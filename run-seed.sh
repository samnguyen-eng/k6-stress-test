#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  source .env
fi

echo "==> Seeding ${USER_COUNT:-1000} users -> ${BASE_URL:-parking-api}"
k6 run scripts/seed-users.js \
  -e "BASE_URL=${BASE_URL:-https://parking-api-763182684658.asia-southeast1.run.app}" \
  -e "USER_COUNT=${USER_COUNT:-1000}" \
  -e "DEPOSIT_AMOUNT=${DEPOSIT_AMOUNT:-1000}" \
  -e "PASSWORD=${PASSWORD:-Test@123456}" \
  -e "SEED_VUS=${SEED_VUS:-20}"
