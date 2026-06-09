#!/usr/bin/env bash
# Usage: ./run-load-test.sh [output-file.json]
set -euo pipefail
cd "$(dirname "$0")"

if [[ -f .env ]]; then
  set -a; source .env; set +a
fi

export BASE_URL="${BASE_URL:-https://parking-api-763182684658.asia-southeast1.run.app}"
export PASSWORD="${PASSWORD:-Test@123456}"
export USER_COUNT="${USER_COUNT:-1000}"
export RATE="${RATE:-500}"
export DURATION="${DURATION:-3m}"
export RESERVATION_DATE="${RESERVATION_DATE:-$(date +%Y-%m-%d)}"
export SETUP_USER_LIMIT="${SETUP_USER_LIMIT:-1000}"
export SETUP_TIMEOUT="${SETUP_TIMEOUT:-10m}"
export PRE_ALLOCATED_VUS="${PRE_ALLOCATED_VUS:-500}"
export MAX_VUS="${MAX_VUS:-1000}"

OUT="${1:-load-summary.json}"

echo "╔══════════════════════════════════════════════════════════╗"
echo "║  LOAD TEST  ${RATE} req/s × ${DURATION}  (15% me / 15% spaces / 70% reserve)"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  date=${RESERVATION_DATE}  users=${USER_COUNT}  maxVUs=${MAX_VUS}"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

if command -v curl &>/dev/null; then
  curl -s -o /dev/null -w "Warm-up GET /spaces → HTTP %{http_code}\n" "${BASE_URL}/api/parking/spaces"
  echo ""
fi

K6_LOG_LEVEL=error k6 run scripts/load-test.js \
  -e "BASE_URL=${BASE_URL}" \
  -e "RATE=${RATE}" \
  -e "DURATION=${DURATION}" \
  -e "USER_COUNT=${USER_COUNT}" \
  -e "SETUP_USER_LIMIT=${SETUP_USER_LIMIT}" \
  -e "SETUP_TIMEOUT=${SETUP_TIMEOUT}" \
  -e "PRE_ALLOCATED_VUS=${PRE_ALLOCATED_VUS}" \
  -e "MAX_VUS=${MAX_VUS}" \
  -e "RESERVATION_DATE=${RESERVATION_DATE}" \
  -e "PASSWORD=${PASSWORD}" \
  --summary-export="${OUT}"

echo ""
echo "==> Done. Summary: ${OUT}"
