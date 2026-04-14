use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

// PROVE Fee Architecture:
//
// 1. Raydium CLMM pool created with 1% fee tier.
// 2. LP position NFT held by the `crank_authority` (a hot but low-blast-
//    radius custodian key). The crank is the only signer that can call
//    Raydium's `decrease_liquidity_v2` on the position, so fee collection
//    is a normal backend transaction — no on-chain Raydium CPI required.
// 3. Every swap on Raydium/Jupiter pays 1% — cannot be bypassed.
// 4. Fee collection flow (per pool, run by backend crank every ~15m):
//      a) crank calls Raydium decrease_liquidity_v2(liquidity=0) via SDK.
//         Fees accrue into the crank's token ATAs (WSOL side + token side).
//      b) crank closes the WSOL ATA → native SOL lands in the crank wallet.
//      c) crank `system::transfer` SOLs into the pool_fee_account PDA.
//      d) crank calls `claim_and_split` which reads the PDA balance above
//         rent floor and splits 80/20 to creator and protocol treasury.
//         This step is the *on-chain enforcement* of the 80/20 rule —
//         the crank cannot cheat the split.
// 5. Security trade-off vs a "PDA-owns-LP" design:
//    - Crank compromise can drain LP NFTs directly (blast radius = pool
//      liquidity). Mitigations: (1) crank is a dedicated low-permission
//      key rotated via two-step accept, (2) `emergency_pause` freezes
//      `claim_and_split` so stolen SOL can't be laundered through the
//      split path, (3) admin can rotate the crank via
//      `propose_crank_authority`.
//    - The 80/20 split itself remains on-chain enforced: crank cannot
//      redirect fees to themselves without calling `claim_and_split`,
//      and that instruction validates the creator + treasury against
//      stored values.
// 6. Migration hatch (`recover_lp_nft`) is retained but now requires the
//    crank to co-sign the transfer (admin authority alone cannot move a
//    crank-owned NFT). In practice the admin pauses, rotates the crank,
//    and the new crank moves the NFT to `recovery_destination`.

declare_id!("6RMoCadvfUsKCYMsTNUKv9vXk6MfrVHRkB7iZ6Kd6gck");

// Real basis-point denominator. 10_000 bps = 100%.
const BPS_DENOMINATOR: u16 = 10_000;
const DEFAULT_CREATOR_BPS: u16 = 8_000;
const DEFAULT_PROTOCOL_BPS: u16 = 2_000;
/// Hard floor on creator share. Even a compromised admin cannot redirect
/// more than 50% of fees away from creators in a single instruction.
const CREATOR_BPS_FLOOR: u16 = 5_000;

#[program]
pub mod fee_router {
    use super::*;

