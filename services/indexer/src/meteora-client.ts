/**
 * Meteora DLMM client helper.
 *
 * Wraps @meteora-ag/dlmm for the two flows the backend needs:
 *
 *   1. Pool creation + position open (used by pool-graduator.ts)
 *   2. Fee collection from an existing position (used by fee-collector.ts)
 *
 * The crank keypair custodies the LP position and signs all Meteora
 * calls directly. The 80/20 fee split is still enforced on-chain by
 * `fee_router::claim_and_split`.
 *
 * Fees are collected only in SOL. Token-side fees are logged but not
 * routed — they accrue in the crank's ATA for manual sweep.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import DLMM, {
  StrategyType,
  ActivationType,
  type LbPosition,
} from "@meteora-ag/dlmm";
import BN from "bn.js";
import Decimal from "decimal.js";

const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

// 2% fee in basis points
const FEE_BPS = 200;

// Bin step controls price granularity between bins. 100 = 1% price
// increments between bins. This is a common choice for volatile pairs.
const BIN_STEP = 100;

// Number of bins on each side of the active bin to seed liquidity into.
const POSITION_WIDTH = 10;

export interface MeteoraContext {
  connection: Connection;
  crank: Keypair;
}

export interface CreatedPool {
  poolAddress: PublicKey;
  positionAddress: PublicKey;
  txIds: string[];
}

/**
 * Create a new Meteora DLMM pool with a 2% fee tier and seed an
 * initial position with the auction's token + SOL amounts.
 *
 * @param tokenMint   The auctioned token's mint address
 * @param solAmount   SOL amount in lamports to seed
 * @param tokenAmount Token amount (raw u64) to seed
 */
export async function createDlmmPoolWithPosition(
  ctx: MeteoraContext,
  params: {
    tokenMint: PublicKey;
    solAmount: BN;
    tokenAmount: BN;
  },
): Promise<CreatedPool> {
  const { connection, crank } = ctx;
  const { tokenMint, solAmount, tokenAmount } = params;

  // Calculate the initial active bin ID from the price ratio.
  // price = SOL / token. Meteora DLMM bin price = (1 + binStep/10000)^(binId - 0)
  // so binId = log(price) / log(1 + binStep/10000)
  const price = new Decimal(solAmount.toString()).dividedBy(tokenAmount.toString());
  const binStepDecimal = new Decimal(BIN_STEP).dividedBy(10000);
  const activeId = Math.round(
    price.ln().dividedBy(binStepDecimal.plus(1).ln()).toNumber(),
  );

  // ── 1. Create the DLMM pool ──────────────────────────────────────────
  const createPoolTx = await DLMM.createCustomizablePermissionlessLbPair(
    connection,
    new BN(BIN_STEP),
    tokenMint,       // tokenX = auctioned token
    WSOL_MINT,       // tokenY = SOL
    new BN(activeId),
    new BN(FEE_BPS),
    ActivationType.Slot,
    false,            // no alpha vault
    crank.publicKey,
  );

  const createTxId = await sendAndConfirmTransaction(
    connection,
    createPoolTx,
    [crank],
    { commitment: "confirmed" },
  );
  console.log(`[meteora] Pool creation tx: ${createTxId}`);

  // Derive the pool address (deterministic from tokenX, tokenY, binStep)
  const [poolAddress] = derivePoolAddress(tokenMint, WSOL_MINT, new BN(BIN_STEP));

  // ── 2. Load the pool and add initial liquidity ────────────────────────
  const dlmmPool = await DLMM.create(connection, poolAddress);

  const positionKeypair = Keypair.generate();
  const minBinId = activeId - POSITION_WIDTH;
  const maxBinId = activeId + POSITION_WIDTH;

  const addLiqTx = await dlmmPool.initializePositionAndAddLiquidityByStrategy({
    positionPubKey: positionKeypair.publicKey,
    totalXAmount: tokenAmount,
    totalYAmount: solAmount,
    strategy: {
      strategyType: StrategyType.Spot,
      minBinId,
      maxBinId,
    },
    user: crank.publicKey,
    slippage: 5, // 5% slippage tolerance for initial seeding
  });

  // The SDK may return a single tx or an array; normalize
  const txs = Array.isArray(addLiqTx) ? addLiqTx : [addLiqTx];
  const addLiqTxIds: string[] = [];

  for (const tx of txs) {
    const txId = await sendAndConfirmTransaction(
      connection,
      tx,
      [crank, positionKeypair],
      { commitment: "confirmed" },
    );
    addLiqTxIds.push(txId);
    console.log(`[meteora] Add liquidity tx: ${txId}`);
  }

  return {
    poolAddress,
    positionAddress: positionKeypair.publicKey,
    txIds: [createTxId, ...addLiqTxIds],
  };
}

/**
 * Fetch a position's pending fees. Returns SOL-side and token-side fees.
 */
export async function getPositionFees(
  ctx: MeteoraContext,
  poolAddress: PublicKey,
  positionAddress: PublicKey,
): Promise<{ feeSOL: BN; feeToken: BN; position: LbPosition }> {
  const dlmmPool = await DLMM.create(ctx.connection, poolAddress);
  const position = await dlmmPool.getPosition(positionAddress);

  const tokenXMint = dlmmPool.tokenX.publicKey.toBase58();
  const isXSol = tokenXMint === WSOL_MINT.toBase58();

  // feeX/feeY correspond to tokenX/tokenY of the pool
  const feeX = position.positionData.feeX;
  const feeY = position.positionData.feeY;

  return {
    feeSOL: isXSol ? feeX : feeY,
    feeToken: isXSol ? feeY : feeX,
    position,
  };
}

/**
 * Claim swap fees from a position. Fees land in the crank's ATAs.
 */
export async function claimPositionFees(
  ctx: MeteoraContext,
  poolAddress: PublicKey,
  position: LbPosition,
): Promise<string[]> {
  const { connection, crank } = ctx;
  const dlmmPool = await DLMM.create(connection, poolAddress);

  const claimTxs = await dlmmPool.claimSwapFee({
    owner: crank.publicKey,
    position,
  });

  const txIds: string[] = [];
  for (const tx of claimTxs) {
    const txId = await sendAndConfirmTransaction(
      connection,
      tx,
      [crank],
      { commitment: "confirmed" },
    );
    txIds.push(txId);
  }

  return txIds;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive the DLMM pool address. The SDK uses
 * `deriveCustomizablePermissionlessLbPair` but we replicate the seed
 * derivation here for convenience.
 */
function derivePoolAddress(
  tokenX: PublicKey,
  tokenY: PublicKey,
  binStep: BN,
): [PublicKey, number] {
  // The Meteora SDK's derivation uses the LBCLMM program ID and specific seeds.
  // We use the SDK's exported helper directly.
  const { deriveCustomizablePermissionlessLbPair: derive } = require("@meteora-ag/dlmm");
  return derive(tokenX, tokenY, binStep);
}
