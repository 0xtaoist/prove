import { Connection, PublicKey } from "@solana/web3.js";
import { prisma } from "./db";

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

// Polling config
const POLL_INTERVAL_MS = 15_000; // 15 seconds (avoid Helius rate limits)
const lastSignatures: Record<ProgramName, string | undefined> = {
  BatchAuction: undefined,
  FeeRouter: undefined,
  StakeManager: undefined,
};

let connection: Connection;
let pollTimers: NodeJS.Timeout[] = [];

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
  console.log("[listener] Starting poll-based listener (every 5s)...");

  for (const [name, programId] of Object.entries(resolved.programs) as [
    ProgramName,
    PublicKey,
  ][]) {
    // Run immediately, then poll
    void pollProgram(name, programId);
    const timer = setInterval(
      () => void pollProgram(name, programId),
      POLL_INTERVAL_MS,
    );
    pollTimers.push(timer);
  }
}

async function pollProgram(name: ProgramName, programId: PublicKey): Promise<void> {
  try {
    const opts: { limit: number; until?: string } = { limit: 20 };
    if (lastSignatures[name]) {
      opts.until = lastSignatures[name];
    }

    const sigs = await connection.getSignaturesForAddress(
      programId,
      opts,
      "confirmed",
    );

    if (sigs.length === 0) return;

    // sigs come newest-first. Process oldest first.
    const sorted = sigs.reverse();

    // Update cursor to the newest we've seen
    lastSignatures[name] = sigs[0].signature;

    for (const sigInfo of sorted) {
      if (sigInfo.err) continue; // Skip failed txs

      try {
        const tx = await connection.getTransaction(sigInfo.signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });
        if (!tx?.meta?.logMessages) continue;

        for (const log of tx.meta.logMessages) {
          if (!log.startsWith("Program log:") && !log.startsWith("Program data:")) continue;
          const message = log.replace(/^Program (log|data): /, "");

          switch (name) {
            case "BatchAuction":
              await handleBatchAuctionEvent(message, sigInfo.signature);
              break;
            case "FeeRouter":
              await handleFeeRouterEvent(message, sigInfo.signature);
              break;
            case "StakeManager":
              await handleStakeManagerEvent(message, sigInfo.signature);
              break;
          }
        }
      } catch (err) {
        console.error(`[listener] Error processing tx ${sigInfo.signature}:`, err);
      }
    }
  } catch (err) {
    console.error(`[listener] Poll error for ${name}:`, err);
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

  await prisma.$transaction(async (tx) => {
    const existing = await tx.commitment.findUnique({
      where: {
        auctionMint_wallet: { auctionMint: data.mint, wallet: data.participant },
      },
    });

    if (existing) {
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
  const data = parseEventData(log, ["mint", "succeeded", "participant_count"]);
  if (!data) return;

  const auction = await prisma.auction.findUnique({
    where: { mint: data.mint },
    select: { state: true },
  });
  if (!auction) {
    console.warn(`[listener] AuctionFinalized for unknown mint ${data.mint}, skipping`);
    return;
  }
  if (auction.state !== "GATHERING") {
    console.warn(
      `[listener] AuctionFinalized for ${data.mint} but state is already ${auction.state}, skipping duplicate`,
    );
    return;
  }

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

  const auction = await prisma.auction.findUnique({
    where: { mint: data.mint },
    select: { state: true },
  });
  if (!auction) {
    console.warn(`[listener] PoolIdSet for unknown mint ${data.mint}, skipping`);
    return;
  }
  if (auction.state === "TRADING") {
    console.warn(
      `[listener] PoolIdSet for ${data.mint} but already TRADING, skipping duplicate`,
    );
    return;
  }
  if (auction.state !== "SUCCEEDED") {
    console.error(
      `[listener] PoolIdSet for ${data.mint} in unexpected state ${auction.state}, skipping`,
    );
    return;
  }

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
      const data = parseEventData(log);
      if (!data) return;

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
  try {
    const braceStart = log.indexOf("{");
    const braceEnd = log.lastIndexOf("}");
    if (braceStart === -1 || braceEnd === -1 || braceEnd <= braceStart) {
      return null;
    }

    const inner = log.slice(braceStart + 1, braceEnd).trim();
    if (!inner) return null;

    const result: Record<string, string> = {};

    let depth = 0;
    let current = "";
    for (const ch of inner) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === "," && depth === 0) {
        parseKeyValue(current.trim(), result);
        current = "";
        continue;
      }
      current += ch;
    }
    if (current.trim()) {
      parseKeyValue(current.trim(), result);
    }

    if (Object.keys(result).length === 0) {
      return null;
    }

    if (requiredFields) {
      for (const f of requiredFields) {
        if (result[f] === undefined) {
          console.warn(
            `[listener] parseEventData: missing required field '${f}'`,
            { fields: Object.keys(result), log: log.slice(0, 200) },
          );
          return null;
        }
      }
    }

    return result;
  } catch (err) {
    console.error("[listener] parseEventData: unexpected parse error", {
      err,
      log: log.slice(0, 200),
    });
  }

  return null;
}

function parseKeyValue(
  pair: string,
  out: Record<string, string>,
): void {
  const colonIdx = pair.indexOf(":");
  if (colonIdx === -1) return;
  const key = pair.slice(0, colonIdx).trim();
  let value = pair.slice(colonIdx + 1).trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1);
  }
  if (key) {
    out[key] = value;
  }
}

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
  for (const timer of pollTimers) {
    clearInterval(timer);
  }
  pollTimers = [];
  console.log("[listener] All poll timers stopped");
}
