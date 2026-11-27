import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGmail, MailError } from './gmail.mjs';
import { bodyText, header, parseFrom } from './mail-text.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ID = /^[a-zA-Z0-9_-]+$/;
const string = value => typeof value === 'string' && value.trim().length > 0;
const id = value => string(value) && ID.test(value);
const dayMs = 86_400_000;
const badRequest = () => new MailError('bad request', 400);

export function readMailConfig(config) {
  if (!string(config?.oauthClientFile) || !Array.isArray(config.accounts) || !config.accounts.length ||
      !Number.isInteger(config.windowDays) || config.windowDays < 1 || config.windowDays > 365 ||
      !Number.isInteger(config.refreshSeconds) || config.refreshSeconds < 1 ||
      config.refreshSeconds * 1000 > 2 ** 31 - 1) return null;
  const accounts = [];
  const local = resolve(ROOT, '.local');
  for (const account of config.accounts) {
    if (!id(account?.id) || !string(account.short) ||
        !string(account.address) || !/^[^\s@]+@[^\s@]+$/.test(account.address) ||
        !string(account.tokenFile) || accounts.some(a => a.id === account.id)) return null;
    const tokenFile = resolve(ROOT, account.tokenFile);
    const fromLocal = relative(local, tokenFile);
    if (!fromLocal || fromLocal === '..' || fromLocal.startsWith('..' + sep) || isAbsolute(fromLocal)) return null;
    accounts.push({ id: account.id, short: account.short, address: account.address, tokenFile });
  }
  return { ...config, oauthClientFile: resolve(ROOT, config.oauthClientFile), accounts };
}

function hostname(value) {
  if (typeof value !== 'string') return '';
  return (/^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::\d+)?$/i.exec(value)?.[1] ?? '').toLowerCase();
}

export function allowPrivateHost(privateHosts) {
  const allowed = new Set(Array.isArray(privateHosts) ? privateHosts.map(hostname).filter(Boolean) : []);
  return headers => !Object.hasOwn(headers, 'cf-ray') && !Object.hasOwn(headers, 'cf-connecting-ip') &&
    allowed.has(hostname(headers.host));
}

function snapshot(load, refreshMs) {
  let value, error, pending, attemptedAt = -Infinity, generation = 0;
  return {
    refresh() {
      if (!pending && Date.now() - attemptedAt >= refreshMs) {
        attemptedAt = Date.now();
        const started = generation;
        pending = Promise.resolve().then(load).then(next => {
          if (started === generation) {
            value = next;
            error = undefined;
          }
        }, failure => { if (started === generation) error = failure; }).finally(() => { pending = undefined; });
      }
      return pending;
    },
    read() {
      if (error) throw error;
      return value;
    },
    get ready() { return value !== undefined; },
    invalidate() {
      generation++;
      attemptedAt = -Infinity;
    },
  };
}

