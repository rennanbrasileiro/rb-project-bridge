const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchWithRetry, isRetryableNetworkError, safeRequestUrl } = require('../electron/services/base44-service.cjs');

test('Base44 network retry recovers after transient fetch failures', async () => {
  let calls = 0;
  const response = await fetchWithRetry('https://app.base44.com/api/apps/test/eject?secret=x', { method: 'GET' }, {
    attempts: 4,
    timeoutMs: 1000,
    waits: [1, 1, 1],
    fetchImpl: async () => {
      calls += 1;
      if (calls < 3) { const error = new TypeError('fetch failed'); error.cause = { code: 'ECONNRESET' }; throw error; }
      return new Response('ok', { status: 200 });
    },
  });
  assert.equal(response.status, 200);
  assert.equal(calls, 3);
});

test('Base44 network retry exposes useful final diagnostics', async () => {
  await assert.rejects(() => fetchWithRetry('https://app.base44.com/api/apps/test/eject', {}, {
    attempts: 2,
    timeoutMs: 1000,
    waits: [1],
    fetchImpl: async () => { const error = new TypeError('fetch failed'); error.cause = { code: 'ENOTFOUND', hostname: 'app.base44.com' }; throw error; },
  }), (error) => error.code === 'BASE44_NETWORK_FAILED' && error.details.code === 'ENOTFOUND' && error.details.attempt === 2);
  assert.equal(isRetryableNetworkError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })), true);
  assert.equal(safeRequestUrl('https://app.base44.com/api/apps/x/eject?token=secret'), 'https://app.base44.com/api/apps/x/eject');
});
