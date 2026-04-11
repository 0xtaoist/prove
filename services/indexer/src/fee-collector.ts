/**
 * Fee collection crank.
 *
 * Every 15 minutes:
 *   1. Find all TRADING auctions with a Raydium pool id.
 *   2. For each pool: read pending fees from the CLMM position, and
 *      if they exceed CLAIM_THRESHOLD_LAMPORTS, collect them via the
 *      Raydium SDK (crank is the position owner, see architecture
 *      comment in programs/fee-router/src/lib.rs).
 *   3. Transfer the SOL-side fees into the pool_fee_account PDA.
 *   4. Call `fee_router::claim_and_split` which enforces the 80/20
 *      split on-chain and sends SOL to creator + protocol treasury.
 *   5. Mirror the amounts into CreatorFee + treasury accounting in
 *      the indexer DB via splitFee() so the two layers stay in sync.
 *
 * Crank key path: ANCHOR_WALLET (same env var as init-programs.ts).
 * Fee router program id: FEE_ROUTER_PROGRAM_ID.
 * Protocol vault: read from ProtocolConfig (pinned by assertProtocolConfig).
 */

import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import BN from "bn.js";
import { prisma } from "./db";
import { getProtocolVaultAddress, splitFee } from "./protocol-config";
import {
  loadRaydium,
  fetchClmmPool,
  findCrankPosition,
  collectPositionFees,
  RaydiumContext,
  RaydiumCluster,
} from "./raydium-client";

const CLAIM_THRESHOLD_LAMPORTS = 10_000_000; // 0.01 SOL min to claim
const CLAIM_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const WSOL_MINT = "So11111111111111111111111111111111111111112";

export function startFeeCollector(): NodeJS.Timeout {
  console.log("[fee-collector] Starting fee collection loop (every 15m)");
  // Run immediately, then on interval
  void collectFees();
  return setInterval(() => void collectFees(), CLAIM_INTERVAL_MS);
}

async function collectFees(): Promise<void> {
  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!rpcUrl) {
    console.error("[fee-collector] SOLANA_RPC_URL not set — skipping cycle");
    return;
  }
  const feeRouterId = process.env.FEE_ROUTER_PROGRAM_ID;
  if (!feeRouterId) {
    console.error(
      "[fee-collector] FEE_ROUTER_PROGRAM_ID not set — skipping cycle",
    );
    return;
  }

  let crank: Keypair;
  try {
    crank = loadCrankKeypair();
  } catch (err) {
    console.error("[fee-collector] Cannot load crank keypair:", err);
    return;
  }

  const feeRouterProgramId = new PublicKey(feeRouterId);
  const connection = new Connection(rpcUrl, "confirmed");
  const cluster: RaydiumCluster =
    (process.env.SOLANA_NETWORK as RaydiumCluster) === "mainnet"
      ? "mainnet"
      : "devnet";

  let ctx: RaydiumContext;
  try {
    ctx = await loadRaydium(connection, crank, cluster);
  } catch (err) {
    console.error("[fee-collector] Failed to load Raydium SDK:", err);
    return;
  }

  const pools = await prisma.auction.findMany({
    where: { state: "TRADING", raydiumPoolId: { not: null } },
  });
  console.log(
    `[fee-collector] Checking ${pools.length} pools for claimable fees`,
  );

  const protocolVault = await getProtocolVaultAddress();

  for (const pool of pools) {
    try {
      await collectFeesForPool(
        pool.mint,
        pool.raydiumPoolId!,
        pool.creator,
        pool.ticker,
        protocolVault,
        ctx,
        connection,
        crank,
        feeRouterProgramId,
      );
    } catch (err) {
      console.error(
        `[fee-collector] Error collecting fees for ${pool.ticker}:`,
        err,
      );
    }
  }
}

/**
 * Collect, route, and record fees for a single pool.
 */
