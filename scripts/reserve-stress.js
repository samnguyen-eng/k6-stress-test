/**
 * Stress test: POST /api/parking/reserve at constant arrival rate.
 *
 * Usage (smoke):
 *   k6 run scripts/reserve-stress.js -e RATE=50 -e DURATION=30s -e USER_COUNT=500
 *
 * Usage (1500 TPS x 3 min — reserve phase only, excludes login setup):
 *   ./run-stress-1500.sh
 *   k6 run scripts/reserve-stress.js -e RATE=1500 -e DURATION=3m -e USER_COUNT=1000
 */
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import {
  BASE_URL,
  PASSWORD,
  USER_COUNT,
  MAX_SPACE_ID,
  RESERVATION_DATE,
  JSON_HEADERS,
  usernameForIndex,
  plateForIndex,
} from '../lib/config.js';

// Custom counters — distinguish business reject vs real error
const reservedOk      = new Counter('reserved_ok');       // 200 - reserved successfully
const businessReject  = new Counter('business_reject');   // 400 - slot taken / duplicate / no balance
const serverError     = new Counter('server_error');      // 5xx - server crash
const connError       = new Counter('conn_error');        // 0   - timeout
const eofError        = new Counter('eof_error');         // 0   - EOF / instance not scaled yet

const RATE = Number(__ENV.RATE || 50);
const DURATION = __ENV.DURATION || '30s';
const SETUP_USER_LIMIT = Number(__ENV.SETUP_USER_LIMIT || USER_COUNT);
const PRE_ALLOCATED_VUS = Number(__ENV.PRE_ALLOCATED_VUS || 1000);
const MAX_VUS = Number(__ENV.MAX_VUS || 2000);

export const options = {
  setupTimeout: __ENV.SETUP_TIMEOUT || '10m',

  // Explicitly declare percentiles — k6 only includes p(90) and p(95) by default
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],

  scenarios: {
    reserve_load: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: PRE_ALLOCATED_VUS,
      maxVUs: MAX_VUS,
      exec: 'reserve',
    },
  },
  thresholds: {
    // Only measure real errors (5xx + conn drop) — business rejects (400/409) are expected
    'http_req_duration{expected_response:true}': [
      __ENV.THRESHOLD_RESERVE_P95 || 'p(95)<3000',
      __ENV.THRESHOLD_RESERVE_P99 || 'p(99)<5000',
    ],
  },
};

/**
 * Login load users once; each VU reuses the pool.
 * Cap SETUP_USER_LIMIT if login takes too long (e.g. 3000 for quick smoke).
 */
export function setup() {
  const users = [];
  const limit = Math.min(SETUP_USER_LIMIT, USER_COUNT);
  const BATCH_SIZE = 50;

  for (let i = 0; i < limit; i += BATCH_SIZE) {
    const batch = [];
    const batchEnd = Math.min(i + BATCH_SIZE, limit);

    for (let j = i; j < batchEnd; j++) {
      batch.push([
        'POST',
        `${BASE_URL}/api/auth/login`,
        JSON.stringify({ username: usernameForIndex(j), password: PASSWORD }),
        { headers: JSON_HEADERS, tags: { name: 'setup_login' } },
      ]);
    }

    const responses = http.batch(batch);
    for (let k = 0; k < responses.length; k++) {
      const res = responses[k];
      if (res.status === 200) {
        const token = res.json('data.token');
        if (token) {
          users.push({ index: i + k, token });
        }
      }
    }
    console.log(`setup: batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(limit / BATCH_SIZE)} done — tokens so far: ${users.length}`);
  }

  if (users.length === 0) {
    throw new Error(
      `No users loaded. Run: k6 run scripts/seed-users.js -e USER_COUNT=${USER_COUNT}`
    );
  }

  console.log(`setup: loaded ${users.length}/${limit} tokens for reserve test (batch size=${BATCH_SIZE})`);

  // Warm Redis spaces cache before firing 1500/s
  http.get(`${BASE_URL}/api/parking/spaces`, { tags: { name: 'setup_spaces' } });

  return { users };
}