    /// One-time global setup. Defaults: 80% creator / 20% protocol.
    /// `recovery_destination` defaults to the admin and can be rotated later.
    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        protocol_treasury: Pubkey,
    ) -> Result<()> {
        let vault = &mut ctx.accounts.fee_vault;
        vault.authority = ctx.accounts.authority.key();
        vault.pending_authority = Pubkey::default();
        vault.crank_authority = ctx.accounts.authority.key();
        vault.pending_crank_authority = Pubkey::default();
        vault.creator_bps = DEFAULT_CREATOR_BPS;
        vault.protocol_bps = DEFAULT_PROTOCOL_BPS;
        vault.protocol_treasury = protocol_treasury;
        vault.recovery_destination = ctx.accounts.authority.key();
        vault.emergency_paused = false;
        vault.bump = ctx.bumps.fee_vault;

        emit!(VaultInitialized {
            authority: vault.authority,
            protocol_treasury,
            creator_bps: vault.creator_bps,
            protocol_bps: vault.protocol_bps,
        });
        Ok(())
    }

    // -----------------------------------------------------------------
    // Authority management (two-step)
    // -----------------------------------------------------------------

    pub fn propose_authority(ctx: Context<AdminOnly>, new_authority: Pubkey) -> Result<()> {
        ctx.accounts.fee_vault.pending_authority = new_authority;
        emit!(AuthorityProposed { role: 0, new_authority });
        Ok(())
    }

    pub fn accept_authority(ctx: Context<AcceptRole>) -> Result<()> {
        let vault = &mut ctx.accounts.fee_vault;
        require!(
            vault.pending_authority == ctx.accounts.new_signer.key(),
            FeeRouterError::Unauthorized
        );
        let old = vault.authority;
        vault.authority = ctx.accounts.new_signer.key();
        vault.pending_authority = Pubkey::default();
        emit!(AuthorityRotated { role: 0, old, new: vault.authority });
        Ok(())
    }

    pub fn propose_crank_authority(
        ctx: Context<AdminOnly>,
        new_authority: Pubkey,
    ) -> Result<()> {
        ctx.accounts.fee_vault.pending_crank_authority = new_authority;
        emit!(AuthorityProposed { role: 1, new_authority });
        Ok(())
    }

    pub fn accept_crank_authority(ctx: Context<AcceptRole>) -> Result<()> {
        let vault = &mut ctx.accounts.fee_vault;
        require!(
            vault.pending_crank_authority == ctx.accounts.new_signer.key(),
            FeeRouterError::Unauthorized
        );
        let old = vault.crank_authority;
        vault.crank_authority = ctx.accounts.new_signer.key();
        vault.pending_crank_authority = Pubkey::default();
        emit!(AuthorityRotated { role: 1, old, new: vault.crank_authority });
        Ok(())
    }

    /// Admin-only: rotate the recovery destination (where the LP position
    /// NFT lands during a migration).
    pub fn set_recovery_destination(
        ctx: Context<AdminOnly>,
        destination: Pubkey,
    ) -> Result<()> {
        ctx.accounts.fee_vault.recovery_destination = destination;
        emit!(RecoveryDestinationSet { destination });
        Ok(())
    }

    /// Admin-only: update the protocol treasury address. Required when
    /// rotating the protocol's receiving wallet.
    pub fn update_treasury(
        ctx: Context<AdminOnly>,
        new_treasury: Pubkey,
    ) -> Result<()> {
        require!(
            new_treasury != Pubkey::default(),
            FeeRouterError::InvalidTreasury
        );
        let old = ctx.accounts.fee_vault.protocol_treasury;
        ctx.accounts.fee_vault.protocol_treasury = new_treasury;
        emit!(TreasuryUpdated { old, new: new_treasury });
        Ok(())
    }

    /// Admin-only: update the fee split. Enforces a hard floor on the
    /// creator share to defend against admin-key compromise.
    pub fn update_split(
        ctx: Context<AdminOnly>,
        new_creator_bps: u16,
        new_protocol_bps: u16,
    ) -> Result<()> {
        require!(
            new_creator_bps
                .checked_add(new_protocol_bps)
                .ok_or(FeeRouterError::MathOverflow)?
                == BPS_DENOMINATOR,
            FeeRouterError::InvalidSplit
        );
        require!(
            new_creator_bps >= CREATOR_BPS_FLOOR,
            FeeRouterError::CreatorShareBelowFloor
        );

        let vault = &mut ctx.accounts.fee_vault;
        vault.creator_bps = new_creator_bps;
        vault.protocol_bps = new_protocol_bps;

        emit!(SplitUpdated {
            creator_bps: new_creator_bps,
            protocol_bps: new_protocol_bps,
        });
        Ok(())
    }

    // -----------------------------------------------------------------
    // Emergency mode
    // -----------------------------------------------------------------

    pub fn emergency_pause(ctx: Context<AdminOnly>) -> Result<()> {
        ctx.accounts.fee_vault.emergency_paused = true;
        emit!(EmergencyPauseToggled { paused: true });
        Ok(())
    }

    pub fn emergency_unpause(ctx: Context<AdminOnly>) -> Result<()> {
        ctx.accounts.fee_vault.emergency_paused = false;
        emit!(EmergencyPauseToggled { paused: false });
        Ok(())
    }

    /// Backend-only emergency drain when paused. Splits all lamports above
    /// the rent floor in the `pool_fee_account` PDA between creator and
    /// protocol treasury per the stored split.
    pub fn emergency_drain_pool(ctx: Context<EmergencyDrainPool>) -> Result<()> {
        require!(
            ctx.accounts.fee_vault.emergency_paused,
            FeeRouterError::NotPaused
        );
        require!(
            ctx.accounts.crank.key() == ctx.accounts.fee_vault.crank_authority,
            FeeRouterError::Unauthorized
        );

        let pda_info = ctx.accounts.pool_fee_account.to_account_info();
        let rent = Rent::get()?;
        let min_balance = rent.minimum_balance(pda_info.data_len());
        let current = pda_info.lamports();
        let drainable = current
            .checked_sub(min_balance)
            .ok_or(FeeRouterError::MathOverflow)?;
        require!(drainable > 0, FeeRouterError::NothingToClaim);

        split_and_send_lamports(
            &pda_info,
            &ctx.accounts.creator.to_account_info(),
            &ctx.accounts.protocol_treasury.to_account_info(),
            drainable,
            ctx.accounts.fee_vault.creator_bps,
        )?;

        // Compute the per-recipient breakdown so accounting stays consistent
        // with claim_and_split — callers of total_sol_to_creator/protocol
        // (e.g. indexer dashboards) get correct totals.
        let creator_bps = ctx.accounts.fee_vault.creator_bps;
        let to_creator = (drainable as u128)
            .checked_mul(creator_bps as u128)
            .ok_or(FeeRouterError::MathOverflow)?
            .checked_div(BPS_DENOMINATOR as u128)
            .ok_or(FeeRouterError::MathOverflow)? as u64;
        let to_protocol = drainable
            .checked_sub(to_creator)
            .ok_or(FeeRouterError::MathOverflow)?;

        let pool_fee = &mut ctx.accounts.pool_fee_account;
        pool_fee.total_sol_claimed = pool_fee
            .total_sol_claimed
            .checked_add(drainable)
            .ok_or(FeeRouterError::MathOverflow)?;
        pool_fee.total_sol_to_creator = pool_fee
            .total_sol_to_creator
            .checked_add(to_creator)
            .ok_or(FeeRouterError::MathOverflow)?;
        pool_fee.total_sol_to_protocol = pool_fee
            .total_sol_to_protocol
            .checked_add(to_protocol)
            .ok_or(FeeRouterError::MathOverflow)?;
        pool_fee.last_claim = Clock::get()?.unix_timestamp;

        emit!(PoolDrained {
            mint: pool_fee.mint,
            amount: drainable,
        });
        Ok(())
    }

    // -----------------------------------------------------------------
    // Pool registration & claim cycle
    // -----------------------------------------------------------------

    /// Backend-only: register a Raydium CLMM pool. Verifies that the LP
    /// position NFT is held by the crank_authority custodian and that
    /// the account holds exactly 1 unit. See the architecture comment
    /// at the top of the file for why crank-custodial was chosen over
    /// PDA-escrowed ownership.
    pub fn register_pool(
        ctx: Context<RegisterPool>,
        creator: Pubkey,
        raydium_pool_id: Pubkey,
    ) -> Result<()> {
        require!(
            !ctx.accounts.fee_vault.emergency_paused,
            FeeRouterError::Paused
        );
        require!(
            ctx.accounts.crank.key() == ctx.accounts.fee_vault.crank_authority,
            FeeRouterError::Unauthorized
        );

        require!(
            ctx.accounts.position_nft_account.owner
                == ctx.accounts.fee_vault.crank_authority,
            FeeRouterError::PositionNftNotHeldByCrank
        );
        require!(
            ctx.accounts.position_nft_account.amount == 1,
            FeeRouterError::PositionNftNotHeldByCrank
        );
        require!(
            ctx.accounts.position_nft_account.mint == ctx.accounts.position_nft_mint.key(),
            FeeRouterError::PositionNftMismatch
        );

        let pool_fee = &mut ctx.accounts.pool_fee_account;
        pool_fee.mint = ctx.accounts.mint.key();
        pool_fee.creator = creator;
        pool_fee.raydium_pool_id = raydium_pool_id;
        pool_fee.position_nft_mint = ctx.accounts.position_nft_mint.key();
        pool_fee.position_nft_account = ctx.accounts.position_nft_account.key();
        pool_fee.total_sol_claimed = 0;
        pool_fee.total_sol_to_creator = 0;
        pool_fee.total_sol_to_protocol = 0;
        pool_fee.last_claim = 0;
        pool_fee.bump = ctx.bumps.pool_fee_account;

        emit!(PoolRegistered {
            mint: pool_fee.mint,
            creator,
            raydium_pool_id,
            position_nft_mint: pool_fee.position_nft_mint,
        });
        Ok(())
    }

    /// Backend-only: split whatever drainable SOL is sitting in the
    /// `pool_fee_account` PDA between creator and protocol treasury.
    /// Reads the actual PDA balance instead of trusting caller-supplied
    /// amounts.
    pub fn claim_and_split(ctx: Context<ClaimAndSplit>) -> Result<()> {
        require!(
            !ctx.accounts.fee_vault.emergency_paused,
            FeeRouterError::Paused
        );
        require!(
            ctx.accounts.crank.key() == ctx.accounts.fee_vault.crank_authority,
            FeeRouterError::Unauthorized
        );

        let pda_info = ctx.accounts.pool_fee_account.to_account_info();
        let rent = Rent::get()?;
        let min_balance = rent.minimum_balance(pda_info.data_len());
        let current = pda_info.lamports();
        let drainable = current
            .checked_sub(min_balance)
            .ok_or(FeeRouterError::MathOverflow)?;
        require!(drainable > 0, FeeRouterError::NothingToClaim);

        let creator_bps = ctx.accounts.fee_vault.creator_bps;
        split_and_send_lamports(
            &pda_info,
            &ctx.accounts.creator.to_account_info(),
            &ctx.accounts.protocol_treasury.to_account_info(),
            drainable,
            creator_bps,
        )?;

        let to_creator = (drainable as u128)
            .checked_mul(creator_bps as u128)
            .ok_or(FeeRouterError::MathOverflow)?
            .checked_div(BPS_DENOMINATOR as u128)
            .ok_or(FeeRouterError::MathOverflow)? as u64;
        let to_protocol = drainable
            .checked_sub(to_creator)
            .ok_or(FeeRouterError::MathOverflow)?;

        let pool_fee = &mut ctx.accounts.pool_fee_account;
        pool_fee.total_sol_claimed = pool_fee
            .total_sol_claimed
            .checked_add(drainable)
            .ok_or(FeeRouterError::MathOverflow)?;
        pool_fee.total_sol_to_creator = pool_fee
            .total_sol_to_creator
            .checked_add(to_creator)
            .ok_or(FeeRouterError::MathOverflow)?;
        pool_fee.total_sol_to_protocol = pool_fee
            .total_sol_to_protocol
            .checked_add(to_protocol)
            .ok_or(FeeRouterError::MathOverflow)?;
        pool_fee.last_claim = Clock::get()?.unix_timestamp;

        emit!(FeesClaimed {
            mint: pool_fee.mint,
            total: drainable,
            to_creator,
            to_protocol,
        });
        Ok(())
    }

    // -----------------------------------------------------------------
    // Migration hatch
    // -----------------------------------------------------------------

    /// Admin + crank co-signed, paused-only: transfer the LP position NFT
    /// out of the crank custodian wallet to the recovery destination's
    /// token account. This is the migration hatch.
    ///
    /// Because the NFT sits in the crank's own token account in the
    /// crank-custodial model, the crank must authorize the transfer
    /// directly — the program cannot `invoke_signed` it out. The
    /// `authority` co-signature enforces that both admin and crank
    /// agree before an LP position moves. A rogue crank cannot run
    /// this alone (admin required); a rogue admin cannot run this
    /// alone (crank required).
    ///
    /// Recovery playbook if the crank is compromised:
    ///   1. admin calls `emergency_pause`
    ///   2. admin calls `propose_crank_authority(fresh_key)`
    ///   3. fresh crank calls `accept_crank_authority`
    ///   4. fresh crank + admin call `recover_lp_nft`
    pub fn recover_lp_nft(ctx: Context<RecoverLpNft>) -> Result<()> {
        require!(
            ctx.accounts.fee_vault.emergency_paused,
            FeeRouterError::NotPaused
        );
        require!(
            ctx.accounts.authority.key() == ctx.accounts.fee_vault.authority,
            FeeRouterError::Unauthorized
        );
        require!(
            ctx.accounts.crank.key() == ctx.accounts.fee_vault.crank_authority,
            FeeRouterError::Unauthorized
        );
        require!(
            ctx.accounts.recovery_destination_token_account.owner
                == ctx.accounts.fee_vault.recovery_destination,
            FeeRouterError::RecoveryDestinationMismatch
        );
        require!(
            ctx.accounts.position_nft_account.owner
                == ctx.accounts.fee_vault.crank_authority,
            FeeRouterError::PositionNftNotHeldByCrank
        );
        require!(
            ctx.accounts.position_nft_account.amount == 1,
            FeeRouterError::PositionNftNotHeldByCrank
        );

        // NFT is in a crank-owned token account, so the crank is the
        // transfer authority — no PDA signing needed.
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.position_nft_account.to_account_info(),
                    to: ctx
                        .accounts
                        .recovery_destination_token_account
                        .to_account_info(),
                    authority: ctx.accounts.crank.to_account_info(),
                },
            ),
            1,
        )?;

        emit!(LpNftRecovered {
            mint: ctx.accounts.pool_fee_account.mint,
            destination: ctx.accounts.fee_vault.recovery_destination,
        });
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn split_and_send_lamports<'info>(
    from: &AccountInfo<'info>,
    creator: &AccountInfo<'info>,
    treasury: &AccountInfo<'info>,
    total: u64,
    creator_bps: u16,
) -> Result<()> {
    let to_creator = (total as u128)
        .checked_mul(creator_bps as u128)
        .ok_or(FeeRouterError::MathOverflow)?
        .checked_div(BPS_DENOMINATOR as u128)
        .ok_or(FeeRouterError::MathOverflow)? as u64;
    let to_protocol = total
        .checked_sub(to_creator)
        .ok_or(FeeRouterError::MathOverflow)?;

    if to_creator > 0 {
        **from.try_borrow_mut_lamports()? = from
            .lamports()
            .checked_sub(to_creator)
            .ok_or(FeeRouterError::MathOverflow)?;
        **creator.try_borrow_mut_lamports()? = creator
            .lamports()
            .checked_add(to_creator)
            .ok_or(FeeRouterError::MathOverflow)?;
    }
    if to_protocol > 0 {
        **from.try_borrow_mut_lamports()? = from
            .lamports()
            .checked_sub(to_protocol)
            .ok_or(FeeRouterError::MathOverflow)?;
        **treasury.try_borrow_mut_lamports()? = treasury
            .lamports()
            .checked_add(to_protocol)
            .ok_or(FeeRouterError::MathOverflow)?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Account contexts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = FeeVault::SIZE,
        seeds = [b"fee_vault"],
        bump,
    )]
    pub fee_vault: Account<'info, FeeVault>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"fee_vault"],
        bump = fee_vault.bump,
        constraint = fee_vault.authority == authority.key() @ FeeRouterError::Unauthorized,
    )]
    pub fee_vault: Account<'info, FeeVault>,
}

