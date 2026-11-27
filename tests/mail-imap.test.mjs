import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { simpleParser } from 'mailparser';
import { createBridge } from '../bridge/server.mjs';
import { readMailConfig } from '../bridge/mail.mjs';

const secret = 'synthetic-app-password-for-test';
const address = 'inbox@example.test';
const privateHost = 'private.example.test';
const gmailThread = '18446744073709551600';
const project = 'Projects/会議';
const all = '[Google Mail]/All Mail';
const trash = 'Deleted Items';
const config = {
  windowDays: 30, refreshSeconds: 120, accounts: [{
    id: 'fixture', short: 'F', provider: 'imap', address, secretFile: '.local/test-fixture.pass',
    imap: { host: 'imap.example.test', port: 993, tls: 'implicit' },
    smtp: { host: 'smtp.example.test', port: 587, tls: 'starttls' },
  }],
};
const mailbox = (path, specialUse) => ({ path, specialUse, flags: new Set() });
const picture = Buffer.alloc(3000, 0x61);

function message(uid, id, { subject = 'Planning', age = uid, references = [], replyTo, labels = [],
  html = false, seen = false, threadId = gmailThread } = {}) {
  const date = new Date(Date.now() - age * 86_400_000);
  const from = 'Sender <sender@example.test>';
  const source = [
    `Message-ID: <${id}@example.test>`, `Date: ${date.toUTCString()}`, `From: ${from}`,
    `To: ${address}, Other <other@example.test>`, 'Cc: Copy <copy@example.test>',
    `Subject: ${subject}`, ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
    ...(references.length ? [`References: ${references.join(' ')}`, `In-Reply-To: ${references.at(-1)}`] : []),
    'MIME-Version: 1.0', ...(html ? [
      'Content-Type: multipart/related; boundary=synthetic', '',
      '--synthetic', 'Content-Type: text/html; charset=utf-8', '',
      '<p>Picture before this text.</p><img src="cid:photo"><p>Newsletter</p>',
      '<img src="https://news.example.test/photo.png"><img width="1" src="https://news.example.test/pixel.png">',
      '--synthetic', 'Content-Type: image/png; name=photo.png', 'Content-ID: <photo>',
      'Content-Transfer-Encoding: base64', '', picture.toString('base64'), '--synthetic--',
    ] : ['Content-Type: text/plain; charset=utf-8', '', 'Original plain body.']),
  ].join('\r\n');
  return { uid, source: Buffer.from(source), internalDate: date, threadId, emailId: String(100 + uid),
    envelope: { subject, from: [{ name: 'Sender', address: 'sender@example.test' }],
      messageId: `<${id}@example.test>`, inReplyTo: references.at(-1) },
    headers: Buffer.from(`References: ${references.join('\r\n ')}\r\n\r\n`),
    flags: new Set(seen ? ['\\Seen'] : []), labels: new Set(labels) };
}

