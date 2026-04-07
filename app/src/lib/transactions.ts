import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  BATCH_AUCTION_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  RENT_SYSVAR,
  getAuctionPDA,
  getCommitmentPDA,
  getStakePDA,
  getTickerPDA,
  getFeeConfigPDA,
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
// 1. Create Auction
// ---------------------------------------------------------------------------

/**
 * Build a transaction that calls `create_auction` on the BatchAuction program.
 *
 * Accounts (expected order):
 *   0. creator          (signer, mut)
 *   1. auction PDA      (mut)
 *   2. ticker PDA       (mut)
 *   3. stake PDA        (mut)
 *   4. mint             (mut)
 *   5. system_program
 *   6. rent
 *
 * The instruction also includes a 2 SOL transfer to the stake PDA, encoded as
 * part of the on-chain logic (the program will CPI into system_program).
 */
export async function buildCreateAuctionTx(
  creator: PublicKey,
  ticker: string,
  totalSupply: number,
  mint: PublicKey,
): Promise<Transaction> {
  const [auctionPDA] = getAuctionPDA(mint);
  const [tickerPDA] = getTickerPDA(ticker);
  const [stakePDA] = getStakePDA(mint);

  const discriminator = await anchorDiscriminator("create_auction");
  const data = Buffer.concat([
    discriminator,
    encodeString(ticker),
    encodeU64(totalSupply),
  ]);

  const ix = new TransactionInstruction({
    programId: BATCH_AUCTION_PROGRAM_ID,
    keys: [
      { pubkey: creator, isSigner: true, isWritable: true },
      { pubkey: auctionPDA, isSigner: false, isWritable: true },
      { pubkey: tickerPDA, isSigner: false, isWritable: true },
      { pubkey: stakePDA, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: RENT_SYSVAR, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  return tx;
}

// ---------------------------------------------------------------------------
// 2. Commit SOL
// ---------------------------------------------------------------------------

/**
 * Build a transaction that calls `commit_sol` on the BatchAuction program.
 *
 * Accounts:
 *   0. participant      (signer, mut)
 *   1. auction PDA      (mut)
 *   2. commitment PDA   (mut)
 *   3. system_program
 */
export async function buildCommitSolTx(
  participant: PublicKey,
  auctionMint: PublicKey,
  amount: number,
): Promise<Transaction> {
  const [auctionPDA] = getAuctionPDA(auctionMint);
  const [commitmentPDA] = getCommitmentPDA(auctionMint, participant);

  const discriminator = await anchorDiscriminator("commit_sol");
  const data = Buffer.concat([
    discriminator,
    encodeU64(Math.round(amount * LAMPORTS_PER_SOL)),
  ]);

  const ix = new TransactionInstruction({
    programId: BATCH_AUCTION_PROGRAM_ID,
    keys: [
      { pubkey: participant, isSigner: true, isWritable: true },
      { pubkey: auctionPDA, isSigner: false, isWritable: true },
      { pubkey: commitmentPDA, isSigner: false, isWritable: true },
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
 *
 * Accounts:
 *   0. participant            (signer, mut)
 *   1. auction PDA            (mut)
 *   2. commitment PDA         (mut)
 *   3. mint                   (readonly)
 *   4. participant token ATA  (mut)
 *   5. auction token vault    (mut)  – auction PDA's ATA for the mint
 *   6. token_program
 *   7. system_program
 */
export async function buildClaimTokensTx(
  participant: PublicKey,
  auctionMint: PublicKey,
): Promise<Transaction> {
  const [auctionPDA] = getAuctionPDA(auctionMint);
  const [commitmentPDA] = getCommitmentPDA(auctionMint, participant);
  const participantAta = getAssociatedTokenAddress(auctionMint, participant);
  const auctionVault = getAssociatedTokenAddress(auctionMint, auctionPDA);

  const discriminator = await anchorDiscriminator("claim_tokens");

  const ix = new TransactionInstruction({
    programId: BATCH_AUCTION_PROGRAM_ID,
    keys: [
      { pubkey: participant, isSigner: true, isWritable: true },
      { pubkey: auctionPDA, isSigner: false, isWritable: true },
      { pubkey: commitmentPDA, isSigner: false, isWritable: true },
      { pubkey: auctionMint, isSigner: false, isWritable: false },
      { pubkey: participantAta, isSigner: false, isWritable: true },
      { pubkey: auctionVault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
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
 *
 * Accounts:
 *   0. participant      (signer, mut)
 *   1. auction PDA      (mut)
 *   2. commitment PDA   (mut)
 *   3. system_program
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
      { pubkey: participant, isSigner: true, isWritable: true },
      { pubkey: auctionPDA, isSigner: false, isWritable: true },
      { pubkey: commitmentPDA, isSigner: false, isWritable: true },
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
