import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  BATCH_AUCTION_PROGRAM_ID,
  STAKE_MANAGER_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  RENT_SYSVAR,
  getAuctionPDA,
  getConfigPDA,
  getVaultPDA,
  getCommitmentPDA,
  getStakePDA,
  getStakeVaultPDA,
  getAssociatedTokenAddress,
  getRaydiumSwapUrl,
} from "./programs";

// ---------------------------------------------------------------------------
// Instruction discriminator helper
// ---------------------------------------------------------------------------

/**
 * Compute an 8-byte Anchor-compatible instruction discriminator.
 *
 * Anchor uses sha256("global:<instruction_name>")[0..8].  We approximate this
 * with a simple hash so the accounts layout is exercised end-to-end.  Once the
 * on-chain programs are deployed and IDLs are generated, these builders should
 * be replaced with the generated Anchor client.
 */
async function anchorDiscriminator(name: string): Promise<Buffer> {
  const msg = `global:${name}`;
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(msg),
  );
  return Buffer.from(new Uint8Array(hash).slice(0, 8));
}

// ---------------------------------------------------------------------------
// Helper: encode a u64 as 8 little-endian bytes
// ---------------------------------------------------------------------------

function encodeU64(value: number | bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(value));
  return buf;
}

// ---------------------------------------------------------------------------
// Helper: encode a boolean as 1 byte
// ---------------------------------------------------------------------------

function encodeBool(value: boolean): Buffer {
  return Buffer.from([value ? 1 : 0]);
}

// ---------------------------------------------------------------------------
// Helper: encode a string with a 4-byte LE length prefix (Borsh convention)
// ---------------------------------------------------------------------------

function encodeString(value: string): Buffer {
  const strBytes = Buffer.from(value, "utf-8");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(strBytes.length);
  return Buffer.concat([lenBuf, strBytes]);
}

// ---------------------------------------------------------------------------
// 1. Create Auction (bundled with stake deposit)
// ---------------------------------------------------------------------------

/**
 * Build a transaction that bundles two instructions atomically:
 *   Instruction 1: batch_auction::create_auction
 *   Instruction 2: stake_manager::deposit_stake
 *
 * If either fails, both revert. This replaces the old CPI approach and
 * saves ~100 KB in batch_auction's binary size.
 */