async function collectFeesForPool(
  mint: string,
  poolId: string,
  creator: string,
  ticker: string,
  protocolVault: string,
  ctx: RaydiumContext,
  connection: Connection,
  crank: Keypair,
  feeRouterProgramId: PublicKey,
): Promise<void> {
  // 1. Load pool info + keys.
  const { poolInfo, poolKeys } = await fetchClmmPool(ctx, poolId);

  // 2. Find the crank's position in this pool.
  const position = await findCrankPosition(ctx, poolId);
  if (!position) {
    console.log(
      `[fee-collector] ${ticker}: crank does not own a position in ${poolId}`,
    );
    return;
  }

  // 3. Figure out which side is SOL. The non-SOL side's fees accrue as
  //    the auctioned token and are currently logged but not distributed
  //    on-chain (see comment below).
  const isMintASol = poolInfo.mintA.address === WSOL_MINT;
  const isMintBSol = poolInfo.mintB.address === WSOL_MINT;
  if (!isMintASol && !isMintBSol) {
    console.warn(
      `[fee-collector] ${ticker}: pool ${poolId} has no SOL side — skipping`,
    );
    return;
  }
  const solFees = isMintASol ? position.tokenFeesOwedA : position.tokenFeesOwedB;
  const tokenFees = isMintASol
    ? position.tokenFeesOwedB
    : position.tokenFeesOwedA;

  if (solFees.lt(new BN(CLAIM_THRESHOLD_LAMPORTS))) {
    console.log(
      `[fee-collector] ${ticker}: pending SOL fees ${solFees.toString()} below threshold (${CLAIM_THRESHOLD_LAMPORTS}) — skipping`,
    );
    return;
  }

  console.log(
    `[fee-collector] ${ticker}: claiming ${solFees.toString()} lamports (SOL) + ${tokenFees.toString()} tokens from ${poolId}`,
  );

  // 4. Collect fees via Raydium. `useSOLBalance: true` makes the SDK
  //    wrap/unwrap so native SOL ends up in the crank wallet directly.
  const collect = await collectPositionFees(ctx, {
    poolInfo,
    poolKeys,
    ownerPosition: position.raw,
  });
  console.log(
    `[fee-collector] ${ticker}: Raydium decrease_liquidity tx ${collect.txId}`,
  );

  // 5. Transfer the SOL portion to the pool_fee_account PDA so
  //    claim_and_split can split it on-chain. We transfer the exact
  //    amount we saw pending — any gas-fee delta is absorbed by the
  //    crank wallet, not debited from the creator/protocol cut.
  const [poolFeePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool_fee"), new PublicKey(mint).toBuffer()],
    feeRouterProgramId,
  );
  const [feeVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("fee_vault")],
    feeRouterProgramId,
  );

  const transferIx = SystemProgram.transfer({
    fromPubkey: crank.publicKey,
    toPubkey: poolFeePda,
    lamports: BigInt(solFees.toString()),
  });

  // 6. Call fee_router::claim_and_split. Anchor-style discriminator
  //    so we don't need to ship the IDL here.
  const claimIx = buildClaimAndSplitIx({
    feeRouterProgramId,
    crank: crank.publicKey,
    feeVault: feeVaultPda,
    poolFeeAccount: poolFeePda,
    creator: new PublicKey(creator),
    protocolTreasury: new PublicKey(protocolVault),
  });

  const tx = new Transaction().add(transferIx, claimIx);
  const splitTxId = await sendAndConfirmTransaction(connection, tx, [crank], {
    commitment: "confirmed",
  });
  console.log(
    `[fee-collector] ${ticker}: claim_and_split tx ${splitTxId}`,
  );

  // 7. Mirror the split into CreatorFee + treasury accounting. splitFee
  //    must match the on-chain math exactly (80/20 floor/rounding).
  const totalLamports = BigInt(solFees.toString());
  const { creatorLamports, protocolLamports } = splitFee(totalLamports);

  await prisma.creatorFee.upsert({
    where: { mint_creator: { mint, creator } },
    update: {
      totalEarned: { increment: creatorLamports },
    },
    create: {
      mint,
      creator,
      totalEarned: creatorLamports,
    },
  });

  console.log(
    `[fee-collector] ${ticker}: recorded ${creatorLamports.toString()} to creator, ${protocolLamports.toString()} to protocol`,
  );

  // Non-SOL side (the auctioned token itself) accrues in a crank-owned
  // ATA but is NOT currently routed to creator / protocol on-chain —
  // `claim_and_split` only handles lamports. Tracked in DB as pending
  // so ops can reconcile manually. A follow-up instruction
  // (`claim_and_split_tokens`) can route these via an SPL transfer path.
  if (tokenFees.gtn(0)) {
    console.log(
      `[fee-collector] ${ticker}: ${tokenFees.toString()} token-side fees sitting in crank ATA — manual sweep required`,
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadCrankKeypair(): Keypair {
  const walletPath =
    process.env.ANCHOR_WALLET ||
    path.join(process.env.HOME || "~", ".config", "solana", "id.json");
  if (!fs.existsSync(walletPath)) {
    throw new Error(`Crank keypair file not found at ${walletPath}`);
  }
  const raw = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function anchorDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().slice(0, 8);
}

function buildClaimAndSplitIx(params: {
  feeRouterProgramId: PublicKey;
  crank: PublicKey;
  feeVault: PublicKey;
  poolFeeAccount: PublicKey;
  creator: PublicKey;
  protocolTreasury: PublicKey;
}): TransactionInstruction {
  // Account order must exactly match fee_router::ClaimAndSplit<'info>:
  //   crank (signer) → fee_vault → pool_fee_account (mut) → creator (mut)
  //   → protocol_treasury (mut) → system_program
  return new TransactionInstruction({
    programId: params.feeRouterProgramId,
    keys: [
      { pubkey: params.crank, isSigner: true, isWritable: false },
      { pubkey: params.feeVault, isSigner: false, isWritable: false },
      { pubkey: params.poolFeeAccount, isSigner: false, isWritable: true },
      { pubkey: params.creator, isSigner: false, isWritable: true },
      { pubkey: params.protocolTreasury, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: anchorDiscriminator("claim_and_split"),
  });
}