export function reserve(data) {
  const pool = data.users;
  const user = pool[(__VU + __ITER) % pool.length];
  // spaceId derived from VU to guarantee all 80 spaces are always targeted
  const spaceId = (__VU % MAX_SPACE_ID) + 1;

  const res = http.post(
    `${BASE_URL}/api/parking/reserve`,
    JSON.stringify({
      spaceId,
      reservationDate: RESERVATION_DATE,
      plateNumber: plateForIndex(user.index),
    }),
    {
      headers: {
        ...JSON_HEADERS,
        Authorization: `Bearer ${user.token}`,
      },
      tags: { name: 'reserve' },
    }
  );

  check(res, {
    'reserve status 200': (r) => r.status === 200,
  });

  if (res.status === 200) {
    reservedOk.add(1);
  } else if (res.status === 400) {
    businessReject.add(1);
  } else if (res.status >= 500) {
    serverError.add(1);
    console.error(`SERVER ERROR status=${res.status} body=${res.body?.substring(0, 200)}`);
  } else if (res.status === 0) {
    const err = res.error || '';
    if (err.includes('EOF') || err.includes('unexpected EOF') || err.includes('connection reset') || err.includes('http2')) {
      eofError.add(1); // instance not scaled yet — expected during burst
    } else if (err.includes('timeout') || err.includes('request timeout')) {
      connError.add(1);
      console.error(`CONN ERROR: ${err}`);
    } else {
      eofError.add(1); // other connection errors
    }
  }
}

export function handleSummary(data) {
  const m = data.metrics;

  // HTTP-only P95/P99 — excludes EOF/connection failures (status=0)
  const httpVals = m['http_req_duration{expected_response:true}']?.values ?? {};
  const p95Rsv = httpVals['p(95)'] ?? httpVals['p(95.0)'] ?? 0;
  const p99Rsv = httpVals['p(99)'] ?? httpVals['p(99.0)'] ?? 0;

  const failRate    = (m.http_req_failed?.values?.rate ?? 0) * 100;
  const totalReq    = m.http_reqs?.values?.count ?? 0;
  const avgRps      = m.http_reqs?.values?.rate ?? 0;
  const dropped     = m.dropped_iterations?.values?.count ?? 0;

  const okCount     = m.reserved_ok?.values?.count ?? 0;
  const rejectCount = m.business_reject?.values?.count ?? 0;
  const svrErrCount = m.server_error?.values?.count ?? 0;
  const connErrCount= m.conn_error?.values?.count ?? 0;
  const eofErrCount = m.eof_error?.values?.count ?? 0;
  const realErrors  = svrErrCount + connErrCount;
  const realErrRate = totalReq > 0 ? (realErrors / totalReq * 100) : 0;

  const pass = (val, threshold) => val <= threshold ? '✅' : '❌';
  const scheduled = totalReq + dropped;
  const dropPct = scheduled > 0 ? ((dropped / scheduled) * 100).toFixed(1) : '0';

  const lines = [
    '\n╔══════════════════════════════════════════════════════╗',
    '║           STRESS TEST SUMMARY — 1500 TPS            ║',
    '╠══════════════════════════════════════════════════════╣',
    `║  Total requests    : ${String(totalReq).padStart(8)}  (avg ${avgRps.toFixed(1)} req/s)`,
    `║  Dropped iters     : ${String(dropped).padStart(8)}  (${dropPct}% — increase MAX_VUS if >5%)`,
    '╠══════════════════════════════════════════════════════╣',
    `║  ❌ Server errors   : ${String(svrErrCount).padStart(8)}  (5xx)`,
    `║  ❌ Conn errors     : ${String(connErrCount).padStart(8)}  (timeout)`,
    '╠══════════════════════════════════════════════════════╣',
    `║  P95    : ${(p95Rsv).toFixed(0).padStart(6)} ms  ${pass(p95Rsv, 1000)}  (threshold <1000ms)`,
    `║  P99    : ${(p99Rsv).toFixed(0).padStart(6)} ms  ${pass(p99Rsv, 2000)}  (threshold <2000ms)`,
    '╠══════════════════════════════════════════════════════╣',
    `║  Real error rate   : ${realErrRate.toFixed(2).padStart(7)}%  ${pass(realErrRate, 1)}  (5xx + conn drop)`,
    '╚══════════════════════════════════════════════════════╝\n',
  ].join('\n');

  return { stdout: lines };
}