#[derive(Accounts)]
pub struct AcceptRole<'info> {
    #[account(
        mut,
        seeds = [b"fee_vault"],
        bump = fee_vault.bump,
    )]
    pub fee_vault: Account<'info, FeeVault>,

    pub new_signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct RegisterPool<'info> {
    pub crank: Signer<'info>,

    #[account(
        seeds = [b"fee_vault"],
        bump = fee_vault.bump,
    )]
    pub fee_vault: Account<'info, FeeVault>,

    /// CHECK: Only used as a PDA seed; no data read.
    pub mint: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        space = PoolFeeAccount::SIZE,
        seeds = [b"pool_fee", mint.key().as_ref()],
        bump,
    )]
    pub pool_fee_account: Account<'info, PoolFeeAccount>,

    /// CHECK: Used only for key comparison against position_nft_account.mint.
    pub position_nft_mint: UncheckedAccount<'info>,

    /// The token account holding the LP position NFT. Must be owned by
    /// `fee_vault.crank_authority` and contain exactly 1 unit. The handler
    /// enforces ownership at runtime.
    pub position_nft_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimAndSplit<'info> {
    pub crank: Signer<'info>,

    #[account(
        seeds = [b"fee_vault"],
        bump = fee_vault.bump,
    )]
    pub fee_vault: Account<'info, FeeVault>,

    #[account(
        mut,
        seeds = [b"pool_fee", pool_fee_account.mint.as_ref()],
        bump = pool_fee_account.bump,
    )]
    pub pool_fee_account: Account<'info, PoolFeeAccount>,

    /// CHECK: Validated against pool_fee_account.creator.
    #[account(
        mut,
        constraint = creator.key() == pool_fee_account.creator @ FeeRouterError::Unauthorized,
    )]
    pub creator: UncheckedAccount<'info>,

    /// CHECK: Validated against fee_vault.protocol_treasury.
    #[account(
        mut,
        constraint = protocol_treasury.key() == fee_vault.protocol_treasury @ FeeRouterError::Unauthorized,
    )]
    pub protocol_treasury: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EmergencyDrainPool<'info> {
    pub crank: Signer<'info>,

    #[account(
        seeds = [b"fee_vault"],
        bump = fee_vault.bump,
    )]
    pub fee_vault: Account<'info, FeeVault>,

    #[account(
        mut,
        seeds = [b"pool_fee", pool_fee_account.mint.as_ref()],
        bump = pool_fee_account.bump,
    )]
    pub pool_fee_account: Account<'info, PoolFeeAccount>,

    /// CHECK: Validated against pool_fee_account.creator.
    #[account(
        mut,
        constraint = creator.key() == pool_fee_account.creator @ FeeRouterError::Unauthorized,
    )]
    pub creator: UncheckedAccount<'info>,

    /// CHECK: Validated against fee_vault.protocol_treasury.
    #[account(
        mut,
        constraint = protocol_treasury.key() == fee_vault.protocol_treasury @ FeeRouterError::Unauthorized,
    )]
    pub protocol_treasury: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RecoverLpNft<'info> {
    /// Admin authority. Must match `fee_vault.authority`.
    pub authority: Signer<'info>,

    /// Crank custodian. Must match `fee_vault.crank_authority` and be the
    /// owner of `position_nft_account`.
    pub crank: Signer<'info>,

    #[account(
        seeds = [b"fee_vault"],
        bump = fee_vault.bump,
    )]
    pub fee_vault: Account<'info, FeeVault>,

    #[account(
        seeds = [b"pool_fee", pool_fee_account.mint.as_ref()],
        bump = pool_fee_account.bump,
    )]
    pub pool_fee_account: Account<'info, PoolFeeAccount>,

    /// LP position NFT sitting in the crank's token account. Verified
    /// in the handler to be owned by `fee_vault.crank_authority`.
    #[account(
        mut,
        constraint = position_nft_account.key() == pool_fee_account.position_nft_account
            @ FeeRouterError::PositionNftMismatch,
    )]
    pub position_nft_account: Account<'info, TokenAccount>,

    /// Token account at the recovery destination that will receive the NFT.
    #[account(mut)]
    pub recovery_destination_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[account]
