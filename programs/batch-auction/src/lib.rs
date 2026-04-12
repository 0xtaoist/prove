use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount, Transfer};

declare_id!("BAuc111111111111111111111111111111111111111");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MIN_WALLETS: u32 = 50;
const DEFAULT_MIN_SOL: u64 = 10_000_000_000; // 10 SOL
const DEFAULT_AUCTION_DURATION: i64 = 300; // 5 minutes
const MAX_TICKER_LEN: usize = 10;

/// Basis-point denominator. 10_000 bps = 100%.
const BPS_DENOMINATOR: u16 = 10_000;
/// Default buyer share: 65% of total supply goes to batch participants at
/// claim time. The remaining 35% + ALL committed SOL seeds the Raydium
/// CLMM pool. Each auction snapshots this at creation time.
const DEFAULT_BUYER_BPS: u16 = 6_500;
/// Hard floor: buyers must always receive at least 50% of supply.
/// Protects against admin-key compromise redirecting supply away from buyers.
const BUYER_BPS_FLOOR: u16 = 5_000;
/// Hard ceiling: at least 10% of supply must seed the pool, otherwise
/// the launch would graduate with no liquidity.
const BUYER_BPS_CEILING: u16 = 9_000;

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
        config.buyer_bps = DEFAULT_BUYER_BPS;
        config.emergency_paused = false;

        emit!(ConfigInitialized {
            authority: config.authority,
            min_wallets: config.min_wallets,
            min_sol: config.min_sol,
            auction_duration: config.auction_duration,
            buyer_bps: config.buyer_bps,
        });
        Ok(())
    }

    // -----------------------------------------------------------------
    // Config updates (upgradability)
    // -----------------------------------------------------------------

    /// Admin-only: update tunable auction parameters without redeploying.
    /// Only applies to auctions created AFTER this call — existing auctions
    /// keep the buyer_bps they snapshotted at creation time.
    pub fn update_config(
        ctx: Context<AdminOnly>,
        new_min_wallets: Option<u32>,
        new_min_sol: Option<u64>,
        new_auction_duration: Option<i64>,
        new_buyer_bps: Option<u16>,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;

        if let Some(mw) = new_min_wallets {
            require!(mw > 0, BatchAuctionError::InvalidConfigValue);
            config.min_wallets = mw;
        }
        if let Some(ms) = new_min_sol {
            require!(ms > 0, BatchAuctionError::InvalidConfigValue);
            config.min_sol = ms;
        }
        if let Some(ad) = new_auction_duration {
            require!(ad > 0, BatchAuctionError::InvalidConfigValue);
            config.auction_duration = ad;
        }
        if let Some(bb) = new_buyer_bps {
            require!(
                bb >= BUYER_BPS_FLOOR && bb <= BUYER_BPS_CEILING,
                BatchAuctionError::InvalidBuyerBps
            );
            config.buyer_bps = bb;
        }

        emit!(ConfigUpdated {
            min_wallets: config.min_wallets,
            min_sol: config.min_sol,
            auction_duration: config.auction_duration,
            buyer_bps: config.buyer_bps,
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
    ///
    /// Decrements `auction.total_sol` so downstream instructions (seed_pool,
    /// off-chain indexer) see accurate committed-SOL after refunds.
    pub fn emergency_refund_commitment(ctx: Context<EmergencyRefundCommitment>) -> Result<()> {
        require!(
            ctx.accounts.config.emergency_paused,
            BatchAuctionError::NotPaused
        );
        require!(
            !ctx.accounts.commitment.tokens_claimed,
            BatchAuctionError::AlreadyClaimed
        );
        // Block refund after pool has been seeded — the committed SOL is
        // no longer in the auction PDA and belongs to the LP now.
        // Participants should claim_tokens instead.
        require!(
            !ctx.accounts.auction.pool_seeded,
            BatchAuctionError::PoolAlreadySeeded
        );

        let amount = ctx.accounts.commitment.sol_amount;
        let auction_info = ctx.accounts.auction.to_account_info();
        let participant_info = ctx.accounts.participant.to_account_info();
        let mint_key = ctx.accounts.auction.mint;
        let participant_key = participant_info.key();

        transfer_lamports_with_floor(&auction_info, &participant_info, amount, 0)?;

        let commitment = &mut ctx.accounts.commitment;
        commitment.tokens_claimed = true;

        let auction = &mut ctx.accounts.auction;
        auction.total_sol = auction
            .total_sol
            .checked_sub(amount)
            .ok_or(BatchAuctionError::Overflow)?;

        emit!(CommitmentEmergencyRefunded {
            mint: mint_key,
            participant: participant_key,
            amount,
        });
        Ok(())
    }

    /// Admin escape hatch when the protocol is paused. Drains all
    /// lamports above rent-exempt minimum from a stuck auction PDA
    /// (e.g. succeeded auction whose pool was never created) to
    /// a destination wallet chosen by the admin. Only callable by
    /// the authority while paused.
    pub fn emergency_drain_auction(ctx: Context<EmergencyDrainAuction>) -> Result<()> {
        require!(
            ctx.accounts.config.emergency_paused,
            BatchAuctionError::NotPaused
        );

        let auction_info = ctx.accounts.auction.to_account_info();
        let rent = Rent::get()?;
        let min_balance = rent.minimum_balance(auction_info.data_len());
        let current = auction_info.lamports();
        let drainable = current
            .checked_sub(min_balance)
            .ok_or(BatchAuctionError::Overflow)?;
        require!(drainable > 0, BatchAuctionError::ZeroAmount);

        let dest_info = ctx.accounts.destination.to_account_info();
        **auction_info.try_borrow_mut_lamports()? = min_balance;
        **dest_info.try_borrow_mut_lamports()? = dest_info
            .lamports()
            .checked_add(drainable)
            .ok_or(BatchAuctionError::Overflow)?;

        emit!(AuctionDrained {
            mint: ctx.accounts.auction.mint,
            amount: drainable,
            destination: dest_info.key(),
        });
        Ok(())
    }

    // -----------------------------------------------------------------
    // Core lifecycle
    // -----------------------------------------------------------------

    /// Creator launches a new batch auction.
    ///
    /// The backend bundles this instruction with
    /// `stake_manager::deposit_stake` in the same transaction so both
    /// execute atomically. If either fails, both revert.
    ///
    /// Ticker uniqueness is enforced off-chain by the backend database.
    pub fn create_auction(
        ctx: Context<CreateAuction>,
        ticker: String,
        total_supply: u64,
    ) -> Result<()> {
        require!(ticker.len() <= MAX_TICKER_LEN, BatchAuctionError::TickerTooLong);
        require!(total_supply > 0, BatchAuctionError::InvalidSupply);

        let config = &ctx.accounts.config;
        require!(
            !config.emergency_paused,
            BatchAuctionError::Paused
        );
        let clock = Clock::get()?;

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

        // --- Snapshot config values so later admin changes don't affect this auction
        let snapshot_buyer_bps = config.buyer_bps;
        let snapshot_min_wallets = config.min_wallets;
        let snapshot_min_sol = config.min_sol;
        let auction_duration = config.auction_duration;

        // --- Populate auction state --------------------------------
        let auction = &mut ctx.accounts.auction;
        auction.creator = ctx.accounts.creator.key();
        auction.mint = ctx.accounts.mint.key();
        auction.ticker = ticker.clone();
        auction.start_time = clock.unix_timestamp;
        auction.end_time = clock
            .unix_timestamp
            .checked_add(auction_duration)
            .ok_or(BatchAuctionError::Overflow)?;
        auction.total_sol = 0;
        auction.total_supply = total_supply;
        auction.participant_count = 0;
        auction.state = AuctionState::Gathering;
        auction.uniform_price = 0;
        auction.pool_id = Pubkey::default();
        auction.pool_created = false;
        auction.pool_seeded = false;
        auction.buyer_bps = snapshot_buyer_bps;
        auction.min_wallets = snapshot_min_wallets;
        auction.min_sol = snapshot_min_sol;
        auction.bump = ctx.bumps.auction;

        emit!(AuctionCreated {
            mint: auction.mint,
            creator: auction.creator,
            ticker,
            total_supply,
            start_time: auction.start_time,
            end_time: auction.end_time,
            buyer_bps: snapshot_buyer_bps,
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

        // Use the snapshotted min_wallets/min_sol values from auction creation,
        // NOT the live config values. This prevents admin from retroactively
        // manipulating success/failure of in-flight auctions.
        if auction.participant_count >= auction.min_wallets
            && auction.total_sol >= auction.min_sol
        {
            auction.state = AuctionState::Succeeded;
            // Uniform price per token paid by batch buyers:
            //   price = total_sol / buyer_pool_tokens
            //         = total_sol / (total_supply * buyer_bps / 10_000)
            let buyer_pool_tokens = (auction.total_supply as u128)
                .checked_mul(auction.buyer_bps as u128)
                .ok_or(BatchAuctionError::Overflow)?
                .checked_div(BPS_DENOMINATOR as u128)
                .ok_or(BatchAuctionError::Overflow)?;
            auction.uniform_price = if buyer_pool_tokens > 0 {
                ((auction.total_sol as u128)
                    .checked_div(buyer_pool_tokens)
                    .ok_or(BatchAuctionError::Overflow)?) as u64
            } else {
                0
            };
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
    /// Only distributes `buyer_bps` of total supply (default 65%). The
    /// remaining supply (default 35%) stays in the vault to seed the
    /// Raydium CLMM pool via `seed_pool`.
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

        // buyer_pool_tokens = total_supply * buyer_bps / 10_000
        // tokens_owed = commitment.sol_amount * buyer_pool_tokens / total_sol
        let buyer_pool_tokens = (auction.total_supply as u128)
            .checked_mul(auction.buyer_bps as u128)
            .ok_or(BatchAuctionError::Overflow)?
            .checked_div(BPS_DENOMINATOR as u128)
            .ok_or(BatchAuctionError::Overflow)?;

        let tokens_owed = (commitment.sol_amount as u128)
            .checked_mul(buyer_pool_tokens)
            .ok_or(BatchAuctionError::Overflow)?
            .checked_div(auction.total_sol as u128)
            .ok_or(BatchAuctionError::Overflow)? as u64;

        require!(tokens_owed > 0, BatchAuctionError::ZeroAmount);

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

    /// Backend-only: release the pool's share of tokens (35% of total_supply
    /// when buyer_bps=6500) and all drainable SOL to crank-controlled
    /// accounts so the crank can build the Raydium CLMM position off-chain.
    ///
    /// The crank chooses the destination accounts. Tokens go to a
    /// crank-owned ATA; SOL goes to a crank-owned wallet. The crank is
    /// then responsible for creating the Raydium CLMM pool with both
    /// assets and transferring the resulting position NFT to the
    /// fee_router `pool_fee_account` PDA.
    ///
    /// Can only be called once per auction and only while in `Succeeded`
    /// state. After this returns, the auction is still in `Succeeded`
    /// (not `Trading`) — the state flips to `Trading` when `set_pool_id`
    /// is called with the finished pool address.
    pub fn seed_pool(ctx: Context<SeedPool>) -> Result<()> {
        require!(
            ctx.accounts.crank.key() == ctx.accounts.config.crank_authority,
            BatchAuctionError::Unauthorized
        );

        let auction_ref = &ctx.accounts.auction;
        require!(
            auction_ref.state == AuctionState::Succeeded,
            BatchAuctionError::InvalidState
        );
        require!(!auction_ref.pool_seeded, BatchAuctionError::PoolAlreadySeeded);
        require!(auction_ref.total_sol > 0, BatchAuctionError::ZeroAmount);

        // pool_tokens = total_supply * (10_000 - buyer_bps) / 10_000
        let pool_bps = BPS_DENOMINATOR
            .checked_sub(auction_ref.buyer_bps)
            .ok_or(BatchAuctionError::Overflow)?;
        let pool_tokens = (auction_ref.total_supply as u128)
            .checked_mul(pool_bps as u128)
            .ok_or(BatchAuctionError::Overflow)?
            .checked_div(BPS_DENOMINATOR as u128)
            .ok_or(BatchAuctionError::Overflow)? as u64;

        require!(pool_tokens > 0, BatchAuctionError::ZeroAmount);

        let mint_key = auction_ref.mint;
        let bump = auction_ref.bump;
        let snapshot_buyer_bps = auction_ref.buyer_bps;

        // Grab account infos up-front so we don't conflict with the
        // later mutable borrow of auction.
        let auction_info = ctx.accounts.auction.to_account_info();
        let token_vault_info = ctx.accounts.token_vault.to_account_info();
        let crank_token_info = ctx.accounts.crank_token_account.to_account_info();
        let token_program_info = ctx.accounts.token_program.to_account_info();
        let dest_info = ctx.accounts.crank_sol_destination.to_account_info();
        let crank_token_key = ctx.accounts.crank_token_account.key();
        let dest_key = dest_info.key();

        // Mark seeded BEFORE external CPIs to prevent reentrancy.
        {
            let auction = &mut ctx.accounts.auction;
            auction.pool_seeded = true;
        }

        // Transfer tokens from vault to crank token account.
        let seeds: &[&[u8]] = &[b"auction", mint_key.as_ref(), &[bump]];
        token::transfer(
            CpiContext::new_with_signer(
                token_program_info,
                Transfer {
                    from: token_vault_info,
                    to: crank_token_info,
                    authority: auction_info.clone(),
                },
                &[seeds],
            ),
            pool_tokens,
        )?;

        // Transfer all drainable SOL from auction PDA to the crank SOL
        // destination. We compute drainable from the actual PDA balance
        // minus rent, NOT from auction.total_sol, because a participant
        // could have called emergency_refund_commitment while paused,
        // leaving the PDA balance below auction.total_sol.
        let rent = Rent::get()?;
        let min_balance = rent.minimum_balance(auction_info.data_len());
        let current = auction_info.lamports();
        let drainable_sol = current
            .checked_sub(min_balance)
            .ok_or(BatchAuctionError::Overflow)?;
        require!(drainable_sol > 0, BatchAuctionError::ZeroAmount);

        **auction_info.try_borrow_mut_lamports()? = min_balance;
        **dest_info.try_borrow_mut_lamports()? = dest_info
            .lamports()
            .checked_add(drainable_sol)
            .ok_or(BatchAuctionError::Overflow)?;

        emit!(PoolSeeded {
            mint: mint_key,
            pool_tokens,
            sol_amount: drainable_sol,
            buyer_bps: snapshot_buyer_bps,
            crank_token_account: crank_token_key,
            crank_sol_destination: dest_key,
        });
        Ok(())
    }

    /// Backend-only: record the Raydium pool address after the off-chain
    /// crank creates the pool. Only callable by `crank_authority`.
    ///
    /// Requires that `seed_pool` has been called first (i.e. the crank
    /// actually has the tokens + SOL needed to build the pool).
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
        require!(auction.pool_seeded, BatchAuctionError::PoolNotSeeded);
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
    /// (currently: set_pool_id, seed_pool).
    pub crank_authority: Pubkey,
    pub pending_crank_authority: Pubkey,
    /// Minimum unique commitments for an auction to succeed.
    pub min_wallets: u32,
    /// Minimum total SOL (lamports) for success.
    pub min_sol: u64,
    /// Auction duration in seconds.
    pub auction_duration: i64,
    /// Share of total supply distributed to buyers at claim time,
    /// in real basis points. The remaining supply seeds the Raydium
    /// CLMM pool. Default 6500 (65%). Each auction snapshots this at
    /// creation time so later admin changes don't affect live auctions.
    pub buyer_bps: u16,
    /// When true, commits are blocked and emergency refunds are unlocked.
    pub emergency_paused: bool,
}

impl AuctionConfig {
    // discriminator(8) + 4*pubkey(128) + min_wallets(4) + min_sol(8)
    // + auction_duration(8) + buyer_bps(2) + emergency_paused(1)
    pub const LEN: usize = 8 + (4 * 32) + 4 + 8 + 8 + 2 + 1;
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
    pub participant_count: u32,
    pub state: AuctionState,
    pub uniform_price: u64,
    /// Raydium pool address, set by `set_pool_id` after the backend crank
    /// builds the pool off-chain.
    pub pool_id: Pubkey,
    /// True once `set_pool_id` has been called.
    pub pool_created: bool,
    /// True once `seed_pool` has released the pool's tokens + SOL to
    /// the crank for Raydium pool creation. Must be true before
    /// `set_pool_id` can be called.
    pub pool_seeded: bool,
    /// Snapshot of config.buyer_bps at auction creation. Pinning this
    /// per-auction means admin changes to the global split don't retroactively
    /// change what buyers receive from live auctions.
    pub buyer_bps: u16,
    /// Snapshot of config.min_wallets at auction creation so admin cannot
    /// retroactively raise/lower thresholds to manipulate live auction outcomes.
    pub min_wallets: u32,
    /// Snapshot of config.min_sol at auction creation (same rationale).
    pub min_sol: u64,
    pub bump: u8,
}

impl Auction {
    // discriminator(8) + creator(32) + mint(32) + string prefix(4) + max_ticker(10)
    // + start(8) + end(8) + total_sol(8) + total_supply(8) + count(4)
    // + state(1) + uniform_price(8) + pool_id(32) + pool_created(1)
    // + pool_seeded(1) + buyer_bps(2) + min_wallets(4) + min_sol(8) + bump(1)
    pub const LEN: usize =
        8 + 32 + 32 + (4 + MAX_TICKER_LEN) + 8 + 8 + 8 + 8 + 4 + 1 + 8 + 32 + 1 + 1 + 2 + 4 + 8 + 1;
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

#[derive(Accounts)]
pub struct EmergencyDrainAuction<'info> {
    #[account(
        seeds = [b"config"],
        bump,
        constraint = config.authority == authority.key() @ BatchAuctionError::Unauthorized,
    )]
    pub config: Account<'info, AuctionConfig>,

    #[account(
        mut,
        seeds = [b"auction", auction.mint.as_ref()],
        bump = auction.bump,
    )]
    pub auction: Account<'info, Auction>,

    pub authority: Signer<'info>,

    /// CHECK: Admin-chosen destination for drained lamports.
    #[account(mut)]
    pub destination: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct SeedPool<'info> {
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
        mut,
        seeds = [b"vault", auction.mint.as_ref()],
        bump,
    )]
    pub token_vault: Account<'info, TokenAccount>,

    /// Crank-owned token account that receives the pool's share of tokens.
    /// Must be for this mint. The crank decides the owner — validated at
    /// the token program level via standard SPL transfer rules.
    #[account(
        mut,
        constraint = crank_token_account.mint == auction.mint @ BatchAuctionError::InvalidMint,
    )]
    pub crank_token_account: Account<'info, TokenAccount>,

    /// Crank-owned SOL destination that receives all drainable SOL.
    /// CHECK: Crank chooses the destination; no data read. Must be writable
    /// to receive lamports.
    #[account(mut)]
    pub crank_sol_destination: AccountInfo<'info>,

    /// Backend crank authority.
    pub crank: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[event]
