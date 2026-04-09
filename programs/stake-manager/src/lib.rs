use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::Mint;

declare_id!("Stak111111111111111111111111111111111111111");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// 2 SOL in lamports.
pub const STAKE_AMOUNT: u64 = 2_000_000_000;
/// 72 hours in seconds — minimum lock before a stake can be evaluated.
pub const MILESTONE_WINDOW: i64 = 259_200;

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

#[program]
pub mod stake_manager {
    use super::*;

    /// One-time global setup.
    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        let vault = &mut ctx.accounts.stake_vault;
        vault.authority = ctx.accounts.authority.key();
        vault.pending_authority = Pubkey::default();
        vault.crank_authority = ctx.accounts.authority.key();
        vault.pending_crank_authority = Pubkey::default();
        vault.oracle_authority = ctx.accounts.authority.key();
        vault.pending_oracle_authority = Pubkey::default();
        vault.total_escrowed = 0;
        vault.total_survivor_pool = 0;
        vault.total_returned = 0;
        vault.total_distributed = 0;
        vault.last_distribution = 0;
        vault.emergency_paused = false;
        vault.bump = ctx.bumps.stake_vault;

        emit!(VaultInitialized {
            authority: vault.authority,
        });
        Ok(())
    }

    // -----------------------------------------------------------------
    // Authority management (two-step transfer for each role)
    // -----------------------------------------------------------------

    pub fn propose_authority(ctx: Context<AdminOnly>, new_authority: Pubkey) -> Result<()> {
        ctx.accounts.stake_vault.pending_authority = new_authority;
        emit!(AuthorityProposed { role: 0, new_authority });
        Ok(())
    }

    pub fn accept_authority(ctx: Context<AcceptRole>) -> Result<()> {
        let vault = &mut ctx.accounts.stake_vault;
        require!(
            vault.pending_authority == ctx.accounts.new_signer.key(),
            StakeError::Unauthorized
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
        ctx.accounts.stake_vault.pending_crank_authority = new_authority;
        emit!(AuthorityProposed { role: 1, new_authority });
        Ok(())
    }

    pub fn accept_crank_authority(ctx: Context<AcceptRole>) -> Result<()> {
        let vault = &mut ctx.accounts.stake_vault;
        require!(
            vault.pending_crank_authority == ctx.accounts.new_signer.key(),
            StakeError::Unauthorized
        );
        let old = vault.crank_authority;
        vault.crank_authority = ctx.accounts.new_signer.key();
        vault.pending_crank_authority = Pubkey::default();
        emit!(AuthorityRotated { role: 1, old, new: vault.crank_authority });
        Ok(())
    }

    pub fn propose_oracle_authority(
        ctx: Context<AdminOnly>,
        new_authority: Pubkey,
    ) -> Result<()> {
        ctx.accounts.stake_vault.pending_oracle_authority = new_authority;
        emit!(AuthorityProposed { role: 2, new_authority });
        Ok(())
    }

    pub fn accept_oracle_authority(ctx: Context<AcceptRole>) -> Result<()> {
        let vault = &mut ctx.accounts.stake_vault;
        require!(
            vault.pending_oracle_authority == ctx.accounts.new_signer.key(),
            StakeError::Unauthorized
        );
        let old = vault.oracle_authority;
        vault.oracle_authority = ctx.accounts.new_signer.key();
        vault.pending_oracle_authority = Pubkey::default();
        emit!(AuthorityRotated { role: 2, old, new: vault.oracle_authority });
        Ok(())
    }

    // -----------------------------------------------------------------
    // Emergency mode
    // -----------------------------------------------------------------

    pub fn emergency_pause(ctx: Context<AdminOnly>) -> Result<()> {
        ctx.accounts.stake_vault.emergency_paused = true;
        emit!(EmergencyPauseToggled { paused: true });
        Ok(())
    }

    pub fn emergency_unpause(ctx: Context<AdminOnly>) -> Result<()> {
        ctx.accounts.stake_vault.emergency_paused = false;
        emit!(EmergencyPauseToggled { paused: false });
        Ok(())
    }

    /// Creator escape hatch. Only callable while paused. The creator pulls
    /// back their own escrowed stake regardless of milestone state.
    pub fn emergency_withdraw_stake(ctx: Context<EmergencyWithdrawStake>) -> Result<()> {
        require!(
            ctx.accounts.stake_vault.emergency_paused,
            StakeError::NotPaused
        );

        let prior_state = ctx.accounts.stake.state;
        require!(
            prior_state != StakeState::EmergencyWithdrawn
                && prior_state != StakeState::Returned,
            StakeError::AlreadyWithdrawn
        );

        let amount = ctx.accounts.stake.amount;
        transfer_lamports_with_floor(
            &ctx.accounts.stake_vault.to_account_info(),
            &ctx.accounts.creator.to_account_info(),
            amount,
            ctx.accounts.stake_vault.total_escrowed.saturating_sub(amount),
        )?;

        let vault = &mut ctx.accounts.stake_vault;
        match prior_state {
            StakeState::Escrowed => {
                vault.total_escrowed = vault
                    .total_escrowed
                    .checked_sub(amount)
                    .ok_or(StakeError::MathOverflow)?;
            }
            StakeState::Forfeited => {
                vault.total_survivor_pool = vault
                    .total_survivor_pool
                    .checked_sub(amount)
                    .ok_or(StakeError::MathOverflow)?;
            }
            _ => {}
        }

        let stake = &mut ctx.accounts.stake;
        stake.state = StakeState::EmergencyWithdrawn;

        emit!(StakeEmergencyWithdrawn {
            mint: stake.mint,
            creator: stake.creator,
            amount,
        });
        Ok(())
    }

    /// Admin escape hatch. Sweeps the unspent survivor pool to a destination
    /// while paused. Active escrowed stakes and rent are protected.
    pub fn emergency_sweep_survivor_pool(ctx: Context<EmergencySweep>) -> Result<()> {
        require!(
            ctx.accounts.stake_vault.emergency_paused,
            StakeError::NotPaused
        );

        let undistributed = ctx.accounts.stake_vault
            .total_survivor_pool
            .checked_sub(ctx.accounts.stake_vault.total_distributed)
            .ok_or(StakeError::MathOverflow)?;
        require!(undistributed > 0, StakeError::NothingToDistribute);

        let vault_info = ctx.accounts.stake_vault.to_account_info();
        let dest_info = ctx.accounts.destination.to_account_info();

        let rent = Rent::get()?;
        let min_balance = rent
            .minimum_balance(vault_info.data_len())
            .checked_add(ctx.accounts.stake_vault.total_escrowed)
            .ok_or(StakeError::MathOverflow)?;
        let current = vault_info.lamports();
        let max_withdrawable = current
            .checked_sub(min_balance)
            .ok_or(StakeError::MathOverflow)?;
        let amount = undistributed.min(max_withdrawable);
        require!(amount > 0, StakeError::NothingToDistribute);

        **vault_info.try_borrow_mut_lamports()? = current
            .checked_sub(amount)
            .ok_or(StakeError::MathOverflow)?;
        **dest_info.try_borrow_mut_lamports()? = dest_info
            .lamports()
            .checked_add(amount)
            .ok_or(StakeError::MathOverflow)?;

        let vault = &mut ctx.accounts.stake_vault;
        vault.total_distributed = vault
            .total_distributed
            .checked_add(amount)
            .ok_or(StakeError::MathOverflow)?;
        vault.last_distribution = Clock::get()?.unix_timestamp;

        emit!(SurvivorPoolSwept {
            destination: ctx.accounts.destination.key(),
            amount,
        });
        Ok(())
    }

    // -----------------------------------------------------------------
    // Core stake lifecycle
    // -----------------------------------------------------------------

    /// Deposit a 2 SOL stake. Designed to be called as a CPI from
    /// `batch_auction::create_auction` so the stake is always tied to a
    /// real launch. Direct calls also work.
    pub fn deposit_stake(ctx: Context<DepositStake>) -> Result<()> {
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.creator.to_account_info(),
                    to: ctx.accounts.stake_vault.to_account_info(),
                },
            ),
            STAKE_AMOUNT,
        )?;

        let now = Clock::get()?.unix_timestamp;
        let mint = ctx.accounts.mint.key();

        let stake = &mut ctx.accounts.stake;
        stake.creator = ctx.accounts.creator.key();
        stake.mint = mint;
        stake.amount = STAKE_AMOUNT;
        stake.created_at = now;
        stake.milestone_deadline = now
            .checked_add(MILESTONE_WINDOW)
            .ok_or(StakeError::MathOverflow)?;
        stake.state = StakeState::Escrowed;
        stake.bump = ctx.bumps.stake;

        let vault = &mut ctx.accounts.stake_vault;
        vault.total_escrowed = vault
            .total_escrowed
            .checked_add(STAKE_AMOUNT)
            .ok_or(StakeError::MathOverflow)?;

        emit!(StakeDeposited {
            mint,
            creator: stake.creator,
            amount: STAKE_AMOUNT,
            milestone_deadline: stake.milestone_deadline,
        });
        Ok(())
    }

    /// Backend-only: evaluate the 72-hour milestone for a stake.
    ///
    /// The oracle (off-chain backend) computes whether the token met the
    /// required thresholds (100 unique holders + $100k mcap equivalent) and
    /// signs the transaction with the oracle authority key. The contract
    /// only checks the signer; it trusts the oracle for the actual numbers.
    ///
    /// `milestone_passed = true` → stake returned to creator.
    /// `milestone_passed = false` → stake forfeited to the survivor pool.
    pub fn evaluate_milestone(
        ctx: Context<EvaluateMilestone>,
        milestone_passed: bool,
    ) -> Result<()> {
        require!(
            ctx.accounts.oracle.key() == ctx.accounts.stake_vault.oracle_authority,
            StakeError::Unauthorized
        );

        let now = Clock::get()?.unix_timestamp;
        let stake_state = ctx.accounts.stake.state;
        let stake_deadline = ctx.accounts.stake.milestone_deadline;
        let stake_amount = ctx.accounts.stake.amount;

        require!(
            stake_state == StakeState::Escrowed,
            StakeError::AlreadyEvaluated
        );
        require!(now >= stake_deadline, StakeError::DeadlineNotReached);

        if milestone_passed {
            // Return stake to creator with rent-floor protection.
            let vault_info = ctx.accounts.stake_vault.to_account_info();
            let creator_info = ctx.accounts.creator.to_account_info();
            transfer_lamports_with_floor(
                &vault_info,
                &creator_info,
                stake_amount,
                ctx.accounts
                    .stake_vault
                    .total_escrowed
                    .saturating_sub(stake_amount),
            )?;
        }

        let stake = &mut ctx.accounts.stake;
        let vault = &mut ctx.accounts.stake_vault;

        if milestone_passed {
            stake.state = StakeState::Returned;
            vault.total_returned = vault
                .total_returned
                .checked_add(stake_amount)
                .ok_or(StakeError::MathOverflow)?;
        } else {
            stake.state = StakeState::Forfeited;
            vault.total_survivor_pool = vault
                .total_survivor_pool
                .checked_add(stake_amount)
                .ok_or(StakeError::MathOverflow)?;
        }

        vault.total_escrowed = vault
            .total_escrowed
            .checked_sub(stake_amount)
            .ok_or(StakeError::MathOverflow)?;

        emit!(MilestoneEvaluated {
            mint: stake.mint,
            creator: stake.creator,
            passed: milestone_passed,
            amount: stake_amount,
        });
        Ok(())
    }

    /// Backend-only: forfeit a stake outside the normal milestone window.
    ///
    /// Used when the auction itself failed (< 50 wallets / < 10 SOL in 5 min)
    /// and there's no point waiting 72 hours to release the survivor-pool funds.
    /// The crank submits this immediately after auction finalization.
    pub fn forfeit_stake_for_failed_auction(
        ctx: Context<ForfeitStake>,
    ) -> Result<()> {
        require!(
            ctx.accounts.crank.key() == ctx.accounts.stake_vault.crank_authority,
            StakeError::Unauthorized
        );

        let stake_state = ctx.accounts.stake.state;
        let stake_amount = ctx.accounts.stake.amount;

        require!(
            stake_state == StakeState::Escrowed,
            StakeError::AlreadyEvaluated
        );

        let stake = &mut ctx.accounts.stake;
        let vault = &mut ctx.accounts.stake_vault;

        stake.state = StakeState::Forfeited;
        vault.total_survivor_pool = vault
            .total_survivor_pool
            .checked_add(stake_amount)
            .ok_or(StakeError::MathOverflow)?;
        vault.total_escrowed = vault
            .total_escrowed
            .checked_sub(stake_amount)
            .ok_or(StakeError::MathOverflow)?;

        emit!(StakeForfeited {
            mint: stake.mint,
            creator: stake.creator,
            amount: stake_amount,
            reason: ForfeitReason::AuctionFailed,
        });
        Ok(())
    }

    /// Backend-only stub for the future quest-weighted survivor pool
    /// distribution. Currently a no-op that just emits an event.
    /// Full implementation deferred to PR2 (requires Raydium CPI for the
    /// auto-LP swap-and-deposit mechanic).
    pub fn distribute_survivor_pool(ctx: Context<DistributeSurvivorPool>) -> Result<()> {
        require!(
            ctx.accounts.crank.key() == ctx.accounts.stake_vault.crank_authority,
            StakeError::Unauthorized
        );
        emit!(SurvivorPoolDistributionRequested {
            timestamp: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Lamport-transfer helper with rent-exempt floor protection.
// ---------------------------------------------------------------------------

fn transfer_lamports_with_floor<'info>(
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    amount: u64,
    additional_reserved: u64,
) -> Result<()> {
    require!(amount > 0, StakeError::NothingToDistribute);
    let rent = Rent::get()?;
    let min_balance = rent
        .minimum_balance(from.data_len())
        .checked_add(additional_reserved)
        .ok_or(StakeError::MathOverflow)?;
    let current = from.lamports();
    let after = current
        .checked_sub(amount)
        .ok_or(StakeError::MathOverflow)?;
    require!(after >= min_balance, StakeError::RentFloorViolated);

    **from.try_borrow_mut_lamports()? = after;
    **to.try_borrow_mut_lamports()? = to
        .lamports()
        .checked_add(amount)
        .ok_or(StakeError::MathOverflow)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Account Contexts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(
        init,
        payer = authority,
        space = StakeVault::SIZE,
        seeds = [b"stake_vault"],
        bump,
    )]
    pub stake_vault: Account<'info, StakeVault>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(
        mut,
        seeds = [b"stake_vault"],
        bump = stake_vault.bump,
        constraint = stake_vault.authority == authority.key() @ StakeError::Unauthorized,
    )]
    pub stake_vault: Account<'info, StakeVault>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct AcceptRole<'info> {
    #[account(
        mut,
        seeds = [b"stake_vault"],
        bump = stake_vault.bump,
    )]
    pub stake_vault: Account<'info, StakeVault>,

    pub new_signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct DepositStake<'info> {
    #[account(
        mut,
        seeds = [b"stake_vault"],
        bump = stake_vault.bump,
    )]
    pub stake_vault: Account<'info, StakeVault>,

    #[account(
        init,
        payer = creator,
        space = Stake::SIZE,
        seeds = [b"stake", mint.key().as_ref()],
        bump,
    )]
    pub stake: Account<'info, Stake>,

    /// The token mint this stake is bound to. Validated as a real SPL Mint
    /// rather than a raw pubkey arg, so junk pubkeys can't fabricate stakes.
    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub creator: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EvaluateMilestone<'info> {
    #[account(
        mut,
        seeds = [b"stake_vault"],
        bump = stake_vault.bump,
    )]
    pub stake_vault: Account<'info, StakeVault>,

    #[account(
        mut,
        seeds = [b"stake", stake.mint.as_ref()],
        bump = stake.bump,
    )]
    pub stake: Account<'info, Stake>,

    /// CHECK: The creator wallet that receives SOL back on success.
    /// Validated against stake.creator.
    #[account(
        mut,
        constraint = creator.key() == stake.creator @ StakeError::CreatorMismatch,
    )]
    pub creator: AccountInfo<'info>,

    /// Backend oracle. Must equal stake_vault.oracle_authority.
    pub oracle: Signer<'info>,
}

