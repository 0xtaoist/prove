import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  ComputeBudgetProgram,
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
} from "./programs";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOKEN_DECIMALS = 9;
const METAPLEX_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);

// ---------------------------------------------------------------------------
// Instruction discriminator helper
// ---------------------------------------------------------------------------

async function anchorDiscriminator(name: string): Promise<Buffer> {
  const msg = `global:${name}`;
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(msg),
  );
  return Buffer.from(new Uint8Array(hash).slice(0, 8));
}

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

function encodeU64(value: number | bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(value));
  return buf;
}

function encodeString(value: string): Buffer {
  const strBytes = Buffer.from(value, "utf-8");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(strBytes.length);
  return Buffer.concat([lenBuf, strBytes]);
}

function encodeU16(value: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(value);
  return buf;
}

// ---------------------------------------------------------------------------
// Metaplex helpers
// ---------------------------------------------------------------------------

function getMetadataPDA(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      METAPLEX_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    METAPLEX_PROGRAM_ID,
  );
  return pda;
}

/**
 * Build a CreateMetadataAccountV3 instruction.
 * Sets name, symbol, URI, and marks the token as fungible (no collection, no uses).
 */
function buildCreateMetadataIx(
  metadata: PublicKey,
  mint: PublicKey,
  mintAuthority: PublicKey,
  payer: PublicKey,
  updateAuthority: PublicKey,
  name: string,
  symbol: string,
  uri: string,
): TransactionInstruction {
  // Borsh-encode the CreateMetadataAccountV3 instruction data.
  // Discriminator: 33 (CreateMetadataAccountV3)
  // DataV2: name(string) + symbol(string) + uri(string) +
  //         sellerFeeBasisPoints(u16) + creators(Option<Vec>) +
  //         collection(Option) + uses(Option)
  // isMutable: bool
  // collectionDetails: Option<CollectionDetails>
  const nameBytes = encodeString(name.slice(0, 32));
  const symbolBytes = encodeString(symbol.slice(0, 10));
  const uriBytes = encodeString(uri.slice(0, 200));

  const data = Buffer.concat([
    Buffer.from([33]), // CreateMetadataAccountV3 discriminator
    nameBytes,
    symbolBytes,
    uriBytes,
    encodeU16(0),      // seller_fee_basis_points = 0
    Buffer.from([0]),  // creators = None
    Buffer.from([0]),  // collection = None
    Buffer.from([0]),  // uses = None
    Buffer.from([1]),  // is_mutable = true
    Buffer.from([0]),  // collection_details = None
  ]);

  return new TransactionInstruction({
    programId: METAPLEX_PROGRAM_ID,
    keys: [
      { pubkey: metadata, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: mintAuthority, isSigner: true, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: updateAuthority, isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: RENT_SYSVAR, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// ---------------------------------------------------------------------------
// 1. Create Auction (bundled with stake deposit)
// ---------------------------------------------------------------------------

/**
 * Build a transaction that bundles instructions atomically:
 *   0. ComputeBudget — set compute limit
 *   1. ComputeBudget — set priority fee
 *   2. SystemProgram.createAccount — create the mint account
 *   3. Token.InitializeMint — set decimals=9, authority=auction PDA
 *   4. Metaplex.CreateMetadataAccountV3 — set name, symbol, URI
 *   5. batch_auction::create_auction — init auction + mint tokens
 *   6. stake_manager::deposit_stake — deposit 2 SOL stake
 *
 * Note: totalSupply is in human-readable units (e.g. 1_000_000_000).
 * It will be scaled by 10^9 for on-chain storage (decimals=9).
 */
export async function buildCreateAuctionTx(
  creator: PublicKey,
  ticker: string,
  totalSupply: number,
  mint: PublicKey,
  tokenName?: string,
  metadataUri?: string,
): Promise<Transaction> {
  const [auctionPDA] = getAuctionPDA(mint);
  const [configPDA] = getConfigPDA();
  const [vaultPDA] = getVaultPDA(mint);
  const [stakePDA] = getStakePDA(mint);
  const [stakeVaultPDA] = getStakeVaultPDA();
  const metadataPDA = getMetadataPDA(mint);

  // Scale supply by decimals: user enters 1B, on-chain = 1B * 10^9
  const rawSupply = BigInt(totalSupply) * BigInt(10 ** TOKEN_DECIMALS);

  // --- Create mint account ---
  const MINT_SIZE = 82;
  const mintRentLamports = 1461600;

  const createMintAccountIx = SystemProgram.createAccount({
    fromPubkey: creator,
    newAccountPubkey: mint,
    lamports: mintRentLamports,
    space: MINT_SIZE,
    programId: TOKEN_PROGRAM_ID,
  });

  // --- InitializeMint (decimals=9) ---
  const initMintData = Buffer.alloc(67);
  initMintData.writeUInt8(0, 0);              // instruction: InitializeMint
  initMintData.writeUInt8(TOKEN_DECIMALS, 1); // decimals = 9
  auctionPDA.toBuffer().copy(initMintData, 2); // mint authority = auction PDA
  initMintData.writeUInt8(0, 34);              // no freeze authority

  const initMintIx = new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: RENT_SYSVAR, isSigner: false, isWritable: false },
    ],
    data: initMintData,
  });

  // --- Metaplex metadata ---
  // The mint authority (auction PDA) needs to sign, but it's a PDA so
  // it can't sign in the same tx before create_auction initializes it.
  // Instead, we create metadata AFTER create_auction using the auction PDA
  // as a signer via CPI... but that's not possible from the client.
  //
  // Alternative: set the creator as a temporary mint authority, create
  // metadata, then the create_auction instruction will verify the auction
  // PDA is the authority. This won't work either.
  //
  // Correct approach: the mint authority IS the auction PDA. Metaplex
  // CreateMetadataAccountV3 requires the mint authority to sign.
  // Since the auction PDA can't sign from the client, we need to either:
  //   a) Create metadata in a separate CPI from the on-chain program
  //   b) Use the creator as mint authority initially, create metadata,
  //      then transfer authority to auction PDA before create_auction
  //
  // Going with (b): creator is initial mint authority → create metadata →
  // transfer authority to auction PDA → create_auction verifies it.

  // Override: set creator as initial mint authority
  const initMintDataWithCreator = Buffer.alloc(67);
  initMintDataWithCreator.writeUInt8(0, 0);
  initMintDataWithCreator.writeUInt8(TOKEN_DECIMALS, 1);
  creator.toBuffer().copy(initMintDataWithCreator, 2); // creator as temp authority
  initMintDataWithCreator.writeUInt8(0, 34);

  const initMintWithCreatorIx = new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: RENT_SYSVAR, isSigner: false, isWritable: false },
    ],
    data: initMintDataWithCreator,
  });

  // Create metadata (creator signs as mint authority)
  const createMetadataIx = buildCreateMetadataIx(
    metadataPDA,
    mint,
    creator,      // mint authority (temporary)
    creator,      // payer
    creator,      // update authority
    tokenName ?? ticker,  // name
    ticker,               // symbol
    metadataUri ?? "",     // URI to JSON metadata
  );

  // Transfer mint authority from creator to auction PDA
  // SPL Token SetAuthority instruction (index 6)
  // Layout: [6(u8), authorityType(u8), newAuthorityOption(u8), newAuthority(32)]
  const setAuthorityData = Buffer.alloc(35);
  setAuthorityData.writeUInt8(6, 0);  // instruction: SetAuthority
  setAuthorityData.writeUInt8(0, 1);  // AuthorityType::MintTokens = 0
  setAuthorityData.writeUInt8(1, 2);  // Some(newAuthority)
  auctionPDA.toBuffer().copy(setAuthorityData, 3);

  const setAuthorityIx = new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: creator, isSigner: true, isWritable: false },
    ],
    data: setAuthorityData,
  });

  // --- batch_auction::create_auction ---
  const createAuctionData = Buffer.concat([
    await anchorDiscriminator("create_auction"),
    encodeString(ticker),
    encodeU64(rawSupply),
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

  // --- stake_manager::deposit_stake ---
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

  const tx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 800_000 }))
    .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }))
    .add(createMintAccountIx)
    .add(initMintWithCreatorIx)
    .add(createMetadataIx)
    .add(setAuthorityIx)
    .add(createAuctionIx)
    .add(depositStakeIx);
  return tx;
}

// ---------------------------------------------------------------------------
// 2. Commit SOL
// ---------------------------------------------------------------------------

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