pub struct ConfigInitialized {
    pub authority: Pubkey,
    pub min_wallets: u32,
    pub min_sol: u64,
    pub auction_duration: i64,
    pub buyer_bps: u16,
}

#[event]
pub struct ConfigUpdated {
    pub min_wallets: u32,
    pub min_sol: u64,
    pub auction_duration: i64,
    pub buyer_bps: u16,
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
    pub buyer_bps: u16,
}

#[event]
pub struct AuctionDrained {
    pub mint: Pubkey,
    pub amount: u64,
    pub destination: Pubkey,
}

#[event]
pub struct PoolSeeded {
    pub mint: Pubkey,
    pub pool_tokens: u64,
    pub sol_amount: u64,
    pub buyer_bps: u16,
    pub crank_token_account: Pubkey,
    pub crank_sol_destination: Pubkey,
}

#[event]
pub struct SolCommitted {
    pub mint: Pubkey,
    pub participant: Pubkey,
    pub amount: u64,
    pub total_sol: u64,
    pub participant_count: u32,
}

#[event]
pub struct AuctionFinalized {
    pub mint: Pubkey,
    pub succeeded: bool,
    pub total_sol: u64,
    pub participant_count: u32,
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
    #[msg("Config value must be greater than zero")]
    InvalidConfigValue,
    #[msg("buyer_bps must be between 5000 and 9000 (50% to 90%)")]
    InvalidBuyerBps,
    #[msg("Pool has already been seeded")]
    PoolAlreadySeeded,
    #[msg("Pool must be seeded before set_pool_id")]
    PoolNotSeeded,
}