export async function buildCreateAuctionTx(
  creator: PublicKey,
  ticker: string,
  totalSupply: number,
  mint: PublicKey,
): Promise<Transaction> {
  const [auctionPDA] = getAuctionPDA(mint);
  const [configPDA] = getConfigPDA();
  const [vaultPDA] = getVaultPDA(mint);
  const [stakePDA] = getStakePDA(mint);
  const [stakeVaultPDA] = getStakeVaultPDA();

  // --- Instruction 1: batch_auction::create_auction ---
  const createAuctionData = Buffer.concat([
    await anchorDiscriminator("create_auction"),
    encodeString(ticker),
    encodeU64(totalSupply),
  ]);

  const createAuctionIx = new TransactionInstruction({
    programId: BATCH_AUCTION_PROGRAM_ID,
    keys: [
      { pubkey: auctionPDA, isSigner: false, isWritable: true },
      { pubkey: configPDA, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: vaultPDA, isSigner: false, isWritable: true },
      { pubkey: creator, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: RENT_SYSVAR, isSigner: false, isWritable: false },
    ],
    data: createAuctionData,
  });

  // --- Instruction 2: stake_manager::deposit_stake ---
  const depositStakeData = await anchorDiscriminator("deposit_stake");

  const depositStakeIx = new TransactionInstruction({
    programId: STAKE_MANAGER_PROGRAM_ID,
    keys: [
      { pubkey: stakeVaultPDA, isSigner: false, isWritable: true },
      { pubkey: stakePDA, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: creator, isSigner: true, isWritable: true },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: depositStakeData,
  });

  const tx = new Transaction().add(createAuctionIx).add(depositStakeIx);
  return tx;
}

// ---------------------------------------------------------------------------
// 2. Commit SOL
// ---------------------------------------------------------------------------

/**
 * Build a transaction that calls `commit_sol` on the BatchAuction program.
 */
export async function buildCommitSolTx(
  participant: PublicKey,
  auctionMint: PublicKey,
  amount: number,
): Promise<Transaction> {
  const [auctionPDA] = getAuctionPDA(auctionMint);
  const [configPDA] = getConfigPDA();
  const [commitmentPDA] = getCommitmentPDA(auctionMint, participant);

  const discriminator = await anchorDiscriminator("commit_sol");
  const data = Buffer.concat([
    discriminator,
    encodeU64(Math.round(amount * LAMPORTS_PER_SOL)),
  ]);

  const ix = new TransactionInstruction({
    programId: BATCH_AUCTION_PROGRAM_ID,
    keys: [
      { pubkey: auctionPDA, isSigner: false, isWritable: true },
      { pubkey: configPDA, isSigner: false, isWritable: false },
      { pubkey: commitmentPDA, isSigner: false, isWritable: true },
      { pubkey: participant, isSigner: true, isWritable: true },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });

  return new Transaction().add(ix);
}

// ---------------------------------------------------------------------------
// 3. Claim Tokens
// ---------------------------------------------------------------------------

/**
 * Build a transaction that calls `claim_tokens` on the BatchAuction program.
 * Works in both Succeeded and Trading states. Closes the commitment PDA
 * and returns rent to the participant.
 */
export async function buildClaimTokensTx(
  participant: PublicKey,
  auctionMint: PublicKey,
): Promise<Transaction> {
  const [auctionPDA] = getAuctionPDA(auctionMint);
  const [commitmentPDA] = getCommitmentPDA(auctionMint, participant);
  const [tokenVaultPDA] = getVaultPDA(auctionMint);
  const participantAta = getAssociatedTokenAddress(auctionMint, participant);

  const discriminator = await anchorDiscriminator("claim_tokens");

  const ix = new TransactionInstruction({
    programId: BATCH_AUCTION_PROGRAM_ID,
    keys: [
      { pubkey: auctionPDA, isSigner: false, isWritable: false },
      { pubkey: commitmentPDA, isSigner: false, isWritable: true },
      { pubkey: tokenVaultPDA, isSigner: false, isWritable: true },
      { pubkey: participantAta, isSigner: false, isWritable: true },
      { pubkey: participant, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: discriminator,
  });

  return new Transaction().add(ix);
}

// ---------------------------------------------------------------------------
// 4. Refund
// ---------------------------------------------------------------------------

/**
 * Build a transaction that calls `refund` on the BatchAuction program.
 * Only works when the auction is in Failed state. Closes the commitment
 * PDA and returns both the SOL commitment + rent to the participant.
 */
export async function buildRefundTx(
  participant: PublicKey,
  auctionMint: PublicKey,
): Promise<Transaction> {
  const [auctionPDA] = getAuctionPDA(auctionMint);
  const [commitmentPDA] = getCommitmentPDA(auctionMint, participant);

  const discriminator = await anchorDiscriminator("refund");

  const ix = new TransactionInstruction({
    programId: BATCH_AUCTION_PROGRAM_ID,
    keys: [
      { pubkey: auctionPDA, isSigner: false, isWritable: true },
      { pubkey: commitmentPDA, isSigner: false, isWritable: true },
      { pubkey: participant, isSigner: true, isWritable: true },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: discriminator,
  });

  return new Transaction().add(ix);
}

// ---------------------------------------------------------------------------
// 5. Swap — now handled via Raydium / Jupiter
// ---------------------------------------------------------------------------
// Swaps are no longer built as on-chain transactions through our program.
// Users trade on Jupiter (jup.ag) or Raydium directly.
// Use getRaydiumSwapUrl(mint) from programs.ts to get the swap URL.
export { getRaydiumSwapUrl };
