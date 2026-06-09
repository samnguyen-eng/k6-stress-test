/**
 * Load test: mixed traffic — 10% /me, 10% /spaces, 80% /reserve
 *
 * Usage:
 *   k6 run scripts/load-test.js -e RATE=500 -e DURATION=3m -e USER_COUNT=1000
 *   ./run-load-test.sh
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

// Custom counters
const reservedOk     = new Counter('reserved_ok');
const businessReject = new Counter('business_reject');
const serverError    = new Counter('server_error');
const connError      = new Counter('conn_error');
const eofError       = new Counter('eof_error');

const RATE              = Number(__ENV.RATE || 500);
const DURATION          = __ENV.DURATION || '3m';
const SETUP_USER_LIMIT  = Number(__ENV.SETUP_USER_LIMIT || USER_COUNT);
const PRE_ALLOCATED_VUS = Number(__ENV.PRE_ALLOCATED_VUS || 500);
const MAX_VUS           = Number(__ENV.MAX_VUS || 1000);

export const options = {
  setupTimeout: __ENV.SETUP_TIMEOUT || '10m',
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],

  scenarios: {
    mixed_load: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: PRE_ALLOCATED_VUS,
      maxVUs: MAX_VUS,
      exec: 'mixedLoad',
    },
  },

  thresholds: {
    'http_req_duration{expected_response:true}': [
      __ENV.THRESHOLD_P95 || 'p(95)<3000',
      __ENV.THRESHOLD_P99 || 'p(99)<5000',
    ],
    'http_req_duration{name:reserve}': [
      __ENV.THRESHOLD_RESERVE_P95 || 'p(95)<4000',
      __ENV.THRESHOLD_RESERVE_P99 || 'p(99)<7000',
    ],
    'http_req_duration{name:spaces}': [
      __ENV.THRESHOLD_SPACES_P95 || 'p(95)<2000',
      __ENV.THRESHOLD_SPACES_P99 || 'p(99)<4000',
    ],
    'http_req_duration{name:me}': [
      __ENV.THRESHOLD_ME_P95 || 'p(95)<2000',
      __ENV.THRESHOLD_ME_P99 || 'p(99)<4000',
    ],
  },
};

export function setup() {
  const users = [];
  const limit = Math.min(SETUP_USER_LIMIT, USER_COUNT);
  const BATCH_SIZE = 200;

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
        if (token) users.push({ index: i + k, token });
      }
    }
    console.log(`setup: batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(limit / BATCH_SIZE)} — tokens: ${users.length}`);
  }

  if (users.length === 0) throw new Error('No users loaded.');
  console.log(`setup: loaded ${users.length}/${limit} tokens`);

  // Warm spaces cache
  http.get(`${BASE_URL}/api/parking/spaces`, { tags: { name: 'setup_spaces' } });
  return { users };
}

export function mixedLoad(data) {
  const pool = data.users;
  const user = pool[(__VU + __ITER) % pool.length];
  const rand = Math.random();

  if (rand < 0.10) {
    // 10% — GET /me
    callMe(user);
  } else if (rand < 0.20) {
    // 10% — GET /spaces
    callSpaces();
  } else {
    // 80% — POST /reserve
    callReserve(user);
  }
}

function callMe(user) {
  const res = http.get(`${BASE_URL}/api/users/me`, {
    headers: { ...JSON_HEADERS, Authorization: `Bearer ${user.token}` },
    tags: { name: 'me' },
  });
  check(res, { 'me: 200': (r) => r.status === 200 });
  trackStatus(res);
}

function callSpaces() {
  const res = http.get(`${BASE_URL}/api/parking/spaces`, {
    headers: JSON_HEADERS,
    tags: { name: 'spaces' },
  });
  check(res, { 'spaces: 200': (r) => r.status === 200 });
  trackStatus(res);
}

function callReserve(user) {
  const spaceId = (__VU % MAX_SPACE_ID) + 1;
  const res = http.post(
    `${BASE_URL}/api/parking/reserve`,
    JSON.stringify({ spaceId, reservationDate: RESERVATION_DATE, plateNumber: plateForIndex(user.index) }),
    {
      headers: { ...JSON_HEADERS, Authorization: `Bearer ${user.token}` },
      tags: { name: 'reserve' },
    }
  );
  check(res, { 'reserve: 200': (r) => r.status === 200 });
  trackStatus(res);
}

function trackStatus(res) {
  if (res.status === 200) {
    reservedOk.add(1);
  } else if (res.status === 400 || res.status === 409 || res.status === 429) {
    businessReject.add(1);
  } else if (res.status >= 500) {
    serverError.add(1);
    console.error(`SERVER ERROR status=${res.status} body=${res.body?.substring(0, 200)}`);
  } else if (res.status === 0) {
    const err = res.error || '';
    if (err.includes('EOF') || err.includes('connection reset') || err.includes('http2')) {
      eofError.add(1);
    } else if (err.includes('timeout')) {
      connError.add(1);
      console.error(`CONN ERROR: ${err}`);
    } else {
      eofError.add(1);
    }
  }
}

export function handleSummary(data) {
  const m = data.metrics;
  const httpVals = m['http_req_duration{expected_response:true}']?.values ?? {};
  const p95 = (httpVals['p(95)'] ?? 0).toFixed(0);
  const p99 = (httpVals['p(99)'] ?? 0).toFixed(0);
  const reserveVals = m['http_req_duration{name:reserve}']?.values ?? {};
  const spacesVals  = m['http_req_duration{name:spaces}']?.values ?? {};
  const meVals      = m['http_req_duration{name:me}']?.values ?? {};
  const reserveP95 = (reserveVals['p(95)'] ?? 0).toFixed(0);
  const reserveP99 = (reserveVals['p(99)'] ?? 0).toFixed(0);
  const spacesP95  = (spacesVals['p(95)'] ?? 0).toFixed(0);
  const spacesP99  = (spacesVals['p(99)'] ?? 0).toFixed(0);
  const meP95      = (meVals['p(95)'] ?? 0).toFixed(0);
  const meP99      = (meVals['p(99)'] ?? 0).toFixed(0);

  const reserveCount = m.http_reqs?.values?.count
    ? m['http_req_duration{name:reserve}']?.values?.count ?? 0
    : 0;
  const spacesCount = m.http_reqs?.values?.count
    ? m['http_req_duration{name:spaces}']?.values?.count ?? 0
    : 0;
  const meCount = m.http_reqs?.values?.count
    ? m['http_req_duration{name:me}']?.values?.count ?? 0
    : 0;
  const totalReq  = m.http_reqs?.values?.count ?? 0;
  const avgRps    = m.http_reqs?.values?.rate ?? 0;
  const dropped   = m.dropped_iterations?.values?.count ?? 0;
  const scheduled = totalReq + dropped;
  const dropPct   = scheduled > 0 ? ((dropped / scheduled) * 100).toFixed(1) : '0';
  const okCount   = m.reserved_ok?.values?.count ?? 0;
  const rejectCount = m.business_reject?.values?.count ?? 0;
  const svrErr    = m.server_error?.values?.count ?? 0;
  const connErr   = m.conn_error?.values?.count ?? 0;
  const eofErr    = m.eof_error?.values?.count ?? 0;
  const realErr   = svrErr + connErr;
  const realErrRate = totalReq > 0 ? (realErr / totalReq * 100) : 0;
  const pass = (v, t) => v <= t ? '✅' : '❌';

  const lines = [
    '\n╔══════════════════════════════════════════════════════╗',
    '║         LOAD TEST SUMMARY                            ║',
    '╠══════════════════════════════════════════════════════╣',
    `║  Total requests    : ${String(totalReq).padStart(8)}  (avg ${avgRps.toFixed(1)} req/s)`,
    `║  Dropped iters     : ${String(dropped).padStart(8)}  (${dropPct}% — increase MAX_VUS if >5%)`,
    '╠══════════════════════════════════════════════════════╣',
    `║  ❌ Server errors   : ${String(svrErr).padStart(8)}  (5xx)`,
    `║  ❌ Conn errors     : ${String(connErr).padStart(8)}  (timeout)`,
    '╠══════════════════════════════════════════════════════╣',
    `║  P95 (HTTP only)   : ${p95.padStart(6)} ms  ${pass(Number(p95), 4000)}  (threshold <4000ms)`,
    `║  P99 (HTTP only)   : ${p99.padStart(6)} ms  ${pass(Number(p99), 6000)}  (threshold <6000ms)`,
    '╠══════════════════════════════════════════════════════╣',
    `║  reserve p95/p99   : ${reserveP95.padStart(5)}/${reserveP99.padStart(5)} ms  (${reserveCount} req)`,
    `║  spaces  p95/p99   : ${spacesP95.padStart(5)}/${spacesP99.padStart(5)} ms  (${spacesCount} req)`,
    `║  me      p95/p99   : ${meP95.padStart(5)}/${meP99.padStart(5)} ms  (${meCount} req)`,
    '╚══════════════════════════════════════════════════════╝\n',
  ].join('\n');

  return { stdout: lines };
}
