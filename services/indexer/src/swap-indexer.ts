import {
  Connection,
  PublicKey,
  ConfirmedSignatureInfo,
} from "@solana/web3.js";
import { prisma } from "./db";
import {
  CREATOR_FEE_BPS,
  TOTAL_FEE_BPS,
} from "@prove/common";

/**
 * Swap indexer — records every trade that touches an active auction
 * mint into the Swap table. Works for direct Raydium CLMM swaps and for
 * Jupiter-routed transactions, because it reads balance deltas rather
 * than parsing instruction data.
 *
 * Strategy per poll cycle:
 *   1. Enumerate TRADING auctions that have a Raydium pool.
 *   2. For each pool, walk getSignaturesForAddress() from the most
 *      recently indexed signature up to the current tip, paginating in
 *      chunks of SIGNATURE_LIMIT until caught up (or MAX_PAGES_PER_POLL
 *      is reached, so one backlogged pool can't monopolize the loop).
 *   3. For each new signature, fetch the transaction and compute:
 *        tokenDelta = sum of signer-owned auctionMint ATA deltas
 *        solDelta   = native lamport delta + signer-owned WSOL ATA delta
 *                     + tx fee (added back, since the fee is not part
 *                       of the swap amount)
 *      - tokenDelta > 0 and solDelta < 0 → buy
 *      - tokenDelta < 0 and solDelta > 0 → sell
 *      - anything else → not a swap of this mint by this signer; skip.
 *   4. Upsert into Swap. `signature` is the unique key, so reruns and
 *      overlapping workers are idempotent.
 *
 * Caveats / known limitations:
 *   - Rent movement from opening/closing wrapped SOL ATAs adds ~2M
 *     lamports of noise per tx. Acceptable for feed ranking, volume,
 *     and prove-score inputs; not precise enough for accounting.
 *   - Exotic Jupiter multi-hop routes where the signer never touches
 *     our auction mint's balance directly won't be detected. In
 *     practice the signer always ends up holding or releasing the
 *     token on buys and sells.
 *   - Swaps that happened before the indexer was running are not
 *     backfilled. The cursor starts at the tip the first time a pool
 *     is seen.
 *
 * The canonical pool-fee split (1% pool fee, then 80/20 creator/
 * protocol) is mirrored here for bookkeeping. Actual on-chain fee
 * collection happens in fee-collector.ts via FeeRouter.claim_and_split.
 */

const WSOL_MINT = "So11111111111111111111111111111111111111112";
const POLL_INTERVAL_MS = 30_000;
const SIGNATURE_LIMIT = 100;
const MAX_PAGES_PER_POLL = 10;

// Raydium CLMM 1% fee tier. Matches the tier chosen by
// create-raydium-pool.ts and enforced by FeeRouter.register_pool.
const POOL_FEE_BPS = 100n;
const BPS_DENOM = 10_000n;

let timer: NodeJS.Timeout | undefined;
let connection: Connection | undefined;
let pollInFlight = false;

export function startSwapIndexer(): NodeJS.Timeout | undefined {
  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!rpcUrl) {
    console.error("[swap-indexer] SOLANA_RPC_URL not set, skipping");
    return undefined;
  }
  connection = new Connection(rpcUrl, "confirmed");
  console.log(
    `[swap-indexer] Starting swap polling loop (every ${POLL_INTERVAL_MS / 1000}s)`,
  );
  // Kick off immediately, then on interval.
  void pollAllPools();
  timer = setInterval(() => void pollAllPools(), POLL_INTERVAL_MS);
  return timer;
}

export function stopSwapIndexer(): void {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
}

async function pollAllPools(): Promise<void> {
  if (!connection) return;
  // Guard against overlapping runs if the previous poll is still in
  // progress (e.g. slow RPC, large backlog).
  if (pollInFlight) return;
  pollInFlight = true;

  try {
    const pools = await prisma.auction.findMany({
      where: {
        state: "TRADING",
        raydiumPoolId: { not: null },
      },
      select: { mint: true, raydiumPoolId: true },
    });
    if (pools.length === 0) return;

    for (const pool of pools) {
      try {
        await indexPool(pool.mint, pool.raydiumPoolId!);
      } catch (err) {
        console.error(`[swap-indexer] pool ${pool.mint} error:`, err);
      }
    }
  } catch (err) {
    console.error("[swap-indexer] poll loop error:", err);
  } finally {
    pollInFlight = false;
  }
}

