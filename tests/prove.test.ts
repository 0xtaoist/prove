import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { assert } from "chai";

// ─── Helpers ──────────────────────────────────────────────

async function airdrop(
  connection: anchor.web3.Connection,
  pubkey: PublicKey,
  sol: number
) {
  const sig = await connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, "confirmed");
}

function findPDA(seeds: Buffer[], programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(seeds, programId);
}

// ─── BatchAuction Tests ───────────────────────────────────

describe("BatchAuction", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // These will be set once programs are deployed and IDLs generated.
  // For now, test structure is documented.
  const admin = Keypair.generate();
  const creator = Keypair.generate();
  const participants = Array.from({ length: 5 }, () => Keypair.generate());
  let mint: PublicKey;

  before(async () => {
    await airdrop(provider.connection, admin.publicKey, 10);
    await airdrop(provider.connection, creator.publicKey, 10);
    for (const p of participants) {
      await airdrop(provider.connection, p.publicKey, 5);
    }
  });

  describe("initialize_config", () => {
    it("creates global auction config", async () => {
      const [configPDA] = findPDA(
        [Buffer.from("config")],
        // program.programId — uncomment when IDL available
        SystemProgram.programId // placeholder
      );
      // TODO: Call initialize_config with admin signer
      // Verify: min_wallets=50, min_sol=10 SOL, auction_duration=300
      assert.ok(configPDA, "Config PDA derived");
    });

    it("rejects re-initialization", async () => {
      // TODO: Call initialize_config again, expect AlreadyInitialized error
    });
  });

  describe("update_config", () => {
    it("allows admin to update min_wallets, min_sol, auction_duration", async () => {
      // TODO: Call update_config(new_min_wallets=100, null, null)
      // Verify: min_wallets updated to 100
    });

    it("rejects zero values", async () => {
      // TODO: Call update_config(new_min_wallets=0, null, null), expect InvalidConfigValue
    });

    it("rejects non-admin caller", async () => {
      // TODO: Non-admin calls update_config, expect Unauthorized
    });
  });

  describe("create_auction", () => {
    it("creates an auction with ticker and 2 SOL stake via CPI", async () => {
      // TODO:
      // 1. Creator calls create_auction(ticker="TEST", total_supply=1_000_000)
      //    with stake_manager CPI accounts (stake_vault, stake, mint)
      // 2. Verify 2 SOL transferred from creator to stake_vault
      // 3. Verify Auction PDA created with state=Gathering
      // 4. Verify end_time = start_time + auction_duration
      // 5. Verify total_supply minted into token_vault
    });

    it("rejects creation while emergency paused", async () => {
      // TODO: Pause, then try create_auction, expect Paused error
    });

    it("rejects ticker > 10 chars", async () => {
      // TODO: create_auction with ticker="TOOLONGNAME1" should fail
    });
  });

  describe("commit_sol", () => {
    it("allows participants to commit SOL during gathering", async () => {
      // TODO: Each participant commits 0.5 SOL
      // Verify: Commitment PDA created, participant_count incremented, total_sol updated
    });

    it("rejects duplicate commitment from same wallet", async () => {
      // TODO: Same wallet commits again, expect PDA init error (already exists)
    });

    it("rejects commitment after auction ends", async () => {
      // TODO: Fast-forward time past end_time, expect AuctionEnded error
    });

    it("rejects commitment while emergency paused", async () => {
      // TODO: Pause, commit, expect Paused error
    });
  });

  describe("finalize_auction - success", () => {
    it("succeeds when thresholds met (permissionless)", async () => {
      // TODO: With 50+ wallets and 10+ SOL committed
      // Verify: state -> Succeeded, uniform_price calculated
    });
  });

  describe("claim_tokens", () => {
    it("distributes only buyer_bps share of supply", async () => {
      // TODO: Each participant claims tokens
      // buyer_pool = total_supply * buyer_bps / 10000   (65% of supply)
      // tokens_owed = commitment_sol * buyer_pool / total_sol
      // Verify: sum of all claims = buyer_pool (not total_supply)
      // Verify: 35% of supply stays in token_vault for pool seeding
    });

    it("works in both Succeeded and Trading states", async () => {
      // TODO: After seed_pool + set_pool_id (flips to Trading), claim should succeed
    });

    it("rejects double claim", async () => {
      // TODO: Claim again, expect AlreadyClaimed error
    });
  });

  describe("seed_pool", () => {
    it("crank withdraws (10000 - buyer_bps) of supply + all SOL", async () => {
      // TODO:
      // 1. Finalize auction as Succeeded
      // 2. Crank calls seed_pool with crank_token_account + crank_sol_destination
      // 3. Verify: pool_tokens = total_supply * 3500 / 10000 transferred to crank_token_account
      // 4. Verify: auction PDA lamports drained to rent-exempt minimum
      // 5. Verify: all committed SOL received by crank_sol_destination
      // 6. Verify: auction.pool_seeded = true
    });

    it("rejects seed_pool twice", async () => {
      // TODO: Call seed_pool again, expect PoolAlreadySeeded
    });

    it("rejects seed_pool from non-crank", async () => {
      // TODO: Random signer, expect Unauthorized
    });

    it("rejects set_pool_id before seed_pool", async () => {
      // TODO: Call set_pool_id on a Succeeded auction that hasn't been seeded,
      // expect PoolNotSeeded
    });
  });

  describe("finalize_auction - failure", () => {
    it("fails when thresholds not met", async () => {
      // TODO: Create new auction with only 2 participants
      // Verify: state -> Failed
    });
  });

  describe("refund", () => {
    it("returns SOL after failed auction", async () => {
      // TODO: Participants call refund
      // Verify: SOL returned, Commitment PDA closed
    });

    it("rejects refund on successful auction", async () => {
      // TODO: Try refund on succeeded auction, expect AuctionNotFailed error
    });
  });

  describe("emergency_drain_auction", () => {
    it("admin can drain stuck SOL when paused", async () => {
      // TODO: Pause, call emergency_drain_auction with admin + destination
      // Verify: SOL drained to destination, auction PDA at rent-exempt minimum
    });

    it("rejects when not paused", async () => {
      // TODO: Call without pausing first, expect NotPaused error
    });

    it("rejects non-admin caller", async () => {
      // TODO: Non-admin calls, expect Unauthorized error
    });
  });
});

