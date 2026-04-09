use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount, Transfer};

use stake_manager::cpi::accounts::DepositStake as StakeDepositAccounts;
use stake_manager::program::StakeManager;

declare_id!("BAuc111111111111111111111111111111111111111");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MIN_WALLETS: u16 = 50;
const DEFAULT_MIN_SOL: u64 = 10_000_000_000; // 10 SOL
const DEFAULT_AUCTION_DURATION: i64 = 300; // 5 minutes
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
        config.pending_authority = Pubkey::default();
        config.crank_authority = ctx.accounts.authority.key();
        config.pending_crank_authority = Pubkey::default();
        config.min_wallets = DEFAULT_MIN_WALLETS;
        config.min_sol = DEFAULT_MIN_SOL;
        config.auction_duration = DEFAULT_AUCTION_DURATION;
        config.emergency_paused = false;

        emit!(ConfigInitialized {
            authority: config.authority,
            min_wallets: config.min_wallets,
            min_sol: config.min_sol,
            auction_duration: config.auction_duration,
        });
        Ok(())
    }

    // -----------------------------------------------------------------
    // Authority management
    // -----------------------------------------------------------------

    pub fn propose_authority(ctx: Context<AdminOnly>, new_authority: Pubkey) -> Result<()> {
        ctx.accounts.config.pending_authority = new_authority;
        emit!(AuthorityProposed { role: 0, new_authority });
        Ok(())
    }

    pub fn accept_authority(ctx: Context<AcceptRole>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(
            config.pending_authority == ctx.accounts.new_signer.key(),
            BatchAuctionError::Unauthorized
        );
        let old = config.authority;
        config.authority = ctx.accounts.new_signer.key();
        config.pending_authority = Pubkey::default();
        emit!(AuthorityRotated { role: 0, old, new: config.authority });
        Ok(())
    }

    pub fn propose_crank_authority(
        ctx: Context<AdminOnly>,
        new_authority: Pubkey,
    ) -> Result<()> {
        ctx.accounts.config.pending_crank_authority = new_authority;
        emit!(AuthorityProposed { role: 1, new_authority });
        Ok(())
    }

    pub fn accept_crank_authority(ctx: Context<AcceptRole>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(
            config.pending_crank_authority == ctx.accounts.new_signer.key(),
            BatchAuctionError::Unauthorized
        );
        let old = config.crank_authority;
        config.crank_authority = ctx.accounts.new_signer.key();
        config.pending_crank_authority = Pubkey::default();
        emit!(AuthorityRotated { role: 1, old, new: config.crank_authority });
        Ok(())
    }

    // -----------------------------------------------------------------
    // Emergency mode
    // -----------------------------------------------------------------

    pub fn emergency_pause(ctx: Context<AdminOnly>) -> Result<()> {
        ctx.accounts.config.emergency_paused = true;
        emit!(EmergencyPauseToggled { paused: true });
        Ok(())
    }

    pub fn emergency_unpause(ctx: Context<AdminOnly>) -> Result<()> {
        ctx.accounts.config.emergency_paused = false;
        emit!(EmergencyPauseToggled { paused: false });
        Ok(())
    }

    /// Participant escape hatch when the protocol is paused. Pulls back
    /// committed SOL regardless of auction state. Forfeits any unclaimed
    /// tokens. Closes the commitment PDA.
    pub fn emergency_refund_commitment(ctx: Context<EmergencyRefundCommitment>) -> Result<()> {
        require!(
            ctx.accounts.config.emergency_paused,
            BatchAuctionError::NotPaused
        );
        require!(
            !ctx.accounts.commitment.tokens_claimed,
            BatchAuctionError::AlreadyClaimed
        );

        let amount = ctx.accounts.commitment.sol_amount;
        let auction_info = ctx.accounts.auction.to_account_info();
        let participant_info = ctx.accounts.participant.to_account_info();

        transfer_lamports_with_floor(&auction_info, &participant_info, amount, 0)?;

        let commitment = &mut ctx.accounts.commitment;
        commitment.tokens_claimed = true;

        emit!(CommitmentEmergencyRefunded {
            mint: ctx.accounts.auction.mint,
            participant: participant_info.key(),
            amount,
        });
        Ok(())
    }

    // -----------------------------------------------------------------
    // Core lifecycle
    // -----------------------------------------------------------------

    /// Creator launches a new batch auction. This single instruction
    /// atomically:
    ///   1. Initialises the auction PDA + token vault.
    ///   2. CPIs stake_manager::deposit_stake to lock the 2 SOL stake.
    ///   3. Mints `total_supply` into the auction-owned token vault.
    ///
    /// Ticker uniqueness is enforced off-chain by the backend database
    /// (unique index on tickers table). This saves an entire on-chain
    /// program deployment (~3-4 SOL rent).
    ///
    /// If any step fails, the entire transaction reverts.
    pub fn create_auction(
        ctx: Context<CreateAuction>,
        ticker: String,
        total_supply: u64,
    ) -> Result<()> {
        require!(ticker.len() <= MAX_TICKER_LEN, BatchAuctionError::TickerTooLong);
        require!(total_supply > 0, BatchAuctionError::InvalidSupply);

        let config = &ctx.accounts.config;
        let clock = Clock::get()?;

        // --- CPI: stake_manager::deposit_stake ---------------------
        stake_manager::cpi::deposit_stake(CpiContext::new(
            ctx.accounts.stake_manager_program.to_account_info(),
            StakeDepositAccounts {
                stake_vault: ctx.accounts.stake_vault.to_account_info(),
                stake: ctx.accounts.stake.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                creator: ctx.accounts.creator.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
            },
        ))?;

        // --- Mint full supply into auction-owned vault -------------
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

        // --- Populate auction state --------------------------------
        let auction = &mut ctx.accounts.auction;
        auction.creator = ctx.accounts.creator.key();
        auction.mint = ctx.accounts.mint.key();
        auction.ticker = ticker.clone();
        auction.start_time = clock.unix_timestamp;
        auction.end_time = clock
            .unix_timestamp
            .checked_add(config.auction_duration)
            .ok_or(BatchAuctionError::Overflow)?;
        auction.total_sol = 0;
        auction.total_supply = total_supply;
        auction.participant_count = 0;
        auction.state = AuctionState::Gathering;
        auction.uniform_price = 0;
        auction.pool_id = Pubkey::default();
        auction.pool_created = false;
        auction.bump = ctx.bumps.auction;

        emit!(AuctionCreated {
            mint: auction.mint,
            creator: auction.creator,
            ticker,
            total_supply,
            start_time: auction.start_time,
            end_time: auction.end_time,
        });
        Ok(())
    }

    /// Participant commits SOL during the gathering window.
    pub fn commit_sol(ctx: Context<CommitSol>, amount: u64) -> Result<()> {
        require!(amount > 0, BatchAuctionError::ZeroAmount);
        require!(
            !ctx.accounts.config.emergency_paused,
            BatchAuctionError::Paused
        );

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

        let auction = &mut ctx.accounts.auction;
        auction.total_sol = auction
            .total_sol
            .checked_add(amount)
            .ok_or(BatchAuctionError::Overflow)?;
        auction.participant_count = auction
            .participant_count
            .checked_add(1)
            .ok_or(BatchAuctionError::Overflow)?;

        let commitment = &mut ctx.accounts.commitment;
        commitment.wallet = ctx.accounts.participant.key();
        commitment.auction = auction.mint;
        commitment.sol_amount = amount;
        commitment.tokens_claimed = false;
        commitment.bump = ctx.bumps.commitment;

        emit!(SolCommitted {
            mint: auction.mint,
            participant: commitment.wallet,
            amount,
            total_sol: auction.total_sol,
            participant_count: auction.participant_count,
        });
        Ok(())
    }

    /// Permissionless crank: finalise the auction after end_time. Pure
    /// on-chain logic — checks `participant_count >= 50 && total_sol >= 10 SOL`.
    /// Stays permissionless so users can self-serve refunds even if the
    /// backend crank is down.
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

        if auction.participant_count >= config.min_wallets
            && auction.total_sol >= config.min_sol
        {
            auction.state = AuctionState::Succeeded;
            auction.uniform_price = auction
                .total_sol
                .checked_div(auction.total_supply)
                .unwrap_or(0);
            emit!(AuctionFinalized {
                mint: auction.mint,
                succeeded: true,
                total_sol: auction.total_sol,
                participant_count: auction.participant_count,
            });
        } else {
            auction.state = AuctionState::Failed;
            emit!(AuctionFinalized {
                mint: auction.mint,
                succeeded: false,
                total_sol: auction.total_sol,
                participant_count: auction.participant_count,
            });
        }

        Ok(())
    }

    /// Claim tokens after a successful auction. Works in both `Succeeded`
    /// and `Trading` states so participants can never be locked out by the
    /// pool-creation crank running first.
    ///
    /// On successful claim, the commitment PDA is closed and rent returned
    /// to the participant.
    pub fn claim_tokens(ctx: Context<ClaimTokens>) -> Result<()> {
        let auction = &ctx.accounts.auction;
        let commitment = &ctx.accounts.commitment;

        require!(
            auction.state == AuctionState::Succeeded || auction.state == AuctionState::Trading,
            BatchAuctionError::AuctionNotSucceeded
        );
        require!(!commitment.tokens_claimed, BatchAuctionError::AlreadyClaimed);
        require!(auction.total_sol > 0, BatchAuctionError::ZeroAmount);

        let tokens_owed = (commitment.sol_amount as u128)
            .checked_mul(auction.total_supply as u128)
            .ok_or(BatchAuctionError::Overflow)?
            .checked_div(auction.total_sol as u128)
            .ok_or(BatchAuctionError::Overflow)? as u64;

        // Mark claimed BEFORE external CPI to prevent reentrancy.
        let participant_key = ctx.accounts.participant.key();
        let mint_key = auction.mint;
        let bump = auction.bump;
        let amount = commitment.sol_amount;

        let commitment_mut = &mut ctx.accounts.commitment;
        commitment_mut.tokens_claimed = true;

        // Transfer tokens from vault to participant.
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

        emit!(TokensClaimed {
            mint: mint_key,
            participant: participant_key,
            sol_committed: amount,
            tokens_received: tokens_owed,
        });
        Ok(())
    }

    /// Refund SOL after a failed auction. Closes the commitment PDA and
    /// returns rent to the participant. Permissionless from the
    /// participant's side — no backend dependency.
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

        let auction_info = ctx.accounts.auction.to_account_info();
        let participant_info = ctx.accounts.participant.to_account_info();

        transfer_lamports_with_floor(&auction_info, &participant_info, amount, 0)?;

        let participant_key = participant_info.key();
        let mint_key = ctx.accounts.auction.mint;

        let commitment = &mut ctx.accounts.commitment;
        commitment.tokens_claimed = true;

        emit!(SolRefunded {
            mint: mint_key,
            participant: participant_key,
            amount,
        });
        Ok(())
    }

    /// Backend-only: record the Raydium pool address after the off-chain
    /// crank creates the pool. Only callable by `crank_authority`.
    pub fn set_pool_id(ctx: Context<SetPoolId>, pool_id: Pubkey) -> Result<()> {
        require!(
            ctx.accounts.crank.key() == ctx.accounts.config.crank_authority,
            BatchAuctionError::Unauthorized
        );
        let auction = &mut ctx.accounts.auction;
        require!(
            auction.state == AuctionState::Succeeded,
            BatchAuctionError::InvalidState
        );
        require!(!auction.pool_created, BatchAuctionError::PoolAlreadyCreated);

        auction.pool_id = pool_id;
        auction.pool_created = true;
        auction.state = AuctionState::Trading;

        emit!(PoolIdSet {
            mint: auction.mint,
            pool_id,
        });
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Helper: rent-floor-aware lamport transfer.
// ---------------------------------------------------------------------------

fn transfer_lamports_with_floor<'info>(
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    amount: u64,
    additional_reserved: u64,
) -> Result<()> {
    require!(amount > 0, BatchAuctionError::ZeroAmount);
    let rent = Rent::get()?;
    let min_balance = rent
        .minimum_balance(from.data_len())
        .checked_add(additional_reserved)
        .ok_or(BatchAuctionError::Overflow)?;
    let current = from.lamports();
    let after = current
        .checked_sub(amount)
        .ok_or(BatchAuctionError::Overflow)?;
    require!(after >= min_balance, BatchAuctionError::RentFloorViolated);

    **from.try_borrow_mut_lamports()? = after;
    **to.try_borrow_mut_lamports()? = to
        .lamports()
        .checked_add(amount)
        .ok_or(BatchAuctionError::Overflow)?;
    Ok(())
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
    /// Protocol admin (parameter changes, role rotations, emergency).
    pub authority: Pubkey,
    pub pending_authority: Pubkey,
    /// Backend service authorized to crank lifecycle instructions
    /// (currently: set_pool_id).
    pub crank_authority: Pubkey,
    pub pending_crank_authority: Pubkey,
    /// Minimum unique commitments for an auction to succeed.
    pub min_wallets: u16,
    /// Minimum total SOL (lamports) for success.
    pub min_sol: u64,
    /// Auction duration in seconds.
    pub auction_duration: i64,
    /// When true, commits are blocked and emergency refunds are unlocked.
    pub emergency_paused: bool,
}

