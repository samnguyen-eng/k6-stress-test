#!/usr/bin/env bash
# Usage: ./run-stress-1500.sh
# (Users loaduser_* must exist — script only logs in to get tokens, no registration)
# Optional: ./run-stress-1500.sh my-summary.json
set -euo pipefail
cd "$(dirname "$0")"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

export BASE_URL="${BASE_URL:-https://parking-api-763182684658.asia-southeast1.run.app}"
export PASSWORD="${PASSWORD:-Test@123456}"
export USER_COUNT="${USER_COUNT:-1000}"
export RATE="${RATE:-1500}"
export DURATION="${DURATION:-3m}"
export RESERVATION_DATE="${RESERVATION_DATE:-$(date +%Y-%m-%d)}"
export SETUP_USER_LIMIT="${SETUP_USER_LIMIT:-1000}"
export SETUP_TIMEOUT="${SETUP_TIMEOUT:-10m}"
export PRE_ALLOCATED_VUS="${PRE_ALLOCATED_VUS:-2000}"
export MAX_VUS="${MAX_VUS:-12000}"

OUT="${1:-summary-1500.json}"


echo "╔══════════════════════════════════════════════════════════╗"
echo "║  STRESS  ${RATE} req/s × ${DURATION}  →  ${BASE_URL}"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  date=${RESERVATION_DATE}  users=${USER_COUNT}  maxVUs=${MAX_VUS}"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

if command -v curl &>/dev/null; then
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/api/parking/spaces" || echo "000")
  echo ""
fi

K6_LOG_LEVEL=error k6 run \
  --log-output=none \
  -e "BASE_URL=${BASE_URL}" \
  -e "RATE=100" \
  -e "DURATION=30s" \
  -e "USER_COUNT=${USER_COUNT}" \
  -e "SETUP_USER_LIMIT=100" \
  -e "PRE_ALLOCATED_VUS=200" \
  -e "MAX_VUS=200" \
  -e "RESERVATION_DATE=${RESERVATION_DATE}" \
  -e "PASSWORD=${PASSWORD}" \
  -e "SETUP_TIMEOUT=5m" \
  scripts/reserve-stress.js > /dev/null 2>&1 || true
sleep 5
echo ""

echo "==> Reserve stress (login ${USER_COUNT} users → tokens, then ${RATE}/s × ${DURATION})..."
echo "    Expected ~$(( RATE * 180 )) requests if no dropped_iterations"
echo ""

K6_LOG_LEVEL=error k6 run scripts/reserve-stress.js \
  --log-output=none \
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