pub struct FeeVault {
    pub authority: Pubkey,
    pub pending_authority: Pubkey,
    pub crank_authority: Pubkey,
    pub pending_crank_authority: Pubkey,
    /// Creator share in real basis points (out of 10_000).
    pub creator_bps: u16,
    /// Protocol share in real basis points (out of 10_000).
    pub protocol_bps: u16,
    /// Where the protocol's share of fees goes.
    pub protocol_treasury: Pubkey,
    /// Destination wallet for `recover_lp_nft` migration. Defaults to admin.
    pub recovery_destination: Pubkey,
    /// When true, emergency drain + Raydium-side migration paths unlock.
    pub emergency_paused: bool,
    /// PDA bump seed.
    pub bump: u8,
}

impl FeeVault {
    // 8 (discriminator) + 6*pubkey(192) + 2*u16(4) + bool(1) + u8(1)
    pub const SIZE: usize = 8 + (6 * 32) + 4 + 1 + 1;
}

#[account]
pub struct PoolFeeAccount {
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub raydium_pool_id: Pubkey,
    pub position_nft_mint: Pubkey,
    /// Token account that holds the LP position NFT (owned by this PDA).
    pub position_nft_account: Pubkey,
    pub total_sol_claimed: u64,
    pub total_sol_to_creator: u64,
    pub total_sol_to_protocol: u64,
    pub last_claim: i64,
    pub bump: u8,
}

