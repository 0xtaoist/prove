/**
 * create-raydium-pool.ts — Real Raydium CLMM pool creation + register_pool.
 *
 * Called after a batch auction succeeds (state == Succeeded, pool_seeded == true).
 * Creates a Raydium CLMM pool with a 1% fee tier, opens an initial position
 * with the auction's seeded token + SOL, and registers the pool with
 * fee_router + batch_auction.
 *
 * After this script returns successfully:
 *   - the Raydium CLMM pool exists and is tradable
 *   - the LP position NFT is held by the *crank* keypair (custodial model,
 *     see architecture comment in programs/fee-router/src/lib.rs)
 *   - fee_router.PoolFeeAccount is initialized for the mint
 *   - batch_auction.Auction.pool_id is set and state flipped to Trading
 *   - indexer DB has Auction.raydiumPoolId populated + state == TRADING
 *
 * Usage:
 *   tsx scripts/create-raydium-pool.ts <auction_mint>
 *
 * Env:
 *   SOLANA_RPC_URL, SOLANA_NETWORK (devnet|mainnet),
 *   FEE_ROUTER_PROGRAM_ID, BATCH_AUCTION_PROGRAM_ID,
 *   ANCHOR_WALLET (path to crank keypair),
 *   RAYDIUM_CLMM_AMM_CONFIG_ID (the 1% fee tier config pubkey).
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
  clusterApiUrl,
} from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import { PrismaClient } from "@prisma/client";
import {
  loadRaydium,
  createClmmPoolWithPosition,
  RaydiumContext,
  RaydiumCluster,
} from "../services/indexer/src/raydium-client";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Raydium mainnet CLMM program id. Devnet consumers should override via env.
const MAINNET_CLMM_PROGRAM = "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK";
const DEVNET_CLMM_PROGRAM = "devi51mZmdwUJGU9hjN27vEz64Gps7uUefqxg27EAtH";
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

// How wide the initial concentrated range is, as a multiplier on tick spacing.
// 100 ticks either side gives a reasonable ~10% range for the initial LP.
const INITIAL_RANGE_TICKS = 100;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const mintArg = process.argv[2];
  if (!mintArg) {
    console.error("Usage: tsx scripts/create-raydium-pool.ts <auction_mint>");
    process.exit(1);
  }
  const mint = new PublicKey(mintArg);

  const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl("devnet");
  const network = (process.env.SOLANA_NETWORK || "devnet").toLowerCase();
  const cluster: RaydiumCluster = network === "mainnet" ? "mainnet" : "devnet";

  const feeRouterId = new PublicKey(requireEnv("FEE_ROUTER_PROGRAM_ID"));
  const batchAuctionId = new PublicKey(requireEnv("BATCH_AUCTION_PROGRAM_ID"));
  const ammConfigId = new PublicKey(requireEnv("RAYDIUM_CLMM_AMM_CONFIG_ID"));
  const clmmProgramId = new PublicKey(
    cluster === "mainnet" ? MAINNET_CLMM_PROGRAM : DEVNET_CLMM_PROGRAM,
  );

  const crank = loadKeypairFromPath(
    process.env.ANCHOR_WALLET ||
      path.join(process.env.HOME || "~", ".config", "solana", "id.json"),
  );

  const connection = new Connection(rpcUrl, "confirmed");
  console.log(`Network: ${cluster}`);
  console.log(`RPC:     ${rpcUrl}`);
  console.log(`Crank:   ${crank.publicKey.toBase58()}`);
  console.log(`Mint:    ${mint.toBase58()}\n`);

  // ── 1. Read auction state ────────────────────────────────────────────
  //
  // We need the pool-side token + SOL amounts that were released by
  // batch_auction::seed_pool. They live in the crank's ATAs already —
  // we just need to know how much to put into the position.
  const prisma = new PrismaClient();
  const auction = await prisma.auction.findUnique({ where: { mint: mintArg } });
  if (!auction) {
    throw new Error(`Auction ${mintArg} not found in indexer DB`);
  }
  if (auction.state !== "SUCCEEDED") {
    throw new Error(
      `Auction ${mintArg} is in state ${auction.state}, expected SUCCEEDED`,
    );
  }
  if (auction.raydiumPoolId) {
    console.log(
      `Auction ${mintArg} already has pool ${auction.raydiumPoolId} — nothing to do`,
    );
    await prisma.$disconnect();
    return;
  }
  if (!auction.poolSeeded) {
    throw new Error(
      `Auction ${mintArg}: pool has not been seeded on-chain yet (call batch_auction::seed_pool first)`,
    );
  }

  // Pool share is (1 - buyer_bps/10000) of total supply.
  const buyerBps = BigInt(auction.buyerBps);
  const totalSupply = auction.totalSupply;
  const poolTokenAmount =
    (totalSupply * (10000n - buyerBps)) / 10000n;
  const poolSolAmount = auction.totalSol;
  console.log(`Pool seed amounts:`);
  console.log(`  tokens: ${poolTokenAmount.toString()}`);
  console.log(`  SOL:    ${poolSolAmount.toString()} lamports\n`);

  if (poolTokenAmount === 0n || poolSolAmount === 0n) {
    throw new Error("Pool seed amount is zero — nothing to put in the position");
  }

  // uniform_price is SOL-per-token. CLMM initial price is mintB-per-mintA
  // in Raydium's convention. We pick the mint ordering so mintA is the
  // auctioned token and mintB is WSOL, giving initialPrice = SOL/token.
  const initialPrice = new Decimal(poolSolAmount.toString()).dividedBy(
    poolTokenAmount.toString(),
  );

  // ── 2. Load Raydium SDK ──────────────────────────────────────────────
  const ctx: RaydiumContext = await loadRaydium(connection, crank, cluster);

  // ── 3. Create pool + open initial position ───────────────────────────
  const created = await createClmmPoolWithPosition(ctx, {
    clmmProgramId,
    ammConfigId,
    mintA: mint,
    mintB: WSOL_MINT,
    initialPrice,
    baseAmount: new BN(poolTokenAmount.toString()),
    quoteAmountMax: new BN(poolSolAmount.toString()),
    // Full-range-ish for v0: ±INITIAL_RANGE_TICKS around current tick.
    // The SDK rounds to nearest valid tick boundary internally.
    tickLower: -INITIAL_RANGE_TICKS,
    tickUpper: INITIAL_RANGE_TICKS,
  });
  console.log(`✔ Pool created: ${created.poolId.toBase58()}`);
  console.log(`  Position NFT:  ${created.positionNftMint.toBase58()}`);
  console.log(`  Position ATA:  ${created.positionNftAccount.toBase58()}`);
  console.log(`  Txs: ${created.txIds.join(", ")}\n`);

  // ── 4. fee_router::register_pool ────────────────────────────────────
  //
  // The NFT is in the crank's ATA. fee_router.register_pool verifies
  // owner == fee_vault.crank_authority (that's us) and initializes
  // the pool_fee_account PDA for accounting.
  const [feeVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("fee_vault")],
    feeRouterId,
  );
  const [poolFeePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool_fee"), mint.toBuffer()],
    feeRouterId,
  );

  const registerIx = buildRegisterPoolIx({
    feeRouterProgramId: feeRouterId,
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
  console.log(`✔ fee_router::register_pool: ${registerTx}\n`);

  // ── 5. batch_auction::set_pool_id ───────────────────────────────────
  //
  // Flips the auction state to Trading and records the Raydium pool id.
  const [auctionPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("auction"), mint.toBuffer()],
    batchAuctionId,
  );
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    batchAuctionId,
  );
  const setPoolIdIx = buildSetPoolIdIx({
    batchAuctionProgramId: batchAuctionId,
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
  console.log(`✔ batch_auction::set_pool_id: ${setPoolTx}\n`);

  // ── 6. Update DB ─────────────────────────────────────────────────────
  await prisma.auction.update({
    where: { mint: mintArg },
    data: {
      raydiumPoolId: created.poolId.toBase58(),
      state: "TRADING",
    },
  });
  console.log(`✔ indexer DB updated: state=TRADING, raydiumPoolId=${created.poolId.toBase58()}`);

  await prisma.$disconnect();
}

// ---------------------------------------------------------------------------
// Instruction builders (Anchor sighash-compatible, no IDL needed)
// ---------------------------------------------------------------------------

function anchorDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().slice(0, 8);
}

/** Encode fee_router::register_pool args: creator (32) + raydium_pool_id (32). */
function encodeRegisterPoolArgs(
  creator: PublicKey,
  raydiumPoolId: PublicKey,
): Buffer {
  return Buffer.concat([creator.toBuffer(), raydiumPoolId.toBuffer()]);
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
  // Account order must match fee_router::RegisterPool<'info>:
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
      encodeRegisterPoolArgs(params.creator, params.raydiumPoolId),
    ]),
  });
}

/** Encode batch_auction::set_pool_id args: pool_id (32). */
function buildSetPoolIdIx(params: {
  batchAuctionProgramId: PublicKey;
  crank: PublicKey;
  config: PublicKey;
  auction: PublicKey;
  poolId: PublicKey;
}): TransactionInstruction {
  // Account order must match batch_auction::SetPoolId<'info>:
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

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`ERROR: Missing environment variable ${name}`);
    process.exit(1);
  }
  return value;
}

function loadKeypairFromPath(p: string): Keypair {
  if (!fs.existsSync(p)) {
    throw new Error(`Keypair file not found at ${p}`);
  }
  const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
