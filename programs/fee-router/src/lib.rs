use anchor_lang::prelude::*;

// PROVE Fee Architecture:
//
// 1. Raydium CLMM pool created with 1% fee tier
// 2. LP position NFT held by FeeRouter PDA (protocol-owned)
// 3. Every swap on Raydium/Jupiter pays 1% - cannot be bypassed
// 4. Permissionless crank calls claim_and_split periodically:
//    - Claims accumulated fees from the CLMM position
//    - Splits: 80% to token creator, 20% to protocol treasury
// 5. Creator earns 0.8% of ALL volume, regardless of swap source

declare_id!("FeeR111111111111111111111111111111111111111");

#[program]
pub mod fee_router {
    use super::*;

    /// Initialize the global FeeVault with default split and treasury address.
    /// Called once by the protocol admin.
    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        creator_bps: u16,
        protocol_bps: u16,
        protocol_treasury: Pubkey,
    ) -> Result<()> {
        require!(
            creator_bps
                .checked_add(protocol_bps)
                .ok_or(FeeRouterError::MathOverflow)?
                == 100,
            FeeRouterError::InvalidSplit
        );

        let vault = &mut ctx.accounts.fee_vault;
        vault.authority = ctx.accounts.authority.key();
        vault.creator_bps = creator_bps;
        vault.protocol_bps = protocol_bps;
        vault.protocol_treasury = protocol_treasury;
        vault.bump = ctx.bumps.fee_vault;

        Ok(())
    }

    /// Register a Raydium CLMM pool after it has been created.
    /// Records pool details and transfers the LP position NFT to the FeeRouter PDA.
    pub fn register_pool(
        ctx: Context<RegisterPool>,
        creator: Pubkey,
        raydium_pool_id: Pubkey,
        position_nft_mint: Pubkey,
    ) -> Result<()> {
        let pool_fee = &mut ctx.accounts.pool_fee_account;
        pool_fee.mint = ctx.accounts.mint.key();
        pool_fee.creator = creator;
        pool_fee.raydium_pool_id = raydium_pool_id;
        pool_fee.position_nft_mint = position_nft_mint;
        pool_fee.total_sol_claimed = 0;
        pool_fee.total_token_claimed = 0;
        pool_fee.total_sol_to_creator = 0;
        pool_fee.total_sol_to_protocol = 0;
        pool_fee.total_token_to_creator = 0;
        pool_fee.total_token_to_protocol = 0;
        pool_fee.last_claim = 0;
        pool_fee.bump = ctx.bumps.pool_fee_account;

        // NOTE: The LP position NFT transfer to the FeeRouter PDA happens off-chain
        // before calling this instruction. The PDA address is derived from
        // seeds [b"pool_fee", mint] so the caller can compute it in advance.

        Ok(())
    }

    /// Permissionless crank: claim accumulated fees and split them.
    ///
    /// The off-chain crank reads claimable fees from the Raydium CLMM position,
    /// claims them (depositing into the FeeRouter PDA token accounts), then calls
    /// this instruction with the claimed amounts. This instruction splits and
    /// distributes the fees to creator (80%) and protocol treasury (20%).
    pub fn claim_and_split(
        ctx: Context<ClaimAndSplit>,
        sol_fee_amount: u64,
        token_fee_amount: u64,
    ) -> Result<()> {
        require!(
            sol_fee_amount > 0 || token_fee_amount > 0,
            FeeRouterError::NothingToClaim
        );

        let fee_vault = &ctx.accounts.fee_vault;
        let creator_bps = fee_vault.creator_bps as u64;

        // --- SOL fee split ---
        let sol_to_creator = sol_fee_amount
            .checked_mul(creator_bps)
            .ok_or(FeeRouterError::MathOverflow)?
            .checked_div(100)
            .ok_or(FeeRouterError::MathOverflow)?;
        let sol_to_protocol = sol_fee_amount
            .checked_sub(sol_to_creator)
            .ok_or(FeeRouterError::MathOverflow)?;

        // --- Token fee split ---
        let token_to_creator = token_fee_amount
            .checked_mul(creator_bps)
            .ok_or(FeeRouterError::MathOverflow)?
            .checked_div(100)
            .ok_or(FeeRouterError::MathOverflow)?;
        let token_to_protocol = token_fee_amount
            .checked_sub(token_to_creator)
            .ok_or(FeeRouterError::MathOverflow)?;

        // --- Transfer SOL fees via lamport manipulation ---
        // The pool_fee_account PDA is owned by this program, so we manipulate lamports directly.
        if sol_to_creator > 0 {
            let pda_info = ctx.accounts.pool_fee_account.to_account_info();
            let creator_info = ctx.accounts.creator.to_account_info();
            **pda_info.try_borrow_mut_lamports()? = pda_info
                .lamports()
                .checked_sub(sol_to_creator)
                .ok_or(FeeRouterError::MathOverflow)?;
            **creator_info.try_borrow_mut_lamports()? = creator_info
                .lamports()
                .checked_add(sol_to_creator)
                .ok_or(FeeRouterError::MathOverflow)?;
        }

        if sol_to_protocol > 0 {
            let pda_info = ctx.accounts.pool_fee_account.to_account_info();
            let treasury_info = ctx.accounts.protocol_treasury.to_account_info();
            **pda_info.try_borrow_mut_lamports()? = pda_info
                .lamports()
                .checked_sub(sol_to_protocol)
                .ok_or(FeeRouterError::MathOverflow)?;
            **treasury_info.try_borrow_mut_lamports()? = treasury_info
                .lamports()
                .checked_add(sol_to_protocol)
                .ok_or(FeeRouterError::MathOverflow)?;
        }

        // NOTE: Token fee transfers (SPL token) would use token::transfer with PDA signing.
        // For now, the off-chain crank handles SPL token distribution directly.
        // The amounts are still tracked in the on-chain state for transparency.

        // --- Update running totals ---
        let pool_fee = &mut ctx.accounts.pool_fee_account;
        pool_fee.total_sol_claimed = pool_fee
            .total_sol_claimed
            .checked_add(sol_fee_amount)
            .ok_or(FeeRouterError::MathOverflow)?;
        pool_fee.total_token_claimed = pool_fee
            .total_token_claimed
            .checked_add(token_fee_amount)
            .ok_or(FeeRouterError::MathOverflow)?;
        pool_fee.total_sol_to_creator = pool_fee
            .total_sol_to_creator
            .checked_add(sol_to_creator)
            .ok_or(FeeRouterError::MathOverflow)?;
        pool_fee.total_sol_to_protocol = pool_fee
            .total_sol_to_protocol
            .checked_add(sol_to_protocol)
            .ok_or(FeeRouterError::MathOverflow)?;
        pool_fee.total_token_to_creator = pool_fee
            .total_token_to_creator
            .checked_add(token_to_creator)
            .ok_or(FeeRouterError::MathOverflow)?;
        pool_fee.total_token_to_protocol = pool_fee
            .total_token_to_protocol
            .checked_add(token_to_protocol)
            .ok_or(FeeRouterError::MathOverflow)?;

        let clock = Clock::get()?;
        pool_fee.last_claim = clock.unix_timestamp;

        Ok(())
    }

    /// Admin-only: update the creator/protocol fee split.
    pub fn update_split(
        ctx: Context<UpdateSplit>,
        new_creator_bps: u16,
        new_protocol_bps: u16,
    ) -> Result<()> {
        require!(
            new_creator_bps
                .checked_add(new_protocol_bps)
                .ok_or(FeeRouterError::MathOverflow)?
                == 100,
            FeeRouterError::InvalidSplit
        );

        let vault = &mut ctx.accounts.fee_vault;
        vault.creator_bps = new_creator_bps;
        vault.protocol_bps = new_protocol_bps;

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Accounts structs
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
pub struct RegisterPool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"fee_vault"],
        bump = fee_vault.bump,
        constraint = fee_vault.authority == authority.key() @ FeeRouterError::Unauthorized,
    )]
    pub fee_vault: Account<'info, FeeVault>,

    /// The token mint for which we are registering a pool.
    /// CHECK: Only used as a PDA seed; no data read.
    pub mint: UncheckedAccount<'info>,

    #[account(
        init,
        payer = authority,
        space = PoolFeeAccount::SIZE,
        seeds = [b"pool_fee", mint.key().as_ref()],
        bump,
    )]
    pub pool_fee_account: Account<'info, PoolFeeAccount>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimAndSplit<'info> {
    /// Permissionless: anyone can crank this instruction.
    #[account(mut)]
    pub cranker: Signer<'info>,

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
pub struct UpdateSplit<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"fee_vault"],
        bump = fee_vault.bump,
        constraint = fee_vault.authority == authority.key() @ FeeRouterError::Unauthorized,
    )]
    pub fee_vault: Account<'info, FeeVault>,
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[account]
pub struct FeeVault {
    /// Protocol admin.
    pub authority: Pubkey,
    /// Creator fee share out of 100 (e.g. 80 = 80% of pool fees).
    pub creator_bps: u16,
    /// Protocol fee share out of 100 (e.g. 20 = 20% of pool fees).
    pub protocol_bps: u16,
    /// Where the protocol's share of fees goes.
    pub protocol_treasury: Pubkey,
    /// PDA bump seed.
    pub bump: u8,
}

