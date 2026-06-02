#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  source .env
fi

echo "==> Smoke reserve ${RATE:-50} req/s for ${DURATION:-30s}"
k6 run scripts/reserve-stress.js \
  -e "BASE_URL=${BASE_URL:-https://parking-api-763182684658.asia-southeast1.run.app}" \
  -e "RATE=${RATE:-50}" \
  -e "DURATION=${DURATION:-30s}" \
  -e "USER_COUNT=${USER_COUNT:-500}" \
  -e "SETUP_USER_LIMIT=${SETUP_USER_LIMIT:-500}" \
  -e "PRE_ALLOCATED_VUS=${PRE_ALLOCATED_VUS:-100}" \
  -e "MAX_VUS=${MAX_VUS:-500}" \
  -e "RESERVATION_DATE=${RESERVATION_DATE:-$(date +%Y-%m-%d)}" \
  -e "PASSWORD=${PASSWORD:-Test@123456}"
