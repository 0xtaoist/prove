# PROVE Protocol — PR 2 Handoff

Branch: `claude/analyze-protocol-contracts-YBVjd`
Last commit: see `git log --oneline -7`

## What happened in PR 1

A full security audit + hardening pass across the PROVE protocol's Solana
programs. The codebase went from 5 programs to 3 deployable programs
(prove_amm and ticker_registry archived) with every critical vulnerability
patched.

### Programs shipped (3 on-chain)

| Program | File | Purpose |
|---|---|---|
| `batch_auction` | `programs/batch-auction/src/lib.rs` | Token launch auctions: 5-min batch, 50-wallet minimum, 10 SOL minimum |
| `stake_manager` | `programs/stake-manager/src/lib.rs` | Creator 2 SOL stake escrow, 72h milestone evaluation, survivor pool |
| `fee_router` | `programs/fee-router/src/lib.rs` | Raydium LP NFT custody, fee collection + 80/20 split, migration hatch |

### Architecture note: client-side transaction bundling

`batch_auction::create_auction` does NOT CPI into `stake_manager`.
Instead, the backend bundles both instructions in a single transaction:

```
Transaction:
  Instruction 1: batch_auction::create_auction(ticker, total_supply)
  Instruction 2: stake_manager::deposit_stake(mint)
```

Same atomicity guarantee — if either fails, both revert. This pattern
saves ~100 KB in batch_auction's binary (~2-3 SOL deployment rent) by
avoiding the stake_manager crate import.

**The backend MUST always bundle these together.** A create_auction
without a deposit_stake leaves an auction live with no creator stake.

### Programs archived (not deployed)

| Program | Location | Why |
|---|---|---|
| `prove_amm` | `archive/prove-amm/` | Deprecated. All trading on Raydium. |
| `ticker_registry` | `archive/ticker-registry/` | Moved off-chain. Backend DB enforces ticker uniqueness. |

### Critical bugs fixed

1. **`stake_manager::evaluate_milestone` trusted caller-supplied holder count.**
   Anyone could lie about holder numbers and steal stakes. Now locked behind
   `oracle_authority` signer with a single `milestone_passed: bool`.

2. **`batch_auction::claim_tokens` unreachable after pool creation.**
   State flip to `Trading` permanently locked late claimers out. Now accepts
   both `Succeeded` and `Trading`.

3. **`batch_auction::set_pool_id` was permissionless.** Anyone could front-run
   with a junk pool ID. Now locked behind `crank_authority`.

4. **`fee_router::claim_and_split` trusted caller-supplied fee amounts.**
   Now reads actual PDA lamport balance.

5. **No rent-exempt floor on lamport withdrawals.** Refund waves could
   corrupt auction PDAs. Added `transfer_lamports_with_floor` helper.

6. **Duplicate 2 SOL stake** in both batch_auction and stake_manager.
   Deleted batch_auction's version. Single source of truth in stake_manager.

### Auth model

Every program has three roles with two-step (propose → accept) rotation:

| Role | Purpose | Instructions gated |
|---|---|---|
| `authority` | Admin: parameter changes, emergency pause, role rotation | `emergency_pause/unpause`, `update_split`, `propose_*_authority`, `set_recovery_destination` |
| `crank_authority` | Backend service: lifecycle operations | `set_pool_id`, `forfeit_stake_for_failed_auction`, `claim_and_split`, `register_pool`, `emergency_drain_pool` |
| `oracle_authority` | Backend signer: milestone attestations (stake_manager only) | `evaluate_milestone` |

All three default to the deploy key on init. User will rotate them to
dedicated backend keys later.

### Permissionless instructions (by design)

These stay open so users can self-serve even if the backend is down:
- `finalize_auction` — pure on-chain logic, no off-chain trust
- `commit_sol` — user deposits SOL during gathering
- `claim_tokens` — user claims tokens after auction succeeds
- `refund` — user gets SOL back after auction fails
- `emergency_refund_commitment` — user pulls SOL during emergency pause
- `emergency_withdraw_stake` — creator pulls stake during emergency pause

### Events

Anchor `#[event]` structs emitted on every state-changing instruction.
Indexer should subscribe to these for monitoring/alerting.

### Deploy cost optimization

