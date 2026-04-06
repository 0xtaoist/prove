-- CreateEnum
CREATE TYPE "AuctionState" AS ENUM ('GATHERING', 'SUCCEEDED', 'FAILED', 'TRADING');

-- CreateEnum
CREATE TYPE "StakeState" AS ENUM ('ESCROWED', 'RETURNED', 'FORFEITED');

-- CreateEnum
CREATE TYPE "QuestType" AS ENUM ('X_POSTS', 'HOLDER_COUNT', 'HOLD_TIME', 'PRICE_ABOVE_BATCH', 'GRADUATION');

-- CreateTable
CREATE TABLE "Auction" (
    "id" TEXT NOT NULL,
    "mint" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "creator" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "totalSol" BIGINT NOT NULL DEFAULT 0,
    "totalSupply" BIGINT NOT NULL,
    "participantCount" INTEGER NOT NULL DEFAULT 0,
    "state" "AuctionState" NOT NULL DEFAULT 'GATHERING',
    "uniformPrice" BIGINT,
    "stakeReturned" BOOLEAN NOT NULL DEFAULT false,
    "tokenName" TEXT,
    "tokenImage" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Auction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Commitment" (
    "id" TEXT NOT NULL,
    "auctionMint" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "solAmount" BIGINT NOT NULL,
    "tokensClaimed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Commitment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Swap" (
    "id" TEXT NOT NULL,
    "auctionMint" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "isBuy" BOOLEAN NOT NULL,
    "solAmount" BIGINT NOT NULL,
    "tokenAmount" BIGINT NOT NULL,
    "creatorFee" BIGINT NOT NULL,
    "protocolFee" BIGINT NOT NULL,
    "price" BIGINT NOT NULL,
    "signature" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Swap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stake" (
    "id" TEXT NOT NULL,
    "auctionMint" TEXT NOT NULL,
    "creator" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "milestoneDeadline" TIMESTAMP(3) NOT NULL,
    "state" "StakeState" NOT NULL DEFAULT 'ESCROWED',
    "evaluatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Stake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TickerEntry" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "mint" TEXT NOT NULL,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ttlExpiry" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TickerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HolderSnapshot" (
    "id" TEXT NOT NULL,
    "mint" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "balance" BIGINT NOT NULL,
    "firstSeen" TIMESTAMP(3) NOT NULL,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HolderSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProveScore" (
    "id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "totalHoldTimeHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "auctionsParticipated" INTEGER NOT NULL DEFAULT 0,
    "questContributions" INTEGER NOT NULL DEFAULT 0,
    "earlyDumpRatio" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastActive" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProveScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quest" (
    "id" TEXT NOT NULL,
    "auctionMint" TEXT NOT NULL,
    "type" "QuestType" NOT NULL,
    "target" INTEGER NOT NULL,
    "current" INTEGER NOT NULL DEFAULT 0,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "reward" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorFee" (
    "id" TEXT NOT NULL,
    "mint" TEXT NOT NULL,
    "creator" TEXT NOT NULL,
    "totalEarned" BIGINT NOT NULL DEFAULT 0,
    "totalWithdrawn" BIGINT NOT NULL DEFAULT 0,
    "lastUpdated" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorFee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForfeitPool" (
    "id" TEXT NOT NULL,
    "totalForfeited" BIGINT NOT NULL DEFAULT 0,
    "lastDistribution" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForfeitPool_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Auction_mint_key" ON "Auction"("mint");

-- CreateIndex
CREATE INDEX "Auction_creator_idx" ON "Auction"("creator");

-- CreateIndex
CREATE INDEX "Auction_state_idx" ON "Auction"("state");

-- CreateIndex
CREATE INDEX "Auction_ticker_idx" ON "Auction"("ticker");

-- CreateIndex
CREATE INDEX "Commitment_wallet_idx" ON "Commitment"("wallet");

-- CreateIndex
CREATE UNIQUE INDEX "Commitment_auctionMint_wallet_key" ON "Commitment"("auctionMint", "wallet");

-- CreateIndex
CREATE UNIQUE INDEX "Swap_signature_key" ON "Swap"("signature");

-- CreateIndex
CREATE INDEX "Swap_auctionMint_timestamp_idx" ON "Swap"("auctionMint", "timestamp");

-- CreateIndex
CREATE INDEX "Swap_wallet_idx" ON "Swap"("wallet");

-- CreateIndex
CREATE UNIQUE INDEX "Stake_auctionMint_key" ON "Stake"("auctionMint");

-- CreateIndex
CREATE INDEX "Stake_creator_idx" ON "Stake"("creator");

-- CreateIndex
CREATE INDEX "Stake_state_idx" ON "Stake"("state");

-- CreateIndex
CREATE UNIQUE INDEX "TickerEntry_ticker_key" ON "TickerEntry"("ticker");

-- CreateIndex
CREATE UNIQUE INDEX "TickerEntry_mint_key" ON "TickerEntry"("mint");

-- CreateIndex
CREATE INDEX "TickerEntry_active_idx" ON "TickerEntry"("active");

-- CreateIndex
CREATE INDEX "HolderSnapshot_mint_idx" ON "HolderSnapshot"("mint");

-- CreateIndex
CREATE UNIQUE INDEX "HolderSnapshot_mint_wallet_key" ON "HolderSnapshot"("mint", "wallet");

-- CreateIndex
CREATE UNIQUE INDEX "ProveScore_wallet_key" ON "ProveScore"("wallet");

-- CreateIndex
CREATE INDEX "Quest_completed_idx" ON "Quest"("completed");

-- CreateIndex
CREATE UNIQUE INDEX "Quest_auctionMint_type_key" ON "Quest"("auctionMint", "type");

-- CreateIndex
CREATE INDEX "CreatorFee_creator_idx" ON "CreatorFee"("creator");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorFee_mint_creator_key" ON "CreatorFee"("mint", "creator");

-- AddForeignKey
ALTER TABLE "Commitment" ADD CONSTRAINT "Commitment_auctionMint_fkey" FOREIGN KEY ("auctionMint") REFERENCES "Auction"("mint") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Swap" ADD CONSTRAINT "Swap_auctionMint_fkey" FOREIGN KEY ("auctionMint") REFERENCES "Auction"("mint") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stake" ADD CONSTRAINT "Stake_auctionMint_fkey" FOREIGN KEY ("auctionMint") REFERENCES "Auction"("mint") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quest" ADD CONSTRAINT "Quest_auctionMint_fkey" FOREIGN KEY ("auctionMint") REFERENCES "Auction"("mint") ON DELETE RESTRICT ON UPDATE CASCADE;
