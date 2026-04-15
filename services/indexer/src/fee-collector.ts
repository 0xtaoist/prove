/**
 * Fee collection crank.
 *
 * Every 15 minutes:
 *   1. Find all TRADING auctions with a pool id.
 *   2. For each pool: read pending fees from the Meteora DLMM position.
 *   3. Claim fees (both SOL and token) via the Meteora SDK.
 *   4. Route SOL fees through fee_router::claim_and_split (80/20 on-chain).
 *   5. Transfer token fees directly to creator (80%) and protocol (20%).
 *   6. Mirror amounts into CreatorFee in the indexer DB.
 *
 * Crank key: CRANK_KEYPAIR_JSON or ANCHOR_WALLET.
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
  claimPositionFees,
  type MeteoraContext,
} from "./meteora-client";

const CLAIM_THRESHOLD_LAMPORTS = 10_000_000; // 0.01 SOL min to claim
const CLAIM_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

export function startFeeCollector(): NodeJS.Timeout {
  console.log("[fee-collector] Starting fee collection loop (every 15m)");
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
    console.error("[fee-collector] FEE_ROUTER_PROGRAM_ID not set — skipping cycle");
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
  const ctx: MeteoraContext = { connection, crank };

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

async function collectFeesForPool(
  mint: string,
  poolId: string,
  creator: string,
  ticker: string,
  protocolVault: string,
  ctx: MeteoraContext,
  connection: Connection,
  crank: Keypair,
  feeRouterProgramId: PublicKey,
): Promise<void> {
  const poolAddress = new PublicKey(poolId);
  const mintPubkey = new PublicKey(mint);

  const DLMM = (await import("@meteora-ag/dlmm")).default;
  let dlmmPool;
  try {
    dlmmPool = await DLMM.create(connection, poolAddress);
  } catch (err) {
    console.log(
      `[fee-collector] ${ticker}: could not load pool ${poolId} — skipping`,
    );
    return;
  }

  const { userPositions } = await dlmmPool.getPositionsByUserAndLbPair(
    crank.publicKey,
  );

  if (!userPositions || userPositions.length === 0) {
    console.log(
      `[fee-collector] ${ticker}: crank has no positions in ${poolId}`,
    );
    return;
  }

  const position = userPositions[0];
  const feeSOL = position.positionData.feeY; // Y = WSOL
  const feeToken = position.positionData.feeX; // X = auctioned token

  if (feeSOL.lt(new BN(CLAIM_THRESHOLD_LAMPORTS)) && feeToken.isZero()) {
    console.log(
      `[fee-collector] ${ticker}: pending fees below threshold — skipping`,
    );
    return;
  }

  console.log(
    `[fee-collector] ${ticker}: claiming ${feeSOL.toString()} lamports (SOL) + ${feeToken.toString()} tokens`,
  );

  // ── 1. Claim both fees via Meteora SDK ────────────────────────────────
  const claimTxIds = await claimPositionFees(ctx, poolAddress, position);
  console.log(
    `[fee-collector] ${ticker}: Meteora claim tx(s) ${claimTxIds.join(", ")}`,
  );

  // ── 2. Route SOL fees through on-chain 80/20 split ────────────────────
  if (feeSOL.gtn(0)) {
    const [poolFeePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool_fee"), mintPubkey.toBuffer()],
      feeRouterProgramId,
    );
    const [feeVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("fee_vault")],
      feeRouterProgramId,
    );

    const transferIx = SystemProgram.transfer({
      fromPubkey: crank.publicKey,
      toPubkey: poolFeePda,
      lamports: BigInt(feeSOL.toString()),
    });

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
      `[fee-collector] ${ticker}: SOL claim_and_split tx ${splitTxId}`,
    );
  }

  // ── 3. Transfer token fees directly: 80% creator, 20% protocol ────────
  if (feeToken.gtn(0)) {
    const totalTokens = BigInt(feeToken.toString());
    const creatorTokens = (totalTokens * 80n) / 100n;
    const protocolTokens = totalTokens - creatorTokens;

    const creatorPubkey = new PublicKey(creator);
    const protocolPubkey = new PublicKey(protocolVault);

    // Crank's token ATA (source)
    const crankAta = getAta(mintPubkey, crank.publicKey);
    // Creator's token ATA (destination)
    const creatorAta = getAta(mintPubkey, creatorPubkey);
    // Protocol's token ATA (destination)
    const protocolAta = getAta(mintPubkey, protocolPubkey);

    const tx = new Transaction();

    // Ensure creator and protocol have ATAs
    const [creatorAtaInfo, protocolAtaInfo] = await Promise.all([
      connection.getAccountInfo(creatorAta),
      connection.getAccountInfo(protocolAta),
    ]);
    if (!creatorAtaInfo) {
      tx.add(buildCreateAtaIx(crank.publicKey, creatorAta, creatorPubkey, mintPubkey));
    }
    if (!protocolAtaInfo) {
      tx.add(buildCreateAtaIx(crank.publicKey, protocolAta, protocolPubkey, mintPubkey));
    }

    // Transfer 80% to creator
    if (creatorTokens > 0n) {
      tx.add(buildTokenTransferIx(crankAta, creatorAta, crank.publicKey, creatorTokens));
    }
    // Transfer 20% to protocol
    if (protocolTokens > 0n) {
      tx.add(buildTokenTransferIx(crankAta, protocolAta, crank.publicKey, protocolTokens));
    }

    const tokenTxId = await sendAndConfirmTransaction(connection, tx, [crank], {
      commitment: "confirmed",
    });
    console.log(
      `[fee-collector] ${ticker}: token split tx ${tokenTxId} (creator=${creatorTokens}, protocol=${protocolTokens})`,
    );
  }

  // ── 4. Mirror SOL split into CreatorFee accounting ────────────────────
  if (feeSOL.gtn(0)) {
    const totalLamports = BigInt(feeSOL.toString());
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
      `[fee-collector] ${ticker}: recorded SOL ${creatorLamports.toString()} to creator, ${protocolLamports.toString()} to protocol`,
    );
  }
}

// ---------------------------------------------------------------------------
// Instruction builders
// ---------------------------------------------------------------------------

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

/** SPL Token transfer instruction (amount as u64 LE). */
function buildTokenTransferIx(
  from: PublicKey,
  to: PublicKey,
  authority: PublicKey,
  amount: bigint,
): TransactionInstruction {
  const data = Buffer.alloc(9);
  data.writeUInt8(3, 0); // Transfer instruction index
  data.writeBigUInt64LE(amount, 1);
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: from, isSigner: false, isWritable: true },
      { pubkey: to, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAta(mint: PublicKey, owner: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
}

function buildCreateAtaIx(
  payer: PublicKey,
  ata: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.alloc(0),
  });
}

function loadCrankKeypair(): Keypair {
  const inlineJson = process.env.CRANK_KEYPAIR_JSON;
  if (inlineJson) {
    const raw = JSON.parse(inlineJson);
    return Keypair.fromSecretKey(Uint8Array.from(raw));
  }

  const walletPath = process.env.ANCHOR_WALLET;
  if (!walletPath) {
    throw new Error("ANCHOR_WALLET or CRANK_KEYPAIR_JSON env var is required");
  }
  const resolved = walletPath.startsWith("~/")
    ? path.join(process.env.HOME ?? "", walletPath.slice(2))
    : walletPath;
  if (!fs.existsSync(resolved)) {
    throw new Error(`Crank keypair file not found at ${resolved}`);
  }
  const raw = JSON.parse(fs.readFileSync(resolved, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}