#[derive(Accounts)]
pub struct ForfeitStake<'info> {
    #[account(
        mut,
        seeds = [b"stake_vault"],
        bump = stake_vault.bump,
    )]
    pub stake_vault: Account<'info, StakeVault>,

    #[account(
        mut,
        seeds = [b"stake", stake.mint.as_ref()],
        bump = stake.bump,
    )]
    pub stake: Account<'info, Stake>,

    /// Backend crank. Must equal stake_vault.crank_authority.
    pub crank: Signer<'info>,
}

#[derive(Accounts)]
pub struct DistributeSurvivorPool<'info> {
    #[account(
        mut,
        seeds = [b"stake_vault"],
        bump = stake_vault.bump,
    )]
    pub stake_vault: Account<'info, StakeVault>,

    pub crank: Signer<'info>,
}

#[derive(Accounts)]
pub struct EmergencyWithdrawStake<'info> {
    #[account(
        mut,
        seeds = [b"stake_vault"],
        bump = stake_vault.bump,
    )]
    pub stake_vault: Account<'info, StakeVault>,

    #[account(
        mut,
        seeds = [b"stake", stake.mint.as_ref()],
        bump = stake.bump,
        constraint = stake.creator == creator.key() @ StakeError::CreatorMismatch,
        close = creator,
    )]
    pub stake: Account<'info, Stake>,

    #[account(mut)]
    pub creator: Signer<'info>,
}

