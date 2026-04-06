use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("Stak111111111111111111111111111111111111111");

/// 2 SOL in lamports.
const STAKE_AMOUNT: u64 = 2_000_000_000;
/// 72 hours in seconds.
const MILESTONE_WINDOW: i64 = 259_200;
/// Minimum holder count to pass the milestone.
const HOLDER_THRESHOLD: u16 = 100;

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

#[program]
pub mod stake_manager {
    use super::*;

    /// Creates the global StakeVault singleton. Only callable once (init).
    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        let vault = &mut ctx.accounts.stake_vault;
        vault.authority = ctx.accounts.authority.key();
        vault.total_escrowed = 0;
        vault.total_forfeited = 0;
        vault.total_returned = 0;
        vault.total_distributed = 0;
        vault.last_distribution = 0;
        vault.bump = ctx.bumps.stake_vault;
        Ok(())
    }

    /// Called during auction creation. The token creator deposits 2 SOL into
    /// the vault PDA and a per-mint Stake account is created.
    pub fn deposit_stake(ctx: Context<DepositStake>, mint: Pubkey) -> Result<()> {
        // Transfer 2 SOL from creator to vault PDA.
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

        // Initialise the per-mint Stake record.
        let stake = &mut ctx.accounts.stake;
        stake.creator = ctx.accounts.creator.key();
        stake.mint = mint;
        stake.amount = STAKE_AMOUNT;
        stake.created_at = now;
        stake.milestone_deadline = now
            .checked_add(MILESTONE_WINDOW)
            .ok_or(StakeError::MathOverflow)?;
        stake.holder_count_at_eval = 0;
        stake.state = StakeState::Escrowed;
        stake.bump = ctx.bumps.stake;

        // Update vault totals.
        let vault = &mut ctx.accounts.stake_vault;
        vault.total_escrowed = vault
            .total_escrowed
            .checked_add(STAKE_AMOUNT)
            .ok_or(StakeError::MathOverflow)?;

        Ok(())
    }

    /// Permissionless crank. Evaluates whether the token reached 100 holders
    /// before the 72-hour deadline.
    ///
    /// `holder_count` is provided by an off-chain indexer and verified
    /// externally; the on-chain program trusts the caller value.
    pub fn evaluate_milestone(ctx: Context<EvaluateMilestone>, holder_count: u16) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;

        // Read stake fields before mutable borrow
        let stake_state = ctx.accounts.stake.state;
        let stake_deadline = ctx.accounts.stake.milestone_deadline;
        let stake_amount = ctx.accounts.stake.amount;

        require!(
            stake_state == StakeState::Escrowed,
            StakeError::AlreadyEvaluated
        );
        require!(now >= stake_deadline, StakeError::DeadlineNotReached);

        // Get account infos before any mutable borrows
        let vault_info = ctx.accounts.stake_vault.to_account_info();
        let creator_info = ctx.accounts.creator.to_account_info();

        if holder_count >= HOLDER_THRESHOLD {
            // Lamport transfer: vault -> creator
            **vault_info.try_borrow_mut_lamports()? = vault_info
                .lamports()
                .checked_sub(stake_amount)
                .ok_or(StakeError::MathOverflow)?;
            **creator_info.try_borrow_mut_lamports()? = creator_info
                .lamports()
                .checked_add(stake_amount)
                .ok_or(StakeError::MathOverflow)?;
        }

        // Now take mutable borrows to update state
        let stake = &mut ctx.accounts.stake;
        stake.holder_count_at_eval = holder_count;

        let vault = &mut ctx.accounts.stake_vault;

        if holder_count >= HOLDER_THRESHOLD {
            stake.state = StakeState::Returned;
            vault.total_returned = vault
                .total_returned
                .checked_add(stake_amount)
                .ok_or(StakeError::MathOverflow)?;
        } else {
            stake.state = StakeState::Forfeited;
            vault.total_forfeited = vault
                .total_forfeited
                .checked_add(stake_amount)
                .ok_or(StakeError::MathOverflow)?;
        }

        vault.total_escrowed = vault
            .total_escrowed
            .checked_sub(stake_amount)
            .ok_or(StakeError::MathOverflow)?;

        Ok(())
    }

    /// Permissionless crank. Distributes accumulated forfeited SOL pro-rata
    /// to creators whose tokens met the milestone (state == Returned).
    ///
    /// The caller passes parallel arrays of qualifying mints and their current
    /// holder counts so that the distribution is weighted by holder count.
    ///
    /// Remaining accounts layout: [stake_0, creator_0, stake_1, creator_1, ...]
    pub fn distribute_forfeit_pool(
        ctx: Context<DistributeForfeitPool>,
        qualifying_mints: Vec<Pubkey>,
        holder_counts: Vec<u64>,
    ) -> Result<()> {
        require!(
            qualifying_mints.len() == holder_counts.len(),
            StakeError::LengthMismatch
        );
        require!(!qualifying_mints.is_empty(), StakeError::NoQualifyingMints);

        // Read vault fields before mutable borrow
        let distributable = ctx.accounts.stake_vault
            .total_forfeited
            .checked_sub(ctx.accounts.stake_vault.total_distributed)
            .ok_or(StakeError::MathOverflow)?;
        require!(distributable > 0, StakeError::NothingToDistribute);

        // Compute total weight (sum of holder counts).
        let total_weight: u64 = holder_counts
            .iter()
            .try_fold(0u64, |acc, &c| acc.checked_add(c))
            .ok_or(StakeError::MathOverflow)?;
        require!(total_weight > 0, StakeError::ZeroWeight);

        // Walk remaining accounts: each pair is (Stake PDA, creator wallet).
        let remaining = &ctx.remaining_accounts;
        require!(
            remaining.len()
                == qualifying_mints
                    .len()
                    .checked_mul(2)
                    .ok_or(StakeError::MathOverflow)?,
            StakeError::AccountMismatch
        );

        // Get account info before mutable borrow
        let vault_info = ctx.accounts.stake_vault.to_account_info();
        let mut total_paid: u64 = 0;

        for (i, (mint, &weight)) in qualifying_mints
            .iter()
            .zip(holder_counts.iter())
            .enumerate()
        {
            let idx = i.checked_mul(2).ok_or(StakeError::MathOverflow)?;
            let stake_info = &remaining[idx];
            let creator_info = &remaining[idx.checked_add(1).ok_or(StakeError::MathOverflow)?];

            // Deserialise the Stake account.
            let stake_account = {
                let data = stake_info.try_borrow_data()?;
                let mut slice: &[u8] = &data;
                Stake::try_deserialize(&mut slice)
                    .map_err(|_| error!(StakeError::InvalidStakeAccount))?
            };

            // Validate the stake account.
            require!(stake_account.mint == *mint, StakeError::MintMismatch);
            require!(
                stake_account.state == StakeState::Returned,
                StakeError::NotReturned
            );
            require!(
                stake_account.creator == *creator_info.key,
                StakeError::CreatorMismatch
            );

            // Verify PDA derivation.
            let (expected_pda, _) =
                Pubkey::find_program_address(&[b"stake", mint.as_ref()], ctx.program_id);
            require!(
                stake_info.key() == expected_pda,
                StakeError::InvalidStakeAccount
            );

            // Pro-rata share: distributable * weight / total_weight
            let share = (distributable as u128)
                .checked_mul(weight as u128)
                .ok_or(StakeError::MathOverflow)?
                .checked_div(total_weight as u128)
                .ok_or(StakeError::MathOverflow)? as u64;

            if share == 0 {
                continue;
            }

            // Transfer lamports from vault to creator.
            **vault_info.try_borrow_mut_lamports()? = vault_info
                .lamports()
                .checked_sub(share)
                .ok_or(StakeError::MathOverflow)?;
            **creator_info.try_borrow_mut_lamports()? = creator_info
                .lamports()
                .checked_add(share)
                .ok_or(StakeError::MathOverflow)?;

            total_paid = total_paid
                .checked_add(share)
                .ok_or(StakeError::MathOverflow)?;
        }

        // Now take mutable borrow to update state
        let vault = &mut ctx.accounts.stake_vault;
        vault.total_distributed = vault
            .total_distributed
            .checked_add(total_paid)
            .ok_or(StakeError::MathOverflow)?;
        vault.last_distribution = Clock::get()?.unix_timestamp;

        Ok(())
    }
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
#[instruction(mint: Pubkey)]
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
        seeds = [b"stake", mint.as_ref()],
        bump,
    )]
    pub stake: Account<'info, Stake>,

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
}

