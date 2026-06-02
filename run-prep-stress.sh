#!/usr/bin/env bash
# Chuẩn bị trước stress: nhắc reset DB/Redis + kiểm tra user seed.
set -euo pipefail
cd "$(dirname "$0")"

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  source .env
fi

BASE="${BASE_URL:-https://parking-api-763182684658.asia-southeast1.run.app}"
DATE="${RESERVATION_DATE:-$(date +%Y-%m-%d)}"

echo "╔══════════════════════════════════════════════════════════╗"
echo "║  PREP STRESS — parking-api                               ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "  API     : ${BASE}"
echo "  Date    : ${DATE}  (RESERVATION_DATE)"
echo "  Users   : ${USER_COUNT:-1000}  loaduser_0 .. loaduser_$(( ${USER_COUNT:-1000} - 1 ))"
echo "  Rate    : ${RATE:-1500} req/s × ${DURATION:-3m}"
echo "  maxVUs  : ${MAX_VUS:-12000}  preAllocated: ${PRE_ALLOCATED_VUS:-2000}"
echo ""
echo "── Bước 1: Reset DB (Cloud SQL / psql) ──"
echo "  scripts/reset-db-for-stress.sql"
echo ""
echo "── Bước 2: Reset Redis (Memorystore) ──"
echo "  FLUSHDB  hoặc xóa: space:claim:* user:reservation:* parking:spaces:* account:balance:*"
echo ""
echo "── Bước 3: Seed users (nếu chưa có 1000 user) ──"
echo "  ./run-seed.sh"
echo ""
echo "── Bước 4: Deploy API/Worker (profile stress) ──"
echo "  cd ../be-parking-sys && DEPLOY_PROFILE=stress IMAGE_TAG=stress-\$(date +%Y%m%d-%H%M) ./deploy/deploy.sh all"
echo ""
echo "── Bước 5: Chạy stress ──"
echo "  ./run-stress-1500.sh"
echo ""

if command -v curl &>/dev/null; then
  echo "── Health check ──"
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE}/api/parking/spaces" || echo "000")
  if [[ "${HTTP_CODE}" == "200" ]]; then
    echo "  GET /api/parking/spaces → ${HTTP_CODE} OK (warm cache)"
  else
    echo "  GET /api/parking/spaces → ${HTTP_CODE} (kiểm tra API deploy)"
  fi
  echo ""
fi

echo "Sẵn sàng. Chạy: ./run-seed.sh && ./run-stress-1500.sh"
