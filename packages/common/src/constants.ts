import { PublicKey } from "@solana/web3.js";

// Platform fee configuration
export const CREATOR_FEE_BPS = 80; // 0.8%
export const PROTOCOL_FEE_BPS = 20; // 0.2%
export const TOTAL_FEE_BPS = 100; // 1.0%

// Batch auction defaults
export const MIN_WALLETS = 50;
export const MIN_SOL_LAMPORTS = 10_000_000_000; // 10 SOL
export const AUCTION_DURATION_SECS = 300; // 5 minutes
export const COOLDOWN_SECS = 30;

// Deployer stake
export const DEPLOYER_STAKE_LAMPORTS = 2_000_000_000; // 2 SOL
export const HOLDER_MILESTONE = 100;
export const MILESTONE_WINDOW_SECS = 259_200; // 72 hours

// Ticker registry
export const TICKER_MAX_LENGTH = 10;
export const TICKER_TTL_SECS = 604_800; // 7 days

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
export const PROGRAM_IDS = {
  batchAuction: new PublicKey("BAuc111111111111111111111111111111111111111"),
  feeRouter: new PublicKey("FeeR111111111111111111111111111111111111111"),
  stakeManager: new PublicKey("Stak111111111111111111111111111111111111111"),
  tickerRegistry: new PublicKey("Tick111111111111111111111111111111111111111"),
  proveAmm: new PublicKey("PAMM111111111111111111111111111111111111111"),
} as const;

export const LAMPORTS_PER_SOL = 1_000_000_000;