#[derive(Accounts)]
pub struct DistributeForfeitPool<'info> {
    #[account(
        mut,
        seeds = [b"stake_vault"],
        bump = stake_vault.bump,
    )]
    pub stake_vault: Account<'info, StakeVault>,

    /// Anyone can crank.
    pub cranker: Signer<'info>,
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[account]
pub struct StakeVault {
    /// Protocol admin.
    pub authority: Pubkey,
    /// Total SOL currently held in escrow.
    pub total_escrowed: u64,
    /// Cumulative SOL forfeited from failed launches.
    pub total_forfeited: u64,
    /// Cumulative SOL returned to successful creators.
    pub total_returned: u64,
    /// Cumulative SOL distributed from the forfeit pool.
    pub total_distributed: u64,
    /// Unix timestamp of the last distribution.
    pub last_distribution: i64,
    /// PDA bump.
    pub bump: u8,
}

impl StakeVault {
    /// 8 (discriminator) + 32 + 8 + 8 + 8 + 8 + 8 + 1 = 81
    pub const SIZE: usize = 8 + 32 + 8 + 8 + 8 + 8 + 8 + 1;
}

#[account]
pub struct Stake {
    /// The creator who deposited the stake.
    pub creator: Pubkey,
    /// The token mint this stake is associated with.
    pub mint: Pubkey,
    /// Amount locked (always 2 SOL = 2_000_000_000 lamports).
    pub amount: u64,
    /// When the stake was created.
    pub created_at: i64,
    /// Deadline by which the milestone must be met (created_at + 72h).
    pub milestone_deadline: i64,
    /// Holder count recorded at evaluation time.
    pub holder_count_at_eval: u16,
    /// Current state of this stake.
    pub state: StakeState,
    /// PDA bump.
    pub bump: u8,
}

impl Stake {
    /// 8 (discriminator) + 32 + 32 + 8 + 8 + 8 + 2 + 1 + 1 = 100
    pub const SIZE: usize = 8 + 32 + 32 + 8 + 8 + 8 + 2 + 1 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum StakeState {
    Escrowed,
    Returned,
    Forfeited,
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
    #[msg("Mint pubkey does not match stake record")]
    MintMismatch,
    #[msg("Stake account is not in the Returned state")]
    NotReturned,
    #[msg("Invalid stake account")]
    InvalidStakeAccount,
    #[msg("Qualifying mints and holder counts length mismatch")]
    LengthMismatch,
    #[msg("No qualifying mints provided")]
    NoQualifyingMints,
    #[msg("Nothing to distribute from the forfeit pool")]
    NothingToDistribute,
    #[msg("Total holder weight must be greater than zero")]
    ZeroWeight,
    #[msg("Remaining accounts count does not match expected")]
    AccountMismatch,
}
