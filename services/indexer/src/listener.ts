import { Connection, PublicKey, Logs } from "@solana/web3.js";
import { prisma } from "./db";

// Program IDs
// Note: ProveAMM has been removed. Swap tracking now comes from Raydium events
// via the Raydium CPMM program or Jupiter aggregator logs.
const PROGRAMS = {
  BatchAuction: new PublicKey("BAuc111111111111111111111111111111111111111"),
  FeeRouter: new PublicKey("FeeR111111111111111111111111111111111111111"),
  StakeManager: new PublicKey("Stak111111111111111111111111111111111111111"),
  TickerRegistry: new PublicKey("Tick111111111111111111111111111111111111111"),
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
          // Reset delay on successful message
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

  // Skip failed transactions
  if (err) return;

  for (const log of logMessages) {
    // Anchor/native programs emit "Program log: <event>" or "Program data: <base64>"
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
      case "TickerRegistry":
        await handleTickerRegistryEvent(message, signature);
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
      await prisma.auction.upsert({
        where: { mint: data.mint },
        create: {
          mint: data.mint,
          ticker: data.ticker,
          creator: data.creator,
          startTime: new Date(Number(data.start_time) * 1000),
          endTime: new Date(Number(data.end_time) * 1000),
          totalSupply: BigInt(data.total_supply),
          tokenName: data.token_name ?? null,
          tokenImage: data.token_image ?? null,
          description: data.description ?? null,
          state: "GATHERING",
        },
        update: {},
      });
      console.log(`[listener] Auction created: ${data.mint}`);
    } else if (log.includes("SolCommitted")) {
      const data = parseEventData(log);
      if (!data) return;
      await prisma.commitment.upsert({
        where: {
          auctionMint_wallet: { auctionMint: data.mint, wallet: data.wallet },
        },
        create: {
          auctionMint: data.mint,
          wallet: data.wallet,
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
      console.log(`[listener] SOL committed: ${data.wallet} -> ${data.mint}`);
    } else if (log.includes("AuctionFinalized")) {
      const data = parseEventData(log);
      if (!data) return;
      await prisma.auction.update({
        where: { mint: data.mint },
        data: {
          state: "SUCCEEDED",
          uniformPrice: data.uniform_price ? BigInt(data.uniform_price) : null,
        },
      });
      console.log(`[listener] Auction finalized: ${data.mint}`);
    } else if (log.includes("AuctionFailed")) {
      const data = parseEventData(log);
      if (!data) return;
      await prisma.auction.update({
        where: { mint: data.mint },
        data: { state: "FAILED" },
      });
      console.log(`[listener] Auction failed: ${data.mint}`);
    } else if (log.includes("TokensClaimed")) {
      const data = parseEventData(log);
      if (!data) return;
      await prisma.commitment.update({
        where: {
          auctionMint_wallet: { auctionMint: data.mint, wallet: data.wallet },
        },
        data: { tokensClaimed: true },
      });
      // Initialize holder snapshot
      await prisma.holderSnapshot.upsert({
        where: { mint_wallet: { mint: data.mint, wallet: data.wallet } },
        create: {
          mint: data.mint,
          wallet: data.wallet,
          balance: BigInt(data.token_amount),
          firstSeen: new Date(),
        },
        update: {
          balance: { increment: BigInt(data.token_amount) },
        },
      });
      console.log(`[listener] Tokens claimed: ${data.wallet} on ${data.mint}`);
    }
  } catch (err) {
    console.error("[listener] BatchAuction event error:", err, { log, signature });
  }
}

// ─── FeeRouter Events ──────────────────────────────────────

async function handleFeeRouterEvent(log: string, _signature: string): Promise<void> {
  try {
    if (log.includes("FeesCollected")) {
      const data = parseEventData(log);
      if (!data) return;

      await prisma.creatorFee.upsert({
        where: {
          mint_creator: { mint: data.mint, creator: data.creator },
        },
        create: {
          mint: data.mint,
          creator: data.creator,
          totalEarned: BigInt(data.amount),
        },
        update: {
          totalEarned: { increment: BigInt(data.amount) },
        },
      });
      console.log(`[listener] Fees collected: ${data.creator} on ${data.mint}`);
    } else if (log.includes("FeesWithdrawn")) {
      const data = parseEventData(log);
      if (!data) return;

      await prisma.creatorFee.update({
        where: {
          mint_creator: { mint: data.mint, creator: data.creator },
        },
        data: {
          totalWithdrawn: { increment: BigInt(data.amount) },
        },
      });
      console.log(`[listener] Fees withdrawn: ${data.creator} on ${data.mint}`);
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
          milestoneDeadline: new Date(Number(data.deadline) * 1000),
          state: "ESCROWED",
        },
        update: {},
      });
      console.log(`[listener] Stake deposited: ${data.creator} for ${data.mint}`);
    } else if (log.includes("StakeReturned")) {
      const data = parseEventData(log);
      if (!data) return;

      await prisma.stake.update({
        where: { auctionMint: data.mint },
        data: { state: "RETURNED", evaluatedAt: new Date() },
      });
      await prisma.auction.update({
        where: { mint: data.mint },
        data: { stakeReturned: true },
      });
      console.log(`[listener] Stake returned: ${data.mint}`);
    } else if (log.includes("StakeForfeited")) {
      const data = parseEventData(log);
      if (!data) return;

      await prisma.stake.update({
        where: { auctionMint: data.mint },
        data: { state: "FORFEITED", evaluatedAt: new Date() },
      });

      // Update forfeit pool
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
      console.log(`[listener] Stake forfeited: ${data.mint}`);
    }
  } catch (err) {
    console.error("[listener] StakeManager event error:", err, { log });
  }
}

