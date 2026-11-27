import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { once } from 'node:events';
import { createBridge } from '../bridge/server.mjs';
import { TOKEN_URL } from '../bridge/gmail.mjs';

const privateHost = 'device.example.test';
const address = 'fixture@example.test';
const config = {
  oauthClientFile: 'fixture.json', accounts: [{ id: 'work', short: 'W', address, tokenFile: '.local/mail/fixture.json' }],
  windowDays: 30, refreshSeconds: 120,
};

function fixture() {
  const now = Date.now();
  const calls = [];
  const unread = new Set(['newest', 'oldest']);
  const labels = new Map([
    ['INBOX', ['newest', 'middle']],
    ['Label_2', ['newest', 'oldest']],
    ['Label_3', []],
  ]);
  const newestSubject = 'First synthetic subject';
  const mail = (id, offset, name, subject, membership = []) => ({
    id, internalDate: String(now - offset), labelIds: membership,
    payload: {
      mimeType: 'text/plain', body: { data: Buffer.from('A synthetic body').toString('base64url') },
      headers: [
        { name: 'From', value: name }, { name: 'Subject', value: subject },
        { name: 'To', value: address }, { name: 'Cc', value: 'cc@example.test' },
      ],
    },
  });
  const credentials = async () => ({ client_id: 'fixture', client_secret: 'fixture', refresh_token: 'fixture' });
  const transport = (url, options) => {
    const { pathname, searchParams } = new URL(url);
    const route = pathname.replace('/gmail/v1/users/me', '');
    calls.push({ route, searchParams, method: options.method, body: options.body });
    if (String(url) === TOKEN_URL) return Response.json({ access_token: 'fixture', expires_in: 600 });
    if (route === '/profile') return Response.json({ emailAddress: address });
    if (route === '/labels') return Response.json({ labels: [
      { id: 'Label_2', type: 'user', name: 'Z fixture' },
      { id: 'SENT', type: 'system', name: 'SENT' },
      { id: 'INBOX', type: 'system', name: 'INBOX' },
      { id: 'Label_3', type: 'user', name: 'A fixture' },
    ] });
    if (route.startsWith('/labels/')) {
      const members = labels.get(route.split('/').at(-1)) ?? [];
      return Response.json({ threadsUnread: members.filter(id => unread.has(id)).length });
    }
    if (route === '/threads') {
      const label = searchParams.get('labelIds');
      if (label === 'UNREAD') return Response.json({ threads: [...unread].map(id => ({ id })) });
      assert.equal(searchParams.get('q'), 'newer_than:30d');
      const ids = label ? labels.get(label) : ['newest', 'middle', 'oldest'];
      if (!label && !searchParams.has('pageToken')) {
        return Response.json({ threads: [{ id: 'newest' }], nextPageToken: 'fixture-next' });
      }
      return Response.json({ threads: (label ? ids : ids.slice(1)).map(id => ({ id })) });
    }
    if (route === '/threads/newest/modify') {
      assert.equal(options.body, '{"removeLabelIds":["UNREAD"]}');
      unread.delete('newest');
      return Response.json({ id: 'newest' });
    }
    if (route === '/threads/newest') {
      return Response.json({ messages: [
        mail('reply', 10, '"Newest Sender" <newest@example.test>', 'Re: fixture'),
        mail('first', 40, 'first@example.test', newestSubject,
          ['INBOX', 'Label_2', ...(unread.has('newest') ? ['UNREAD'] : [])]),
      ] });
    }
    if (route === '/threads/middle') return Response.json({ messages: [mail('m', 20, 'middle@example.test', 'Middle')] });
    if (route === '/threads/oldest') return Response.json({ messages: [
      mail('o', 30, 'old@example.test', 'Oldest', ['Label_2', 'UNREAD']),
    ] });
    return Response.json({ error: { message: `${address} ${newestSubject}` } }, { status: 500 });
  };
  return { credentials, transport, calls, now, newestSubject };
}

async function serve(t, mailConfig, { transport, credentials }, coldWaitMs) {
  const server = createBridge({
    token: 'fixture-bearer', mailConfig, beeperConfig: null, privateHosts: [privateHost],
    mailOptions: { gmailOptions: { transport, credentials }, coldWaitMs },
  }).listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await once(server, 'listening');
  return (path, { host = 'DEVICE.EXAMPLE.TEST:443', headers = {}, method = 'GET', body, auth = true } = {}) =>
    new Promise((resolve, reject) => {
      const req = request({
        hostname: '127.0.0.1', port: server.address().port, path, method,
        headers: { host, ...(auth ? { authorization: 'Bearer fixture-bearer' } : {}), ...headers },
      }, res => {
        res.setEncoding('utf8');
        let raw = '';
        res.on('data', chunk => { raw += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: raw ? JSON.parse(raw) : null, headers: res.headers });
          } catch (error) { reject(error); }
        });
        res.on('error', reject);
      });
      req.on('error', reject);
      req.end(body && JSON.stringify(body));
    });
}

test('Mail rejects Cloudflare headers (including empty header values) before transport', async t => {
  const example = fixture();
  const get = await serve(t, config, example);
  for (const name of ['cf-ray', 'cf-connecting-ip']) {
    const result = await get('/api/mail/accounts', { headers: { [name]: '' } });
    assert.equal(result.status, 403);
    assert.deepEqual(result.data, { error: 'private-route' });
  }
  assert.equal(example.calls.length, 0);
});

