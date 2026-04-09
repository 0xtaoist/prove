import { Connection, PublicKey } from "@solana/web3.js";

// ---------------------------------------------------------------------------
// Program IDs – read from env with fallback placeholders
// ---------------------------------------------------------------------------

export const BATCH_AUCTION_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_BATCH_AUCTION_PROGRAM_ID ??
    "BAuc111111111111111111111111111111111111111",
);

export const STAKE_MANAGER_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_STAKE_MANAGER_PROGRAM_ID ??
    "Stak111111111111111111111111111111111111111",
);

export const FEE_ROUTER_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_FEE_ROUTER_PROGRAM_ID ??
    "FeeR111111111111111111111111111111111111111",
);

// Raydium CLMM for concentrated liquidity pool creation
export const RAYDIUM_CLMM_PROGRAM_ID = new PublicKey(
  "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
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

export function getConfigPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    BATCH_AUCTION_PROGRAM_ID,
  );
}

export function getVaultPDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), mint.toBuffer()],
    BATCH_AUCTION_PROGRAM_ID,
  );
}

export function getStakePDA(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stake"), mint.toBuffer()],
    STAKE_MANAGER_PROGRAM_ID,
  );
}

export function getStakeVaultPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stake_vault")],
    STAKE_MANAGER_PROGRAM_ID,
  );
}

// ---------------------------------------------------------------------------
// Raydium swap URL helper
// ---------------------------------------------------------------------------

/**
 * Returns a Jupiter aggregator URL for swapping the given token.
 * Jupiter routes through Raydium CPMM pools automatically.
 */
export function getRaydiumSwapUrl(mint: string): string {
  return `https://jup.ag/swap/SOL-${mint}`;
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
