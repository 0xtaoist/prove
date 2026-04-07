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

  // These will be set once programs are deployed and IDLs generated
  // For now, test structure is documented
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
        [Buffer.from("auction_config")],
        // program.programId - uncomment when IDL available
        SystemProgram.programId // placeholder
      );
      // TODO: Call initialize_config with admin signer
      // Verify: min_wallets=50, min_sol=10 SOL, auction_duration=300, deployer_stake=2 SOL
      assert.ok(configPDA, "Config PDA derived");
    });

    it("rejects re-initialization", async () => {
      // TODO: Call initialize_config again, expect AlreadyInitialized error
    });
  });

  describe("create_auction", () => {
    it("creates an auction with ticker and 2 SOL stake", async () => {
      // TODO:
      // 1. Creator calls create_auction(ticker="TEST", total_supply=1_000_000)
      // 2. Verify 2 SOL transferred from creator to stake escrow
      // 3. Verify Auction PDA created with state=Gathering
      // 4. Verify ticker registered in TickerRegistry
      // 5. Verify end_time = start_time + 300
    });

    it("rejects duplicate ticker", async () => {
      // TODO: Second create_auction with same ticker should fail
    });

    it("rejects invalid ticker (lowercase, too long)", async () => {
      // TODO: Tickers must be uppercase A-Z0-9, max 10 chars
    });
  });

  describe("commit_sol", () => {
    it("allows participants to commit SOL during gathering", async () => {
      // TODO: Each participant commits 0.5 SOL
      // Verify: Commitment PDA created, participant_count incremented, total_sol updated
    });

    it("rejects duplicate commitment from same wallet", async () => {
      // TODO: Same wallet commits again, expect error
    });

    it("rejects commitment after auction ends", async () => {
      // TODO: Fast-forward time past end_time, expect error
    });
  });

  describe("finalize_auction - success", () => {
    it("succeeds when thresholds met", async () => {
      // TODO: With 50+ wallets and 10+ SOL committed
      // Verify: state -> Succeeded, uniform_price calculated
    });

    it("emits event for off-chain Raydium pool creation", async () => {
      // Pool creation happens off-chain via scripts/create-raydium-pool.ts
      // After finalization, a permissionless crank creates the Raydium CPMM pool
      // and calls set_pool_id to record the pool address on-chain.
    });
  });

  describe("claim_tokens", () => {
    it("distributes tokens proportionally", async () => {
      // TODO: Each participant claims tokens
      // tokens = commitment_sol * total_supply / total_sol
      // Verify: tokens transferred, commitment marked claimed
    });

    it("rejects double claim", async () => {
      // TODO: Claim again, expect AlreadyClaimed error
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
      // TODO: Try refund on succeeded auction, expect error
    });
  });
});

// ─── FeeRouter Tests ──────────────────────────────────────

describe("FeeRouter", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  describe("initialize_fee_config", () => {
    it("creates fee config with correct split", async () => {
      // TODO: Initialize with creator_bps=80, protocol_bps=20
      // Verify: FeeConfig PDA created with correct values
    });

    it("rejects invalid bps (not summing to 100)", async () => {
      // TODO: creator_bps=60, protocol_bps=20 -> should fail
    });
  });

  describe("collect_fees", () => {
    it("splits fees correctly (0.8% creator, 0.2% protocol)", async () => {
      // TODO: Collect 1 SOL in fees
      // Verify: 0.8 SOL to creator escrow, 0.2 SOL to protocol treasury
    });
  });

  describe("withdraw_creator_fees", () => {
    it("allows creator to withdraw accumulated fees", async () => {
      // TODO: Creator withdraws
      // Verify: SOL transferred to creator wallet, withdrawn counter updated
    });

    it("rejects non-creator withdrawal", async () => {
      // TODO: Random wallet tries to withdraw, expect Unauthorized
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

  describe("evaluate_milestone - returned", () => {
    it("returns stake when 100+ holders", async () => {
      // TODO: Fast-forward past deadline, evaluate with holder_count=150
      // Verify: state -> Returned, 2 SOL sent back to creator
    });

    it("rejects evaluation before deadline", async () => {
      // TODO: Try to evaluate before deadline, expect DeadlineNotReached
    });
  });

  describe("evaluate_milestone - forfeited", () => {
    it("forfeits stake when < 100 holders", async () => {
      // TODO: Evaluate with holder_count=30
      // Verify: state -> Forfeited, SOL stays in vault
    });

    it("rejects double evaluation", async () => {
      // TODO: Evaluate again, expect AlreadyEvaluated
    });
  });

  describe("distribute_forfeit_pool", () => {
    it("distributes forfeited SOL pro-rata to successful tokens", async () => {
      // TODO: Pass qualifying mints with holder counts
      // Verify: pro-rata distribution to creators
    });
  });
});

// ─── TickerRegistry Tests ─────────────────────────────────

describe("TickerRegistry", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  describe("initialize_registry", () => {
    it("creates registry config", async () => {
      // TODO: Initialize, verify max_ticker_length=10, ttl=7 days
    });
  });

  describe("register_ticker", () => {
    it("registers a valid uppercase ticker", async () => {
      // TODO: Register "PROVE", verify TickerEntry PDA
    });

    it("rejects lowercase ticker", async () => {
      // TODO: Try "prove", expect InvalidTicker
    });

    it("rejects ticker > 10 chars", async () => {
      // TODO: Try "TOOLONGNAME1", expect InvalidTicker
    });

    it("rejects duplicate active ticker", async () => {
      // TODO: Register "PROVE" again, expect TickerAlreadyRegistered
    });
  });

  describe("deactivate_ticker", () => {
    it("deactivates a ticker", async () => {
      // TODO: Deactivate "PROVE"
      // Verify: active=false, deactivated_at set
    });

    it("rejects deactivation of already-inactive ticker", async () => {
      // TODO: Deactivate again, expect AlreadyDeactivated
    });
  });

  describe("register_ticker_reuse", () => {
    it("allows re-registration after TTL expires", async () => {
      // TODO: Fast-forward past 7-day TTL
      // Register "PROVE" again with new mint, should succeed
    });

    it("rejects reuse before TTL expires", async () => {
      // TODO: Try immediately after deactivation, expect TickerTTLNotExpired
    });
  });
});

// ─── Integration: Full Lifecycle ──────────────────────────

describe("Full Lifecycle Integration", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  it("complete flow: create -> commit -> finalize -> claim -> pool creation", async () => {
    // TODO: End-to-end test
    // 1. Admin initializes all configs
    // 2. Creator creates auction with ticker "LIFECYCLE"
    // 3. 50+ participants commit SOL
    // 4. Finalize auction (success)
    // 5. Participants claim tokens
    // 6. Off-chain crank creates Raydium CPMM pool (via scripts/create-raydium-pool.ts)
    // 7. Call set_pool_id to record the Raydium pool address on-chain
    // 8. Verify auction state transitions to Trading
    // 9. Users trade on Jupiter/Raydium (no on-chain swap through our program)
    // 10. Evaluate milestone (pass)
    // 11. Verify stake returned
  });
});
