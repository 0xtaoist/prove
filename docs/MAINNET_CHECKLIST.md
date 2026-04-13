# PROVE Protocol — Mainnet Launch Checklist

## Critical (MUST DO before deploy)

- [ ] **Replace placeholder program IDs** — `BAuc111...`, `Stak111...`, `FeeR111...` are placeholders.
  After deploying each program, update the real IDs in:
  - `Anchor.toml` (both `[programs.localnet]` and `[programs.devnet]` / add `[programs.mainnet]`)
  - `programs/batch-auction/src/lib.rs` → `declare_id!()`
  - `programs/stake-manager/src/lib.rs` → `declare_id!()`
  - `programs/fee-router/src/lib.rs` → `declare_id!()`
  - `.env` on Railway (all three `*_PROGRAM_ID` vars + `NEXT_PUBLIC_*` variants)
  - `app/.env.production` / Railway app service env vars

- [ ] **Set `SOLANA_NETWORK=mainnet`** in all Railway services

- [ ] **Set `SOLANA_RPC_URL`** to a mainnet Helius/Triton endpoint (not devnet)

- [ ] **Set `NEXT_PUBLIC_SOLANA_RPC_URL`** + `NEXT_PUBLIC_SOLANA_NETWORK=mainnet-beta` in the app service

- [ ] **Set `ANCHOR_WALLET`** to the absolute path of the crank keypair on the Railway service filesystem
  (fee-collector now fails fast if this is missing)

- [ ] **Set `PROTOCOL_VAULT_ADDRESS`** to the real protocol treasury wallet pubkey

- [ ] **Run `scripts/init-programs.ts`** against mainnet for all 3 programs:
  - `initialize_config` (batch_auction)
  - `initialize_vault` (stake_manager)
  - `initialize_vault` (fee_router) — pass the real `protocol_treasury` pubkey

- [ ] **Rotate authority keys** — deploy key should NOT remain as admin/crank/oracle:
  - `propose_authority` + `accept_authority` for each program
  - `propose_crank_authority` + `accept_crank_authority` for batch_auction + fee_router
  - `propose_oracle_authority` + `accept_oracle_authority` for stake_manager

- [ ] **Set `recovery_destination`** on fee_router to the dedicated treasury wallet
  (defaults to deploy key — call `set_recovery_destination(treasury_pubkey)`)

- [ ] **Set `APP_ORIGIN`** in indexer + quest-verifier to the production frontend URL

- [ ] **Set `PRIVY_APP_SECRET`** + `NEXT_PUBLIC_PRIVY_APP_ID` for production Privy app

- [ ] **Set `INTERNAL_API_KEY`** for indexer ↔ quest-verifier communication

- [ ] **Verify `DATABASE_URL`** uses SSL: append `?sslmode=require` if on Railway Postgres

- [ ] **Seed `ProtocolConfig` row** in the database:
  ```sql
  INSERT INTO "ProtocolConfig" ("creatorBps", "protocolBps", "protocolVaultAddress")
  VALUES (80, 20, '<REAL_VAULT_ADDRESS>');
  ```
  The indexer will fail-fast on startup if this row is missing or misconfigured.

## High Priority (should do)

- [ ] **Test the full auction lifecycle** on mainnet-beta (or a devnet dry-run):
  1. `create_auction` + `deposit_stake` (bundled tx)
  2. `commit_sol` from ≥1 wallet
  3. `finalize_auction` (will fail with <50 wallets, confirm refund flow works)
  4. Verify listener picks up all events
  5. Verify indexer DB state matches on-chain

- [ ] **Test fee collection** end-to-end:
  1. Create a Raydium CLMM pool manually
  2. `register_pool` via fee_router
  3. Execute a swap on Raydium
  4. Run fee-collector cycle
  5. Verify `claim_and_split` sends correct amounts

- [ ] **Verify emergency pause/unpause** works on all 3 programs

- [ ] **Configure `X_API_BEARER_TOKEN`** in quest-verifier if X-based quests are active

- [ ] **Set `RAYDIUM_CLMM_AMM_CONFIG_ID`** to the mainnet 1% fee tier config

## Nice to Have (pre-launch)

- [ ] Make CI audit checks blocking (remove `|| echo "::warning::"` from `.github/workflows/ci.yml`)
- [ ] Add secret scanning to CI (`trufflehog` or GitHub Advanced Security)
- [ ] Commit IDL files to repo after mainnet deploy (`scripts/generate-idl.sh`)
- [ ] Write integration tests for the current contract layout
- [ ] Set up alerting on listener disconnections and fee-collector failures

## Post-Launch

- [ ] Migrate event parsing to Anchor EventParser once IDLs are committed
- [ ] Implement `distribute_survivor_pool` (or keep using `emergency_sweep_survivor_pool` + off-chain swap)
- [ ] Add `claim_fees_from_raydium` + `unwind_liquidity` as on-chain CPI instructions
- [ ] Monitor crank wallet balance (it pays gas for fee collection)
- [ ] Set up dashboard for fee accounting reconciliation (on-chain vs off-chain)