impl AuctionConfig {
    // discriminator(8) + 4*pubkey(128) + u16(2) + u64(8) + i64(8) + bool(1)
    pub const LEN: usize = 8 + (4 * 32) + 2 + 8 + 8 + 1;
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
    pub uniform_price: u64,
    /// Raydium pool address, set by `set_pool_id` after the backend crank
    /// builds the pool off-chain.
    pub pool_id: Pubkey,
    pub pool_created: bool,
    pub bump: u8,
}

impl Auction {
    // discriminator(8) + creator(32) + mint(32) + string prefix(4) + max_ticker(10)
    // + start(8) + end(8) + total_sol(8) + total_supply(8) + count(2)
    // + state(1) + uniform_price(8) + pool_id(32) + pool_created(1) + bump(1)
    pub const LEN: usize =
        8 + 32 + 32 + (4 + MAX_TICKER_LEN) + 8 + 8 + 8 + 8 + 2 + 1 + 8 + 32 + 1 + 1;
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
    // discriminator(8) + 32 + 32 + 8 + 1 + 1
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
pub struct AdminOnly<'info> {
    #[account(
        mut,
        seeds = [b"config"],
        bump,
        constraint = config.authority == authority.key() @ BatchAuctionError::Unauthorized,
    )]
    pub config: Account<'info, AuctionConfig>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct AcceptRole<'info> {
    #[account(
        mut,
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, AuctionConfig>,

    pub new_signer: Signer<'info>,
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

    /// SPL token mint for this auction. Auction PDA must be the mint authority.
    #[account(
        mut,
        constraint = mint.mint_authority.map_or(false, |a| a == auction.key()) @ BatchAuctionError::InvalidMintAuthority,
        constraint = mint.supply == 0 @ BatchAuctionError::MintAlreadyHasSupply,
    )]
    pub mint: Account<'info, Mint>,

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

    // ----- stake_manager CPI accounts -----
    /// CHECK: Validated by stake_manager CPI.
    #[account(mut)]
    pub stake_vault: UncheckedAccount<'info>,
    /// CHECK: Initialized by stake_manager CPI; PDA seeds checked there.
    #[account(mut)]
    pub stake: UncheckedAccount<'info>,

    pub stake_manager_program: Program<'info, StakeManager>,
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
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, AuctionConfig>,

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

    /// Anyone can crank finalization (pure on-chain logic, no off-chain trust).
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
        close = participant,
    )]
    pub commitment: Account<'info, Commitment>,

    #[account(
        mut,
        seeds = [b"vault", auction.mint.as_ref()],
        bump,
    )]
    pub token_vault: Account<'info, TokenAccount>,

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

