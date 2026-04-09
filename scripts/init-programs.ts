/**
 * init-programs.ts — Initialize on-chain config accounts for PROVE programs.
 *
 * Reads program IDs from environment variables or .env.programs, then calls:
 *   - BatchAuction.initialize_config
 *   - StakeManager.initialize_vault
 *
 * Ticker uniqueness is handled off-chain by the backend database.
 *
 * Usage:
 *   npx ts-node scripts/init-programs.ts
 *
 * Environment:
 *   BATCH_AUCTION_PROGRAM_ID, STAKE_MANAGER_PROGRAM_ID
 *   (or place them in .env.programs at the repo root)
 */

import * as fs from "fs";
import * as path from "path";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, clusterApiUrl } from "@solana/web3.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Load key=value pairs from .env.programs into process.env (no overwrite). */
function loadEnvPrograms(): void {
  const envPath = path.resolve(__dirname, "..", ".env.programs");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (key && !process.env[key]) {
      process.env[key] = rest.join("=");
    }
  }
}

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    console.error(`ERROR: Missing environment variable ${name}`);
    process.exit(1);
  }
  return val;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  loadEnvPrograms();

  const batchAuctionId = new PublicKey(requireEnv("BATCH_AUCTION_PROGRAM_ID"));
  const stakeManagerId = new PublicKey(requireEnv("STAKE_MANAGER_PROGRAM_ID"));
  const feeRouterId = new PublicKey(requireEnv("FEE_ROUTER_PROGRAM_ID"));

  // Connect to devnet
  const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl("devnet");
  const connection = new Connection(rpcUrl, "confirmed");
  console.log(`Connected to ${rpcUrl}`);

  // Load wallet from default Solana keypair
  const walletPath =
    process.env.ANCHOR_WALLET ||
    path.join(process.env.HOME || "~", ".config", "solana", "id.json");
  const raw = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
  const payer = Keypair.fromSecretKey(Uint8Array.from(raw));
  const wallet = new anchor.Wallet(payer);

  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  console.log(`Authority: ${payer.publicKey.toBase58()}\n`);

  // ── 1. BatchAuction — initialize_config ─────────────────────────────
  try {
    console.log("Initializing BatchAuction config...");
    const batchIdl = loadIdl("batch_auction");
    const batchProgram = new anchor.Program(batchIdl, batchAuctionId, provider);

    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      batchAuctionId
    );

    const tx = await batchProgram.methods
      .initializeConfig()
      .accounts({
        config: configPda,
        authority: payer.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log(`  BatchAuction config initialized. tx: ${tx}`);
  } catch (err: any) {
    handleInitError("BatchAuction", err);
  }

  // ── 2. StakeManager — initialize_vault ──────────────────────────────
  try {
    console.log("Initializing StakeManager vault...");
    const stakeIdl = loadIdl("stake_manager");
    const stakeProgram = new anchor.Program(stakeIdl, stakeManagerId, provider);

    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("stake_vault")],
      stakeManagerId
    );

    const tx = await stakeProgram.methods
      .initializeVault()
      .accounts({
        stakeVault: vaultPda,
        authority: payer.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log(`  StakeManager vault initialized. tx: ${tx}`);
  } catch (err: any) {
    handleInitError("StakeManager", err);
  }

  // ── 3. FeeRouter — initialize_vault ─────────────────────────────────
  try {
    console.log("Initializing FeeRouter vault...");
    const feeIdl = loadIdl("fee_router");
    const feeProgram = new anchor.Program(feeIdl, feeRouterId, provider);

    const [feeVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("fee_vault")],
      feeRouterId
    );

    // protocol_treasury defaults to the deployer wallet. Rotate later
    // via the admin key once a dedicated treasury address is ready.
    const tx = await feeProgram.methods
      .initializeVault(payer.publicKey)
      .accounts({
        authority: payer.publicKey,
        feeVault: feeVaultPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log(`  FeeRouter vault initialized. tx: ${tx}`);
  } catch (err: any) {
    handleInitError("FeeRouter", err);
  }

  console.log("\nAll program initializations complete.");
}

// ---------------------------------------------------------------------------
// IDL loader
// ---------------------------------------------------------------------------

function loadIdl(programName: string): any {
  const idlPath = path.resolve(
    __dirname,
    "..",
    "target",
    "idl",
    `${programName}.json`
  );
  if (!fs.existsSync(idlPath)) {
    console.error(`ERROR: IDL not found at ${idlPath}. Run 'anchor build' first.`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(idlPath, "utf-8"));
}

function handleInitError(name: string, err: any): void {
  const msg = err?.message || String(err);
  if (msg.includes("already in use") || msg.includes("0x0")) {
    console.log(`  ${name} already initialized (account exists). Skipping.`);
  } else {
    console.error(`  ERROR initializing ${name}: ${msg}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
