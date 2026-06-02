# Parking system — K6 load test

Stress target: **1500 req/s** → `POST /api/parking/reserve` for **3 minutes**.

Hit **parking-api** directly (not FE) to avoid nginx bottleneck.

## Prerequisites

- [K6](https://grafana.com/docs/k6/latest/set-up/install-k6/): `brew install k6`
- Cloud SQL `RUNNABLE`, API + Worker deployed
- API: `APP_PUBSUB_ENABLED=true`, Pub/Sub publisher IAM
- Worker: `--no-cpu-throttling`, subscriber IAM

## Quick start

```bash
cd /Users/vnipco900217/Documents/ProbationProject/Git/k6
cp .env.example .env
# edit RESERVATION_DATE (new date each run)

chmod +x run-stress-1500.sh

./run-stress-1500.sh
```

(User `loaduser_*` phải có sẵn; script **không** register — chỉ login trong `setup()` để lấy JWT.)

### Deploy API/Worker (profile stress)

```bash
cd ../be-parking-sys
DEPLOY_PROFILE=stress IMAGE_TAG=stress-$(date +%Y%m%d-%H%M) ./deploy/deploy.sh all
```

| Service | Stress profile |
|---------|----------------|
| parking-api | max 6, concurrency 300, CPU 2, 4Gi, timeout 60s |
| parking-worker | max 4, concurrency 100, `--no-cpu-throttling` |
| Pub/Sub | `APP_PUBSUB_ORDERING_ENABLED=false` |

**Seed vs test:** `seed-users.js` chỉ tạo user + deposit. `reserve-stress.js` chỉ gọi reserve.

**Đã sửa lỗi ~44 user:** `__ITER` trùng giữa các VU → dùng `execution.scenario.iterationInTest` (0..999). Chạy lại seed an toàn: user có sẵn → bỏ qua register, login + deposit.

```sql
SELECT count(*) FROM users WHERE username LIKE 'loaduser_%';
```

## Layout

```text
k6/
├── lib/config.js           # BASE_URL, env defaults
├── scripts/
│   ├── seed-users.js       # register loaduser_N + deposit
│   └── reserve-stress.js   # constant-arrival-rate reserve
├── run-seed.sh
├── run-smoke.sh
├── run-stress-1500.sh
├── .env.example
└── README.md
```

## Manual commands

```bash
export BASE_URL="https://parking-api-763182684658.asia-southeast1.run.app"
export RESERVATION_DATE="2026-06-02"

k6 run scripts/seed-users.js -e USER_COUNT=1000

k6 run scripts/reserve-stress.js \
  -e RATE=1500 -e DURATION=3m -e USER_COUNT=10000 \
  -e RESERVATION_DATE="$RESERVATION_DATE"
```

## Env vars

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | parking-api Cloud Run URL | API base |
| `USER_COUNT` | 1000 | Users `loaduser_0` … `loaduser_999` |
| `PASSWORD` | Test@123456 | Shared password |
| `DEPOSIT_AMOUNT` | 1000 | Balance per user |
| `RESERVATION_DATE` | today | **Change each run** |
| `RATE` | 1500 | Requests per second (stress) |
| `DURATION` | 3m | Test duration |
| `MAX_VUS` | **12000** | **Bắt buộc** đủ cao (đừng 1000) |
| `PRE_ALLOCATED_VUS` | 2000 | VU khởi tạo sẵn |
| `SETUP_USER_LIMIT` | = USER_COUNT | Max logins in setup |
| `MAX_SPACE_ID` | 80 | spaceId = index % 80 + 1 |

## Watch GCP during test

```bash
gcloud beta run services logs tail parking-api \
  --region=asia-southeast1 --project=parking-system-497603

gcloud beta run services logs tail parking-worker \
  --region=asia-southeast1 --project=parking-system-497603
```

## Notes

- **1 user / 1 day** → need enough users (`USER_COUNT` ≥ total requests if all should be 200).
- **1500 RPS** from one laptop may not be reached — use a VM with 8+ vCPU or K6 Cloud.
- 4xx on repeat reserve same day is expected if user pool is too small.
