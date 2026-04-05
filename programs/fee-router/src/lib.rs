use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("FeeR1111111111111111111111111111111111111111");

#[program]
pub mod fee_router {
    use super::*;

    /// Initialize a fee configuration for a pool/mint.
    /// Called once when a new pool is created.
    pub fn initialize_fee_config(
        ctx: Context<InitializeFeeConfig>,
        creator_wallet: Pubkey,
        protocol_treasury: Pubkey,
        creator_bps: u16,
        protocol_bps: u16,
    ) -> Result<()> {
        require!(
            creator_bps.checked_add(protocol_bps).ok_or(FeeRouterError::MathOverflow)? == 100,
            FeeRouterError::InvalidFeeSplit
        );

        let fee_config = &mut ctx.accounts.fee_config;
        fee_config.mint = ctx.accounts.mint.key();
        fee_config.creator_wallet = creator_wallet;
        fee_config.creator_bps = creator_bps;
        fee_config.protocol_bps = protocol_bps;
        fee_config.protocol_treasury = protocol_treasury;
        fee_config.total_creator_fees = 0;
        fee_config.total_protocol_fees = 0;
        fee_config.total_creator_withdrawn = 0;
        fee_config.bump = ctx.bumps.fee_config;

        Ok(())
    }

    /// Collect fees from a swap. Called by the AMM program via CPI.
    /// The caller must transfer `total_fee_amount` lamports to the fee_escrow PDA
    /// before or as part of this instruction. This instruction splits the fee
    /// between creator and protocol, transferring the protocol share immediately
    /// and accumulating the creator share in the escrow.
    pub fn collect_fees(ctx: Context<CollectFees>, total_fee_amount: u64) -> Result<()> {
        require!(total_fee_amount > 0, FeeRouterError::ZeroFeeAmount);

        let fee_config = &ctx.accounts.fee_config;

        // creator_share = total_fee_amount * creator_bps / 100
        let creator_share = total_fee_amount
            .checked_mul(fee_config.creator_bps as u64)
            .ok_or(FeeRouterError::MathOverflow)?
            .checked_div(100)
            .ok_or(FeeRouterError::MathOverflow)?;

        // protocol_share = total_fee_amount - creator_share
        let protocol_share = total_fee_amount
            .checked_sub(creator_share)
            .ok_or(FeeRouterError::MathOverflow)?;

        // Transfer total_fee_amount from the payer (AMM) to fee_escrow
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.fee_escrow.to_account_info(),
                },
            ),
            total_fee_amount,
        )?;

        // Transfer protocol_share from fee_escrow to protocol_treasury via lamport manipulation.
        // The fee_escrow is owned by this program, so system_program::transfer cannot be used.
        if protocol_share > 0 {
            let escrow_info = ctx.accounts.fee_escrow.to_account_info();
            let treasury_info = ctx.accounts.protocol_treasury.to_account_info();

            **escrow_info.try_borrow_mut_lamports()? = escrow_info
                .lamports()
                .checked_sub(protocol_share)
                .ok_or(FeeRouterError::MathOverflow)?;
            **treasury_info.try_borrow_mut_lamports()? = treasury_info
                .lamports()
                .checked_add(protocol_share)
                .ok_or(FeeRouterError::MathOverflow)?;
        }

        // Update accumulated fee totals
        let fee_config = &mut ctx.accounts.fee_config;
        fee_config.total_creator_fees = fee_config
            .total_creator_fees
            .checked_add(creator_share)
            .ok_or(FeeRouterError::MathOverflow)?;
        fee_config.total_protocol_fees = fee_config
            .total_protocol_fees
            .checked_add(protocol_share)
            .ok_or(FeeRouterError::MathOverflow)?;

        Ok(())
    }

    /// Withdraw accumulated creator fees from the escrow.
    /// Only the creator_wallet can call this. No lock period or vesting.
    pub fn withdraw_creator_fees(ctx: Context<WithdrawCreatorFees>) -> Result<()> {
        let fee_config = &ctx.accounts.fee_config;

        let withdrawable = fee_config
            .total_creator_fees
            .checked_sub(fee_config.total_creator_withdrawn)
            .ok_or(FeeRouterError::MathOverflow)?;

        require!(withdrawable > 0, FeeRouterError::NothingToWithdraw);

        // Update state BEFORE transfer to prevent reentrancy.
        let fee_config = &mut ctx.accounts.fee_config;
        fee_config.total_creator_withdrawn = fee_config
            .total_creator_withdrawn
            .checked_add(withdrawable)
            .ok_or(FeeRouterError::MathOverflow)?;

        // Transfer from fee_escrow PDA to creator wallet via lamport manipulation.
        // The fee_escrow is owned by this program, so system_program::transfer cannot be used.
        let escrow_info = ctx.accounts.fee_escrow.to_account_info();
        let creator_info = ctx.accounts.creator.to_account_info();

        **escrow_info.try_borrow_mut_lamports()? = escrow_info
            .lamports()
            .checked_sub(withdrawable)
            .ok_or(FeeRouterError::MathOverflow)?;
        **creator_info.try_borrow_mut_lamports()? = creator_info
            .lamports()
            .checked_add(withdrawable)
            .ok_or(FeeRouterError::MathOverflow)?;

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Accounts structs
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitializeFeeConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// The mint this fee config is associated with.
    /// CHECK: Only used as a PDA seed; no data read.
    pub mint: UncheckedAccount<'info>,

    #[account(
        init,
        payer = authority,
        space = FeeConfig::SIZE,
        seeds = [b"fee_config", mint.key().as_ref()],
        bump,
    )]
    pub fee_config: Account<'info, FeeConfig>,

    #[account(
        init,
        payer = authority,
        space = FeeEscrow::SIZE,
        seeds = [b"fee_escrow", mint.key().as_ref()],
        bump,
    )]
    pub fee_escrow: Account<'info, FeeEscrow>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CollectFees<'info> {
    /// The AMM or authorized caller that pays the fee.
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"fee_config", fee_config.mint.as_ref()],
        bump = fee_config.bump,
    )]
    pub fee_config: Account<'info, FeeConfig>,

    #[account(
        mut,
        seeds = [b"fee_escrow", fee_config.mint.as_ref()],
        bump = fee_escrow.bump,
    )]
    pub fee_escrow: Account<'info, FeeEscrow>,

    /// CHECK: Validated against fee_config.protocol_treasury.
    #[account(
        mut,
        constraint = protocol_treasury.key() == fee_config.protocol_treasury @ FeeRouterError::InvalidTreasury,
    )]
    pub protocol_treasury: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawCreatorFees<'info> {
    /// The creator requesting withdrawal. Must match fee_config.creator_wallet.
    #[account(
        mut,
        constraint = creator.key() == fee_config.creator_wallet @ FeeRouterError::UnauthorizedCreator,
    )]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"fee_config", fee_config.mint.as_ref()],
        bump = fee_config.bump,
    )]
    pub fee_config: Account<'info, FeeConfig>,

    #[account(
        mut,
        seeds = [b"fee_escrow", fee_config.mint.as_ref()],
        bump = fee_escrow.bump,
    )]
    pub fee_escrow: Account<'info, FeeEscrow>,
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[account]
pub struct FeeConfig {
    /// The token mint this config belongs to.
    pub mint: Pubkey,
    /// Wallet address of the token creator.
    pub creator_wallet: Pubkey,
    /// Creator fee in basis points out of 100 (e.g. 80 = 0.8%).
    pub creator_bps: u16,
    /// Protocol fee in basis points out of 100 (e.g. 20 = 0.2%).
    pub protocol_bps: u16,
    /// Protocol treasury address.
    pub protocol_treasury: Pubkey,
    /// Total creator fees accumulated (lamports).
    pub total_creator_fees: u64,
    /// Total protocol fees accumulated (lamports).
    pub total_protocol_fees: u64,
    /// Total creator fees already withdrawn (lamports).
    pub total_creator_withdrawn: u64,
    /// PDA bump seed.
    pub bump: u8,
}

impl FeeConfig {
    // 8 (discriminator) + 32 + 32 + 2 + 2 + 32 + 8 + 8 + 8 + 1 = 133
    pub const SIZE: usize = 8 + 32 + 32 + 2 + 2 + 32 + 8 + 8 + 8 + 1;
}

/// Escrow PDA that holds SOL for creator fee withdrawals.
#[account]
pub struct FeeEscrow {
    /// PDA bump seed.
    pub bump: u8,
}

impl FeeEscrow {
    // 8 (discriminator) + 1 = 9
    pub const SIZE: usize = 8 + 1;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[error_code]
pub enum FeeRouterError {
    #[msg("Fee split must sum to 100")]
    InvalidFeeSplit,

    #[msg("Arithmetic overflow")]
    MathOverflow,

    #[msg("Fee amount must be greater than zero")]
    ZeroFeeAmount,

    #[msg("Protocol treasury does not match fee config")]
    InvalidTreasury,

    #[msg("Signer is not the authorized creator")]
    UnauthorizedCreator,

    #[msg("No fees available to withdraw")]
    NothingToWithdraw,
}