async function indexPool(auctionMint: string, poolId: string): Promise<void> {
  if (!connection) return;

  let poolPk: PublicKey;
  try {
    poolPk = new PublicKey(poolId);
  } catch {
    console.error(
      `[swap-indexer] invalid pool id for ${auctionMint}: ${poolId}`,
    );
    return;
  }

  // Cursor: the newest signature we've already persisted for this
  // auction. We walk newer-than-cursor back to the tip.
  const cursor = await prisma.swap.findFirst({
    where: { auctionMint },
    orderBy: { timestamp: "desc" },
    select: { signature: true },
  });
  const untilSig = cursor?.signature;

  // Paginate to catch up on backlog. `before` moves the walk older on
  // each iteration; `until` bounds it at our stored cursor.
  let before: string | undefined = undefined;
  const collected: ConfirmedSignatureInfo[] = [];
  for (let page = 0; page < MAX_PAGES_PER_POLL; page++) {
    const batch: ConfirmedSignatureInfo[] =
      await connection.getSignaturesForAddress(
        poolPk,
        { before, until: untilSig, limit: SIGNATURE_LIMIT },
        "confirmed",
      );
    if (batch.length === 0) break;
    collected.push(...batch);
    if (batch.length < SIGNATURE_LIMIT) break;
    before = batch[batch.length - 1].signature;
  }

  if (collected.length === 0) return;

  // Process oldest first so the cursor advances monotonically and a
  // crash mid-batch can resume cleanly on the next poll.
  collected.reverse();

  let indexed = 0;
  for (const sigInfo of collected) {
    if (sigInfo.err) continue;
    const inserted = await indexSwap(sigInfo.signature, auctionMint);
    if (inserted) indexed++;
  }

  if (indexed > 0) {
    console.log(
      `[swap-indexer] ${auctionMint}: indexed ${indexed}/${collected.length} txs`,
    );
  }
}

async function indexSwap(
  signature: string,
  auctionMint: string,
): Promise<boolean> {
  if (!connection) return false;

  // Quick check to skip the RPC round-trip when we already have this swap.
  const existing = await prisma.swap.findUnique({ where: { signature } });
  if (existing) return false;

  const tx = await connection.getTransaction(signature, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });
  if (!tx || !tx.meta || tx.meta.err) return false;
  if (tx.blockTime == null) return false;

  // The fee payer is always the first static account key on any
  // Solana transaction — legacy or versioned.
  const staticKeys = tx.transaction.message.staticAccountKeys;
  if (!staticKeys || staticKeys.length === 0) return false;
  const walletStr = staticKeys[0].toBase58();

  // Compute the signer's token balance deltas for the auction mint
  // and for wrapped SOL. Sum over all matching token accounts in
  // case the user holds more than one (rare but legal).
  let tokenDelta = 0n;
  let walletWsolDelta = 0n;

  for (const bal of tx.meta.preTokenBalances ?? []) {
    if (bal.owner !== walletStr) continue;
    const amt = BigInt(bal.uiTokenAmount.amount);
    if (bal.mint === auctionMint) tokenDelta -= amt;
    else if (bal.mint === WSOL_MINT) walletWsolDelta -= amt;
  }
  for (const bal of tx.meta.postTokenBalances ?? []) {
    if (bal.owner !== walletStr) continue;
    const amt = BigInt(bal.uiTokenAmount.amount);
    if (bal.mint === auctionMint) tokenDelta += amt;
    else if (bal.mint === WSOL_MINT) walletWsolDelta += amt;
  }

  if (tokenDelta === 0n) return false;

  // Native lamport delta for the fee payer. Add the tx fee back so
  // we measure the swap amount, not the protocol cost. Combine with
  // the WSOL ATA delta so the math works whether the user wraps/
  // unwraps inside the tx (fresh buy) or reuses an existing WSOL ATA
  // (Jupiter routing).
  const nativeDelta =
    BigInt(tx.meta.postBalances[0]) -
    BigInt(tx.meta.preBalances[0]) +
    BigInt(tx.meta.fee);
  const solDelta = nativeDelta + walletWsolDelta;

  if (solDelta === 0n) return false;

  // A real swap moves tokens and SOL in opposite directions.
  const isBuy = tokenDelta > 0n;
  if ((tokenDelta > 0n) === (solDelta > 0n)) return false;

  const tokenAmount = tokenDelta < 0n ? -tokenDelta : tokenDelta;
  const solAmount = solDelta < 0n ? -solDelta : solDelta;

  // Integer price in lamports per raw token unit. Matches the unit
  // used by auction.uniformPrice, so downstream consumers (quest
  // verifier, feed ranking) can compare directly.
  const price = solAmount / tokenAmount;

  // Mirror the 1% pool fee × 80/20 split into per-swap fee columns.
  // This is bookkeeping: real fee movement happens in FeeRouter.
  const totalFee = (solAmount * POOL_FEE_BPS) / BPS_DENOM;
  const creatorFee =
    (totalFee * BigInt(CREATOR_FEE_BPS)) / BigInt(TOTAL_FEE_BPS);
  const protocolFee = totalFee - creatorFee;

  // Upsert: the unique constraint on `signature` is the source of truth.
  // If another worker inserted first, the update is a harmless no-op
  // (all values are identical). No more TOCTOU race.
  const row = await prisma.swap.upsert({
    where: { signature },
    create: {
      auctionMint,
      wallet: walletStr,
      isBuy,
      solAmount,
      tokenAmount,
      creatorFee,
      protocolFee,
      price,
      signature,
      timestamp: new Date(tx.blockTime * 1000),
    },
    update: {},
  });
  // `createdAt` only exists on newly created rows in some Prisma versions.
  // We treat any upsert that didn't throw as success; the findUnique
  // guard at the top handles the common "already indexed" case.
  return row != null;
}
