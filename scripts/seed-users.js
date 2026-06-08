/**
 * SETUP ONLY — not a stress test.
 * Creates USER_COUNT users: loaduser_{START} .. loaduser_{START+COUNT-1}, each with deposit.
 * Existing users → skip register, just login + deposit (safe to re-run).
 *
 * Usage:
 *   k6 run scripts/seed-users.js                              # seed 1000 users from index 0
 *   k6 run scripts/seed-users.js -e USER_COUNT=500 -e SEED_START_INDEX=1000  # add 500 users from index 1000
 */
import http from 'k6/http';
import exec from 'k6/execution';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import {
  BASE_URL,
  PASSWORD,
  USER_COUNT,
  DEPOSIT_AMOUNT,
  JSON_HEADERS,
  authHeaders,
  usernameForIndex,
  plateForIndex,
} from '../lib/config.js';

const seedReady = new Counter('seed_ready');
const seedSkippedExisting = new Counter('seed_skipped_existing');

const START_INDEX = Number(__ENV.SEED_START_INDEX || 0);
const COUNT = Number(__ENV.USER_COUNT || USER_COUNT);

export const options = {
  scenarios: {
    seed: {
      executor: 'shared-iterations',
      vus: Number(__ENV.SEED_VUS || 20),
      iterations: COUNT,
      maxDuration: __ENV.SEED_MAX_DURATION || '60m',
    },
  },
};

export default function () {
  const index = START_INDEX + exec.scenario.iterationInTest;
  if (index >= START_INDEX + COUNT) {
    return;
  }

  const username = usernameForIndex(index);
  let token = null;
  let skippedExisting = false;

  const registerRes = http.post(
    `${BASE_URL}/api/auth/register`,
    JSON.stringify({
      username,
      email: `${username}@k6.test`,
      password: PASSWORD,
      plateNumber: plateForIndex(index),
    }),
    { headers: JSON_HEADERS, tags: { name: 'register' } }
  );

  if (registerRes.status === 201 || registerRes.status === 200) {
    token = registerRes.json('data.token');
    check(registerRes, { 'register created': (r) => r.status === 201 || r.status === 200 });
  } else {
    skippedExisting = true;
    const loginRes = http.post(
      `${BASE_URL}/api/auth/login`,
      JSON.stringify({ username, password: PASSWORD }),
      { headers: JSON_HEADERS, tags: { name: 'login_existing' } }
    );
    if (check(loginRes, { 'existing user login': (r) => r.status === 200 })) {
      token = loginRes.json('data.token');
    }
  }

  if (!token) {
    console.warn(`seed failed index=${index} username=${username}`);
    return;
  }

  const depositRes = http.post(
    `${BASE_URL}/api/deposit`,
    JSON.stringify({ amount: DEPOSIT_AMOUNT }),
    { headers: authHeaders(token), tags: { name: 'deposit' } }
  );

  if (check(depositRes, { 'deposit ok': (r) => r.status === 200 })) {
    seedReady.add(1);
  }

  if (skippedExisting) {
    seedSkippedExisting.add(1);
  }
}

export function handleSummary(data) {
  const ready = data.metrics.seed_ready?.values?.count ?? 0;
  const skipped = data.metrics.seed_skipped_existing?.values?.count ?? 0;
  console.log('\n=== Seed summary ===');
  console.log(`Target: loaduser_${START_INDEX} .. loaduser_${START_INDEX + COUNT - 1}`);
  console.log(`Ready (deposit OK): ${ready} / ${COUNT}`);
  console.log(`Skipped (already existed): ${skipped}`);
  console.log("Verify: SELECT count(*) FROM users WHERE username LIKE 'loaduser_%';");
  return {};
}