async function listIds(gmail, search, label) {
  const ids = new Set();
  let pageToken;
  do {
    const query = { maxResults: '500', fields: 'threads(id),nextPageToken' };
    if (search) query.q = search;
    if (label) query.labelIds = label;
    if (pageToken) query.pageToken = pageToken;
    const page = await gmail('GET', '/threads', { query });
    for (const thread of page.threads ?? []) if (id(thread.id)) ids.add(thread.id);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return ids;
}

function pool(limit) {
  let active = 0;
  const waiting = [];
  return async function run(task) {
    if (active < limit) active++;
    else await new Promise(resolve => waiting.push(resolve));
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

export async function before(promise, deadline) {
  let timer;
  try {
    return await Promise.race([promise, new Promise(resolve => {
      timer = setTimeout(resolve, Math.max(0, deadline - Date.now()));
    })]);
  } finally {
    clearTimeout(timer);
  }
}

const dateOf = message => Number(message.internalDate) || Date.parse(header(message, 'date')) || 0;
const messagesOf = thread => [...(thread.messages ?? [])].sort((a, b) => dateOf(a) - dateOf(b));

function publicError(error) {
  return error instanceof MailError ? error.code : 'internal';
}

export function createMail(config, { gmailOptions, coldWaitMs = 3000 } = {}) {
  const refreshMs = config.refreshSeconds * 1000;
  const search = `newer_than:${config.windowDays}d`;
  const accounts = new Map(config.accounts.map(account => {
    const call = createGmail(config.oauthClientFile, account, gmailOptions);
    const run = pool(3);
    const gmail = (...args) => run(() => call(...args));
    // Retain successful writes that race a snapshot refresh until that refresh has settled.
    const recentlyRead = new Map();
    let revision = 0;
    const order = snapshot(() => listIds(gmail, search), refreshMs);
    const unread = snapshot(async () => {
      const started = revision;
      // An older unread message can belong to a thread with a recent read reply.
      const ids = await listIds(gmail, '', 'UNREAD');
      for (const [threadId, readAt] of recentlyRead) {
        if (readAt > started) ids.delete(threadId);
        else recentlyRead.delete(threadId);
      }
      return ids;
    }, refreshMs);
    const labels = snapshot(async () => {
      const { labels = [] } = await gmail('GET', '/labels', { query: { fields: 'labels(id,name,type)' } });
      const visible = labels.filter(label => label.id === 'INBOX' || label.type === 'user');
      const counts = await Promise.all(visible.map(async label => {
        const detail = await gmail('GET', `/labels/${label.id}`, { query: { fields: 'threadsUnread' } });
        return { id: label.id, name: label.id === 'INBOX' ? 'Inbox' : label.name, unread: detail.threadsUnread ?? 0 };
      }));
      return counts.sort((a, b) => a.id === 'INBOX' ? -1 : b.id === 'INBOX' ? 1 : a.name.localeCompare(b.name));
    }, refreshMs);
    const health = snapshot(async () => {
      const profile = await gmail('GET', '/profile', { query: { fields: 'emailAddress' } });
      if (profile.emailAddress?.toLowerCase() !== account.address.toLowerCase()) throw new MailError('auth', 502);
      return true;
    }, refreshMs);

    const selections = new Map();
    function labelIndex(label) {
      if (!selections.has(label)) selections.set(label, snapshot(() => listIds(gmail, search, label), refreshMs));
      const index = selections.get(label);
      index.usedAt = Date.now();
      return index;
    }

    const metadata = new Map();
    const dates = new Map();
    let metadataOrder;
    const reads = new Map();
    const unreadLabels = new Map();
    function rememberUnreadLabels(threadId, messages, started) {
      if ((recentlyRead.get(threadId) ?? 0) > started) return;
      unreadLabels.set(threadId, new Set(messages.filter(m => m.labelIds?.includes('UNREAD'))
        .flatMap(m => m.labelIds)));
    }
    function resetMetadata() {
      const generation = order.read();
      if (generation !== metadataOrder) {
        metadata.clear();
        dates.clear();
        unreadLabels.clear();
        metadataOrder = generation;
      }
    }

    function sortDate(threadId) {
      resetMetadata();
      const known = metadata.get(threadId)?.value?.date;
      if (known !== undefined) return known;
      if (!dates.has(threadId)) {
        const pending = gmail('GET', `/threads/${threadId}`, { query: {
          format: 'metadata', metadataHeaders: 'Date', fields: 'messages(internalDate,payload(headers))',
        } }).then(thread => dateOf(messagesOf(thread).at(-1) ?? {})).catch(error => {
          if (dates.get(threadId) === pending) dates.delete(threadId);
          if (error instanceof MailError && error.status === 404) return 0;
          throw error;
        });
        dates.set(threadId, pending);
      }
      return dates.get(threadId);
    }

    function summary(threadId) {
      resetMetadata();
      if (!metadata.has(threadId)) {
        const started = revision;
        const query = new URLSearchParams({
          format: 'metadata',
          fields: 'messages(internalDate,labelIds,payload(headers))',
        });
        for (const name of ['From', 'Subject', 'Date']) query.append('metadataHeaders', name);
        const cached = {};
        cached.pending = gmail('GET', `/threads/${threadId}`, { query }).then(thread => {
          const messages = messagesOf(thread);
          if (!messages.length) throw new MailError('not found', 404);
          const newest = messages.at(-1);
          if (metadata.get(threadId) === cached) rememberUnreadLabels(threadId, messages, started);
          cached.value = {
            account: account.id, id: threadId, from: parseFrom(header(newest, 'from')),
            subject: header(messages[0], 'subject'), date: dateOf(newest), count: messages.length,
            unread: messages.some(m => m.labelIds?.includes('UNREAD')),
          };
        }).catch(error => {
          if (metadata.get(threadId) === cached) metadata.delete(threadId);
          if (!(error instanceof MailError && error.status === 404)) throw error;
          // A thread may disappear between the ID list and the metadata request.
          cached.removed = true;
        });
        metadata.set(threadId, cached);
      }
      return metadata.get(threadId);
    }

    async function open(threadId) {
      const started = revision;
      const messages = messagesOf(await gmail('GET', `/threads/${threadId}`, { query: {
        format: 'full',
        fields: 'messages(id,internalDate,labelIds,payload)',
      } }));
      rememberUnreadLabels(threadId, messages, started);
      return {
        subject: header(messages[0] ?? {}, 'subject'),
        messages: messages.map(m => ({
          id: m.id, from: parseFrom(header(m, 'from')), to: header(m, 'to'), cc: header(m, 'cc'),
          date: dateOf(m), text: bodyText(m.payload, { subject: header(m, 'subject') }),
        })),
      };
    }

    function mark(threadId) {
      if (!reads.has(threadId)) {
        reads.set(threadId, gmail('POST', `/threads/${threadId}/modify`, {
          query: { fields: 'id' },
          body: { removeLabelIds: ['UNREAD'] },
        }).then(() => {
          recentlyRead.set(threadId, ++revision);
          // An earlier background error must not turn a successful Gmail write into an API failure.
          try { unread.read()?.delete(threadId); } catch { /* Next snapshot reconciles. */ }
          try {
            const changed = unreadLabels.get(threadId);
            for (const label of labels.read() ?? []) {
              if (changed?.has(label.id)) label.unread = Math.max(0, label.unread - 1);
            }
          } catch { /* Next snapshot reconciles. */ }
          labels.invalidate();
          unreadLabels.set(threadId, new Set());
          return { ok: true };
        }).finally(() => reads.delete(threadId)));
      }
      return reads.get(threadId);
    }

    return [account.id, {
      id: account.id, short: account.short, address: account.address, health, labels, labelIndex, order, unread, recentlyRead,
      summary, open, mark, sortDate, selections,
    }];
  }));

  let timer;
  const active = new Set();
  function start(entries) {
    for (const entry of entries) active.add(entry);
    timer ??= setInterval(() => {
      for (const account of accounts.values()) {
        for (const [label, index] of account.selections) {
          if (Date.now() - index.usedAt > refreshMs * 2) {
            account.selections.delete(label);
            active.delete(index);
          }
        }
      }
      for (const entry of active) entry.refresh();
    }, refreshMs).unref();
  }

  async function warm(entries, deadline) {
    start(entries);
    const waits = [];
    for (const entry of entries) {
      const pending = entry.refresh();
      if (pending && !entry.ready) waits.push(pending);
    }
    if (waits.length) await before(Promise.all(waits), deadline);
  }

  function accountOf(key) {
    const account = accounts.get(key);
    if (!account) throw badRequest();
    return account;
  }

  function threadId(value) {
    if (!id(value)) throw badRequest();
    return value;
  }

  async function listThreads(query) {
    const deadline = Date.now() + coldWaitMs;
    const page = Number(query.get('page') ?? 0);
    const requestedSize = Number(query.get('size') ?? 8);
    if (!Number.isSafeInteger(page) || page < 0 || !Number.isSafeInteger(requestedSize) || requestedSize < 1) throw badRequest();
    const size = Math.min(requestedSize, 20);
    const filter = new Map();
    for (const item of (query.get('filter') || '').split(',').filter(Boolean)) {
      const [key, label, extra] = item.split(':');
      const account = accountOf(key);
      if (!id(label) || extra !== undefined) throw badRequest();
      if (!filter.has(account)) filter.set(account, new Set());
      filter.get(account).add(label);
    }
    const selected = [...filter].map(([account, labels]) => ({ account, indexes: [...labels].map(account.labelIndex) }));
    const entries = selected.flatMap(({ account, indexes }) => [account.order, account.unread, ...indexes]);
    await warm(entries, deadline);
    // loading: the cold-start wait ran out before the rows were known (thread order, label index,
    // ranking or a visible summary), so this page is incomplete and the app asks again shortly
    // (G2 2026-11-27: the first Email open showed one thread). The mailbox-wide UNREAD scan is left
    // out: it has no date window, took 20-30 s on a large mailbox after the 2026-11-27 reboot, and
    // only feeds the row-0 count; each row's own mark falls back to its summary's UNREAD label.
    let loading = selected.some(({ account, indexes }) => !account.order.ready || indexes.some(index => !index.ready));

    let unread = 0;
    const feeds = selected.map(({ account, indexes }) => {
      const included = new Set();
      for (const index of indexes) for (const key of index.read() ?? []) included.add(key);
      const unreadIds = account.unread.read();
      const ids = [];
      for (const key of account.order.read() ?? []) {
        if (!included.has(key)) continue;
        if (unreadIds?.has(key) && !account.recentlyRead.has(key)) unread++;
        ids.push(key);
      }
      return { account, ids };
    });
    const offset = page * size;
    const total = feeds.reduce((count, feed) => count + feed.ids.length, 0);
    if (offset >= total) return { items: [], hasMore: false, unread, loading };
    let visible;
    if (feeds.length <= 1) {
      const [feed] = feeds;
      visible = feed?.ids.slice(offset, offset + size).map(key => ({ account: feed.account, key })) ?? [];
    } else {
      // Gmail's ID-only order is per mailbox. Cross-mailbox comparisons need a date-only projection.
      const candidates = feeds.flatMap(({ account, ids }) => ids.slice(0, offset + size).map(async key => ({
        account, key, date: await account.sortDate(key),
      })));
      const ranked = await before(Promise.all(candidates), deadline);
      if (!ranked) loading = true;
      visible = ranked?.sort((a, b) => b.date - a.date).slice(offset, offset + size) ?? [];
    }
    const results = visible.map(({ account, key }) => account.summary(key));
    await before(Promise.all(results.map(result => result.pending)), deadline);
    const cutoff = Date.now() - config.windowDays * dayMs;
    const items = [];
    for (const [i, result] of results.entries()) {
      if (result.removed) continue;
      if (!result.value) { loading = true; break; }
      const { account, key } = visible[i];
      if (result.value.date >= cutoff) {
        const unreadIds = account.unread.read();
        items.push({ ...result.value, unread: !account.recentlyRead.has(key) &&
          (unreadIds ? unreadIds.has(key) : result.value.unread) });
      }
    }
    items.sort((a, b) => b.date - a.date);
    return { items, hasMore: total > offset + size, unread, loading };
  }

  const routes = {
    'GET /api/mail/accounts': async () => {
      const list = [...accounts.values()];
      await warm(list.map(a => a.health), Date.now() + coldWaitMs);
      // The address names the mailbox on the glasses and the phone. This route sits behind the
      // bearer token and the private-host gate, like the mail itself.
      return list.map(({ id, short, address, health }) => {
        try {
          return health.read() ? { id, short, address, ok: true } : { id, short, address, ok: false, error: 'network' };
        } catch (error) {
          return { id, short, address, ok: false, error: publicError(error) };
        }
      });
    },
    'GET /api/mail/labels': async query => {
      const { labels } = accountOf(query.get('account'));
      await warm([labels], Date.now() + coldWaitMs);
      return labels.read() ?? [];
    },
    'GET /api/mail/threads': listThreads,
    'GET /api/mail/thread': query => accountOf(query.get('account')).open(threadId(query.get('id'))),
    'POST /api/mail/read': (_query, body) => accountOf(body?.account).mark(threadId(body?.threadId)),
  };
  return { routes, close: () => clearInterval(timer) };
}