function fakeMailbox(gmail) {
  const folders = [
    mailbox('INBOX'), mailbox(project), mailbox('Sent', '\\Sent'), mailbox(trash, '\\Trash'),
    mailbox(gmail ? all : 'Archive', gmail ? '\\All' : '\\Archive'),
    { ...mailbox('Parent'), flags: new Set(['\\Noselect']) },
  ];
  const first = message(1, 'first', { age: 40, labels: ['\\Inbox', project], seen: gmail });
  const latest = message(2, 'latest', { age: 1, references: ['<first@example.test>', '<missing@example.test>'],
    labels: [project], replyTo: 'Replies <reply@example.test>', html: true });
  const separate = message(3, 'separate', { age: 2, labels: ['\\Inbox'], seen: true, threadId: '99' });
  const data = gmail ? new Map([[all, [first, latest, separate]], [trash, []]]) : new Map([
    ['INBOX', [first, separate]],
    [project, [{ ...first, uid: 51, flags: new Set() }]],
    ['Sent', [latest]], ['Archive', []], [trash, []],
  ]);
  const calls = [], sent = [], appended = [];
  const failure = {};
  let nextUid = 1000;
  const copy = item => ({ ...item, flags: new Set(item.flags), labels: new Set(item.labels) });
  class FakeImap extends EventEmitter {
    capabilities = new Map([['MOVE', true], ...(gmail ? [['X-GM-EXT-1', true]] : [])]);
    async connect() {
      if (failure.imap) throw Object.assign(new Error(secret), { authenticationFailed: true });
    }
    async logout() { assert.equal(this.mailbox, undefined); }
    close() {}
    async list() { return folders; }
    async getMailboxLock(path, { readOnly }) {
      assert.equal(this.mailbox, undefined);
      this.mailbox = { path, readOnly, uidValidity: BigInt(folders.findIndex(folder => folder.path === path) + 1) };
      return { release: () => { this.mailbox = undefined; } };
    }
    async search(criteria, options) {
      assert.equal(options.uid, true);
      calls.push(['search', this.mailbox.path, criteria]);
      let rows = data.get(this.mailbox.path) ?? [];
      if (criteria.threadId) rows = rows.filter(row => row.threadId === criteria.threadId);
      if (criteria.uid) rows = rows.filter(row => String(row.uid) === criteria.uid);
      if (criteria.emailId) rows = rows.filter(row => row.emailId === criteria.emailId);
      if (criteria.gmraw?.startsWith('{')) rows = rows.filter(row => !row.flags.has('\\Seen') ||
        row.internalDate >= Date.now() - 30 * 86_400_000);
      if (criteria.gmraw?.includes('(Newsletter)') || criteria.text) {
        rows = rows.filter(row => row.source.includes(criteria.text ?? 'Newsletter'));
      }
      if (criteria.header) rows = rows.filter(row => row.envelope.messageId === criteria.header['Message-ID']);
      return rows.map(row => row.uid);
    }
    async fetchAll(uids, fields, options) {
      assert.equal(options.uid, true);
      calls.push(['fetch', this.mailbox.path, fields]);
      return (data.get(this.mailbox.path) ?? []).filter(item => uids.includes(item.uid)).map(copy);
    }
    async fetchOne(uid, fields, options) {
      assert.equal(this.mailbox.readOnly, true);
      assert.equal(options.uid, true);
      assert.equal(typeof fields.source.maxLength, 'number');
      return (data.get(this.mailbox.path) ?? []).find(row => row.uid === uid);
    }
    async messageFlagsAdd(uids, labels, options) { return this.change(uids, labels, options, 'add'); }
    async messageFlagsRemove(uids, labels, options) { return this.change(uids, labels, options, 'delete'); }
    change(uids, labels, options, method) {
      assert.equal(this.mailbox.readOnly, false);
      assert.equal(options.uid, true);
      calls.push([method, this.mailbox.path, uids, labels, options]);
      for (const row of data.get(this.mailbox.path) ?? []) {
        if (!uids.includes(row.uid)) continue;
        for (const label of labels) (options.useLabels ? row.labels : row.flags)[method](label);
      }
      return true;
    }
    async messageMove(uids, dest, options) {
      assert.equal(this.mailbox.readOnly, false);
      assert.equal(options.uid, true);
      const from = this.mailbox.path;
      calls.push(['move', from, dest, uids]);
      const target = gmail && dest === 'INBOX' ? all : dest;
      const rows = data.get(from);
      const uidMap = new Map();
      for (const row of rows.filter(item => uids.includes(item.uid))) {
        uidMap.set(row.uid, nextUid);
        if (gmail) row.labels = new Set(dest === 'INBOX' ? ['\\Inbox'] : ['\\Trash']);
        data.get(target).push({ ...row, uid: nextUid++ });
      }
      data.set(from, rows.filter(item => !uids.includes(item.uid)));
      // Also cover UID MOVE success without a COPYUID response.
      return from === project ? {} : { uidMap, uidValidity: BigInt(folders.findIndex(folder => folder.path === target) + 1) };
    }
    async append(path, raw, flags) {
      appended.push({ path, raw, flags });
    }
  }
  const options = {
    credentials: async () => secret,
    createClient: opts => {
      assert.equal(opts.auth.pass, secret);
      assert.equal(opts.logger, false);
      assert.equal(opts.secure, true);
      assert.equal(opts.tls.rejectUnauthorized, true);
      return new FakeImap();
    },
    createTransport: opts => {
      assert.equal(opts.auth.pass, secret);
      assert.equal(opts.logger, false);
      assert.equal(opts.debug, false);
      assert.equal(opts.secure, false);
      assert.equal(opts.requireTLS, true);
      return { sendMail: async mail => {
        sent.push(mail);
        if (failure.smtp) throw new Error(secret);
        return { accepted: mail.envelope.to };
      } };
    },
  };
  return { options, calls, sent, appended, data, failure };
}

