// Auction state enum matching on-chain
export enum AuctionState {
  Gathering = "gathering",
  Succeeded = "succeeded",
  Failed = "failed",
  Trading = "trading",
}

// Stake state enum matching on-chain
export enum StakeState {
  Escrowed = "escrowed",
  Returned = "returned",
  Forfeited = "forfeited",
}

// Quest types
export enum QuestType {
  XPosts = "x_posts",
  HolderCount = "holder_count",
  HoldTime = "hold_time",
  PriceAboveBatch = "price_above_batch",
  Graduation = "graduation",
}

export interface Auction {
  creator: string;
  mint: string;
  startTime: number;
  endTime: number;
  totalSol: bigint;
  totalSupply: bigint;
  participantCount: number;
  state: AuctionState;
  stakeReturned: boolean;
  ticker: string;
  uniformPrice: bigint | null;
  poolAddress: string | null; // Raydium pool address, set after pool creation
}

export interface Commitment {
  wallet: string;
  auctionMint: string;
  solAmount: bigint;
  tokensClaimed: boolean;
}

export interface TokenStats {
  mint: string;
  ticker: string;
  creator: string;
  holderCount: number;
  volume24h: bigint;
  avgHoldTimeHours: number;
  currentPrice: bigint;
  batchPrice: bigint;
  questsCompleted: number;
  createdAt: number;
  feedScore: number;
  raydiumPoolId: string | null; // Raydium pool address, null if pool not yet created
}

export interface ProveScore {
  wallet: string;
  score: number;
  totalHoldTimeHours: number;
  auctionsParticipated: number;
  questContributions: number;
  earlyDumpRatio: number;
  lastActive: number;
}

export interface Quest {
  id: string;
  mint: string;
  type: QuestType;
  target: number;
  current: number;
  completed: boolean;
  completedAt: number | null;
  reward: string;
}

export interface CreatorDashboard {
  wallet: string;
  tokens: string[];
  totalFeesEarned: bigint;
  totalFeesWithdrawn: bigint;
  pendingFees: bigint;
  stakesActive: number;
  stakesReturned: number;
  stakesForfeited: number;
}

export interface FeedToken {
  mint: string;
  ticker: string;
  creator: string;
  holderCount: number;
  volume24h: string;
  avgHoldTimeHours: number;
  priceChangePct: number;
  questsCompleted: number;
  badges: string[];
  feedScore: number;
  pinned: boolean;
  pinnedUntil: number | null;
}
