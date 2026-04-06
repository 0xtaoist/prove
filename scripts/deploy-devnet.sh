#!/usr/bin/env bash
# deploy-devnet.sh — Build and deploy all 5 PROVE programs to Solana devnet.
# Usage: ./scripts/deploy-devnet.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY_DIR="$ROOT/target/deploy"
ENV_FILE="$ROOT/.env.programs"

# ── Program names (must match Anchor.toml / Cargo package names) ─────────
PROGRAMS=(batch_auction fee_router stake_manager ticker_registry prove_amm)

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
  echo "         Request an airdrop: solana airdrop 2"
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
  anchor deploy --program-name "$prog" --provider.cluster devnet
  # Read the program ID from the generated keypair
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
echo "Done."
