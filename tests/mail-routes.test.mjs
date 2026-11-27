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
      date: example.now - 10, unread: true, starred: false, count: 2 },
    { account: 'work', id: 'middle', from: 'middle@example.test', subject: 'Middle',
      date: example.now - 20, unread: false, starred: false, count: 1 },
  ], hasMore: true, unread: 2, loading: false });
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
  // The app reads an incomplete page again (G2 2026-11-27: the first Email open showed one thread).
  assert.equal(first.data.loading, true);
  release();
  let page;
  for (let i = 0; i < 10 && !page?.items.length; i++) page = (await get(route)).data;
  assert.deepEqual(page.items.map(item => item.id), ['newest', 'middle']);
  assert.equal(page.loading, false);
});

test('A slow mailbox-wide unread scan does not mark complete rows as loading', async t => {
  const example = fixture();
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const get = await serve(t, config, { ...example, transport: async (url, options) => {
    const parsed = new URL(url);
    // After the 2026-11-27 reboot the UNREAD scan of a large mailbox took 20-30 s.
    if (parsed.pathname.endsWith('/threads') && parsed.searchParams.get('labelIds') === 'UNREAD') await held;
    return example.transport(url, options);
  } }, 25);
  const route = '/api/mail/threads?filter=work:INBOX';
  let page;
  for (let i = 0; i < 10 && page?.items.length !== 2; i++) page = (await get(route)).data;
  assert.deepEqual(page.items.map(item => item.id), ['newest', 'middle']);
  assert.equal(page.loading, false);
  release();
});

test('A page whose thread summaries are still arriving is marked loading and completes later', async t => {
  const example = fixture();
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const get = await serve(t, config, { ...example, transport: async (url, options) => {
    if (new URL(url).pathname.endsWith('/threads/middle')) await held;
    return example.transport(url, options);
  } }, 25);
  const route = '/api/mail/threads?filter=work:INBOX';
  let first;
  for (let i = 0; i < 10 && !first?.items.length; i++) first = (await get(route)).data;
  assert.deepEqual(first.items.map(item => item.id), ['newest']);
  assert.equal(first.loading, true);
  release();
  let page;
  for (let i = 0; i < 10 && page?.items.length !== 2; i++) page = (await get(route)).data;
  assert.deepEqual(page.items.map(item => item.id), ['newest', 'middle']);
  assert.equal(page.loading, false);
});