- Release profile: `opt-level = "z"`, `lto = "fat"`, `strip = true`
  (workspace Cargo.toml already configured)
- Use `--max-len` flag on `solana program deploy` for tight allocation
- Estimated mainnet cost with both: **~5-7 SOL** for all 3 programs

---

## User-confirmed product requirements

These were discussed and confirmed by the project owner during the PR 1
session. The next agent should treat these as locked-in decisions.

### Launch flow
1. Creator pays 2 SOL to deploy (stake_manager::deposit_stake, bundled
   client-side in the same transaction as create_auction)
2. 5-minute batch auction, uniform price, requires 50 unique wallets + 10 SOL
3. If auction fails: 2 SOL forfeited to survivor pool, never refunded
4. If auction succeeds: off-chain crank creates Raydium CLMM pool (1% fee),
   then calls set_pool_id to record it and flip state to Trading
5. 72 hours after launch, backend oracle evaluates milestone:
   - 100 unique holders AND $100k USD equivalent market cap → stake returned
   - Otherwise → stake forfeited to survivor pool
6. The oracle signs a single `milestone_passed: bool`. The contract does
   NOT check holder count or mcap on-chain. Backend computes everything
   off-chain (holder count from indexer, mcap from pool price × supply ×
   SOL/USD rate from whatever source).

### Fee model
- 1% flat fee on all Raydium swaps (set by pool fee tier at creation)
- Split: 80% to token creator, 20% to protocol treasury
- Split stored as real basis points (8000/2000 out of 10000)
- Hard floor: creator share can never go below 50% (5000 bps)
- No sniper tax. No dynamic fees. 1% flat, always.

### Survivor pool
- All forfeited 2 SOL stakes (from failed auctions + failed milestones)
  go into the survivor pool
- Distribution: the winning token for a time period is determined by
  quest completions (off-chain scoring: Twitter mentions, holder count, etc.)
- Mechanic: protocol uses 50% of the pool SOL to buy the winning token
  on Raydium, then adds both sides (tokens + remaining 50% SOL) as LP
  to the Raydium pool
- LP position NFT goes to the fee_router PDA
- This is the "auto-LP" pattern. Full implementation deferred to PR 2.

### Ticker uniqueness
- Enforced off-chain by backend database (unique index on tickers table)
- NOT enforced on-chain. Ticker string stored on Auction account for display.

### Axiom / sniper blocking
- Not needed on-chain. During the 5-min auction, trading doesn't exist yet.
  After pool creation, all platforms (Axiom, Jupiter, etc.) can trade freely.

### Emergency model
- Admin can pause each program independently
- During pause: users can self-refund commitments, creators can pull stakes
- Admin can sweep the survivor pool to a destination during pause
- Admin can recover LP NFTs to a dedicated `recovery_destination` during pause

---

## PR 2 scope (what's left to build)

### Must-do

1. **Raydium CLMM CPI integration** in `fee_router`
   - Add new instructions: `claim_fees_from_raydium` and `unwind_liquidity`.
     These were stripped from PR1 to reduce binary size (they were stubs).
     PR2 adds them with real `invoke_signed` CPI to Raydium CLMM
     `collect_fees` and `decrease_liquidity` respectively.
   - The `pool_fee_account` PDA is the position-owner signer.
   - Account structures are complex (pool state, position, tick arrays,
     token vaults, etc.). Recommend importing Raydium CLMM crate or
     manually encoding instruction data via `invoke_signed`.

2. **Survivor pool distribution** in `stake_manager`
   - Add a new `distribute_survivor_pool` instruction (stripped from PR1).
   - Needs: quest oracle integration (backend signs the winner mint +
     score), Raydium CPI to swap SOL → tokens, Raydium CPI to
     add liquidity (both sides), route the LP NFT to the fee_router PDA.
   - Consider moving this entirely off-chain (admin calls
     `emergency_sweep_survivor_pool` to extract SOL, backend wallet
     performs the swap + LP deposit as normal transactions).
     Simpler and avoids complex Raydium CPI.

3. **Indexer updates**
   - Account layouts changed across the board. The indexer (services/indexer)
     needs updated IDLs (run `anchor build` then copy IDL JSON).
   - The `forfeit_pool` → `survivor_pool` rename breaks any existing decode.
   - New events need subscriptions for monitoring/alerting.