test('Mail rejects the wrong Host after bearer authentication', async t => {
  const example = fixture();
  const get = await serve(t, config, example);
  const result = await get('/api/mail/accounts', { host: 'public.example.test:443' });
  assert.equal(result.status, 403);
  assert.deepEqual(result.data, { error: 'private-route' });
  assert.equal((await get('/api/mail/accounts', { auth: false, host: 'public.example.test' })).status, 401);
  assert.equal(example.calls.length, 0);
});

test('Absent or invalid mail configuration exposes Coding only and returns 404 for mail routes', async t => {
  for (const settings of [null, { ...config, refreshSeconds: 0 }, {
    ...config, accounts: [{ ...config.accounts[0], tokenFile: 'bridge/fixture.json' }],
  }]) {
    const get = await serve(t, settings, fixture());
    const { data } = await get('/api/capabilities');
    assert.deepEqual(data.modules, ['coding']);
    assert.equal(typeof data.voice, 'boolean');
    assert.equal((await get('/api/mail/accounts')).status, 404);
    assert.equal((await get('/api/mail/read', { method: 'POST', body: {} })).status, 404);
  }
});

test('Mail unions and pages labels in newest-first order, fetches visible headers only, and clears snapshot unread', async t => {
  const example = fixture();
  const get = await serve(t, config, example);
  assert.deepEqual((await get('/api/capabilities')).data.modules, ['coding', 'email']);
  const accounts = await get('/api/mail/accounts');
  assert.deepEqual(accounts.data, [{ id: 'work', short: 'W', address, ok: true }]);
  assert.equal(accounts.headers['cache-control'], 'no-store');
  assert.deepEqual((await get('/api/mail/labels?account=work')).data, [
    { id: 'INBOX', name: 'Inbox', unread: 1 },
    { id: 'Label_3', name: 'A fixture', unread: 0 },
    { id: 'Label_2', name: 'Z fixture', unread: 2 },
  ]);
  const route = '/api/mail/threads?filter=work:INBOX,work:Label_2&size=2';
  const first = (await get(route)).data;
  assert.deepEqual(first, { items: [
    { account: 'work', id: 'newest', from: 'Newest Sender', subject: example.newestSubject,
      date: example.now - 10, unread: true, count: 2 },
    { account: 'work', id: 'middle', from: 'middle@example.test', subject: 'Middle',
      date: example.now - 20, unread: false, count: 1 },
  ], hasMore: true, unread: 2 });
  const threadCalls = () => example.calls.filter(c => c.route.startsWith('/threads/'));
  assert.deepEqual(threadCalls().map(c => c.route), ['/threads/newest', '/threads/middle']);
  assert(threadCalls().every(c => c.searchParams.get('format') === 'metadata'));
  assert.deepEqual(threadCalls()[0].searchParams.getAll('metadataHeaders'), ['From', 'Subject', 'Date']);
  const second = (await get(route + '&page=1')).data;
  assert.deepEqual(second.items.map(i => i.id), ['oldest']);
  assert.equal(second.hasMore, false);
  assert.equal(second.unread, 2);

  const open = await get('/api/mail/thread?account=work&id=newest');
  assert.equal(open.data.subject, example.newestSubject);
  assert.deepEqual(open.data.messages, [
    { id: 'first', from: 'first@example.test', to: address, cc: 'cc@example.test',
      date: example.now - 40, text: 'A synthetic body' },
    { id: 'reply', from: 'Newest Sender', to: address, cc: 'cc@example.test',
      date: example.now - 10, text: 'A synthetic body' },
  ]);
  assert.equal(threadCalls().at(-1).searchParams.get('format'), 'full');
  assert(threadCalls().every(c => c.method === 'GET'));
  assert.equal((await get(route)).data.items[0].unread, true);
  const read = { method: 'POST', body: { account: 'work', threadId: 'newest' } };
  assert.deepEqual((await get('/api/mail/read', read)).data, { ok: true });
  assert.deepEqual((await get('/api/mail/read', read)).data, { ok: true });
  const updated = (await get(route)).data;
  assert.equal(updated.items[0].unread, false);
  assert.equal(updated.unread, 1);
  assert.equal((await get('/api/mail/labels?account=work')).data[0].unread, 0);
});

test('Mail errors redact Google text and caller input', async t => {
  const example = fixture();
  const get = await serve(t, config, example);
  const upstream = await get('/api/mail/thread?account=work&id=missing');
  assert.equal(upstream.status, 502);
  assert.deepEqual(upstream.data, { error: 'network' });
  const input = await get('/api/mail/thread?account=' + encodeURIComponent(address) + '&id=fixture');
  assert.equal(input.status, 400);
  assert.deepEqual(input.data, { error: 'bad request' });
});

test('Cold mail lists return cached data within the wait budget and finish loading in the background', async t => {
  const example = fixture();
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const get = await serve(t, config, { ...example, transport: async (url, options) => {
    if (new URL(url).pathname.endsWith('/threads')) await held;
    return example.transport(url, options);
  } }, 25);
  const route = '/api/mail/threads?filter=work:INBOX';
  const first = await get(route);
  assert.equal(first.status, 200);
  assert.deepEqual(first.data.items, []);
  release();
  let list;
  for (let i = 0; i < 10 && !list?.length; i++) list = (await get(route)).data.items;
  assert.deepEqual(list.map(item => item.id), ['newest', 'middle']);
});