#[derive(Accounts)]
pub struct EmergencySweep<'info> {
    #[account(
        mut,
        seeds = [b"stake_vault"],
        bump = stake_vault.bump,
        constraint = stake_vault.authority == authority.key() @ StakeError::Unauthorized,
    )]
    pub stake_vault: Account<'info, StakeVault>,

    pub authority: Signer<'info>,

    /// CHECK: Receives the swept lamports. Authority chooses the destination.
    #[account(mut)]
    pub destination: AccountInfo<'info>,
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[account]
pub struct StakeVault {
    /// Protocol admin (parameter changes, role rotations, emergency).
    pub authority: Pubkey,
    pub pending_authority: Pubkey,
    /// Backend service authorized to crank lifecycle instructions.
    pub crank_authority: Pubkey,
    pub pending_crank_authority: Pubkey,
    /// Backend service authorized to sign milestone attestations.
    pub oracle_authority: Pubkey,
    pub pending_oracle_authority: Pubkey,
    /// Total SOL currently held in escrow (active stakes).
    pub total_escrowed: u64,
    /// Cumulative SOL forfeited to the survivor pool.
    pub total_survivor_pool: u64,
    /// Cumulative SOL returned to successful creators.
    pub total_returned: u64,
    /// Cumulative SOL distributed from the survivor pool.
    pub total_distributed: u64,
    /// Unix timestamp of the last survivor-pool distribution / sweep.
    pub last_distribution: i64,
    /// When true, emergency withdrawal instructions are unlocked.
    pub emergency_paused: bool,
    /// PDA bump.
    pub bump: u8,
}