4. **TypeScript SDK / test updates**
   - `tests/prove.test.ts` almost certainly broken by the layout changes.
   - Need to regenerate Anchor client bindings (`anchor build` → `target/types/`).
   - CreateAuction instruction now requires stake_manager CPI accounts
     (stake_vault, stake, stake_manager_program) in addition to the
     existing accounts.

### Nice-to-have (items 5-6 already done in PR1)

5. ~~Deploy script updates~~ — DONE. `--max-len` added, ticker_registry removed.

6. ~~Frontend updates~~ — DONE. Transaction builders updated, dead refs removed,
   bps constants updated to 10000 scale.

7. **Init script updates** (`scripts/init-programs.ts`)
   - `initialize_config` for batch_auction: new account layout
     (4 pubkeys instead of old layout).
   - `initialize_vault` for stake_manager: new layout (6 pubkeys for
     authority/crank/oracle + pending).
   - `initialize_vault` for fee_router: new layout, takes
     `protocol_treasury` pubkey, no longer takes `creator_bps/protocol_bps`
     as args (hardcoded to 8000/2000).

---

## Key files

| Path | What's there |
|---|---|
| `programs/batch-auction/src/lib.rs` | Core auction: create, commit, finalize, claim, refund |
| `programs/stake-manager/src/lib.rs` | 2 SOL stake: deposit, evaluate_milestone, forfeit, survivor pool |
| `programs/fee-router/src/lib.rs` | Fee routing: register_pool, claim_and_split, recover_lp_nft |
| `archive/prove-amm/` | Dead code, do not touch |
| `archive/ticker-registry/` | Dead code, reference only |
| `Cargo.toml` | Workspace: 3 members + release profile optimizations |
| `Anchor.toml` | 3 programs, localnet + devnet configs |
| `scripts/setup-railway.sh` | Railway env vars (3 programs, no ticker/amm) |
| `services/indexer/src/listener.ts` | Needs IDL updates for new layouts |
| `tests/prove.test.ts` | Needs rewrite for new account structures |

---

## Traps for the next agent

1. **Don't re-add ticker_registry.** Owner confirmed it's dead. Backend DB
   with a unique index on tickers table replaces it. If you add CPI back,
   deploy cost goes up 3-4 SOL for zero security benefit.

2. **Don't make finalize_auction backend-only.** It's permissionless on
   purpose. If the backend is down, users need to be able to crank it
   themselves so they can refund failed auctions.

3. **Raydium CPI instructions were stripped to save binary size.** PR2
   needs to add `claim_fees_from_raydium`, `unwind_liquidity` (fee_router)
   and `distribute_survivor_pool` (stake_manager) as new instructions via
   program upgrade. Until then, fees are claimed off-chain by the crank
   and the survivor pool is accessible via `emergency_sweep_survivor_pool`.

4. **`uniform_price` on Auction is unused on-chain but consumed off-chain.**
   `claim_tokens` does its own math, so the field isn't read by any
   instruction. However, `services/quest-verifier/src/verifier.ts`
   (checkPriceAboveBatch) reads it to score the `price_above_batch`
   quest, so it cannot be removed without also rewriting that quest.

5. **`commit_sol` blocks during emergency pause.** This was added in PR 1
   so users can't be tricked into depositing into a broken auction.

6. **Two-step authority transfer must be tested carefully.** If you
   `propose_authority(X)` and X never calls `accept_authority()`, the
   pending role stays set forever. Only the current authority can propose
   again to overwrite it with a different key.

7. **`recovery_destination` defaults to admin on init.** The owner wants
   this pointed at a dedicated treasury wallet. They haven't provided the
   pubkey yet. When they do, call `set_recovery_destination(new_pubkey)`.

8. **Backend needs two separate signing keys.** `crank_authority` (for
   lifecycle operations like set_pool_id, claim_and_split) and
   `oracle_authority` (for milestone attestations). These can be the same
   key operationally but the contract stores them separately so they can
   be rotated independently if one is compromised.

9. **All program IDs are placeholders.** `BAuc111...`, `Stak111...`,
   `FeeR111...` — replace with real deployed IDs before mainnet. Update
   both `Anchor.toml` and the `declare_id!()` in each `lib.rs`.
