import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import test from 'node:test';
import { createBeeperClient, readBeeperConfig } from '../bridge/beeper.mjs';
import { createBridge } from '../bridge/server.mjs';
import { createBeeperFixture, fixtureChatId } from '../scripts/beeper-fixture.mjs';

const chatId = fixtureChatId(0);
const messagesPath = `/v1/chats/${encodeURIComponent(chatId)}/messages`;
const readToken = async () => 'fixture-token\r\n';

async function serve(t, { config = {}, mailConfig = null, transport = () => assert.fail('Unexpected Beeper request'), coldWaitMs, sleep } = {}) {
  const server = createBridge({ token: 'bridge-fixture', mailConfig, beeperConfig: config,
    privateHosts: ['127.0.0.1'], beeperOptions: { coldWaitMs, clientOptions: { transport, readToken, sleep } },
  }).listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await once(server, 'listening');
  return (path, { method = 'GET', body, headers = {} } = {}) => new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: server.address().port, path, method,
      headers: { authorization: 'Bearer bridge-fixture', ...headers },
    }, async response => {
      try {
        let raw = '';
        for await (const chunk of response) raw += chunk;
        resolve({ status: response.statusCode, headers: response.headers, data: raw ? JSON.parse(raw) : null });
      } catch (error) { reject(error); }
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

test('Beeper token configuration defaults under the gitignored local directory', () => {
  assert.match(readBeeperConfig({}).tokenFile, /[\\/]\.local[\\/]beeper-token\.txt$/);
  assert.equal(readBeeperConfig({ tokenFile: 'bridge/token.txt' }), null);
  assert.equal(readBeeperConfig({ tokenFile: '.local/../token.txt' }), null);
  assert.equal(readBeeperConfig({ refreshSeconds: 0 }), null);
  assert.equal(readBeeperConfig(undefined), null);
});

test('Beeper allowlist refuses other operations and text mutations before credentials or transport', async () => {
  let calls = 0;
  const client = createBeeperClient('', { readToken: async () => { calls++; }, transport: () => { calls++; } });
  for (const [method, path, body] of [
    ['POST', '/v1/chats'],
    ['POST', `/v1/chats/${encodeURIComponent(chatId)}/read`],
    ['GET', `/v1/chats/${encodeURIComponent(chatId)}`],
    ['GET', '/v1/messages/search'],
    ['PATCH', messagesPath],
    ['GET', messagesPath, { text: 'Fixture' }],
    ['POST', messagesPath, { text: 'Fixture', attachment: {} }],
    ['POST', messagesPath, { text: 'Fixture', replyToMessageID: 'fixture' }],
    ['POST', messagesPath, { text: ' ' }],
    ['GET', '/v1/chats/../messages'],
    ['GET', '/v1/chats/%2e%2e/messages'],
    ['GET', '/v1/chats/%252e%252e/messages'],
    ['GET', '/v1/chats/one%2Ftwo/messages'],
    ['GET', '/v1/accounts?extra=1'],
    ['GET', '//example.test/v1/accounts'],
  ]) await assert.rejects(client(method, path, { body }), { code: 'disallowed' });
  assert.equal(calls, 0);
});

test('Beeper retries transient GET errors with back-off and never retries a POST', async () => {
  const waits = [], methods = [];
  const client = createBeeperClient('', { readToken, sleep: async n => waits.push(n), transport: async (url, options) => {
    assert.equal(url.origin, 'http://127.0.0.1:23373');
    assert.equal(options.redirect, 'error');
    methods.push(options.method);
    if (methods.length === 1) return Response.json({}, { status: 429, headers: { 'retry-after': '1' } });
    if (methods.length === 3) return Response.json([]);
    return Response.json({}, { status: 503 });
  } });
  assert.deepEqual(await client('GET', '/v1/accounts'), []);
  assert.deepEqual(waits, [1000, 500]);
  await assert.rejects(client('POST', messagesPath, { body: { text: 'Fixture' } }), { code: 'beeper-request' });
  assert.deepEqual(methods, ['GET', 'GET', 'GET', 'POST']);
});

test('Chat routes require private host and bearer, including the send and CORS gate', async t => {
  const fixture = createBeeperFixture();
  const request = await serve(t, fixture);
  for (const headers of [{ 'cf-ray': '' }, { 'cf-connecting-ip': '' }, { host: 'public.example.test' }]) {
    const blocked = await request('/api/chat/send', { method: 'POST', body: { chatId, text: 'Fixture' }, headers });
    assert.equal(blocked.status, 403);
    assert.deepEqual(blocked.data, { error: 'private-route' });
  }
  assert.equal((await request('/api/chat/networks', { headers: { authorization: '' } })).status, 401);
  assert.equal((await request('/api/chat/list', { method: 'OPTIONS', headers: { authorization: '', 'cf-ray': '' } })).status, 403);
  assert.equal((await request('/api/chat/list', { method: 'OPTIONS', headers: { authorization: '' } })).status, 204);
  assert.equal(fixture.calls.length, 0);
});

test('Capabilities add Chat only with a Beeper config and put it after Email', async t => {
  const transport = () => { assert.fail('Capabilities should not reach Beeper'); };
  const absent = await serve(t, { config: null, transport });
  assert.deepEqual((await absent('/api/capabilities')).data.modules, ['coding']);
  assert.equal((await absent('/api/chat/networks')).status, 404);
  const chatOnly = await serve(t, { transport });
  assert.deepEqual((await chatOnly('/api/capabilities')).data.modules, ['coding', 'chat']);
  const mailConfig = { oauthClientFile: 'fixture.json', windowDays: 30, refreshSeconds: 120,
    accounts: [{ id: 'fixture', short: 'F', address: 'mail@example.test', tokenFile: '.local/fixture.json' }] };
  const all = await serve(t, { mailConfig, transport });
  assert.deepEqual((await all('/api/capabilities')).data.modules, ['coding', 'email', 'chat']);
});

test('Chat routes page a cached network filter, read without mutating, and submit one text reply', async t => {
  const fixture = createBeeperFixture();
  const request = await serve(t, fixture);
  const networks = await request('/api/chat/networks');
  assert.deepEqual(networks.data, ['Signal', 'Telegram', 'WhatsApp']);
  assert.equal(networks.headers['cache-control'], 'no-store');
  const first = (await request('/api/chat/list?page=0')).data;
  assert.equal(first.items.length, 8);
  assert.equal(first.items[0].id, chatId);
  assert.equal(first.items[0].unread, true);
  assert.equal(first.items[1].unread, false);
  assert.equal(first.unread, 4);
  assert.equal(first.hasMore, true);
  const second = (await request('/api/chat/list?page=1')).data;
  assert.equal(second.items.length, 2);
  assert.equal(second.items[1].readOnly, true);
  assert.equal(second.hasMore, false);
  const filtered = (await request('/api/chat/list?networks=Telegram,WhatsApp')).data;
  assert.equal(filtered.items.length, 6);
  assert.equal(filtered.unread, 0);
  assert.deepEqual(fixture.calls.map(call => call.cursor), [null, null, 'older']);
  assert.equal((await request('/api/chat/list?page=-1')).status, 400);
  assert.equal((await request('/api/chat/messages?id=%2e%2e')).status, 400);

  const reader = `/api/chat/messages?id=${encodeURIComponent(chatId)}`;
  const { messages } = (await request(reader)).data;
  assert.deepEqual(messages.map(item => item.own), [true, false]);
  assert.equal(messages[1].from, 'Fixture sender');
  assert.ok(messages[1].date > messages[0].date);
  assert.equal((await request('/api/chat/list')).data.items[0].unread, true);
  assert.equal(fixture.calls.filter(call => call.method === 'POST').length, 0);
  assert.equal((await request('/api/chat/send', { method: 'POST', body: { chatId, text: 'Synthetic reply.', extra: true } })).status, 400);
  const sent = await request('/api/chat/send', { method: 'POST', body: { chatId, text: 'Synthetic reply.' } });
  assert.deepEqual(sent.data, { ok: true });
  assert.deepEqual(fixture.sends, [{ id: chatId, text: 'Synthetic reply.' }]);
  assert.equal((await request(reader)).data.messages.at(-1).own, true);
});

test('A cold list returns before the remaining Beeper snapshot and later serves cached rows', async t => {
  const fixture = createBeeperFixture();
  let release, reached;
  const blocked = new Promise(resolve => { release = resolve; });
  const secondPage = new Promise(resolve => { reached = resolve; });
  const transport = async (url, options) => {
    if (url.searchParams.get('cursor') === 'older') { reached(); await blocked; }
    return fixture.transport(url, options);
  };
  const request = await serve(t, { transport, coldWaitMs: 25 });
  const list = request('/api/chat/list');
  await secondPage;
  try {
    const partial = await list;
    assert.equal(partial.status, 200);
    assert.ok(partial.data.items.length <= 6);
    assert.equal((await request('/api/chat/list')).data.items.length, 6);
  } finally { release(); }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await request('/api/chat/list')).data.items.length, 8);
});

test('A Beeper disconnect after accepting a POST maps to a fixed error without replay', async t => {
  const fixture = createBeeperFixture();
  const request = await serve(t, { transport: async (...args) => {
    await fixture.transport(...args);
    throw new Error('Fixture transport disconnected');
  } });
  const result = await request('/api/chat/send', { method: 'POST', body: { chatId, text: 'Synthetic reply.' } });
  assert.deepEqual(result.data, { error: 'beeper-network' });
  assert.equal(result.status, 502);
  assert.equal(fixture.sends.length, 1);
});
