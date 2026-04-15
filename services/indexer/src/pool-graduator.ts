/**
 * Pool graduation crank.
 *
 * Polls every 30 seconds for auctions in SUCCEEDED state that have not
 * yet been graduated to a Raydium CLMM pool. For each eligible auction:
 *
 *   1. Call batch_auction::seed_pool (transfers tokens + SOL to crank)
 *   2. Create a Raydium CLMM pool with 1% fee tier via SDK
 *   3. Open a concentrated liquidity position with the seeded amounts
 *   4. Call fee_router::register_pool (initializes on-chain fee accounting)
 *   5. Call batch_auction::set_pool_id (flips auction to Trading)
 *   6. Update indexer DB: state=TRADING, raydiumPoolId set
 *
 * Env vars:
 *   CRANK_KEYPAIR_JSON or ANCHOR_WALLET — crank signer
 *   BATCH_AUCTION_PROGRAM_ID, FEE_ROUTER_PROGRAM_ID — program IDs
 *   RAYDIUM_CLMM_AMM_CONFIG_ID — mainnet 1% fee tier config pubkey
 *   SOLANA_RPC_URL, SOLANA_NETWORK
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
import Decimal from "decimal.js";
import { prisma } from "./db";
import {
  loadRaydium,
  createClmmPoolWithPosition,
  RaydiumContext,
  RaydiumCluster,
} from "./raydium-client";

const POLL_INTERVAL_MS = 30_000; // 30 seconds
const INITIAL_RANGE_TICKS = 100;
const MAINNET_CLMM_PROGRAM = new PublicKey("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK");
const DEVNET_CLMM_PROGRAM = new PublicKey("devi51mZmdwUJGU9hjN27vEz64Gps7uUefqxg27EAtH");
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

// Track in-flight graduations to avoid double-processing
const graduating = new Set<string>();

export function startPoolGraduator(): NodeJS.Timeout | null {
  const ammConfigRaw = process.env.RAYDIUM_CLMM_AMM_CONFIG_ID;
  if (!ammConfigRaw) {
    console.warn(
      "[pool-graduator] RAYDIUM_CLMM_AMM_CONFIG_ID not set — pool graduation disabled",
    );
    return null;
  }

  console.log("[pool-graduator] Starting pool graduation loop (every 30s)");
  void graduateEligible();
  return setInterval(() => void graduateEligible(), POLL_INTERVAL_MS);
}

async function graduateEligible(): Promise<void> {
  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!rpcUrl) return;

  const batchAuctionId = process.env.BATCH_AUCTION_PROGRAM_ID;
  const feeRouterId = process.env.FEE_ROUTER_PROGRAM_ID;
  const ammConfigRaw = process.env.RAYDIUM_CLMM_AMM_CONFIG_ID;
  if (!batchAuctionId || !feeRouterId || !ammConfigRaw) return;

  // Find auctions ready for graduation:
  // state=SUCCEEDED, no raydiumPoolId yet
  const eligible = await prisma.auction.findMany({
    where: {
      state: "SUCCEEDED",
      raydiumPoolId: null,
    },
  });

  if (eligible.length === 0) return;

  console.log(
    `[pool-graduator] Found ${eligible.length} auction(s) eligible for graduation`,
  );

  let crank: Keypair;
  try {
    crank = loadCrankKeypair();
  } catch (err) {
    console.error("[pool-graduator] Cannot load crank keypair:", err);
    return;
  }

  const connection = new Connection(rpcUrl, "confirmed");
  const network = (process.env.SOLANA_NETWORK || "devnet").toLowerCase();
  const cluster: RaydiumCluster = network.includes("mainnet") ? "mainnet" : "devnet";
  const clmmProgramId = cluster === "mainnet" ? MAINNET_CLMM_PROGRAM : DEVNET_CLMM_PROGRAM;
  const ammConfigId = new PublicKey(ammConfigRaw);
  const batchAuctionProgramId = new PublicKey(batchAuctionId);
  const feeRouterProgramId = new PublicKey(feeRouterId);

  let ctx: RaydiumContext;
  try {
    ctx = await loadRaydium(connection, crank, cluster);
  } catch (err) {
    console.error("[pool-graduator] Failed to load Raydium SDK:", err);
    return;
  }

  for (const auction of eligible) {
    if (graduating.has(auction.mint)) continue;
    graduating.add(auction.mint);

    try {
      await graduateAuction({
        auction,
        crank,
        connection,
        ctx,
        clmmProgramId,
        ammConfigId,
        batchAuctionProgramId,
        feeRouterProgramId,
      });
    } catch (err) {
      console.error(
        `[pool-graduator] Failed to graduate ${auction.ticker} (${auction.mint}):`,
        err,
      );
    } finally {
      graduating.delete(auction.mint);
    }
  }
}

async function graduateAuction(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  auction: any;
  crank: Keypair;
  connection: Connection;
  ctx: RaydiumContext;
  clmmProgramId: PublicKey;
  ammConfigId: PublicKey;
  batchAuctionProgramId: PublicKey;
  feeRouterProgramId: PublicKey;
}): Promise<void> {
  const {
    auction,
    crank,
    connection,
    ctx,
    clmmProgramId,
    ammConfigId,
    batchAuctionProgramId,
    feeRouterProgramId,
  } = params;

  const mint = new PublicKey(auction.mint);
  const ticker = auction.ticker;

  console.log(`[pool-graduator] Graduating ${ticker} (${auction.mint})...`);

  // ── 1. seed_pool (if not already seeded) ──────────────────────────────
  if (!auction.poolSeeded) {
    console.log(`[pool-graduator] ${ticker}: calling seed_pool...`);

    const [auctionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("auction"), mint.toBuffer()],
      batchAuctionProgramId,
    );
    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      batchAuctionProgramId,
    );
    const [tokenVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), mint.toBuffer()],
      batchAuctionProgramId,
    );

    // Crank's ATA for the token mint (create if needed)
    const crankTokenAta = getAta(mint, crank.publicKey);

    const tx = new Transaction();

    // Ensure crank has an ATA for this token
    const ataInfo = await connection.getAccountInfo(crankTokenAta);
    if (!ataInfo) {
      tx.add(buildCreateAtaIx(crank.publicKey, crankTokenAta, crank.publicKey, mint));
    }

    tx.add(buildSeedPoolIx({
      batchAuctionProgramId,
      auction: auctionPda,
      config: configPda,
      tokenVault: tokenVaultPda,
      crankTokenAccount: crankTokenAta,
      crankSolDestination: crank.publicKey,
      crank: crank.publicKey,
    }));

    const seedTxId = await sendAndConfirmTransaction(connection, tx, [crank], {
      commitment: "confirmed",
    });
    console.log(`[pool-graduator] ${ticker}: seed_pool tx ${seedTxId}`);

    // Update local state so we don't retry seed_pool
    await prisma.auction.update({
      where: { mint: auction.mint },
      data: { poolSeeded: true },
    });
  } else {
    console.log(`[pool-graduator] ${ticker}: already seeded, skipping seed_pool`);
  }

  // ── 2. Compute pool amounts ───────────────────────────────────────────
  const buyerBps = BigInt(auction.buyerBps);
  const totalSupply = auction.totalSupply;
  const poolTokenAmount = (totalSupply * (10000n - buyerBps)) / 10000n;
  const poolSolAmount = auction.totalSol;

  if (poolTokenAmount === 0n || poolSolAmount === 0n) {
    console.error(`[pool-graduator] ${ticker}: pool seed amounts are zero — cannot graduate`);
    return;
  }

  const initialPrice = new Decimal(poolSolAmount.toString()).dividedBy(
    poolTokenAmount.toString(),
  );

  console.log(
    `[pool-graduator] ${ticker}: creating CLMM pool (tokens=${poolTokenAmount}, sol=${poolSolAmount} lamports)`,
  );

  // ── 3. Create Raydium CLMM pool + open position ──────────────────────
  const created = await createClmmPoolWithPosition(ctx, {
    clmmProgramId,
    ammConfigId,
    mintA: mint,
    mintB: WSOL_MINT,
    initialPrice,
    baseAmount: new BN(poolTokenAmount.toString()),
    quoteAmountMax: new BN(poolSolAmount.toString()),
    tickLower: -INITIAL_RANGE_TICKS,
    tickUpper: INITIAL_RANGE_TICKS,
  });
  console.log(
    `[pool-graduator] ${ticker}: pool created ${created.poolId.toBase58()} (txs: ${created.txIds.join(", ")})`,
  );

  // ── 4. fee_router::register_pool ──────────────────────────────────────
  const [feeVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("fee_vault")],
    feeRouterProgramId,
  );
  const [poolFeePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool_fee"), mint.toBuffer()],
    feeRouterProgramId,
  );

  const registerIx = buildRegisterPoolIx({
    feeRouterProgramId,
    crank: crank.publicKey,
    feeVault: feeVaultPda,
    mint,
    poolFeeAccount: poolFeePda,
    positionNftMint: created.positionNftMint,
    positionNftAccount: created.positionNftAccount,
    payer: crank.publicKey,
    creator: new PublicKey(auction.creator),
    raydiumPoolId: created.poolId,
  });
  const registerTx = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(registerIx),
    [crank],
    { commitment: "confirmed" },
  );
  console.log(`[pool-graduator] ${ticker}: register_pool tx ${registerTx}`);

  // ── 5. batch_auction::set_pool_id ─────────────────────────────────────
  const [auctionPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("auction"), mint.toBuffer()],
    batchAuctionProgramId,
  );
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    batchAuctionProgramId,
  );

  const setPoolIdIx = buildSetPoolIdIx({
    batchAuctionProgramId,
    crank: crank.publicKey,
    config: configPda,
    auction: auctionPda,
    poolId: created.poolId,
  });
  const setPoolTx = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(setPoolIdIx),
    [crank],
    { commitment: "confirmed" },
  );
  console.log(`[pool-graduator] ${ticker}: set_pool_id tx ${setPoolTx}`);

  // ── 6. Update DB ──────────────────────────────────────────────────────
  await prisma.auction.update({
    where: { mint: auction.mint },
    data: {
      raydiumPoolId: created.poolId.toBase58(),
      state: "TRADING",
    },
  });

  console.log(
    `[pool-graduator] ${ticker}: graduated successfully — pool ${created.poolId.toBase58()}, state=TRADING`,
  );
}

// ---------------------------------------------------------------------------
// Instruction builders
// ---------------------------------------------------------------------------

function anchorDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().slice(0, 8);
}

function buildSeedPoolIx(params: {
  batchAuctionProgramId: PublicKey;
  auction: PublicKey;
  config: PublicKey;
  tokenVault: PublicKey;
  crankTokenAccount: PublicKey;
  crankSolDestination: PublicKey;
  crank: PublicKey;
}): TransactionInstruction {
  // Account order matches batch_auction::SeedPool<'info>:
  //   auction (mut) → config → token_vault (mut) → crank_token_account (mut)
  //   → crank_sol_destination (mut) → crank (signer) → token_program
  return new TransactionInstruction({
    programId: params.batchAuctionProgramId,
    keys: [
      { pubkey: params.auction, isSigner: false, isWritable: true },
      { pubkey: params.config, isSigner: false, isWritable: false },
      { pubkey: params.tokenVault, isSigner: false, isWritable: true },
      { pubkey: params.crankTokenAccount, isSigner: false, isWritable: true },
      { pubkey: params.crankSolDestination, isSigner: false, isWritable: true },
      { pubkey: params.crank, isSigner: true, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: anchorDiscriminator("seed_pool"),
  });
}

function buildRegisterPoolIx(params: {
  feeRouterProgramId: PublicKey;
  crank: PublicKey;
  feeVault: PublicKey;
  mint: PublicKey;
  poolFeeAccount: PublicKey;
  positionNftMint: PublicKey;
  positionNftAccount: PublicKey;
  payer: PublicKey;
  creator: PublicKey;
  raydiumPoolId: PublicKey;
}): TransactionInstruction {
  // Account order matches fee_router::RegisterPool<'info>:
  //   crank (signer) → fee_vault → mint → pool_fee_account (init, mut)
  //   → position_nft_mint → position_nft_account → payer (signer, mut)
  //   → system_program
  return new TransactionInstruction({
    programId: params.feeRouterProgramId,
    keys: [
      { pubkey: params.crank, isSigner: true, isWritable: false },
      { pubkey: params.feeVault, isSigner: false, isWritable: false },
      { pubkey: params.mint, isSigner: false, isWritable: false },
      { pubkey: params.poolFeeAccount, isSigner: false, isWritable: true },
      { pubkey: params.positionNftMint, isSigner: false, isWritable: false },
      { pubkey: params.positionNftAccount, isSigner: false, isWritable: false },
      { pubkey: params.payer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      anchorDiscriminator("register_pool"),
      params.creator.toBuffer(),
      params.raydiumPoolId.toBuffer(),
    ]),
  });
}

function buildSetPoolIdIx(params: {
  batchAuctionProgramId: PublicKey;
  crank: PublicKey;
  config: PublicKey;
  auction: PublicKey;
  poolId: PublicKey;
}): TransactionInstruction {
  // Account order matches batch_auction::SetPoolId<'info>:
  //   auction (mut) → config → crank (signer)
  return new TransactionInstruction({
    programId: params.batchAuctionProgramId,
    keys: [
      { pubkey: params.auction, isSigner: false, isWritable: true },
      { pubkey: params.config, isSigner: false, isWritable: false },
      { pubkey: params.crank, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([
      anchorDiscriminator("set_pool_id"),
      params.poolId.toBuffer(),
    ]),
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Derive the associated token address for a given mint + owner. */
function getAta(mint: PublicKey, owner: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
}

/** Build a create-associated-token-account instruction. */
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
