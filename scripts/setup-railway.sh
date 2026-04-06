#!/usr/bin/env bash
# setup-railway.sh — Print required Railway environment variables for PROVE.
# Usage: ./scripts/setup-railway.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env.programs"

# ── Load program IDs if .env.programs exists ─────────────────────────────
if [[ -f "$ENV_FILE" ]]; then
  echo "Found .env.programs — loading program IDs..."
  # shellcheck disable=SC1090
  source "$ENV_FILE"
else
  echo "NOTE: .env.programs not found. Run deploy-devnet.sh first to populate program IDs."
  echo ""
fi

BA="${BATCH_AUCTION_PROGRAM_ID:-<run deploy-devnet.sh first>}"
FR="${FEE_ROUTER_PROGRAM_ID:-<run deploy-devnet.sh first>}"
SM="${STAKE_MANAGER_PROGRAM_ID:-<run deploy-devnet.sh first>}"
TR="${TICKER_REGISTRY_PROGRAM_ID:-<run deploy-devnet.sh first>}"
PA="${PROVE_AMM_PROGRAM_ID:-<run deploy-devnet.sh first>}"

cat <<EOF

=====================================================================
  PROVE — Railway Environment Variables
=====================================================================

Copy-paste these into your Railway service variables.
Replace placeholder values (<...>) with real credentials.

---------------------------------------------------------------------
 1. Shared / Infrastructure
---------------------------------------------------------------------

DATABASE_URL=<Railway PostgreSQL connection string>
SOLANA_RPC_URL=https://devnet.helius-rpc.com/?api-key=<YOUR_HELIUS_KEY>

---------------------------------------------------------------------
 2. Indexer Service  (services/indexer)
---------------------------------------------------------------------

DATABASE_URL=\${{Postgres.DATABASE_URL}}
SOLANA_RPC_URL=https://devnet.helius-rpc.com/?api-key=<YOUR_HELIUS_KEY>
INDEXER_PORT=3001

BATCH_AUCTION_PROGRAM_ID=${BA}
FEE_ROUTER_PROGRAM_ID=${FR}
STAKE_MANAGER_PROGRAM_ID=${SM}
TICKER_REGISTRY_PROGRAM_ID=${TR}
PROVE_AMM_PROGRAM_ID=${PA}

---------------------------------------------------------------------
 3. Quest Verifier Service  (services/quest-verifier)
---------------------------------------------------------------------

DATABASE_URL=\${{Postgres.DATABASE_URL}}
SOLANA_RPC_URL=https://devnet.helius-rpc.com/?api-key=<YOUR_HELIUS_KEY>
QUEST_PORT=3002

BATCH_AUCTION_PROGRAM_ID=${BA}
STAKE_MANAGER_PROGRAM_ID=${SM}

---------------------------------------------------------------------
 4. Frontend App  (app)
---------------------------------------------------------------------

NEXT_PUBLIC_SOLANA_RPC_URL=https://devnet.helius-rpc.com/?api-key=<YOUR_HELIUS_KEY>
NEXT_PUBLIC_SOLANA_NETWORK=devnet

NEXT_PUBLIC_BATCH_AUCTION_PROGRAM_ID=${BA}
NEXT_PUBLIC_FEE_ROUTER_PROGRAM_ID=${FR}
NEXT_PUBLIC_STAKE_MANAGER_PROGRAM_ID=${SM}
NEXT_PUBLIC_TICKER_REGISTRY_PROGRAM_ID=${TR}
NEXT_PUBLIC_PROVE_AMM_PROGRAM_ID=${PA}

NEXT_PUBLIC_INDEXER_URL=<Railway indexer service URL, e.g. https://prove-indexer.up.railway.app>
NEXT_PUBLIC_QUEST_URL=<Railway quest service URL, e.g. https://prove-quest.up.railway.app>

---------------------------------------------------------------------
 5. Railway Setup Steps
---------------------------------------------------------------------

 a) Create a new Railway project.
 b) Add a PostgreSQL plugin — Railway provides DATABASE_URL automatically.
 c) Add three services linked to the PROVE repo:
      - indexer   → root directory: services/indexer
      - quest     → root directory: services/quest-verifier
      - app       → root directory: app
 d) Set the environment variables above in each service.
 e) Run database migrations:
      railway run pnpm db:migrate
 f) Deploy!

=====================================================================
EOF
