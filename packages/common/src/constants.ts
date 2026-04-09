import { PublicKey } from "@solana/web3.js";

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

// Program IDs (placeholder - replace with deployed addresses)
// Post-auction liquidity pools are created on Raydium CLMM (concentrated liquidity).
export const PROGRAM_IDS = {
  batchAuction: new PublicKey("BAuc111111111111111111111111111111111111111"),
  feeRouter: new PublicKey("FeeR111111111111111111111111111111111111111"),
  stakeManager: new PublicKey("Stak111111111111111111111111111111111111111"),
  raydiumClmm: new PublicKey("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK"), // Raydium CLMM
} as const;

export const LAMPORTS_PER_SOL = 1_000_000_000;