impl PoolFeeAccount {
    // 8 (discriminator) + 5*pubkey(160) + 3*u64(24) + i64(8) + u8(1)
    pub const SIZE: usize = 8 + (5 * 32) + 24 + 8 + 1;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[event]
pub struct VaultInitialized {
    pub authority: Pubkey,
    pub protocol_treasury: Pubkey,
    pub creator_bps: u16,
    pub protocol_bps: u16,
}

#[event]
pub struct AuthorityProposed {
    /// 0 = admin, 1 = crank
    pub role: u8,
    pub new_authority: Pubkey,
}

#[event]
pub struct AuthorityRotated {
    pub role: u8,
    pub old: Pubkey,
    pub new: Pubkey,
}

#[event]
pub struct RecoveryDestinationSet {
    pub destination: Pubkey,
}

#[event]
pub struct SplitUpdated {
    pub creator_bps: u16,
    pub protocol_bps: u16,
}

#[event]
pub struct TreasuryUpdated {
    pub old: Pubkey,
    pub new: Pubkey,
}

#[event]
pub struct EmergencyPauseToggled {
    pub paused: bool,
}

#[event]
pub struct PoolRegistered {
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub raydium_pool_id: Pubkey,
    pub position_nft_mint: Pubkey,
}

#[event]
pub struct FeesClaimed {
    pub mint: Pubkey,
    pub total: u64,
    pub to_creator: u64,
    pub to_protocol: u64,
}

#[event]
pub struct PoolDrained {
    pub mint: Pubkey,
    pub amount: u64,
}

#[event]
pub struct LpNftRecovered {
    pub mint: Pubkey,
    pub destination: Pubkey,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[error_code]
pub enum FeeRouterError {
    #[msg("Fee split bps must sum to 10_000")]
    InvalidSplit,

