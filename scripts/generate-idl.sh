#!/usr/bin/env bash
# generate-idl.sh — Build Anchor IDLs and copy them to frontend + indexer.
# Usage: ./scripts/generate-idl.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IDL_SOURCE="$ROOT/target/idl"

APP_IDL_DIR="$ROOT/app/src/idl"
INDEXER_IDL_DIR="$ROOT/services/indexer/src/idl"

PROGRAMS=(batch_auction fee_router stake_manager ticker_registry)

# ── Build ────────────────────────────────────────────────────────────────
echo "==> Building programs with Anchor to generate IDLs..."
cd "$ROOT"
anchor build

# ── Verify IDLs were generated ───────────────────────────────────────────
echo ""
echo "==> Verifying generated IDL files..."
for prog in "${PROGRAMS[@]}"; do
  if [[ ! -f "$IDL_SOURCE/${prog}.json" ]]; then
    echo "WARNING: IDL not found for $prog (expected $IDL_SOURCE/${prog}.json)"
  fi
done

# ── Copy to app (frontend) ──────────────────────────────────────────────
echo ""
echo "==> Copying IDLs to app/src/idl/..."
mkdir -p "$APP_IDL_DIR"

for prog in "${PROGRAMS[@]}"; do
  SRC="$IDL_SOURCE/${prog}.json"
  if [[ -f "$SRC" ]]; then
    cp "$SRC" "$APP_IDL_DIR/"
    echo "    Copied ${prog}.json"
  fi
done

# ── Copy to indexer ─────────────────────────────────────────────────────
echo ""
echo "==> Copying IDLs to services/indexer/src/idl/..."
mkdir -p "$INDEXER_IDL_DIR"

for prog in "${PROGRAMS[@]}"; do
  SRC="$IDL_SOURCE/${prog}.json"
  if [[ -f "$SRC" ]]; then
    cp "$SRC" "$INDEXER_IDL_DIR/"
    echo "    Copied ${prog}.json"
  fi
done

echo ""
echo "Done. IDL files are ready for consumption."
