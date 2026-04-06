-- 001_initial.sql
-- Raw SQL migration matching the Prisma schema (backup / non-Prisma environments).
-- PostgreSQL 15+

-- =========================================================================
-- Enums
-- =========================================================================

CREATE TYPE "AuctionState" AS ENUM ('GATHERING', 'SUCCEEDED', 'FAILED', 'TRADING');
CREATE TYPE "StakeState"   AS ENUM ('ESCROWED', 'RETURNED', 'FORFEITED');
CREATE TYPE "QuestType"    AS ENUM ('X_POSTS', 'HOLDER_COUNT', 'HOLD_TIME', 'PRICE_ABOVE_BATCH', 'GRADUATION');

-- =========================================================================
-- Tables
-- =========================================================================

-- ── Auctions ────────────────────────────────────────────────────────────

CREATE TABLE "Auction" (
    "id"               TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
    "mint"             TEXT         NOT NULL,
    "ticker"           TEXT         NOT NULL,
    "creator"          TEXT         NOT NULL,
    "startTime"        TIMESTAMPTZ  NOT NULL,
    "endTime"          TIMESTAMPTZ  NOT NULL,
    "totalSol"         BIGINT       NOT NULL DEFAULT 0,
    "totalSupply"      BIGINT       NOT NULL,
    "participantCount" INT          NOT NULL DEFAULT 0,
    "state"            "AuctionState" NOT NULL DEFAULT 'GATHERING',
    "uniformPrice"     BIGINT,
    "stakeReturned"    BOOLEAN      NOT NULL DEFAULT FALSE,
    "tokenName"        TEXT,
    "tokenImage"       TEXT,
    "description"      TEXT,
    "createdAt"        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    "updatedAt"        TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT "Auction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Auction_mint_key"    ON "Auction" ("mint");
CREATE INDEX        "Auction_creator_idx" ON "Auction" ("creator");
CREATE INDEX        "Auction_state_idx"   ON "Auction" ("state");
CREATE INDEX        "Auction_ticker_idx"  ON "Auction" ("ticker");

-- ── Commitments ─────────────────────────────────────────────────────────

CREATE TABLE "Commitment" (
    "id"            TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
    "auctionMint"   TEXT         NOT NULL,
    "wallet"        TEXT         NOT NULL,
    "solAmount"     BIGINT       NOT NULL,
    "tokensClaimed" BOOLEAN      NOT NULL DEFAULT FALSE,
    "createdAt"     TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT "Commitment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Commitment_auctionMint_fkey"
        FOREIGN KEY ("auctionMint") REFERENCES "Auction" ("mint")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Commitment_auctionMint_wallet_key" ON "Commitment" ("auctionMint", "wallet");
CREATE INDEX        "Commitment_wallet_idx"             ON "Commitment" ("wallet");

-- ── Swaps ───────────────────────────────────────────────────────────────

CREATE TABLE "Swap" (
    "id"          TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
    "auctionMint" TEXT         NOT NULL,
    "wallet"      TEXT         NOT NULL,
    "isBuy"       BOOLEAN      NOT NULL,
    "solAmount"   BIGINT       NOT NULL,
    "tokenAmount" BIGINT       NOT NULL,
    "creatorFee"  BIGINT       NOT NULL,
    "protocolFee" BIGINT       NOT NULL,
    "price"       BIGINT       NOT NULL,
    "signature"   TEXT         NOT NULL,
    "timestamp"   TIMESTAMPTZ  NOT NULL,

    CONSTRAINT "Swap_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Swap_auctionMint_fkey"
        FOREIGN KEY ("auctionMint") REFERENCES "Auction" ("mint")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Swap_signature_key"             ON "Swap" ("signature");
CREATE INDEX        "Swap_auctionMint_timestamp_idx" ON "Swap" ("auctionMint", "timestamp");
CREATE INDEX        "Swap_wallet_idx"                ON "Swap" ("wallet");

-- ── Stakes ──────────────────────────────────────────────────────────────

CREATE TABLE "Stake" (
    "id"                TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
    "auctionMint"       TEXT         NOT NULL,
    "creator"           TEXT         NOT NULL,
    "amount"            BIGINT       NOT NULL,
    "milestoneDeadline" TIMESTAMPTZ  NOT NULL,
    "state"             "StakeState" NOT NULL DEFAULT 'ESCROWED',
    "evaluatedAt"       TIMESTAMPTZ,
    "createdAt"         TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT "Stake_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Stake_auctionMint_fkey"
        FOREIGN KEY ("auctionMint") REFERENCES "Auction" ("mint")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Stake_auctionMint_key" ON "Stake" ("auctionMint");
CREATE INDEX        "Stake_creator_idx"     ON "Stake" ("creator");
CREATE INDEX        "Stake_state_idx"       ON "Stake" ("state");

-- ── Ticker Registry ─────────────────────────────────────────────────────

CREATE TABLE "TickerEntry" (
    "id"           TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
    "ticker"       TEXT         NOT NULL,
    "mint"         TEXT         NOT NULL,
    "registeredAt" TIMESTAMPTZ  NOT NULL DEFAULT now(),
    "ttlExpiry"    TIMESTAMPTZ  NOT NULL,
    "active"       BOOLEAN      NOT NULL DEFAULT TRUE,

    CONSTRAINT "TickerEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TickerEntry_ticker_key" ON "TickerEntry" ("ticker");
CREATE UNIQUE INDEX "TickerEntry_mint_key"   ON "TickerEntry" ("mint");
CREATE INDEX        "TickerEntry_active_idx" ON "TickerEntry" ("active");

-- ── Holder Snapshots ────────────────────────────────────────────────────

CREATE TABLE "HolderSnapshot" (
    "id"          TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
    "mint"        TEXT         NOT NULL,
    "wallet"      TEXT         NOT NULL,
    "balance"     BIGINT       NOT NULL,
    "firstSeen"   TIMESTAMPTZ  NOT NULL,
    "lastUpdated" TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT "HolderSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HolderSnapshot_mint_wallet_key" ON "HolderSnapshot" ("mint", "wallet");
CREATE INDEX        "HolderSnapshot_mint_idx"        ON "HolderSnapshot" ("mint");

-- ── Prove Scores ────────────────────────────────────────────────────────

CREATE TABLE "ProveScore" (
    "id"                   TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
    "wallet"               TEXT         NOT NULL,
    "score"                INT          NOT NULL DEFAULT 0,
    "totalHoldTimeHours"   DOUBLE PRECISION NOT NULL DEFAULT 0,
    "auctionsParticipated" INT          NOT NULL DEFAULT 0,
    "questContributions"   INT          NOT NULL DEFAULT 0,
    "earlyDumpRatio"       DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastActive"           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    "updatedAt"            TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT "ProveScore_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProveScore_wallet_key" ON "ProveScore" ("wallet");

-- ── Quests ──────────────────────────────────────────────────────────────

CREATE TABLE "Quest" (
    "id"          TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
    "auctionMint" TEXT         NOT NULL,
    "type"        "QuestType"  NOT NULL,
    "target"      INT          NOT NULL,
    "current"     INT          NOT NULL DEFAULT 0,
    "completed"   BOOLEAN      NOT NULL DEFAULT FALSE,
    "completedAt" TIMESTAMPTZ,
    "reward"      TEXT         NOT NULL,
    "createdAt"   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    "updatedAt"   TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT "Quest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Quest_auctionMint_fkey"
        FOREIGN KEY ("auctionMint") REFERENCES "Auction" ("mint")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Quest_auctionMint_type_key" ON "Quest" ("auctionMint", "type");
CREATE INDEX        "Quest_completed_idx"        ON "Quest" ("completed");

-- ── Creator Fee Tracking ────────────────────────────────────────────────

CREATE TABLE "CreatorFee" (
    "id"             TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
    "mint"           TEXT         NOT NULL,
    "creator"        TEXT         NOT NULL,
    "totalEarned"    BIGINT       NOT NULL DEFAULT 0,
    "totalWithdrawn" BIGINT       NOT NULL DEFAULT 0,
    "lastUpdated"    TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT "CreatorFee_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CreatorFee_mint_creator_key" ON "CreatorFee" ("mint", "creator");
CREATE INDEX        "CreatorFee_creator_idx"      ON "CreatorFee" ("creator");

-- ── Forfeit Pool ────────────────────────────────────────────────────────

CREATE TABLE "ForfeitPool" (
    "id"               TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
    "totalForfeited"   BIGINT       NOT NULL DEFAULT 0,
    "lastDistribution" TIMESTAMPTZ,
    "updatedAt"        TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT "ForfeitPool_pkey" PRIMARY KEY ("id")
);
