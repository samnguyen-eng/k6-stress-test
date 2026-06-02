/** Shared env config for parking K6 scripts */

export const BASE_URL =
  __ENV.BASE_URL || 'https://parking-api-763182684658.asia-southeast1.run.app';

export const PASSWORD = __ENV.PASSWORD || 'Test@123456';
export const USER_COUNT = Number(__ENV.USER_COUNT || 1000);
export const DEPOSIT_AMOUNT = Number(__ENV.DEPOSIT_AMOUNT || 1000);
export const MAX_SPACE_ID = Number(__ENV.MAX_SPACE_ID || 80);

/** Use a new date per test run to avoid "already reserved today" */
export const RESERVATION_DATE =
  __ENV.RESERVATION_DATE || new Date().toISOString().slice(0, 10);

export const JSON_HEADERS = { 'Content-Type': 'application/json' };

export function authHeaders(token) {
  return {
    ...JSON_HEADERS,
    Authorization: `Bearer ${token}`,
  };
}

export function usernameForIndex(index) {
  return `loaduser_${index}`;
}

export function plateForIndex(index) {
  return `K6${String(index).padStart(5, '0')}`;
}
