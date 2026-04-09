#!/usr/bin/env bash
# deploy-devnet.sh — Build and deploy all PROVE programs to Solana devnet.
# Usage: ./scripts/deploy-devnet.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY_DIR="$ROOT/target/deploy"
ENV_FILE="$ROOT/.env.programs"

# ── Program names (must match Anchor.toml / Cargo package names) ─────────
PROGRAMS=(batch_auction fee_router stake_manager)

# ── Preflight checks ────────────────────────────────────────────────────
echo "==> Checking required tools..."

if ! command -v solana &>/dev/null; then
  echo "ERROR: solana CLI not found. Install from https://docs.solana.com/cli/install"
  exit 1
fi

if ! command -v anchor &>/dev/null; then
  echo "ERROR: anchor CLI not found. Install from https://www.anchor-lang.com/docs/installation"
  exit 1
fi

echo "    solana $(solana --version)"
echo "    anchor $(anchor --version)"

# ── Set cluster to devnet ────────────────────────────────────────────────
echo ""
echo "==> Setting cluster to devnet..."
solana config set --url devnet

# ── Ensure deployer wallet exists and has SOL ────────────────────────────
WALLET=$(solana config get keypair | awk '{print $NF}')
echo "    Deployer wallet: $WALLET"
echo "    Address: $(solana address)"

BALANCE=$(solana balance --lamports | awk '{print $1}')
if [[ "$BALANCE" -lt 5000000000 ]]; then
  echo ""
  echo "WARNING: Deployer balance is low ($(solana balance))."
  echo "         Request airdrops:  solana airdrop 2  (run a few times)"
fi

# ── Generate keypairs for each program if missing ────────────────────────
echo ""
echo "==> Checking program keypairs..."
mkdir -p "$DEPLOY_DIR"

for prog in "${PROGRAMS[@]}"; do
  KP="$DEPLOY_DIR/${prog}-keypair.json"
  if [[ ! -f "$KP" ]]; then
    echo "    Generating keypair for $prog..."
    solana-keygen new --no-bip39-passphrase --outfile "$KP" --force
  else
    echo "    Keypair exists: $KP"
  fi
done

# ── Build ────────────────────────────────────────────────────────────────
echo ""
echo "==> Building programs with Anchor..."
cd "$ROOT"
anchor build

# ── Deploy each program ─────────────────────────────────────────────────
echo ""
echo "==> Deploying programs to devnet..."

declare -A PROGRAM_IDS

for prog in "${PROGRAMS[@]}"; do
  echo ""
  echo "--- Deploying $prog ---"
  SO_FILE="$DEPLOY_DIR/${prog}.so"
  SO_SIZE=$(wc -c < "$SO_FILE")
  # Allocate 20% headroom over current binary for future upgrades.
  # This saves ~40% rent vs the default 2x allocation.
  MAX_LEN=$(( SO_SIZE + SO_SIZE / 5 ))
  echo "    Binary size: ${SO_SIZE} bytes, allocating: ${MAX_LEN} bytes"
  solana program deploy \
    "$SO_FILE" \
    --program-id "$DEPLOY_DIR/${prog}-keypair.json" \
    --max-len "$MAX_LEN" \
    --url devnet
  PROGRAM_IDS[$prog]=$(solana address --keypair "$DEPLOY_DIR/${prog}-keypair.json")
  echo "    $prog => ${PROGRAM_IDS[$prog]}"
done

# ── Print summary & write .env.programs ──────────────────────────────────
echo ""
echo "========================================="
echo "  Deployment Complete — Program IDs"
echo "========================================="

# Clear and write the env file
> "$ENV_FILE"

for prog in "${PROGRAMS[@]}"; do
  UPPER=$(echo "$prog" | tr '[:lower:]' '[:upper:]')
  ID="${PROGRAM_IDS[$prog]}"
  echo "  ${UPPER}_PROGRAM_ID=${ID}"
  echo "${UPPER}_PROGRAM_ID=${ID}" >> "$ENV_FILE"
done

echo ""
echo "Program IDs saved to $ENV_FILE"
echo ""
echo "Next steps:"
echo "  1. Run: node scripts/init-programs.ts    (initialize on-chain config)"
echo "  2. Update Anchor.toml with the program IDs above"
echo "  3. Update declare_id!() in each program's lib.rs"
echo "  4. Rebuild + redeploy with the real IDs:  anchor build && ./scripts/deploy-devnet.sh"
echo ""
echo "Done."