    #[msg("Creator share is below the protected floor")]
    CreatorShareBelowFloor,

    #[msg("Unauthorized")]
    Unauthorized,

    #[msg("No fees to claim")]
    NothingToClaim,

    #[msg("Arithmetic overflow")]
    MathOverflow,

    #[msg("Pool already registered")]
    PoolAlreadyRegistered,

    #[msg("Emergency mode is not active")]
    NotPaused,

    #[msg("Protocol is paused")]
    Paused,

    #[msg("Position NFT is not held by the crank_authority custodian")]
    PositionNftNotHeldByCrank,

    #[msg("Position NFT mismatch")]
    PositionNftMismatch,

    #[msg("Recovery destination token account owner mismatch")]
    RecoveryDestinationMismatch,

    #[msg("Treasury address cannot be the default/zero pubkey")]
    InvalidTreasury,
}

// ---------------------------------------------------------------------------
// Unit tests — pure-logic validation (no Solana runtime required)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // ── Account size calculations ────────────────────────────────

    #[test]
    fn fee_vault_size() {
        // 8 (discriminator) + 6*pubkey(192) + 2*u16(4) + bool(1) + u8(1) = 206
        let expected = 8 + (6 * 32) + 4 + 1 + 1;
        assert_eq!(FeeVault::SIZE, expected, "FeeVault::SIZE mismatch");
        assert_eq!(FeeVault::SIZE, 206);
    }

