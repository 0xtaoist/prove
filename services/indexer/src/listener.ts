import { Connection, PublicKey, Logs } from "@solana/web3.js";
import { prisma } from "./db";

// Program IDs — TickerRegistry removed (archived, off-chain now).
const PROGRAMS = {
  BatchAuction: new PublicKey("BAuc111111111111111111111111111111111111111"),
  FeeRouter: new PublicKey("FeeR111111111111111111111111111111111111111"),
  StakeManager: new PublicKey("Stak111111111111111111111111111111111111111"),
} as const;

// Reconnection config
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 60_000;
const BACKOFF_FACTOR = 2;

type ProgramName = keyof typeof PROGRAMS;

// Subscription tracking for cleanup
const subscriptions: number[] = [];
let connection: Connection;

export function startListener(): void {
  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!rpcUrl) {
    console.error("[listener] SOLANA_RPC_URL not set, skipping listener");
    return;
  }

  connection = new Connection(rpcUrl, "confirmed");
  console.log("[listener] Connecting to Solana RPC...");

  for (const [name, programId] of Object.entries(PROGRAMS)) {
    subscribeWithReconnect(name as ProgramName, programId);
  }
}

function subscribeWithReconnect(name: ProgramName, programId: PublicKey): void {
  let delay = BASE_DELAY_MS;

  function subscribe(): void {
    console.log(`[listener] Subscribing to ${name} (${programId.toBase58()})`);

    try {
      const subId = connection.onLogs(
        programId,
        (logs: Logs) => {
          delay = BASE_DELAY_MS;
          handleLogs(name, logs).catch((err) => {
            console.error(`[listener] Error handling ${name} logs:`, err);
          });
        },
        "confirmed"
      );

      subscriptions.push(subId);
    } catch (err) {
      console.error(`[listener] Failed to subscribe to ${name}:`, err);
      reconnect();
    }
  }

  function reconnect(): void {
    console.log(`[listener] Reconnecting ${name} in ${delay}ms...`);
    setTimeout(() => {
      subscribe();
      delay = Math.min(delay * BACKOFF_FACTOR, MAX_DELAY_MS);
    }, delay);
  }

  subscribe();
}

async function handleLogs(program: ProgramName, logs: Logs): Promise<void> {
  const { signature, err, logs: logMessages } = logs;

  if (err) return;

  for (const log of logMessages) {
    if (!log.startsWith("Program log:") && !log.startsWith("Program data:")) continue;

    const message = log.replace(/^Program (log|data): /, "");

    switch (program) {
      case "BatchAuction":
        await handleBatchAuctionEvent(message, signature);
        break;
      case "FeeRouter":
        await handleFeeRouterEvent(message, signature);
        break;
      case "StakeManager":
        await handleStakeManagerEvent(message, signature);
        break;
    }
  }
}

// ─── BatchAuction Events ────────────────────────────────────

