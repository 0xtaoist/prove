import { Connection, PublicKey, Logs } from "@solana/web3.js";
import { prisma } from "./db";

// Program IDs are sourced from the env so deploys can rotate them
// without a code change. Missing or invalid vars cause the listener
// to skip startup — subscribing to placeholder IDs would silently
// index zero events, which is strictly worse than a loud "off"
// state. TickerRegistry is off-chain (archived) so it's not listed.
type ProgramName = "BatchAuction" | "FeeRouter" | "StakeManager";

const PROGRAM_ENV_VARS: Record<ProgramName, string> = {
  BatchAuction: "BATCH_AUCTION_PROGRAM_ID",
  FeeRouter: "FEE_ROUTER_PROGRAM_ID",
  StakeManager: "STAKE_MANAGER_PROGRAM_ID",
};

function resolveProgramIds():
  | { ok: true; programs: Record<ProgramName, PublicKey> }
  | { ok: false; reason: string } {
  const programs = {} as Record<ProgramName, PublicKey>;
  for (const [name, envVar] of Object.entries(PROGRAM_ENV_VARS) as [
    ProgramName,
    string,
  ][]) {
    const raw = process.env[envVar];
    if (!raw) {
      return { ok: false, reason: `env var ${envVar} not set` };
    }
    try {
      programs[name] = new PublicKey(raw);
    } catch {
      return {
        ok: false,
        reason: `env var ${envVar} is not a valid Solana pubkey: ${raw}`,
      };
    }
  }
  return { ok: true, programs };
}

// Reconnection config
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 60_000;
const BACKOFF_FACTOR = 2;

// Subscription tracking for cleanup
const subscriptions: number[] = [];
let connection: Connection;

export function startListener(): void {
  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!rpcUrl) {
    console.error("[listener] SOLANA_RPC_URL not set, skipping listener");
    return;
  }

  const resolved = resolveProgramIds();
  if (!resolved.ok) {
    console.error(
      `[listener] Program IDs not configured (${resolved.reason}), skipping listener`,
    );
    return;
  }

  connection = new Connection(rpcUrl, "confirmed");
  console.log("[listener] Connecting to Solana RPC...");

  for (const [name, programId] of Object.entries(resolved.programs) as [
    ProgramName,
    PublicKey,
  ][]) {
    subscribeWithReconnect(name, programId);
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
      await onAuctionCreated(log, signature);
    } else if (log.includes("SolCommitted")) {
      await onSolCommitted(log);
    } else if (log.includes("AuctionFinalized")) {
      await onAuctionFinalized(log);
    } else if (log.includes("TokensClaimed")) {
      await onTokensClaimed(log);
    } else if (log.includes("PoolSeeded")) {
      await onPoolSeeded(log);
    } else if (log.includes("PoolIdSet")) {
      await onPoolIdSet(log);
    } else if (log.includes("CommitmentEmergencyRefunded")) {
      await onCommitmentEmergencyRefunded(log);
    }
  } catch (err) {
    console.error("[listener] BatchAuction event error:", err, { log, signature });
  }
}

async function onAuctionCreated(log: string, signature: string): Promise<void> {
  const data = parseEventData(log, ["mint", "creator", "ticker", "total_supply", "start_time", "end_time"]);
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
}