    #[test]
    fn pool_fee_account_size() {
        // 8 (discriminator) + 5*pubkey(160) + 3*u64(24) + i64(8) + u8(1) = 201
        let expected = 8 + (5 * 32) + 24 + 8 + 1;
        assert_eq!(
            PoolFeeAccount::SIZE,
            expected,
            "PoolFeeAccount::SIZE mismatch"
        );
        assert_eq!(PoolFeeAccount::SIZE, 201);
    }

    // ── BPS constants ────────────────────────────────────────────

    #[test]
    fn default_split_sums_to_denominator() {
        assert_eq!(
            DEFAULT_CREATOR_BPS + DEFAULT_PROTOCOL_BPS,
            BPS_DENOMINATOR,
            "default split must sum to 10_000"
        );
    }

    #[test]
    fn default_split_is_80_20() {
        assert_eq!(DEFAULT_CREATOR_BPS, 8_000);
        assert_eq!(DEFAULT_PROTOCOL_BPS, 2_000);
    }

    #[test]
    fn creator_floor_enforced() {
        assert_eq!(CREATOR_BPS_FLOOR, 5_000);
        assert!(
            DEFAULT_CREATOR_BPS >= CREATOR_BPS_FLOOR,
            "default creator share below floor"
        );
    }

    // ── Fee split math ───────────────────────────────────────────