// Keyboard mail actions, compose prefill and send (2026-11-27). Synthetic mailbox only.
function actionFixture() {
  const base = fixture();
  const inbox = new Set(['newest', 'middle']);
  const trashed = new Set();
  const sent = [];
  const transport = (url, options) => {
    const { pathname } = new URL(url);
    const route = pathname.replace('/gmail/v1/users/me', '');
    if (route === '/threads' && new URL(url).searchParams.get('labelIds') === 'INBOX') {
      base.calls.push({ route, searchParams: new URL(url).searchParams, method: options.method });
      return Response.json({ threads: [...inbox].filter(id => !trashed.has(id)).map(id => ({ id })) });
    }
    if (route === '/threads/newest/modify' && options.body === '{"removeLabelIds":["INBOX"]}') { inbox.delete('newest'); return Response.json({ id: 'newest' }); }
    if (route === '/threads/newest/modify' && options.body === '{"addLabelIds":["INBOX"]}') { inbox.add('newest'); return Response.json({ id: 'newest' }); }
    if (route === '/threads/middle/trash') { trashed.add('middle'); return Response.json({ id: 'middle' }); }
    if (route === '/threads/middle/untrash') { trashed.delete('middle'); return Response.json({ id: 'middle' }); }
    if (route === '/threads/newest/modify' && /STARRED|"addLabelIds":\["UNREAD"\]/.test(options.body)) return Response.json({ id: 'newest' });
    if (route === '/messages/send') { sent.push(JSON.parse(options.body)); return Response.json({ id: `sent-${sent.length}`, threadId: 'newest' }); }
    if (route === '/threads/newest' && new URL(url).searchParams.get('format') === 'full') {
      return Response.json({ messages: [{
        id: 'reply', internalDate: String(base.now - 10), labelIds: ['INBOX'],
        payload: { mimeType: 'text/plain', body: { data: Buffer.from('Line one\nLine two').toString('base64url') }, headers: [
          { name: 'From', value: '"Newest Sender" <newest@example.test>' }, { name: 'Subject', value: 'Synthetic plan' },
          { name: 'To', value: `${address}, other@example.test` }, { name: 'Cc', value: '"Cc Person" <cc@example.test>, fixture@example.test' },
          { name: 'Message-ID', value: '<m2@example.test>' }, { name: 'References', value: '<m1@example.test>' },
          { name: 'Date', value: 'Wed, 25 Nov 2026 10:00:00 +0000' },
        ] },
      }] });
    }
    return base.transport(url, options);
  };
  return { ...base, transport, inbox, trashed, sent };
}
const decodeRaw = raw => Buffer.from(raw, 'base64url').toString('utf8');
const bodyOf = message => Buffer.from(message.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8');

test('Mail keyboard actions archive, trash, undo, mark unread and star through the allowlist', async t => {
  const example = actionFixture();
  const get = await serve(t, config, example);
  const inbox = '/api/mail/threads?filter=work:INBOX&size=8';
  assert.deepEqual((await get(inbox)).data.items.map(i => i.id), ['newest', 'middle']);
  const act = (threadId, action) => get('/api/mail/modify', { method: 'POST', body: { account: 'work', threadId, action } });
  assert.deepEqual((await act('newest', 'archive')).data, { ok: true });
  assert.deepEqual((await get(inbox)).data.items.map(i => i.id), ['middle'], 'archived thread leaves the Inbox list at once');
  assert.deepEqual((await act('newest', 'unarchive')).data, { ok: true });
  assert.deepEqual((await get(inbox)).data.items.map(i => i.id), ['newest', 'middle'], 'undo puts it back');
  assert.deepEqual((await act('middle', 'trash')).data, { ok: true });
  assert.deepEqual((await get(inbox)).data.items.map(i => i.id), ['newest']);
  assert.deepEqual((await act('middle', 'untrash')).data, { ok: true });
  assert.deepEqual((await get(inbox)).data.items.map(i => i.id), ['newest', 'middle']);
  for (const action of ['star', 'unstar', 'unread']) assert.deepEqual((await act('newest', action)).data, { ok: true }, action);
  for (const action of ['delete', 'spam', '', undefined]) assert.equal((await act('newest', action)).status, 400, String(action));
  assert.equal((await act('../x', 'archive')).status, 400);
});

test('Mail compose prefills reply, reply all and forward like Gmail, without your own address', async t => {
  const example = actionFixture();
  const get = await serve(t, config, example);
  const compose = mode => get(`/api/mail/compose?account=work&id=newest&mode=${mode}`);
  assert.deepEqual((await compose('reply')).data, { to: '"Newest Sender" <newest@example.test>', cc: '', subject: 'Re: Synthetic plan' });
  assert.deepEqual((await compose('replyAll')).data, {
    to: '"Newest Sender" <newest@example.test>, other@example.test', cc: '"Cc Person" <cc@example.test>', subject: 'Re: Synthetic plan' });
  assert.deepEqual((await compose('forward')).data, { to: '', cc: '', subject: 'Fwd: Synthetic plan' });
  assert.equal((await compose('new')).status, 400);
});

test('Mail send builds the message itself, threads replies, sends once per id and refuses header injection', async t => {
  const example = actionFixture();
  const get = await serve(t, config, example);
  const send = body => get('/api/mail/send', { method: 'POST', body: { account: 'work', sendId: 'fixture-send-1', ...body } });
  const reply = { mode: 'reply', threadId: 'newest', to: '"Newest Sender" <newest@example.test>', cc: '', subject: 'Re: Synthetic plan', body: 'Thanks, done.\nSecond line' };
  assert.deepEqual((await send(reply)).data, { ok: true, id: 'sent-1' });
  assert.deepEqual((await send(reply)).data, { ok: true, id: 'sent-1' }, 'the same send id never sends twice');
  assert.equal(example.sent.length, 1);
  assert.equal(example.sent[0].threadId, 'newest');
  const message = decodeRaw(example.sent[0].raw);
  const headers = message.split('\r\n\r\n')[0].split('\r\n');
  assert.deepEqual(headers, ['To: "Newest Sender" <newest@example.test>', 'Subject: Re: Synthetic plan',
    'In-Reply-To: <m2@example.test>', 'References: <m1@example.test> <m2@example.test>',
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64']);
  const body = bodyOf(message);
  assert.match(body, /^Thanks, done\.\r\nSecond line\r\n\r\nOn [^\r\n]+ GMT, "Newest Sender" <newest@example\.test> wrote:\r\n> Line one\r\n> Line two$/);
  // New mail: no thread, non-ASCII subject encoded.
  await send({ mode: 'new', sendId: 'fixture-send-2', to: 'a@example.test, B <b@example.test>', cc: 'c@example.test', subject: '測試 plan', body: 'Hi' });
  const fresh = decodeRaw(example.sent[1].raw);
  assert.equal(example.sent[1].threadId, undefined);
  assert.match(fresh, /^To: a@example\.test, "B" <b@example\.test>\r\nCc: c@example\.test\r\nSubject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=\r\n/);
  // Forward: its own thread, the forwarded block below.
  await send({ mode: 'forward', sendId: 'fixture-send-3', threadId: 'newest', to: 'd@example.test', subject: 'Fwd: Synthetic plan', body: 'FYI' });
  assert.equal(example.sent[2].threadId, undefined);
  assert.match(bodyOf(decodeRaw(example.sent[2].raw)), /FYI\r\n\r\n---------- Forwarded message ---------\r\nFrom: "Newest Sender"/);
  // Refused before any Gmail call.
  const before = example.sent.length;
  for (const [field, value] of [['to', 'a@example.test\r\nBcc: x@example.test'], ['subject', 'Hi\r\nBcc: x@example.test'],
    ['to', 'not-an-address'], ['to', ''], ['mode', 'draft'], ['sendId', 'x'], ['body', 'x'.repeat(50_001)]]) {
    const result = await send({ mode: 'new', sendId: `fixture-bad-${field}`, to: 'a@example.test', subject: 's', body: 'b', [field]: value });
    assert.equal(result.status, 400, `${field}=${String(value).slice(0, 20)}`);
  }
  assert.equal(example.sent.length, before);
});