async function onSolCommitted(log: string): Promise<void> {
  const data = parseEventData(log, ["mint", "participant", "amount"]);
  if (!data) return;

  // Use a transaction to atomically create-or-update the commitment and
  // only increment participantCount when the commitment is genuinely new.
  // This prevents double-counting if the same event is delivered twice
  // (e.g. WebSocket reconnection, duplicate log delivery).
  await prisma.$transaction(async (tx) => {
    const existing = await tx.commitment.findUnique({
      where: {
        auctionMint_wallet: { auctionMint: data.mint, wallet: data.participant },
      },
    });

    if (existing) {
      // Duplicate event — commitment PDA is init-only on-chain so the
      // same wallet can never commit twice. Skip to avoid inflating totals.
      console.warn(`[listener] Duplicate SolCommitted for ${data.participant} on ${data.mint}, skipping`);
      return;
    }

    await tx.commitment.create({
      data: {
        auctionMint: data.mint,
        wallet: data.participant,
        solAmount: BigInt(data.amount),
      },
    });

    await tx.auction.update({
      where: { mint: data.mint },
      data: {
        totalSol: { increment: BigInt(data.amount) },
        participantCount: { increment: 1 },
      },
    });
  });
  console.log(`[listener] SOL committed: ${data.participant} -> ${data.mint}`);
}

async function onAuctionFinalized(log: string): Promise<void> {
  // On-chain emits a single AuctionFinalized event with succeeded: bool.
  const data = parseEventData(log, ["mint", "succeeded", "participant_count"]);
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
}

async function onTokensClaimed(log: string): Promise<void> {
  const data = parseEventData(log, ["mint", "participant", "tokens_received"]);
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
}

async function onPoolSeeded(log: string): Promise<void> {
  const data = parseEventData(log);
  if (!data) return;
  await prisma.auction.update({
    where: { mint: data.mint },
    data: { poolSeeded: true },
  });
  console.log(
    `[listener] Pool seeded: ${data.mint} (tokens=${data.pool_tokens}, sol=${data.sol_amount}, buyer_bps=${data.buyer_bps})`,
  );
}

async function onPoolIdSet(log: string): Promise<void> {
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
}

async function onCommitmentEmergencyRefunded(log: string): Promise<void> {
  const data = parseEventData(log, ["mint", "participant", "amount"]);
  if (!data) return;

  // Persist the refund: mark the commitment as claimed (prevents re-claim)
  // and decrement the auction's totalSol / participantCount so off-chain
  // state stays consistent with on-chain after emergency refunds.
  await prisma.$transaction(async (tx) => {
    await tx.commitment.updateMany({
      where: {
        auctionMint: data.mint,
        wallet: data.participant,
      },
      data: { tokensClaimed: true },
    });
    await tx.auction.update({
      where: { mint: data.mint },
      data: {
        totalSol: { decrement: BigInt(data.amount) },
        participantCount: { decrement: 1 },
      },
    });
  });

  console.log(
    `[listener] Emergency refund: ${data.participant} on ${data.mint} (${data.amount} lamports)`,
  );
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
        await incrementForfeitPool(BigInt(data.amount));
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

      await incrementForfeitPool(BigInt(data.amount));
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

function parseEventData(
  log: string,
  requiredFields?: string[],
): Record<string, string> | null {
  // Expected format from Anchor emit!():
  //   "EventName { key: value, key2: value2 }"
  // We extract the first { ... } block and coerce it into valid JSON.
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

      const parsed = JSON.parse(jsonStr) as Record<string, string>;

      // Validate that expected fields exist so we don't act on mismatched data
      if (requiredFields) {
        for (const f of requiredFields) {
          if (parsed[f] === undefined) {
            console.warn(`[listener] parseEventData: missing required field '${f}'`);
            return null;
          }
        }
      }

      return parsed;
    }
  } catch {
    // parse failed
  }

  return null;
}

/** Atomically increment the singleton ForfeitPool row, creating it if absent. */
async function incrementForfeitPool(amount: bigint): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const pool = await tx.forfeitPool.findFirst();
    if (pool) {
      await tx.forfeitPool.update({
        where: { id: pool.id },
        data: { totalForfeited: { increment: amount } },
      });
    } else {
      await tx.forfeitPool.create({
        data: { totalForfeited: amount },
      });
    }
  });
}

export function stopListener(): void {
  for (const subId of subscriptions) {
    connection?.removeOnLogsListener(subId).catch(() => {});
  }
  subscriptions.length = 0;
  console.log("[listener] All subscriptions removed");
}
