// Fee Architecture:
// - Raydium CLMM pool with 1% fee tier (cannot be bypassed)
// - LP position owned by FeeRouter PDA
// - Fees claimed periodically and split:
//   CREATOR_FEE_BPS (8000) = 80% of pool fees to creator
//   PROTOCOL_FEE_BPS (2000) = 20% of pool fees to protocol
export const CREATOR_FEE_BPS = 8000; // 80% (out of 10_000)
export const PROTOCOL_FEE_BPS = 2000; // 20% (out of 10_000)
export const TOTAL_FEE_BPS = 10_000;

// Batch auction defaults
export const MIN_WALLETS = 50;
export const MIN_SOL_LAMPORTS = 10_000_000_000; // 10 SOL
export const AUCTION_DURATION_SECS = 300; // 5 minutes
export const COOLDOWN_SECS = 30;

// Token supply split between buyers and the Raydium CLMM pool.
// buyer_bps (65%) of total_supply goes to batch participants at claim time.
// The remaining (10000 - buyer_bps) (35%) seeds the pool alongside ALL
// committed SOL. Each auction snapshots this at creation — admin changes
// to the default only affect future auctions.
export const DEFAULT_BUYER_BPS = 6_500; // 65%
export const BUYER_BPS_FLOOR = 5_000;    // 50% (protocol guardrail)
export const BUYER_BPS_CEILING = 9_000;  // 90% (protocol guardrail)
export const BPS_DENOMINATOR = 10_000;

// Deployer stake
export const DEPLOYER_STAKE_LAMPORTS = 2_000_000_000; // 2 SOL
export const HOLDER_MILESTONE = 100;
export const MILESTONE_WINDOW_SECS = 259_200; // 72 hours

// Prove score
export const PROVE_SCORE_MAX = 100;
export const PROVE_SCORE_CAP = 70; // Benefits cap
export const PROVE_SCORE_DECAY_PER_WEEK = 2;

// Feed ranking weights
export const FEED_WEIGHT_HOLDERS = 0.4;
export const FEED_WEIGHT_VOLUME_24H = 0.3;
export const FEED_WEIGHT_HOLD_TIME = 0.2;
export const FEED_WEIGHT_QUESTS = 0.1;

// Program IDs are read from env vars by each consumer (indexer, frontend,
// scripts) — see programs.ts in the app and listener.ts in the indexer.
// This package intentionally does NOT re-export them to avoid stale fallbacks.

export const LAMPORTS_PER_SOL = 1_000_000_000;
