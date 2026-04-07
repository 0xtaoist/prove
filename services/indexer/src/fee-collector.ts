import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { prisma } from "./db";

const CLAIM_THRESHOLD_LAMPORTS = 10_000_000; // 0.01 SOL min to claim
const CLAIM_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

export function startFeeCollector(): NodeJS.Timeout {
  console.log("[fee-collector] Starting fee collection loop (every 15m)");

  // Run immediately, then on interval
  collectFees();
  return setInterval(collectFees, CLAIM_INTERVAL_MS);
}

async function collectFees() {
  try {
    // Get all trading auctions with Raydium pools
    const pools = await prisma.auction.findMany({
      where: {
        state: "TRADING",
        raydiumPoolId: { not: null },
      },
    });

    console.log(`[fee-collector] Checking ${pools.length} pools for claimable fees`);

    for (const pool of pools) {
      try {
        await claimPoolFees(pool.mint, pool.raydiumPoolId!, pool.creator);
      } catch (err) {
        console.error(`[fee-collector] Error claiming fees for ${pool.ticker}:`, err);
      }
    }
  } catch (err) {
    console.error("[fee-collector] Collection loop error:", err);
  }
}

async function claimPoolFees(mint: string, poolId: string, creator: string) {
  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!rpcUrl) return;

  const connection = new Connection(rpcUrl);

  // TODO: Implement with Raydium CLMM SDK
  // 1. Read accumulated fees from the CLMM position
  // 2. If fees > CLAIM_THRESHOLD_LAMPORTS:
  //    a. Claim fees from Raydium CLMM position (decreaseLiquidity or collectFee)
  //    b. Call FeeRouter.claim_and_split with the claimed amounts
  //    c. Update CreatorFee table in DB
  // 3. Log the claim for transparency

  console.log(`[fee-collector] Checking fees for pool ${poolId} (token: ${mint})`);
}
