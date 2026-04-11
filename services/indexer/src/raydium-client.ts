/**
 * Raydium CLMM client helper.
 *
 * Wraps @raydium-io/raydium-sdk-v2 for the two flows the backend needs:
 *
 *   1. Pool creation + position open (used by scripts/create-raydium-pool.ts)
 *   2. Fee collection from an existing position (used by fee-collector.ts)
 *
 * Architectural note: we run the SDK with the *crank* keypair as the
 * owner. The crank custodies LP position NFTs and signs Raydium calls
 * directly, which avoids the need for on-chain Raydium CPI. The 80/20
 * fee split is still enforced on-chain by `fee_router::claim_and_split`
 * — the crank can claim, but cannot divert fees from creator / treasury.
 * See the architecture comment at the top of programs/fee-router/src/lib.rs.
 */

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Raydium, TxVersion, ApiV3PoolInfoConcentratedItem, ClmmKeys } from "@raydium-io/raydium-sdk-v2";
import BN from "bn.js";
import Decimal from "decimal.js";

/** Raydium's supported clusters — narrower than @solana/web3.js's Cluster. */
export type RaydiumCluster = "devnet" | "mainnet";

export interface RaydiumContext {
  sdk: Raydium;
  owner: Keypair;
  connection: Connection;
  cluster: RaydiumCluster;
}

/**
 * Boot the Raydium SDK with the crank keypair as owner. The SDK will
 * auto-sign and broadcast transactions it builds with this owner's key.
 */
export async function loadRaydium(
  connection: Connection,
  cranKeypair: Keypair,
  cluster: RaydiumCluster = "devnet",
): Promise<RaydiumContext> {
  const sdk = await Raydium.load({
    connection,
    cluster,
    owner: cranKeypair,
    disableFeatureCheck: true,
    disableLoadToken: true,
    blockhashCommitment: "confirmed",
  });
  return { sdk, owner: cranKeypair, connection, cluster };
}

/**
 * Fetch a Raydium CLMM pool's full info + keys by pool address.
 * Used by the fee-collector to hydrate pool data before claiming fees.
 *
 * Throws if the pool is not a concentrated-liquidity pool or if Raydium's
 * API can't find it.
 */
export async function fetchClmmPool(
  ctx: RaydiumContext,
  poolId: string,
): Promise<{ poolInfo: ApiV3PoolInfoConcentratedItem; poolKeys: ClmmKeys }> {
  const data = await ctx.sdk.api.fetchPoolById({ ids: poolId });
  const poolInfo = data?.[0] as ApiV3PoolInfoConcentratedItem | undefined;
  if (!poolInfo) {
    throw new Error(`Raydium pool ${poolId} not found in API`);
  }
  if (poolInfo.type !== "Concentrated") {
    throw new Error(
      `Raydium pool ${poolId} is ${poolInfo.type}, expected Concentrated`,
    );
  }
  const poolKeys = await ctx.sdk.clmm.getClmmPoolKeys(poolId);
  return { poolInfo, poolKeys };
}

/**
 * Fetch the crank's owned CLMM positions. Returns the position matching
 * the given pool id, or undefined if the crank does not own a position
 * for that pool.
 */
export async function findCrankPosition(
  ctx: RaydiumContext,
  poolId: string,
): Promise<
  | {
      nftMint: PublicKey;
      tickLower: number;
      tickUpper: number;
      liquidity: BN;
      tokenFeesOwedA: BN;
      tokenFeesOwedB: BN;
      raw: unknown;
    }
  | undefined
> {
  const positions = await ctx.sdk.clmm.getOwnerPositionInfo({
    programId: new PublicKey(
      // Default to the concentrated program id from the loaded pool;
      // callers that need to target devnet vs mainnet should pass the
      // right programId upstream.
      // This is the mainnet CLMM program. Devnet consumers should look
      // it up via DEVNET_PROGRAM_ID.CLMM instead.
      "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
    ),
  });

  const match = positions.find(
    (p) => p.poolId.toBase58() === poolId,
  );
  if (!match) return undefined;
  return {
    nftMint: match.nftMint,
    tickLower: match.tickLower,
    tickUpper: match.tickUpper,
    liquidity: match.liquidity,
    tokenFeesOwedA: match.tokenFeesOwedA ?? new BN(0),
    tokenFeesOwedB: match.tokenFeesOwedB ?? new BN(0),
    raw: match,
  };
}

export interface CreatedPool {
  poolId: PublicKey;
  positionNftMint: PublicKey;
  positionNftAccount: PublicKey;
  txIds: string[];
}

/**
 * Create a new CLMM pool with a 1% fee tier and open an initial
 * concentrated position centered on `initialPrice`.
 *
 * Side effects: signs and broadcasts transactions with the crank key.
 * On success, the crank owns the LP position NFT.
 *
 * @param initialPrice   token-A / token-B ratio, e.g. new Decimal(0.0001)
 * @param ammConfigId    the Raydium AMM config pubkey for the 1% fee tier
 * @param mintA          base token mint (the auctioned token)
 * @param mintB          quote token mint (WSOL)
 * @param baseAmount     amount of mintA to seed into the position (raw u64 in mint decimals)
 * @param quoteAmountMax max amount of mintB to seed (raw u64 in mint decimals)
 * @param tickLower      lower tick of the concentrated range
 * @param tickUpper      upper tick of the concentrated range
 */