// ─── TickerRegistry Events ─────────────────────────────────

async function handleTickerRegistryEvent(log: string, _signature: string): Promise<void> {
  try {
    if (log.includes("TickerRegistered")) {
      const data = parseEventData(log);
      if (!data) return;

      await prisma.tickerEntry.upsert({
        where: { ticker: data.ticker },
        create: {
          ticker: data.ticker,
          mint: data.mint,
          ttlExpiry: new Date(Number(data.ttl_expiry) * 1000),
          active: true,
        },
        update: {
          mint: data.mint,
          ttlExpiry: new Date(Number(data.ttl_expiry) * 1000),
          active: true,
        },
      });
      console.log(`[listener] Ticker registered: ${data.ticker} -> ${data.mint}`);
    } else if (log.includes("TickerDeactivated")) {
      const data = parseEventData(log);
      if (!data) return;

      await prisma.tickerEntry.update({
        where: { ticker: data.ticker },
        data: { active: false },
      });
      console.log(`[listener] Ticker deactivated: ${data.ticker}`);
    }
  } catch (err) {
    console.error("[listener] TickerRegistry event error:", err, { log });
  }
}

// ─── Helpers ───────────────────────────────────────────────

function parseEventData(log: string): Record<string, string> | null {
  // Attempt to parse structured event data from log
  // Expected formats:
  //   "EventName { key: value, key2: value2 }"
  //   or JSON-style after the event name
  try {
    // Try JSON parse first (some programs emit JSON)
    const jsonMatch = log.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      // Handle Rust-style struct format: { key: value, key2: value2 }
      const raw = jsonMatch[0];
      // Convert "key: value" to "key": "value" for JSON parsing
      const jsonStr = raw
        .replace(/(\w+)\s*:/g, '"$1":')
        .replace(/:\s*([^",}\s][^,}]*)/g, (_, val) => {
          const trimmed = val.trim();
          // Don't double-quote if already quoted or a number
          if (/^".*"$/.test(trimmed) || /^-?\d+(\.\d+)?$/.test(trimmed)) {
            return `: ${trimmed}`;
          }
          return `: "${trimmed}"`;
        });

      return JSON.parse(jsonStr);
    }
  } catch {
    // If structured parsing fails, return null
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