#[derive(Accounts)]
pub struct SetPoolId<'info> {
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

    /// Backend crank authority.
    pub crank: Signer<'info>,
}

#[derive(Accounts)]
pub struct EmergencyRefundCommitment<'info> {
    #[account(
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, AuctionConfig>,

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
// Events
// ---------------------------------------------------------------------------

#[event]
pub struct ConfigInitialized {
    pub authority: Pubkey,
    pub min_wallets: u16,
    pub min_sol: u64,
    pub auction_duration: i64,
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
pub struct EmergencyPauseToggled {
    pub paused: bool,
}

#[event]
pub struct AuctionCreated {
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub ticker: String,
    pub total_supply: u64,
    pub start_time: i64,
    pub end_time: i64,
}

#[event]
pub struct SolCommitted {
    pub mint: Pubkey,
    pub participant: Pubkey,
    pub amount: u64,
    pub total_sol: u64,
    pub participant_count: u16,
}

#[event]
pub struct AuctionFinalized {
    pub mint: Pubkey,
    pub succeeded: bool,
    pub total_sol: u64,
    pub participant_count: u16,
}

#[event]
pub struct TokensClaimed {
    pub mint: Pubkey,
    pub participant: Pubkey,
    pub sol_committed: u64,
    pub tokens_received: u64,
}

#[event]
pub struct SolRefunded {
    pub mint: Pubkey,
    pub participant: Pubkey,
    pub amount: u64,
}

#[event]
pub struct CommitmentEmergencyRefunded {
    pub mint: Pubkey,
    pub participant: Pubkey,
    pub amount: u64,
}

#[event]
pub struct PoolIdSet {
    pub mint: Pubkey,
    pub pool_id: Pubkey,
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
    #[msg("Auction is not in a valid state for this operation")]
    InvalidState,
    #[msg("Raydium pool has already been created for this auction")]
    PoolAlreadyCreated,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Emergency mode is not active")]
    NotPaused,
    #[msg("Protocol is paused; commits temporarily disabled")]
    Paused,
    #[msg("Withdrawal would push the auction PDA below its rent-exempt floor")]
    RentFloorViolated,
}
