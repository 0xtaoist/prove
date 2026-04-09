import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  BATCH_AUCTION_PROGRAM_ID,
  STAKE_MANAGER_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  RENT_SYSVAR,
  getAuctionPDA,
  getAuctionConfigPDA,
  getTokenVaultPDA,
  getCommitmentPDA,
  getStakeVaultPDA,
  getStakePDA,
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
 * On-chain CreateAuction account layout:
 *   0. auction PDA       (init, mut)  — seeds: ["auction", mint]
 *   1. config PDA        (readonly)   — seeds: ["config"]
 *   2. mint              (mut)        — SPL token mint (auction PDA must be mint authority)
 *   3. token_vault PDA   (init, mut)  — seeds: ["vault", mint]
 *   4. creator           (signer, mut)
 *   5. stake_vault       (mut)        — stake_manager PDA
 *   6. stake PDA         (init, mut)  — stake_manager PDA
 *   7. stake_manager_program
 *   8. token_program
 *   9. system_program
 *  10. rent
 */
export async function buildCreateAuctionTx(
  creator: PublicKey,
  ticker: string,
  totalSupply: number,
  mint: PublicKey,
): Promise<Transaction> {
  const [auctionPDA] = getAuctionPDA(mint);
  const [configPDA] = getAuctionConfigPDA();
  const [tokenVaultPDA] = getTokenVaultPDA(mint);
  const [stakeVaultPDA] = getStakeVaultPDA();
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
      { pubkey: auctionPDA, isSigner: false, isWritable: true },
      { pubkey: configPDA, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: tokenVaultPDA, isSigner: false, isWritable: true },
      { pubkey: creator, isSigner: true, isWritable: true },
      { pubkey: stakeVaultPDA, isSigner: false, isWritable: true },
      { pubkey: stakePDA, isSigner: false, isWritable: true },
      { pubkey: STAKE_MANAGER_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: RENT_SYSVAR, isSigner: false, isWritable: false },
    ],
    data,
  });

  return new Transaction().add(ix);
}

// ---------------------------------------------------------------------------
// 2. Commit SOL
// ---------------------------------------------------------------------------

/**
 * Build a transaction that calls `commit_sol` on the BatchAuction program.
 *
 * On-chain CommitSol account layout:
 *   0. auction PDA      (mut)       — seeds: ["auction", mint]
 *   1. config PDA       (readonly)  — seeds: ["config"]
 *   2. commitment PDA   (init, mut) — seeds: ["commitment", mint, participant]
 *   3. participant      (signer, mut)
 *   4. system_program
 */
export async function buildCommitSolTx(
  participant: PublicKey,
  auctionMint: PublicKey,
  amount: number,
): Promise<Transaction> {
  const [auctionPDA] = getAuctionPDA(auctionMint);
  const [configPDA] = getAuctionConfigPDA();
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
 *
 * On-chain ClaimTokens account layout:
 *   0. auction PDA            (readonly) — seeds: ["auction", mint]
 *   1. commitment PDA         (mut, close=participant)
 *   2. token_vault PDA        (mut)      — seeds: ["vault", mint]
 *   3. participant_token_ata  (mut)
 *   4. participant            (signer, mut)
 *   5. token_program
 */
export async function buildClaimTokensTx(
  participant: PublicKey,
  auctionMint: PublicKey,
): Promise<Transaction> {
  const [auctionPDA] = getAuctionPDA(auctionMint);
  const [commitmentPDA] = getCommitmentPDA(auctionMint, participant);
  const [tokenVaultPDA] = getTokenVaultPDA(auctionMint);
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
 *
 * On-chain Refund account layout:
 *   0. auction PDA      (mut)               — seeds: ["auction", mint]
 *   1. commitment PDA   (mut, close=participant)
 *   2. participant      (signer, mut)
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
