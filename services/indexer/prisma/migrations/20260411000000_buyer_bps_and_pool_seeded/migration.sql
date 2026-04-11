-- AddColumn: buyer_bps and pool_seeded on Auction
-- These track the on-chain 65/35 supply split (buyers vs Raydium pool)
-- and whether seed_pool has released the pool's share of tokens + SOL.

ALTER TABLE "Auction"
  ADD COLUMN "buyerBps" INTEGER NOT NULL DEFAULT 6500,
  ADD COLUMN "poolSeeded" BOOLEAN NOT NULL DEFAULT false;

-- Sanity: buyerBps must stay within the on-chain floor/ceiling (50%-90%).
ALTER TABLE "Auction"
  ADD CONSTRAINT "Auction_buyerBps_range"
  CHECK ("buyerBps" >= 5000 AND "buyerBps" <= 9000);

-- AddEnum value: EMERGENCY_WITHDRAWN for Stake.state
ALTER TYPE "StakeState" ADD VALUE IF NOT EXISTS 'EMERGENCY_WITHDRAWN';