async function handleBatchAuctionEvent(log: string, signature: string): Promise<void> {
  try {
    if (log.includes("AuctionCreated")) {
      const data = parseEventData(log);
      if (!data) return;
      if (!data.creator) {
        console.error("[listener] AuctionCreated missing creator, refusing to index", { signature });
        return;
      }
      // Creator row MUST exist before the Auction row can be inserted
      // (enforced by FK). Upsert is idempotent with the launch-flow POST.
      await prisma.creator.upsert({
        where: { wallet: data.creator },
        create: { wallet: data.creator },
        update: {},
      });
      const buyerBps = data.buyer_bps ? Number(data.buyer_bps) : 6500;
      await prisma.auction.upsert({
        where: { mint: data.mint },
        create: {
          mint: data.mint,
          ticker: data.ticker,
          creator: data.creator,
          startTime: new Date(Number(data.start_time) * 1000),
          endTime: new Date(Number(data.end_time) * 1000),
          totalSupply: BigInt(data.total_supply),
          buyerBps,
          tokenName: data.token_name ?? null,
          tokenImage: data.token_image ?? null,
          description: data.description ?? null,
          state: "GATHERING",
        },
        update: { buyerBps },
      });
      console.log(`[listener] Auction created: ${data.mint} (creator=${data.creator}, buyer_bps=${buyerBps})`);
    } else if (log.includes("SolCommitted")) {
      const data = parseEventData(log);
      if (!data) return;
      await prisma.commitment.upsert({
        where: {
          auctionMint_wallet: { auctionMint: data.mint, wallet: data.participant },
        },
        create: {
          auctionMint: data.mint,
          wallet: data.participant,
          solAmount: BigInt(data.amount),
        },
        update: {
          solAmount: { increment: BigInt(data.amount) },
        },
      });
      await prisma.auction.update({
        where: { mint: data.mint },
        data: {
          totalSol: { increment: BigInt(data.amount) },
          participantCount: { increment: 1 },
        },
      });
      console.log(`[listener] SOL committed: ${data.participant} -> ${data.mint}`);
    } else if (log.includes("AuctionFinalized")) {
      // On-chain emits a single AuctionFinalized event with succeeded: bool.
      const data = parseEventData(log);
      if (!data) return;
      const succeeded = data.succeeded === "true" || data.succeeded === "1";
      await prisma.auction.update({
        where: { mint: data.mint },
        data: {
          state: succeeded ? "SUCCEEDED" : "FAILED",
          participantCount: Number(data.participant_count),
        },
      });
      console.log(`[listener] Auction finalized: ${data.mint} (succeeded=${succeeded})`);
    } else if (log.includes("TokensClaimed")) {
      const data = parseEventData(log);
      if (!data) return;
      await prisma.commitment.update({
        where: {
          auctionMint_wallet: { auctionMint: data.mint, wallet: data.participant },
        },
        data: { tokensClaimed: true },
      });
      await prisma.holderSnapshot.upsert({
        where: { mint_wallet: { mint: data.mint, wallet: data.participant } },
        create: {
          mint: data.mint,
          wallet: data.participant,
          balance: BigInt(data.tokens_received),
          firstSeen: new Date(),
        },
        update: {
          balance: { increment: BigInt(data.tokens_received) },
        },
      });
      console.log(`[listener] Tokens claimed: ${data.participant} on ${data.mint}`);
    } else if (log.includes("PoolSeeded")) {
      const data = parseEventData(log);
      if (!data) return;
      await prisma.auction.update({
        where: { mint: data.mint },
        data: { poolSeeded: true },
      });
      console.log(
        `[listener] Pool seeded: ${data.mint} (tokens=${data.pool_tokens}, sol=${data.sol_amount}, buyer_bps=${data.buyer_bps})`,
      );
    } else if (log.includes("PoolIdSet")) {
      const data = parseEventData(log);
      if (!data) return;
      await prisma.auction.update({
        where: { mint: data.mint },
        data: {
          state: "TRADING",
          raydiumPoolId: data.pool_id,
        },
      });
      console.log(`[listener] Pool set: ${data.mint} -> ${data.pool_id}`);
    } else if (log.includes("CommitmentEmergencyRefunded")) {
      const data = parseEventData(log);
      if (!data) return;
      console.log(
        `[listener] Emergency refund: ${data.participant} on ${data.mint} (${data.amount} lamports)`,
      );
    }
  } catch (err) {
    console.error("[listener] BatchAuction event error:", err, { log, signature });
  }
}

// ─── FeeRouter Events ──────────────────────────────────────

async function handleFeeRouterEvent(log: string, _signature: string): Promise<void> {
  try {
    if (log.includes("FeesClaimed")) {
      // On-chain event: FeesClaimed { mint, total, to_creator, to_protocol }
      const data = parseEventData(log);
      if (!data) return;

      // Look up the creator from the auction row
      const auction = await prisma.auction.findUnique({
        where: { mint: data.mint },
        select: { creator: true },
      });
      if (!auction) return;

      await prisma.creatorFee.upsert({
        where: {
          mint_creator: { mint: data.mint, creator: auction.creator },
        },
        create: {
          mint: data.mint,
          creator: auction.creator,
          totalEarned: BigInt(data.to_creator),
        },
        update: {
          totalEarned: { increment: BigInt(data.to_creator) },
        },
      });
      console.log(
        `[listener] Fees claimed: ${data.mint} (creator=${data.to_creator}, protocol=${data.to_protocol})`,
      );
    } else if (log.includes("PoolRegistered")) {
      const data = parseEventData(log);
      if (!data) return;
      console.log(`[listener] Pool registered: ${data.mint} (raydium=${data.raydium_pool_id})`);
    } else if (log.includes("EmergencyPauseToggled")) {
      const data = parseEventData(log);
      if (!data) return;
      console.log(`[listener] FeeRouter emergency pause: ${data.paused}`);
    }
  } catch (err) {
    console.error("[listener] FeeRouter event error:", err, { log });
  }
}