function harness(t, gmail) {
  const fake = fakeMailbox(gmail);
  const images = [];
  const logs = [];
  t.mock.method(console, 'log', (...args) => logs.push(args.join(' ')));
  const server = createBridge({ token: 'fake-bridge', privateHosts: [privateHost], mailConfig: config,
    beeperConfig: null, mailOptions: {
      imapOptions: fake.options, coldWaitMs: 1000,
      imaging: { available: () => true, readable: async () => false, render: async (_key, load) => ({ bytes: (await load()).length }) },
      fetchRemote: async url => { images.push(url); return Buffer.alloc(987); },
    } });
  t.after(() => server.emit('close'));
  function request(path, body, { token = 'fake-bridge', host = privateHost } = {}) {
    return new Promise(resolve => {
      const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
      Object.assign(req, { url: path, method: body ? 'POST' : 'GET', headers: { host, authorization: `Bearer ${token}` } });
      const res = {
        setHeader() {},
        writeHead(statusCode) { this.statusCode = statusCode; },
        end(body) { resolve({ status: this.statusCode, answer: JSON.parse(body) }); },
      };
      server.emit('request', req, res);
    });
  }
  async function get(path) {
    const response = await request(`/api/mail/${path}`);
    assert.equal(response.status, 200, JSON.stringify(response.answer));
    return response.answer;
  }
  const labels = () => get('labels?account=fixture');
  const threads = (label = 'INBOX', params = '') => get(`threads?filter=fixture:${label}${params}`);
  const action = async (id, action) => {
    const { status, answer } = await request(action === 'read' ? '/api/mail/read' : '/api/mail/modify',
      { account: 'fixture', threadId: id, ...(action !== 'read' && { action }) });
    assert.equal(status, 200, JSON.stringify(answer));
    assert.deepEqual(answer, { ok: true });
  };
  return { ...fake, request, get, labels, threads, action, images, logs };
}

test('Gmail IMAP uses Gmail IDs, labels and search, and preserves labels across mutations', async t => {
  const h = harness(t, true);
  assert.deepEqual((await h.request('/api/capabilities')).answer.modules, ['coding', 'email']);
  assert.deepEqual(await h.get('accounts'), [{ id: 'fixture', short: 'F', address, ok: true }]);
  assert.equal((await h.request('/api/mail/accounts', null, { token: 'wrong' })).status, 401);
  assert.equal((await h.request('/api/mail/accounts', null, { host: 'public.example.test' })).status, 403);
  const labels = await h.labels();
  const work = labels.find(label => label.name === project);
  assert.deepEqual(labels.map(label => [label.name, label.unread]), [['Inbox', 0], [project, 1]]);
  const page = await h.threads('INBOX', '&size=1');
  assert.equal(page.hasMore, false); // The older read Inbox member is outside the metadata window.
  assert.equal(page.items[0].id, 'gt_99');
  const id = `gt_${gmailThread}`;
  const filtered = await h.threads(work.id, '&q=Newsletter');
  assert.equal(filtered.items[0].id, id);
  assert.equal(filtered.unread, 1);
  assert.ok(h.calls.some(call => call[0] === 'search' && call[2].gmraw === '{newer_than:30d is:unread}'));
  assert.ok(h.calls.some(call => call[0] === 'fetch' && call[2].labels && call[2].threadId));

  const read = await h.get(`thread?account=fixture&id=${id}`);
  assert.equal(read.subject, 'Planning');
  assert.equal(read.messages.length, 2);
  assert.ok(read.messages[1].text.includes('[[img:0]]'));
  assert.ok(read.messages[1].text.includes('[[img:1]]'));
  assert.deepEqual(read.messages[1].images, [{ part: '1', name: 'photo.png' }, { remote: 1, name: '' }]);
  assert.deepEqual(h.images, []);
  const picturePath = `image?account=fixture&message=${read.messages[1].id}`;
  assert.equal((await h.get(picturePath + '&part=1')).bytes, picture.length);
  assert.equal((await h.get(picturePath + '&remote=1')).bytes, 987);
  assert.deepEqual(h.images, ['https://news.example.test/photo.png']);
  assert.ok(h.calls.some(call => call[0] === 'search' && call[2].threadId === gmailThread));
  assert.ok(h.calls.some(call => call[0] === 'search' && call[2].emailId === '102'));

  await h.action(id, 'read');
  assert.equal((await h.threads(work.id)).unread, 0);
  await h.action(id, 'unread');
  assert.equal((await h.threads('INBOX', '&size=1')).hasMore, true);
  assert.equal((await h.threads('INBOX', '&page=1&size=1')).items[0].id, 'gt_99');
  await h.action(id, 'star');
  assert.equal((await h.threads(work.id)).items[0].starred, true);
  await h.action(id, 'unstar');
  await h.action(id, 'archive');
  assert.equal((await h.threads()).items.length, 1);
  assert.ok(h.calls.some(call => call[0] === 'delete' && call[3][0] === '\\Inbox' && call[4].useLabels));
  await h.action(id, 'unarchive');
  assert.equal((await h.threads()).items.length, 2);
  await h.action(id, 'archive');
  await h.action(id, 'trash');
  assert.equal((await h.threads(work.id)).items.length, 0);
  await h.action(id, 'untrash');
  assert.equal((await h.threads(work.id)).items[0].id, id);
  assert.equal((await h.threads()).items.length, 1);
  assert.equal(h.data.get(all).filter(row => row.labels.has(project)).length, 2);
  assert.ok(!h.logs.join('\n').includes(secret));
});

