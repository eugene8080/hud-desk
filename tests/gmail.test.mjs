import test from 'node:test';
import assert from 'node:assert/strict';
import { createGmail, TOKEN_URL } from '../bridge/gmail.mjs';

const credentials = async () => ({ client_id: 'fixture', client_secret: 'fixture', refresh_token: 'fixture' });
const json = (body, status = 200) => Response.json(body, { status });

test('Gmail rejects all disallowed operations before any transport call', async () => {
  let calls = 0;
  let loads = 0;
  const gmail = createGmail(null, null, {
    credentials: () => { loads++; },
    transport: () => { calls++; },
  });
  const mutation = { removeLabelIds: ['UNREAD'] };
  for (const [method, path, body] of [
    ['POST', '/messages/send', {}], ['POST', '/drafts', {}], ['GET', '/drafts'],
    ['POST', '/threads/abc/trash', {}], ['DELETE', '/threads/abc'],
    ['POST', '/threads/abc/modify', { addLabelIds: ['UNREAD'] }],
    ['POST', '/threads/abc/modify', { removeLabelIds: ['INBOX'] }],
    ['POST', '/threads/abc/modify', { removeLabelIds: ['UNREAD', 'INBOX'] }],
    ['POST', '/threads/abc/modify', { ...mutation, addLabelIds: [] }],
    ['POST', '/threads/abc/modify', { ...mutation, extra: 1 }],
    ['POST', '/threads/abc/modify', { ...mutation, [Symbol('extra')]: 1 }],
    ['POST', '/threads/abc/modify', null], ['GET', '/threads/abc/modify'],
    ['PATCH', '/threads/abc/modify', mutation], ['POST', '/profile', {}],
    ['GET', '/profile', {}], ['GET', '/unknown'], ['GET', '/messages'],
    ['GET', '/threads/../drafts'], ['GET', '/threads/a%2ftrash'], ['GET', '/profile?x=1'],
    ['GET', '/profile\n'], ['GET', 'https://example.test/profile'],
  ]) {
    await assert.rejects(gmail(method, path, { body }), { code: 'disallowed' }, `${method} ${path}`);
  }
  assert.equal(calls, 0);
  assert.equal(loads, 0);
});

test('Gmail accepts exactly the listed reads and the canonical unread removal', async () => {
  const calls = [];
  const gmail = createGmail(null, null, {
    credentials,
    transport: (url, options) => {
      calls.push({ url: String(url), ...options });
      return String(url) === TOKEN_URL ? json({ access_token: 'access', expires_in: 60 }) : json({ ok: true });
    },
  });
  const paths = ['/profile', '/labels', '/labels/Label_123', '/threads', '/threads/abc', '/messages/def'];
  await Promise.all(paths.map(path => gmail('GET', path)));
  await gmail('POST', '/threads/abc/modify', { body: { removeLabelIds: ['UNREAD'] } });
  assert.equal(calls.filter(c => c.url === TOKEN_URL).length, 1);
  assert.deepEqual(calls.slice(1).map(c => new URL(c.url).pathname), [
    ...paths, '/threads/abc/modify',
  ].map(path => `/gmail/v1/users/me${path}`));
  assert(calls.slice(1, -1).every(c => c.method === 'GET' && c.body === undefined));
  assert.equal(calls.at(-1).headers.Authorization, 'Bearer access');
  assert.equal(calls.at(-1).body, '{"removeLabelIds":["UNREAD"]}');
});

test('Gmail caches until expiry and exponentially backs off on 429 and 403 rate limits', async () => {
  let time = 1000;
  let refreshes = 0;
  let apiCalls = 0;
  const delays = [];
  const gmail = createGmail(null, null, {
    credentials, now: () => time, sleep: async ms => delays.push(ms), jitter: () => 0,
    transport: url => {
      if (String(url) === TOKEN_URL) return json({ access_token: `access-${++refreshes}`, expires_in: 10 });
      switch (++apiCalls) {
        case 1: return json({}, 429);
        case 2: return json({ error: { errors: [{ reason: 'rateLimitExceeded' }] } }, 403);
        case 3: return json({ error: { errors: [{ reason: 'userRateLimitExceeded' }] } }, 403);
        case 6: return json({ error: { errors: [{ reason: 'forbidden' }] } }, 403);
        default: return json({ ok: true });
      }
    },
  });
  assert.deepEqual(await gmail('GET', '/profile'), { ok: true });
  time = 10_999;
  await gmail('GET', '/profile');
  assert.equal(refreshes, 1);
  time = 11_000;
  await assert.rejects(gmail('GET', '/profile'), { code: 'auth' });
  assert.equal(refreshes, 2);
  assert.equal(apiCalls, 6);
  assert.deepEqual(delays, [1000, 2000, 4000]);
});