impl StakeVault {
    /// 8 (discriminator) + 6*32 + 5*8 + 8 + 1 + 1 = 250
    pub const SIZE: usize = 8 + (6 * 32) + (5 * 8) + 8 + 1 + 1;
}

#[account]
pub struct Stake {
    /// The creator who deposited the stake.
    pub creator: Pubkey,
    /// The token mint this stake is associated with.
    pub mint: Pubkey,
    /// Amount locked (always STAKE_AMOUNT).
    pub amount: u64,
    /// When the stake was created.
    pub created_at: i64,
    /// Earliest timestamp at which the milestone can be evaluated.
    pub milestone_deadline: i64,
    /// Current state of this stake.
    pub state: StakeState,
    /// PDA bump.
    pub bump: u8,
}

impl Stake {
    /// 8 (discriminator) + 32 + 32 + 8 + 8 + 8 + 1 + 1
    pub const SIZE: usize = 8 + 32 + 32 + 8 + 8 + 8 + 1 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum StakeState {
    Escrowed,
    Returned,
    Forfeited,
    /// The creator pulled the stake out via the emergency escape hatch.
    EmergencyWithdrawn,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ForfeitReason {
    AuctionFailed,
    MilestoneFailed,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[event]
pub struct VaultInitialized {
    pub authority: Pubkey,
}

#[event]
pub struct AuthorityProposed {
    /// 0 = admin, 1 = crank, 2 = oracle
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
pub struct EmergencyPauseToggled {
    pub paused: bool,
}

#[event]
pub struct StakeDeposited {
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub amount: u64,
    pub milestone_deadline: i64,
}

#[event]
pub struct MilestoneEvaluated {
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub passed: bool,
    pub amount: u64,
}

#[event]
pub struct StakeForfeited {
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub amount: u64,
    pub reason: ForfeitReason,
}

#[event]
pub struct StakeEmergencyWithdrawn {
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub amount: u64,
}

#[event]
pub struct SurvivorPoolSwept {
    pub destination: Pubkey,
    pub amount: u64,
}

#[event]
pub struct SurvivorPoolDistributionRequested {
    pub timestamp: i64,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[error_code]
pub enum StakeError {
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Milestone deadline has not been reached yet")]
    DeadlineNotReached,
    #[msg("Stake has already been evaluated")]
    AlreadyEvaluated,
    #[msg("Creator pubkey does not match stake record")]
    CreatorMismatch,
    #[msg("Nothing to distribute from the survivor pool")]
    NothingToDistribute,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Emergency mode is not active")]
    NotPaused,
    #[msg("Stake has already been withdrawn")]
    AlreadyWithdrawn,
    #[msg("Withdrawal would push the vault below its rent-exempt floor")]
    RentFloorViolated,
}