impl FeeVault {
    // 8 (discriminator) + 32 + 2 + 2 + 32 + 1 = 77
    pub const SIZE: usize = 8 + 32 + 2 + 2 + 32 + 1;
}

#[account]
pub struct PoolFeeAccount {
    /// Token mint.
    pub mint: Pubkey,
    /// Creator wallet (gets 80%).
    pub creator: Pubkey,
    /// Raydium CLMM pool address.
    pub raydium_pool_id: Pubkey,
    /// The CLMM position NFT mint.
    pub position_nft_mint: Pubkey,
    /// Total SOL fees claimed from CLMM.
    pub total_sol_claimed: u64,
    /// Total token fees claimed from CLMM.
    pub total_token_claimed: u64,
    /// Running total SOL sent to creator.
    pub total_sol_to_creator: u64,
    /// Running total SOL sent to protocol.
    pub total_sol_to_protocol: u64,
    /// Running total tokens sent to creator.
    pub total_token_to_creator: u64,
    /// Running total tokens sent to protocol.
    pub total_token_to_protocol: u64,
    /// Timestamp of last fee claim.
    pub last_claim: i64,
    /// PDA bump seed.
    pub bump: u8,
}

impl PoolFeeAccount {
    // 8 (discriminator) + 32 + 32 + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 1 = 193
    pub const SIZE: usize = 8 + 32 + 32 + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 1;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[error_code]
pub enum FeeRouterError {
    #[msg("Fee split bps must sum to 100")]
    InvalidSplit,

    #[msg("Unauthorized")]
    Unauthorized,

    #[msg("No fees to claim")]
    NothingToClaim,

    #[msg("Arithmetic overflow")]
    MathOverflow,

    #[msg("Pool already registered")]
    PoolAlreadyRegistered,
}