// ─── FeeRouter Tests ──────────────────────────────────────

describe("FeeRouter", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  describe("initialize_vault", () => {
    it("creates fee vault with correct 80/20 split", async () => {
      // TODO: Initialize with protocol_treasury pubkey
      // Verify: FeeVault PDA created with creator_bps=8000, protocol_bps=2000
    });
  });

  describe("update_split", () => {
    it("allows admin to adjust split within floor", async () => {
      // TODO: update_split(7000, 3000) should succeed (creator >= 5000)
    });

    it("rejects creator share below 50% floor", async () => {
      // TODO: update_split(4999, 5001) should fail with CreatorShareBelowFloor
    });

    it("rejects splits not summing to 10000", async () => {
      // TODO: update_split(6000, 3000) should fail with InvalidSplit
    });
  });

  describe("update_treasury", () => {
    it("allows admin to change protocol treasury", async () => {
      // TODO: update_treasury(new_pubkey)
      // Verify: protocol_treasury updated
    });

    it("rejects zero/default pubkey", async () => {
      // TODO: update_treasury(Pubkey::default()) should fail with InvalidTreasury
    });
  });

  describe("claim_and_split", () => {
    it("splits drainable SOL 80/20 between creator and treasury", async () => {
      // TODO: Register pool, deposit SOL to pool_fee_account PDA,
      // call claim_and_split
      // Verify: 80% to creator, 20% to protocol_treasury
    });
  });

  describe("recover_lp_nft", () => {
    it("transfers LP NFT to recovery destination when paused", async () => {
      // TODO: Pause, call recover_lp_nft
      // Verify: NFT transferred to recovery_destination's token account
    });

    it("rejects when not paused", async () => {
      // TODO: Call without pausing, expect NotPaused error
    });
  });
});

// ─── StakeManager Tests ───────────────────────────────────

describe("StakeManager", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  describe("initialize_vault", () => {
    it("creates global stake vault", async () => {
      // TODO: Initialize vault, verify PDA and zero counters
    });
  });

  describe("deposit_stake", () => {
    it("escrows 2 SOL from creator", async () => {
      // TODO: Deposit stake for a mint
      // Verify: Stake PDA with state=Escrowed, deadline=now+72h
      // Verify: 2 SOL transferred to vault
    });
  });

  describe("evaluate_milestone - oracle signed", () => {
    it("returns stake when oracle attests milestone_passed=true", async () => {
      // TODO: Fast-forward past deadline, call with oracle_authority signer
      // Verify: state -> Returned, 2 SOL sent back to creator
    });

    it("forfeits stake when oracle attests milestone_passed=false", async () => {
      // TODO: Evaluate with milestone_passed=false
      // Verify: state -> Forfeited, SOL stays in vault, total_survivor_pool updated
    });

    it("rejects non-oracle signer", async () => {
      // TODO: Random signer, expect Unauthorized
    });

    it("rejects evaluation before deadline", async () => {
      // TODO: Try to evaluate before deadline, expect DeadlineNotReached
    });

    it("rejects double evaluation", async () => {
      // TODO: Evaluate again, expect AlreadyEvaluated
    });
  });

  describe("forfeit_stake_for_failed_auction", () => {
    it("crank forfeits stake immediately for failed auctions", async () => {
      // TODO: Crank calls with crank_authority
      // Verify: state -> Forfeited, no deadline check
    });
  });

  describe("emergency_withdraw_stake", () => {
    it("creator pulls stake when paused", async () => {
      // TODO: Pause, creator calls emergency_withdraw_stake
      // Verify: 2 SOL returned, state -> EmergencyWithdrawn, Stake PDA closed
    });

    it("rejects when not paused", async () => {
      // TODO: Call without pausing, expect NotPaused
    });

    it("rejects already-withdrawn stake", async () => {
      // TODO: Withdraw twice, expect AlreadyWithdrawn
    });
  });

  describe("emergency_sweep_survivor_pool", () => {
    it("admin sweeps undistributed survivor pool when paused", async () => {
      // TODO: Pause, sweep to destination
      // Verify: Lamports moved, total_distributed updated
    });
  });
});

// ─── Integration: Full Lifecycle ──────────────────────────

describe("Full Lifecycle Integration", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  it("complete flow: create -> commit -> finalize -> claim -> pool creation", async () => {
    // TODO: End-to-end test
    // 1. Admin initializes all configs (batch_auction, stake_manager, fee_router)
    // 2. Creator creates auction with ticker "LIFECYCLE"
    //    - Automatically deposits 2 SOL stake via CPI to stake_manager
    // 3. 50+ participants commit SOL
    // 4. Finalize auction (success) — permissionless
    // 5. Participants claim tokens
    // 6. Off-chain crank creates Raydium CLMM pool (via scripts/create-raydium-pool.ts)
    // 7. Crank calls set_pool_id to record pool address, state -> Trading
    // 8. Users trade on Jupiter/Raydium (no on-chain swap through our programs)
    // 9. Crank calls claim_and_split to distribute fees 80/20
    // 10. After 72h, oracle evaluates milestone (pass)
    // 11. Verify stake returned to creator
  });
});
