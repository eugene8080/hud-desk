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

async function serve(t, { config = {}, mailConfig = null, transport = () => assert.fail('Unexpected Beeper request'), coldWaitMs, sleep, speech, ollamaTransport } = {}) {
  const server = createBridge({ token: 'bridge-fixture', mailConfig, beeperConfig: config,
    privateHosts: ['127.0.0.1'], beeperOptions: { coldWaitMs, speech, ollamaTransport, clientOptions: { transport, readToken, sleep } },
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
  const defaults = readBeeperConfig({});
  assert.equal(defaults.translationModel, 'qwen3.8:27b');
  assert.deepEqual({ language: defaults.speech.language, script: defaults.speech.script }, { language: 'yue', script: 's2hk' });
  const configured = readBeeperConfig({ asrLanguage: 'zh', asrScript: 'none', asrPython: '.local/fixture/python', ffmpegPath: '.local/fixture/ffmpeg' });
  assert.equal(configured.speech.language, 'zh');
  assert.equal(configured.speech.script, 'none');
  assert.match(configured.speech.python, /[\\/]fixture[\\/]python$/);
  assert.match(configured.speech.ffmpeg, /[\\/]fixture[\\/]ffmpeg$/);
});

test('Beeper allowlist refuses other operations and text mutations before credentials or transport', async () => {
  let calls = 0;
  const client = createBeeperClient('', { readToken: async () => { calls++; }, transport: () => { calls++; } });
  for (const [method, path, body] of [
    ['POST', '/v1/chats'],
    ['POST', `/v1/chats/${encodeURIComponent(chatId)}/read`],
    ['POST', `/v1/chats/${encodeURIComponent(chatId)}/read`, { messageID: 'fixture' }],
    ['GET', `/v1/chats/${encodeURIComponent(chatId)}/read`, {}],
    ['POST', `/v1/chats/${encodeURIComponent(chatId)}/unread`, {}],
    ['POST', '/v1/chats/%2e%2e/read', {}],
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
  for (const [method, path, url] of [
    ['GET', '/v1/assets/download', 'mxc://fixture.test/audio'],
    ['POST', '/v1/assets/serve', 'mxc://fixture.test/audio'],
    ['GET', '/v1/assets/serve', 'file:///fixture/private'],
    ['GET', '/v1/assets/serve', 'https://fixture.test/audio'],
    ['GET', '/v1/assets/serve?url=other', 'mxc://fixture.test/audio'],
    ['GET', '/v1/assets/serve', undefined],
  ]) await assert.rejects(client(method, path, { query: { url } }), { code: 'disallowed' });
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
  for (const path of ['transcribe', 'translate', 'read']) {
    const route = `/api/chat/${path}`;
    assert.equal((await request(route, { method: 'POST', headers: { 'cf-ray': '' }, body: {} })).status, 403);
    assert.equal((await request(route, { method: 'POST', headers: { authorization: '' }, body: {} })).status, 401);
  }
  assert.equal(fixture.calls.length, 0);
});

test('Capabilities report which Chat features this PC can serve', async t => {
  const missing = await serve(t, { speech: { available: () => false, transcribe: async () => assert.fail('no transcription') },
    ollamaTransport: async () => { throw new Error('Ollama is not running'); } });
  assert.deepEqual((await missing('/api/capabilities')).data.chatFeatures, { transcribe: false, translate: false });
  const ready = await serve(t, { speech: { available: () => true, transcribe: async () => ({}) },
    ollamaTransport: async () => Response.json({ model_info: { 'general.architecture': 'fixture' } }) });
  assert.deepEqual((await ready('/api/capabilities')).data.chatFeatures, { transcribe: true, translate: true });
  // A cloud alias is not a local model.
  const cloud = await serve(t, { speech: { available: () => true, transcribe: async () => ({}) },
    ollamaTransport: async () => Response.json({ model_info: { 'general.architecture': 'fixture' }, remote_host: 'https://fixture.test' }) });
  assert.equal((await cloud('/api/capabilities')).data.chatFeatures.translate, false);
});

test('Opening a chat marks the whole chat read: one POST with an empty body, list row updated', async t => {
  const calls = [];
  const request = await serve(t, { transport: async (url, options) => {
    calls.push({ method: options.method, path: url.pathname, body: options.body });
    if (url.pathname === '/v1/accounts') return Response.json([{ accountID: 'fixture', network: 'Signal' }]);
    if (url.pathname === '/v1/chats') return Response.json({ items: [{ id: chatId, title: 'Sample', accountID: 'fixture', unreadCount: 2, lastActivity: '2026-11-27T00:00:00Z' }], hasMore: false });
    if (url.pathname === `/v1/chats/${encodeURIComponent(chatId)}/read`) return Response.json({ id: chatId, unreadCount: 0 });
    return assert.fail(`Unexpected ${options.method} ${url.pathname}`);
  } });
  let list;
  for (let i = 0; i < 10 && !list?.items?.length; i++) list = (await request('/api/chat/list?networks=&page=0')).data;
  assert.equal(list.items[0].unread, true);
  const marked = await request('/api/chat/read', { method: 'POST', body: { chatId } });
  assert.deepEqual(marked.data, { ok: true });
  assert.deepEqual(calls.filter(call => call.method === 'POST'), [{ method: 'POST', path: `/v1/chats/${encodeURIComponent(chatId)}/read`, body: '{}' }]);
  assert.equal((await request('/api/chat/list?networks=&page=0')).data.items[0].unread, false);
  for (const body of [{}, { chatId, messageId: 'fixture' }, { chatId: '' }]) {
    assert.equal((await request('/api/chat/read', { method: 'POST', body })).status, 400);
  }
});

test('HTML line breaks in Beeper text become line breaks', async t => {
  const request = await serve(t, { transport: () => Response.json({ items: [{ id: 'one', type: 'TEXT', text: 'One<br>Two<br/>Three' }] }) });
  const { data } = await request(`/api/chat/messages?id=${encodeURIComponent(chatId)}`);
  assert.equal(data.messages[0].text, 'One\nTwo\nThree');
});

test('Chat keeps each supported media type and exposes only voice metadata', async t => {
  const kinds = ['TEXT', 'NOTICE', 'VOICE', 'AUDIO', 'IMAGE', 'VIDEO', 'STICKER', 'FILE', 'LOCATION', 'REACTION'];
  const items = kinds.map(type => ({ id: type.toLowerCase(), type, text: ['TEXT', 'NOTICE', 'IMAGE', 'REACTION'].includes(type) ? 'Synthetic caption.' : '' }));
  items[2].attachments = [{ type: 'audio', srcURL: 'mxc://fixture.test/first', duration: 12.9,
    transcription: { transcription: '巴士已經到站。', language: 'yue' }, fileName: 'synthetic.ogg' }];
  items.push({ id: 'hidden', type: 'VOICE', isHidden: true }, { id: 'deleted', type: 'TEXT', text: 'Deleted.', isDeleted: true },
    { id: 'voice-note', type: 'TEXT', attachments: [{ type: 'audio', isVoiceNote: true }] });
  const request = await serve(t, { transport: url => {
    assert.equal(url.pathname, messagesPath);
    return Response.json({ items });
  } });
  const { data } = await request(`/api/chat/messages?id=${encodeURIComponent(chatId)}`);
  assert.deepEqual(data.messages.map(({ media }) => media), [undefined, undefined, 'Voice', 'Audio', 'Photo', 'Video',
    'Sticker', 'File', 'Location', 'Voice']);
  assert.equal(data.messages[4].text, 'Synthetic caption.');
  assert.deepEqual(data.messages[2].voice, { id: 'voice', duration: 12.9, transcript: '巴士已經到站。', language: 'yue' });
  assert.deepEqual(data.messages[3].voice, { id: 'audio' });
  assert.doesNotMatch(JSON.stringify(data), /mxc|fileName|synthetic\.ogg/);
});

test('Chat transcribes only the selected attachment and caches the transcript', async t => {
  const calls = [];
  let inferences = 0;
  const audio = 'fake-audio-bytes';
  const asset = 'mxc://fixture.test/audio';
  const request = await serve(t, {
    transport: (url, options) => {
      calls.push([options.method, url.pathname]);
      if (url.pathname === messagesPath) return Response.json({ items: [
        { id: 'voice', type: 'VOICE', attachments: [{ type: 'audio', id: asset }] },
        { id: 'missing', type: 'VOICE' },
        { id: 'deleted', type: 'VOICE', isDeleted: true, attachments: [{ type: 'audio', id: asset }] },
      ] });
      assert.equal(url.pathname, '/v1/assets/serve');
      assert.equal(url.searchParams.get('url'), asset);
      return new Response(audio);
    },
    speech: { async transcribe(loadAudio) {
      assert.equal((await loadAudio()).toString(), audio);
      inferences++;
      return { text: '電車が着きました。', language: 'japanese' };
    } },
  });
  const post = (messageId, extra = {}) => request('/api/chat/transcribe', { method: 'POST', body: { chatId, messageId, ...extra } });
  assert.equal((await post('voice', { url: asset })).status, 400);
  assert.equal((await post('missing')).status, 404);
  assert.equal((await post('deleted')).status, 404);
  const [first, second] = await Promise.all([post('voice'), post('voice')]);
  assert.deepEqual(first.data, { text: '電車が着きました。', language: 'japanese' });
  assert.deepEqual(second.data, first.data);
  assert.equal(inferences, 1);
  const { data } = await request(`/api/chat/messages?id=${encodeURIComponent(chatId)}`);
  assert.equal(data.messages[0].voice.transcript, first.data.text);
  assert.deepEqual(calls.filter(([, path]) => path !== messagesPath), [['GET', '/v1/assets/serve']]);
});

test('Chat batches translation, keeps English and blocks remote Ollama models before sending text', async t => {
  const source = '巴士已經到站。';
  const items = [
    { id: 'english', type: 'TEXT', text: 'Synthetic English.' },
    { id: 'voice', type: 'AUDIO', attachments: [{ type: 'audio', transcription: { transcription: source, language: 'yue' } }] },
    { id: 'english-voice', type: 'VOICE', attachments: [{ type: 'audio', transcription: { transcription: 'Already English.', language: 'en-US' } }] },
  ];
  const calls = [];
  let remote = false;
  const request = await serve(t, {
    config: { translationModel: 'fixture:local' },
    transport: () => Response.json({ items }),
    ollamaTransport: (url, options) => {
      const { pathname, origin } = new URL(url);
      assert.equal(origin, 'http://127.0.0.1:11434');
      calls.push(pathname);
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'fixture:local');
      if (pathname === '/api/show') return Response.json({
        model_info: { 'general.architecture': 'fixture' }, ...(remote && { remote_host: 'https://example.test' }),
      });
      assert.equal(pathname, '/api/chat');
      assert.equal(body.think, false);
      assert.equal(body.stream, false);
      assert.deepEqual(JSON.parse(body.messages[1].content), ['Synthetic English.', source]);
      return Response.json({ message: { content: '[null, "The bus has arrived."]' } });
    },
  });
  const post = () => request('/api/chat/translate', { method: 'POST', body: { chatId, messageIds: ['english', 'voice', 'english-voice', 'absent'] } });
  const expected = { items: [{ id: 'english', text: null }, { id: 'voice', voice: 'The bus has arrived.' }, { id: 'english-voice' }] };
  assert.deepEqual((await post()).data, expected);
  assert.deepEqual((await post()).data, expected);
  assert.deepEqual(calls, ['/api/show', '/api/chat']);
  remote = true;
  items[0].text = 'Synthetic edit.';
  assert.equal((await post()).status, 502);
  assert.deepEqual(calls, ['/api/show', '/api/chat', '/api/show']);
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
