// Raydium CLMM pool creation after successful batch auction
// Usage: tsx scripts/create-raydium-pool.ts <auction_mint>
//
// Fee Architecture:
// - Creates a Raydium CLMM pool with 1% fee tier
// - LP position NFT is transferred to the FeeRouter PDA (protocol-owned)
// - FeeRouter.register_pool is called to record the pool on-chain
// - All swap fees (from Raydium, Jupiter, any aggregator) accrue to the position
// - Permissionless crank periodically claims and splits: 80% creator / 20% protocol

import { Connection, PublicKey, Keypair } from "@solana/web3.js";

const RAYDIUM_CLMM_PROGRAM = new PublicKey("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`ERROR: Missing environment variable ${name}`);
    process.exit(1);
  }
  return value;
}

const FEE_ROUTER_PROGRAM = new PublicKey(requireEnv("FEE_ROUTER_PROGRAM_ID"));

async function createRaydiumPool(auctionMint: string) {
  console.log("Creating Raydium CLMM pool for auction:", auctionMint);

  // TODO: Implement Raydium CLMM SDK pool creation
  // 1. Read auction data from chain (batch price, SOL/token amounts)
  // 2. Calculate SOL/token amounts for LP (80% of auction SOL + tokens)
  // 3. Create Raydium CLMM pool with 1% fee tier
  //    - Use concentrated liquidity range around the batch price
  //    - This ensures high capital efficiency and fee capture
  // 4. Transfer the LP position NFT to the FeeRouter PDA
  //    - PDA derived from seeds [b"pool_fee", mint]
  //    - This makes the protocol the owner of the LP position
  // 5. Call FeeRouter.register_pool to record pool details on-chain
  //    - Params: mint, creator, raydium_pool_id, position_nft_mint
  //    - This enables the permissionless crank to claim and split fees
  // 6. Call set_pool_id on BatchAuction program
  // 7. Record pool in indexer DB

  console.log("Pool creation will use Raydium CLMM SDK with 1% fee tier");
  console.log("LP position NFT will be transferred to FeeRouter PDA");
  console.log("Fees will be claimed periodically: 80% creator / 20% protocol");
}

const mint = process.argv[2];
if (!mint) {
  console.error("Usage: tsx scripts/create-raydium-pool.ts <auction_mint>");
  process.exit(1);
}
createRaydiumPool(mint);
