use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount, Transfer};

declare_id!("BAuc111111111111111111111111111111111111111");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MIN_WALLETS: u16 = 50;
const DEFAULT_MIN_SOL: u64 = 10_000_000_000; // 10 SOL
const DEFAULT_AUCTION_DURATION: i64 = 300; // 5 minutes
const DEFAULT_DEPLOYER_STAKE: u64 = 2_000_000_000; // 2 SOL
const DEFAULT_HOLDER_MILESTONE: u16 = 100;
const DEFAULT_MILESTONE_WINDOW: i64 = 259_200; // 72 hours

const MAX_TICKER_LEN: usize = 10;

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

#[program]
pub mod batch_auction {
    use super::*;

    /// One-time global configuration setup by the protocol admin.
    pub fn initialize_config(ctx: Context<InitializeConfig>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.protocol_authority = ctx.accounts.authority.key();
        config.min_wallets = DEFAULT_MIN_WALLETS;
        config.min_sol = DEFAULT_MIN_SOL;
        config.auction_duration = DEFAULT_AUCTION_DURATION;
        config.deployer_stake = DEFAULT_DEPLOYER_STAKE;
        config.holder_milestone = DEFAULT_HOLDER_MILESTONE;
        config.milestone_window = DEFAULT_MILESTONE_WINDOW;
        Ok(())
    }

    /// Creator launches a new batch auction for a token.
    pub fn create_auction(
        ctx: Context<CreateAuction>,
        ticker: String,
        total_supply: u64,
    ) -> Result<()> {
        require!(ticker.len() <= MAX_TICKER_LEN, BatchAuctionError::TickerTooLong);
        require!(total_supply > 0, BatchAuctionError::InvalidSupply);

        let config = &ctx.accounts.config;
        let clock = Clock::get()?;

        // Transfer deployer stake to the auction escrow (PDA).
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.creator.to_account_info(),
                    to: ctx.accounts.auction.to_account_info(),
                },
            ),
            config.deployer_stake,
        )?;

        // Mint total supply into the auction token vault.
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.token_vault.to_account_info(),
                    authority: ctx.accounts.auction.to_account_info(),
                },
                &[&[
                    b"auction",
                    ctx.accounts.mint.key().as_ref(),
                    &[ctx.bumps.auction],
                ]],
            ),
            total_supply,
        )?;

        // Populate auction state.
        let auction = &mut ctx.accounts.auction;
        auction.creator = ctx.accounts.creator.key();
        auction.mint = ctx.accounts.mint.key();
        auction.ticker = ticker;
        auction.start_time = clock.unix_timestamp;
        auction.end_time = clock
            .unix_timestamp
            .checked_add(config.auction_duration)
            .ok_or(BatchAuctionError::Overflow)?;
        auction.total_sol = 0;
        auction.total_supply = total_supply;
        auction.participant_count = 0;
        auction.state = AuctionState::Gathering;
        auction.stake_returned = false;
        auction.uniform_price = 0;
        auction.bump = ctx.bumps.auction;

        Ok(())
    }

    /// Participant commits SOL during the gathering window.
    pub fn commit_sol(ctx: Context<CommitSol>, amount: u64) -> Result<()> {
        require!(amount > 0, BatchAuctionError::ZeroAmount);

        let auction = &ctx.accounts.auction;
        let clock = Clock::get()?;

        require!(
            auction.state == AuctionState::Gathering,
            BatchAuctionError::AuctionNotGathering
        );
        require!(
            clock.unix_timestamp < auction.end_time,
            BatchAuctionError::AuctionEnded
        );

        // Transfer SOL from participant to auction PDA escrow.
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.participant.to_account_info(),
                    to: ctx.accounts.auction.to_account_info(),
                },
            ),
            amount,
        )?;

        // Update auction totals.
        let auction = &mut ctx.accounts.auction;
        auction.total_sol = auction
            .total_sol
            .checked_add(amount)
            .ok_or(BatchAuctionError::Overflow)?;
        auction.participant_count = auction
            .participant_count
            .checked_add(1)
            .ok_or(BatchAuctionError::Overflow)?;

        // Initialize commitment PDA.
        let commitment = &mut ctx.accounts.commitment;
        commitment.wallet = ctx.accounts.participant.key();
        commitment.auction = auction.mint;
        commitment.sol_amount = amount;
        commitment.tokens_claimed = false;
        commitment.bump = ctx.bumps.commitment;

        Ok(())
    }

    /// Permissionless crank: finalize auction after end_time.
    pub fn finalize_auction(ctx: Context<FinalizeAuction>) -> Result<()> {
        let auction = &ctx.accounts.auction;
        let config = &ctx.accounts.config;
        let clock = Clock::get()?;

        require!(
            auction.state == AuctionState::Gathering,
            BatchAuctionError::AuctionNotGathering
        );
        require!(
            clock.unix_timestamp >= auction.end_time,
            BatchAuctionError::AuctionNotEnded
        );

        let auction = &mut ctx.accounts.auction;

        if auction.participant_count >= config.min_wallets && auction.total_sol >= config.min_sol {
            auction.state = AuctionState::Succeeded;
            auction.uniform_price = auction
                .total_sol
                .checked_div(auction.total_supply)
                .ok_or(BatchAuctionError::Overflow)?;
        } else {
            auction.state = AuctionState::Failed;
        }

        Ok(())
    }

    /// Claim tokens after a successful auction.
    pub fn claim_tokens(ctx: Context<ClaimTokens>) -> Result<()> {
        let auction = &ctx.accounts.auction;
        let commitment = &ctx.accounts.commitment;

        require!(
            auction.state == AuctionState::Succeeded,
            BatchAuctionError::AuctionNotSucceeded
        );
        require!(!commitment.tokens_claimed, BatchAuctionError::AlreadyClaimed);
        require!(auction.total_sol > 0, BatchAuctionError::ZeroAmount);

        // tokens = commitment_sol * total_supply / total_sol
        let tokens_owed = (commitment.sol_amount as u128)
            .checked_mul(auction.total_supply as u128)
            .ok_or(BatchAuctionError::Overflow)?
            .checked_div(auction.total_sol as u128)
            .ok_or(BatchAuctionError::Overflow)? as u64;

        // Mark claimed BEFORE external CPI to prevent reentrancy.
        let commitment = &mut ctx.accounts.commitment;
        commitment.tokens_claimed = true;

        // Transfer tokens from vault to participant.
        let mint_key = auction.mint;
        let bump = auction.bump;
        let seeds: &[&[u8]] = &[b"auction", mint_key.as_ref(), &[bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.token_vault.to_account_info(),
                    to: ctx.accounts.participant_token_account.to_account_info(),
                    authority: ctx.accounts.auction.to_account_info(),
                },
                &[seeds],
            ),
            tokens_owed,
        )?;

        Ok(())
    }

    /// Refund SOL after a failed auction. Closes the commitment PDA.
    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        let auction = &ctx.accounts.auction;

        require!(
            auction.state == AuctionState::Failed,
            BatchAuctionError::AuctionNotFailed
        );
        require!(
            !ctx.accounts.commitment.tokens_claimed,
            BatchAuctionError::AlreadyClaimed
        );

        let amount = ctx.accounts.commitment.sol_amount;

        // Transfer SOL back from auction PDA to participant.
        let auction_info = ctx.accounts.auction.to_account_info();
        let participant_info = ctx.accounts.participant.to_account_info();

        **auction_info.try_borrow_mut_lamports()? = auction_info
            .lamports()
            .checked_sub(amount)
            .ok_or(BatchAuctionError::Overflow)?;
        **participant_info.try_borrow_mut_lamports()? = participant_info
            .lamports()
            .checked_add(amount)
            .ok_or(BatchAuctionError::Overflow)?;

        // Commitment PDA is closed via `close = participant` in the accounts struct.
        // Mark as claimed to prevent double refund within the same tx.
        let commitment = &mut ctx.accounts.commitment;
        commitment.tokens_claimed = true;

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum AuctionState {
    Gathering,
    Succeeded,
    Failed,
    Trading,
}

