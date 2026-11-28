import test from 'node:test';
import assert from 'node:assert/strict';
import { ADDRESS_ATTEMPT_MS, patientConnections } from '../bridge/network.mjs';

test('outbound connections wait longer than Node\'s 250 ms per address and try IPv4 first', () => {
  const calls = [];
  const result = patientConnections({
    setAttemptTimeout: ms => calls.push(['attempt', ms]),
    setResultOrder: order => calls.push(['order', order]),
  });
  assert.deepEqual(calls, [['attempt', ADDRESS_ATTEMPT_MS], ['order', 'ipv4first']]);
  assert.deepEqual(result, { attemptMs: ADDRESS_ATTEMPT_MS, order: 'ipv4first' });
  // 2026-11-28: IPv4 to Google's token server took ~270 ms through the exit node; the limit must
  // clear that with margin and still fit several attempts inside undici's 10 s connect timeout.
  assert.ok(ADDRESS_ATTEMPT_MS >= 1000 && ADDRESS_ATTEMPT_MS * 3 < 10_000);
});