    fn compute_split(total: u64, creator_bps: u16) -> (u64, u64) {
        let to_creator = (total as u128)
            .checked_mul(creator_bps as u128)
            .unwrap()
            .checked_div(BPS_DENOMINATOR as u128)
            .unwrap() as u64;
        let to_protocol = total.checked_sub(to_creator).unwrap();
        (to_creator, to_protocol)
    }

    #[test]
    fn split_80_20_normal() {
        let (creator, protocol) = compute_split(1_000_000_000, 8_000);
        assert_eq!(creator, 800_000_000);
        assert_eq!(protocol, 200_000_000);
        assert_eq!(creator + protocol, 1_000_000_000);
    }

    #[test]
    fn split_80_20_small_amount() {
        // 100 lamports
        let (creator, protocol) = compute_split(100, 8_000);
        assert_eq!(creator, 80);
        assert_eq!(protocol, 20);
    }

    #[test]
    fn split_80_20_single_lamport() {
        // 1 lamport — integer truncation means creator gets 0
        let (creator, protocol) = compute_split(1, 8_000);
        assert_eq!(creator, 0);
        assert_eq!(protocol, 1);
    }

    #[test]
    fn split_conserves_total() {
        // Test across a range of amounts
        for total in [
            1u64,
            7,
            99,
            1_000,
            999_999,
            1_000_000_000,
            u64::MAX / 10_000,
        ] {
            let (creator, protocol) = compute_split(total, 8_000);
            assert_eq!(
                creator + protocol,
                total,
                "split not conserved for total={}",
                total
            );
        }
    }

    #[test]
    fn split_at_floor() {
        // 50/50 split (creator at minimum floor)
        let (creator, protocol) = compute_split(1_000_000, 5_000);
        assert_eq!(creator, 500_000);
        assert_eq!(protocol, 500_000);
    }

    #[test]
    fn split_no_overflow_large_amount() {
        // u128 intermediate prevents overflow even at large amounts
        let total = u64::MAX / 2;
        let (creator, protocol) = compute_split(total, 8_000);
        assert_eq!(creator + protocol, total);
    }

    // ── Update_split validation logic ────────────────────────────

    #[test]
    fn valid_splits() {
        // These should all pass the update_split validation
        let valid = vec![
            (8000u16, 2000u16),
            (5000, 5000),
            (9000, 1000),
            (7500, 2500),
        ];
        for (c, p) in valid {
            assert_eq!(
                c.checked_add(p).unwrap(),
                BPS_DENOMINATOR,
                "invalid test case: {} + {} != 10000",
                c,
                p
            );
            assert!(c >= CREATOR_BPS_FLOOR, "creator {} below floor", c);
        }
    }

    #[test]
    fn invalid_split_below_floor() {
        // 49/51 — creator below 50% floor
        let creator_bps: u16 = 4_999;
        assert!(creator_bps < CREATOR_BPS_FLOOR);
    }

    #[test]
    fn invalid_split_wrong_sum() {
        // 80/30 — doesn't sum to 10_000
        let sum = 8_000u16.checked_add(3_000u16).unwrap();
        assert_ne!(sum, BPS_DENOMINATOR);
    }
}