#[account]
pub struct AuctionConfig {
    /// Protocol admin who created this config.
    pub authority: Pubkey,
    /// Minimum unique wallets for an auction to succeed.
    pub min_wallets: u16,
    /// Minimum total SOL (lamports) for success.
    pub min_sol: u64,
    /// Auction duration in seconds.
    pub auction_duration: i64,
    /// Required creator stake in lamports.
    pub deployer_stake: u64,
    /// Holder milestone count.
    pub holder_milestone: u16,
    /// Milestone window in seconds.
    pub milestone_window: i64,
    /// Protocol authority pubkey.
    pub protocol_authority: Pubkey,
}

impl AuctionConfig {
    // discriminator(8) + pubkey(32) + u16(2) + u64(8) + i64(8) + u64(8) + u16(2) + i64(8) + pubkey(32)
    pub const LEN: usize = 8 + 32 + 2 + 8 + 8 + 8 + 2 + 8 + 32;
}

#[account]
pub struct Auction {
    pub creator: Pubkey,
    pub mint: Pubkey,
    pub ticker: String,
    pub start_time: i64,
    pub end_time: i64,
    pub total_sol: u64,
    pub total_supply: u64,
    pub participant_count: u16,
    pub state: AuctionState,
    pub stake_returned: bool,
    pub uniform_price: u64,
    pub bump: u8,
}

impl Auction {
    // discriminator(8) + pubkey(32) + pubkey(32) + string prefix(4) + max_ticker(10)
    // + i64(8) + i64(8) + u64(8) + u64(8) + u16(2) + enum(1) + bool(1) + u64(8) + u8(1)
    pub const LEN: usize = 8 + 32 + 32 + (4 + MAX_TICKER_LEN) + 8 + 8 + 8 + 8 + 2 + 1 + 1 + 8 + 1;
}

