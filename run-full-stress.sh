#!/usr/bin/env bash
# Full pipeline: prep → seed (optional skip) → stress 1500/s
set -euo pipefail
cd "$(dirname "$0")"

SKIP_SEED="${SKIP_SEED:-0}"

./run-prep-stress.sh
echo ""

if [[ "${SKIP_SEED}" != "1" ]]; then
  echo "==> Seeding users..."
  ./run-seed.sh
  echo ""
fi

echo "==> Starting stress test..."
./run-stress-1500.sh "${1:-summary-1500.json}"