export async function createClmmPoolWithPosition(
  ctx: RaydiumContext,
  params: {
    clmmProgramId: PublicKey;
    ammConfigId: PublicKey;
    mintA: PublicKey;
    mintB: PublicKey;
    initialPrice: Decimal;
    baseAmount: BN;
    quoteAmountMax: BN;
    tickLower: number;
    tickUpper: number;
  },
): Promise<CreatedPool> {
  // 1. Load token metadata for both mints (Raydium needs ApiV3Token entries).
  const [tokenA, tokenB] = await Promise.all([
    ctx.sdk.token.getTokenInfo(params.mintA.toBase58()),
    ctx.sdk.token.getTokenInfo(params.mintB.toBase58()),
  ]);

  // 2. Fetch the requested AMM config (defines fee tier + tick spacing)
  //    and convert from Api shape → runtime ClmmConfigInfo.
  const ammConfigs = await ctx.sdk.api.getClmmConfigs();
  const apiConfig = ammConfigs.find(
    (c) => c.id === params.ammConfigId.toBase58(),
  );
  if (!apiConfig) {
    throw new Error(
      `Raydium CLMM config ${params.ammConfigId.toBase58()} not found`,
    );
  }
  const ammConfig = {
    id: new PublicKey(apiConfig.id),
    index: apiConfig.index,
    protocolFeeRate: apiConfig.protocolFeeRate,
    tradeFeeRate: apiConfig.tradeFeeRate,
    tickSpacing: apiConfig.tickSpacing,
    fundFeeRate: apiConfig.fundFeeRate,
    fundOwner: "",
    description: "",
  };

  // 3. Create the pool. This builds + sends a transaction whose signer
  //    is the SDK's configured owner (the crank).
  const created = await ctx.sdk.clmm.createPool({
    programId: params.clmmProgramId,
    owner: ctx.owner.publicKey,
    mint1: tokenA,
    mint2: tokenB,
    ammConfig,
    initialPrice: params.initialPrice,
    txVersion: TxVersion.V0,
  });
  const createTxId = await created.execute().then((r) => r.txId);

  // 4. Open a concentrated position in the new pool. Position NFT lands
  //    in the crank's wallet (the SDK's configured owner).
  const poolInfo = created.extInfo.mockPoolInfo;
  const poolKeys = created.extInfo.address;
  const opened = await ctx.sdk.clmm.openPositionFromBase({
    poolInfo,
    poolKeys,
    ownerInfo: { useSOLBalance: true },
    tickLower: params.tickLower,
    tickUpper: params.tickUpper,
    base: "MintA",
    baseAmount: params.baseAmount,
    otherAmountMax: params.quoteAmountMax,
    txVersion: TxVersion.V0,
  });
  const openTxId = await opened.execute().then((r) => r.txId);

  const nftMint = opened.extInfo.nftMint;
  // ATA address for the crank (owner) holding the position NFT.
  const [positionNftAccount] = PublicKey.findProgramAddressSync(
    [
      ctx.owner.publicKey.toBuffer(),
      new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").toBuffer(),
      nftMint.toBuffer(),
    ],
    new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
  );

  return {
    poolId: new PublicKey(poolKeys.id),
    positionNftMint: nftMint,
    positionNftAccount,
    txIds: [createTxId, openTxId],
  };
}

export interface ClaimResult {
  txId: string;
  /** Fees collected on the mintA side (raw u64 in mint decimals). */
  amountA: BN;
  /** Fees collected on the mintB side (raw u64 in mint decimals). */
  amountB: BN;
}

/**
 * Collect accumulated fees from an existing CLMM position without
 * removing liquidity. Implemented via Raydium's `decreaseLiquidity`
 * with `liquidity = 0` — the SDK treats this as a fee-only collection.
 *
 * Side effect: signs and broadcasts a transaction with the crank key.
 * Collected fees land in the crank's token ATAs for mintA and mintB.
 */
export async function collectPositionFees(
  ctx: RaydiumContext,
  params: {
    poolInfo: ApiV3PoolInfoConcentratedItem;
    poolKeys: ClmmKeys;
    // The raw position record from findCrankPosition(). Typed as unknown
    // upstream so we accept the SDK's exact layout here.
    ownerPosition: unknown;
  },
): Promise<ClaimResult> {
  const position = params.ownerPosition as {
    tokenFeesOwedA?: BN;
    tokenFeesOwedB?: BN;
  };
  const claimedA = position.tokenFeesOwedA ?? new BN(0);
  const claimedB = position.tokenFeesOwedB ?? new BN(0);

  const tx = await ctx.sdk.clmm.decreaseLiquidity({
    poolInfo: params.poolInfo,
    poolKeys: params.poolKeys,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ownerPosition: params.ownerPosition as any,
    ownerInfo: {
      useSOLBalance: true,
      closePosition: false,
    },
    liquidity: new BN(0),
    amountMinA: new BN(0),
    amountMinB: new BN(0),
    txVersion: TxVersion.V0,
  });
  const txId = await tx.execute().then((r) => r.txId);

  return { txId, amountA: claimedA, amountB: claimedB };
}