// ─── StakeManager Events ───────────────────────────────────

async function handleStakeManagerEvent(log: string, _signature: string): Promise<void> {
  try {
    if (log.includes("StakeDeposited")) {
      const data = parseEventData(log);
      if (!data) return;

      await prisma.stake.upsert({
        where: { auctionMint: data.mint },
        create: {
          auctionMint: data.mint,
          creator: data.creator,
          amount: BigInt(data.amount),
          milestoneDeadline: new Date(Number(data.milestone_deadline) * 1000),
          state: "ESCROWED",
        },
        update: {},
      });
      console.log(`[listener] Stake deposited: ${data.creator} for ${data.mint}`);
    } else if (log.includes("MilestoneEvaluated")) {
      // On-chain event: MilestoneEvaluated { mint, creator, passed, amount }
      const data = parseEventData(log);
      if (!data) return;
      const passed = data.passed === "true" || data.passed === "1";

      await prisma.stake.update({
        where: { auctionMint: data.mint },
        data: {
          state: passed ? "RETURNED" : "FORFEITED",
          evaluatedAt: new Date(),
        },
      });

      if (passed) {
        await prisma.auction.update({
          where: { mint: data.mint },
          data: { stakeReturned: true },
        });
        console.log(`[listener] Milestone passed — stake returned: ${data.mint}`);
      } else {
        const pool = await prisma.forfeitPool.findFirst();
        if (pool) {
          await prisma.forfeitPool.update({
            where: { id: pool.id },
            data: { totalForfeited: { increment: BigInt(data.amount) } },
          });
        } else {
          await prisma.forfeitPool.create({
            data: { totalForfeited: BigInt(data.amount) },
          });
        }
        console.log(`[listener] Milestone failed — stake forfeited: ${data.mint}`);
      }
    } else if (log.includes("StakeForfeited")) {
      // Emitted by forfeit_stake_for_failed_auction
      const data = parseEventData(log);
      if (!data) return;

      await prisma.stake.update({
        where: { auctionMint: data.mint },
        data: {
          state: "FORFEITED",
          evaluatedAt: new Date(),
        },
      });

      const pool = await prisma.forfeitPool.findFirst();
      if (pool) {
        await prisma.forfeitPool.update({
          where: { id: pool.id },
          data: { totalForfeited: { increment: BigInt(data.amount) } },
        });
      } else {
        await prisma.forfeitPool.create({
          data: { totalForfeited: BigInt(data.amount) },
        });
      }
      console.log(`[listener] Stake forfeited (auction failed): ${data.mint}`);
    } else if (log.includes("StakeEmergencyWithdrawn")) {
      const data = parseEventData(log);
      if (!data) return;
      await prisma.stake.update({
        where: { auctionMint: data.mint },
        data: {
          state: "EMERGENCY_WITHDRAWN",
          evaluatedAt: new Date(),
        },
      });
      console.log(`[listener] Stake emergency withdrawn: ${data.mint}`);
    }
  } catch (err) {
    console.error("[listener] StakeManager event error:", err, { log });
  }
}

// ─── Helpers ───────────────────────────────────────────────

function parseEventData(log: string): Record<string, string> | null {
  // Expected formats:
  //   "EventName { key: value, key2: value2 }"
  //   or JSON-style after the event name
  try {
    const jsonMatch = log.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const raw = jsonMatch[0];
      const jsonStr = raw
        .replace(/(\w+)\s*:/g, '"$1":')
        .replace(/:\s*([^",}\s][^,}]*)/g, (_, val) => {
          const trimmed = val.trim();
          if (/^".*"$/.test(trimmed) || /^-?\d+(\.\d+)?$/.test(trimmed)) {
            return `: ${trimmed}`;
          }
          return `: "${trimmed}"`;
        });

      return JSON.parse(jsonStr);
    }
  } catch {
    // parse failed
  }

  return null;
}

export function stopListener(): void {
  for (const subId of subscriptions) {
    connection?.removeOnLogsListener(subId).catch(() => {});
  }
  subscriptions.length = 0;
  console.log("[listener] All subscriptions removed");
}