test('generic IMAP groups References across folders and restores each copy to its origin', async t => {
  const h = harness(t, false);
  const labels = await h.labels();
  const work = labels.find(row => row.name === project);
  const sent = labels.find(row => row.name === 'Sent');
  const archive = labels.find(row => row.name === 'Archive');
  assert.deepEqual(labels.map(row => row.name), ['Inbox', 'Archive', project, 'Sent']);
  assert.equal(work.unread, 1);
  const page = await h.threads(`INBOX,fixture:${work.id},fixture:${sent.id}`, '&size=1');
  const [summary] = page.items;
  assert.equal(summary.count, 2);
  assert.equal(page.hasMore, true);
  assert.equal(page.unread, 1);
  assert.equal((await h.threads(sent.id, '&q=Newsletter')).items[0].id, summary.id);
  const reader = await h.get(`thread?account=fixture&id=${summary.id}`);
  assert.equal(reader.messages.length, 2);
  assert.equal(reader.messages[0].text, 'Original plain body.');
  await h.action(summary.id, 'read');
  for (const path of ['INBOX', 'Sent', project]) assert.ok(h.data.get(path)[0].flags.has('\\Seen'));
  await h.action(summary.id, 'unread');
  await h.action(summary.id, 'star');
  assert.equal((await h.threads()).items[0].starred, true);
  await h.action(summary.id, 'unstar');
  assert.equal((await h.threads()).items[0].starred, false);
  await h.action(summary.id, 'archive');
  assert.equal((await h.threads()).items.length, 1);
  assert.equal((await h.threads(archive.id)).items[0].id, summary.id);
  await h.action(summary.id, 'unarchive');
  assert.equal((await h.threads()).items.length, 2);
  await h.action(summary.id, 'trash');
  assert.equal(h.data.get(trash).length, 3);
  await h.action(summary.id, 'untrash');
  assert.equal(h.data.get(trash).length, 0);
  assert.equal(h.data.get(project).length, 1);
  assert.equal(h.data.get('Sent').length, 1);
  assert.equal((await h.threads()).items[0].id, summary.id);
  assert.ok(!h.calls.some(call => call[0] === 'search' && call[2].gmraw));
});