#[account]
pub struct Commitment {
    pub wallet: Pubkey,
    pub auction: Pubkey,
    pub sol_amount: u64,
    pub tokens_claimed: bool,
    pub bump: u8,
}

impl Commitment {
    // discriminator(8) + pubkey(32) + pubkey(32) + u64(8) + bool(1) + u8(1)
    pub const LEN: usize = 8 + 32 + 32 + 8 + 1 + 1;
}

// ---------------------------------------------------------------------------
// Instruction Accounts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = authority,
        space = AuctionConfig::LEN,
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, AuctionConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(ticker: String, total_supply: u64)]
pub struct CreateAuction<'info> {
    #[account(
        init,
        payer = creator,
        space = Auction::LEN,
        seeds = [b"auction", mint.key().as_ref()],
        bump,
    )]
    pub auction: Account<'info, Auction>,

    #[account(
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, AuctionConfig>,

    /// The SPL token mint for this auction. The auction PDA must be the mint authority.
    #[account(
        mut,
        constraint = mint.mint_authority.map_or(false, |a| a == auction.key()) @ BatchAuctionError::InvalidMintAuthority,
        constraint = mint.supply == 0 @ BatchAuctionError::MintAlreadyHasSupply,
    )]
    pub mint: Account<'info, Mint>,

    /// Token vault owned by the auction PDA to hold minted tokens.
    #[account(
        init,
        payer = creator,
        token::mint = mint,
        token::authority = auction,
        seeds = [b"vault", mint.key().as_ref()],
        bump,
    )]
    pub token_vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub creator: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct CommitSol<'info> {
    #[account(
        mut,
        seeds = [b"auction", auction.mint.as_ref()],
        bump = auction.bump,
    )]
    pub auction: Account<'info, Auction>,

    #[account(
        init,
        payer = participant,
        space = Commitment::LEN,
        seeds = [b"commitment", auction.mint.as_ref(), participant.key().as_ref()],
        bump,
    )]
    pub commitment: Account<'info, Commitment>,

    #[account(mut)]
    pub participant: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FinalizeAuction<'info> {
    #[account(
        mut,
        seeds = [b"auction", auction.mint.as_ref()],
        bump = auction.bump,
    )]
    pub auction: Account<'info, Auction>,

    #[account(
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, AuctionConfig>,

    /// Anyone can crank finalization.
    pub cranker: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimTokens<'info> {
    #[account(
        seeds = [b"auction", auction.mint.as_ref()],
        bump = auction.bump,
    )]
    pub auction: Account<'info, Auction>,

    #[account(
        mut,
        seeds = [b"commitment", auction.mint.as_ref(), participant.key().as_ref()],
        bump = commitment.bump,
        constraint = commitment.wallet == participant.key() @ BatchAuctionError::UnauthorizedParticipant,
    )]
    pub commitment: Account<'info, Commitment>,

    /// Token vault holding the auction's minted supply.
    #[account(
        mut,
        seeds = [b"vault", auction.mint.as_ref()],
        bump,
    )]
    pub token_vault: Account<'info, TokenAccount>,

    /// Participant's associated token account to receive claimed tokens.
    #[account(
        mut,
        constraint = participant_token_account.owner == participant.key() @ BatchAuctionError::UnauthorizedParticipant,
        constraint = participant_token_account.mint == auction.mint @ BatchAuctionError::InvalidMint,
    )]
    pub participant_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub participant: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(
        mut,
        seeds = [b"auction", auction.mint.as_ref()],
        bump = auction.bump,
    )]
    pub auction: Account<'info, Auction>,

    #[account(
        mut,
        seeds = [b"commitment", auction.mint.as_ref(), participant.key().as_ref()],
        bump = commitment.bump,
        constraint = commitment.wallet == participant.key() @ BatchAuctionError::UnauthorizedParticipant,
        close = participant,
    )]
    pub commitment: Account<'info, Commitment>,

    #[account(mut)]
    pub participant: Signer<'info>,

    pub system_program: Program<'info, System>,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[error_code]
pub enum BatchAuctionError {
    #[msg("Ticker exceeds maximum length of 10 characters")]
    TickerTooLong,
    #[msg("Total supply must be greater than zero")]
    InvalidSupply,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Auction is not in Gathering state")]
    AuctionNotGathering,
    #[msg("Auction has ended")]
    AuctionEnded,
    #[msg("Auction has not ended yet")]
    AuctionNotEnded,
    #[msg("Auction did not succeed")]
    AuctionNotSucceeded,
    #[msg("Auction did not fail")]
    AuctionNotFailed,
    #[msg("Tokens already claimed or SOL already refunded")]
    AlreadyClaimed,
    #[msg("Commitment amount must be greater than zero")]
    ZeroAmount,
    #[msg("Invalid mint authority; auction PDA must be mint authority")]
    InvalidMintAuthority,
    #[msg("Mint already has existing supply")]
    MintAlreadyHasSupply,
    #[msg("Unauthorized participant")]
    UnauthorizedParticipant,
    #[msg("Invalid mint for this auction")]
    InvalidMint,
}
