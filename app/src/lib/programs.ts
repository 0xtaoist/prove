import { Connection, PublicKey } from "@solana/web3.js";

// ---------------------------------------------------------------------------
// Program IDs – read from env with fallback placeholders
// ---------------------------------------------------------------------------

export const BATCH_AUCTION_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_BATCH_AUCTION_PROGRAM_ID ??
    "PRVEauct1on111111111111111111111111111111111",
);

export const PROVE_AMM_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROVE_AMM_PROGRAM_ID ??
    "PRVEamm11111111111111111111111111111111111111",
);

// ---------------------------------------------------------------------------
// Connection helper
// ---------------------------------------------------------------------------

let _connection: Connection | null = null;

export function getConnection(): Connection {
  if (!_connection) {
    const rpcUrl =
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
      "https://api.devnet.solana.com";
    _connection = new Connection(rpcUrl, "confirmed");
  }
  return _connection;
}

// ---------------------------------------------------------------------------
// System program constants
// ---------------------------------------------------------------------------

export const SYSTEM_PROGRAM_ID = new PublicKey(
  "11111111111111111111111111111111",
);

export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);

export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

export const RENT_SYSVAR = new PublicKey(
  "SysvarRent111111111111111111111111111111111",
);

// ---------------------------------------------------------------------------
// PDA derivation helpers
// ---------------------------------------------------------------------------

export function getAuctionPDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("auction"), mint.toBuffer()],
    BATCH_AUCTION_PROGRAM_ID,
  );
}

export function getCommitmentPDA(
  mint: PublicKey,
  wallet: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("commitment"), mint.toBuffer(), wallet.toBuffer()],
    BATCH_AUCTION_PROGRAM_ID,
  );
}

export function getPoolPDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), mint.toBuffer()],
    PROVE_AMM_PROGRAM_ID,
  );
}

export function getStakePDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stake"), mint.toBuffer()],
    BATCH_AUCTION_PROGRAM_ID,
  );
}

export function getTickerPDA(ticker: string): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("ticker"), Buffer.from(ticker)],
    BATCH_AUCTION_PROGRAM_ID,
  );
}

export function getFeeConfigPDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("fee_config"), mint.toBuffer()],
    PROVE_AMM_PROGRAM_ID,
  );
}

// ---------------------------------------------------------------------------
// Associated token address helper
// ---------------------------------------------------------------------------

export function getAssociatedTokenAddress(
  mint: PublicKey,
  owner: PublicKey,
): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
}