test('SMTP builds new, reply, reply-all and forward mail once per send ID', async t => {
  const h = harness(t, false);
  const [{ id }] = (await h.threads()).items;
  const base = { account: 'fixture', threadId: id, body: 'My reply' };
  for (const mode of ['new', 'reply', 'replyAll', 'forward']) {
    const fields = mode === 'new' ? { to: 'new@example.test', subject: 'New mail' }
      : await h.get(`compose?account=fixture&id=${id}&mode=${mode}`);
    if (mode === 'reply') assert.match(fields.to, /reply@example.test/);
    if (mode === 'replyAll') {
      assert.match(fields.to, /other@example.test/);
      assert.match(fields.cc, /copy@example.test/);
      assert.ok(!fields.to.includes(address));
    }
    if (mode === 'forward') {
      assert.equal(fields.to, '');
      fields.to = 'forward@example.test';
    }
    const draft = { ...base, ...fields, mode, sendId: `unique-${mode}` };
    const responses = await Promise.all([h.request('/api/mail/send', draft), h.request('/api/mail/send', draft)]);
    assert.equal(responses[0].status, 200, JSON.stringify(responses[0]));
    assert.deepEqual(responses[0], responses[1]);
    const submission = h.sent.at(-1);
    const parsed = await simpleParser(submission.raw);
    assert.equal(parsed.from.value[0].address, address);
    assert.equal(submission.envelope.from, address);
    assert.equal(parsed.messageId, responses[0].answer.id);
    assert.ok(parsed.date instanceof Date);
    if (mode === 'reply' || mode === 'replyAll') {
      assert.equal(parsed.inReplyTo, '<latest@example.test>');
      assert.deepEqual(parsed.references, ['<first@example.test>', '<missing@example.test>', '<latest@example.test>']);
      assert.match(parsed.text, /\nOn .+ wrote:/);
    } else {
      assert.equal(parsed.inReplyTo, undefined);
      assert.equal(parsed.references, undefined);
    }
    if (mode === 'forward') assert.match(parsed.text, /Forwarded message/);
  }
  assert.equal(h.sent.length, 4);
  assert.deepEqual(h.appended.map(({ path }) => path), ['Sent', 'Sent', 'Sent', 'Sent']);
  assert.ok(!JSON.stringify(h.sent).includes(secret));
});

test('server and transport errors expose fixed codes without secrets and uncertain sends stay deduplicated', async t => {
  const h = harness(t, true);
  h.failure.imap = true;
  const [account] = await h.get('accounts');
  assert.deepEqual({ ok: account.ok, error: account.error }, { ok: false, error: 'auth' });
  assert.deepEqual(await h.request('/api/mail/labels?account=fixture'), { status: 502, answer: { error: 'auth' } });
  h.failure.imap = false;
  h.failure.smtp = true;
  const draft = { account: 'fixture', mode: 'new', sendId: 'uncertain-001', to: 'recipient@example.test', body: 'Body' };
  const first = await h.request('/api/mail/send', draft);
  assert.deepEqual(first, { status: 502, answer: { error: 'send-uncertain' } });
  h.failure.smtp = false;
  assert.deepEqual(await h.request('/api/mail/send', draft), first);
  assert.equal(h.sent.length, 1);
  const next = { ...draft, sendId: 'successful-001' };
  assert.equal((await h.request('/api/mail/send', next)).status, 200);
  assert.equal(h.sent.length, 2);
  assert.equal(h.appended.length, 0);
  assert.ok(!JSON.stringify({ account, logs: h.logs }).includes(secret));
});

test('mail provider config accepts mixed accounts and refuses plaintext TLS and secret path escapes', () => {
  const imap = config.accounts[0];
  const mixed = structuredClone(config);
  mixed.accounts.push({ id: 'legacy', short: 'L', address, tokenFile: '.local/fake-token.json' });
  mixed.oauthClientFile = '.local/fake-client.json';
  assert.deepEqual(readMailConfig(mixed).accounts.map(account => account.provider), ['imap', 'gmail-api']);
  const asConfig = entry => ({ ...config, accounts: [{ ...imap, ...entry }] });
  for (const entry of [
    { secretFile: '.local/../out.txt' }, { smtp: { ...imap.smtp, tls: 'none' } }, { provider: 'other' },
    { imap: { ...imap.imap, host: 'https://user:password@example.test' } },
  ]) assert.equal(readMailConfig(asConfig(entry)), null);
  const normalized = readMailConfig(asConfig({ password: secret, smtp: { ...imap.smtp, password: secret } }));
  assert.ok(!JSON.stringify(normalized).includes(secret));
});
