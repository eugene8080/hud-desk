import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { before } from './mail.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ORIGIN = 'http://127.0.0.1:23373';
const PAGE_SIZE = 8;
const text = value => typeof value === 'string' ? value.trim() : '';
const date = value => Date.parse(value) || 0;
const validId = value => typeof value === 'string' && value.length <= 1024 &&
  !/[\s%/\\?#]/u.test(value) && value !== '.' && value !== '..' && !!value && value.isWellFormed();

export class BeeperError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function readBeeperConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  const { tokenFile = '.local/beeper-token.txt', refreshSeconds = 120 } = config;
  if (!text(tokenFile) || !Number.isInteger(refreshSeconds) || refreshSeconds < 1 ||
      refreshSeconds * 1000 > 2 ** 31 - 1) return null;
  const file = resolve(ROOT, tokenFile);
  const fromLocal = relative(resolve(ROOT, '.local'), file);
  if (!fromLocal || fromLocal === '..' || fromLocal.startsWith('..' + sep) || isAbsolute(fromLocal)) return null;
  return { tokenFile: file, refreshSeconds };
}

const messagePath = id => `/v1/chats/${encodeURIComponent(id)}/messages`;

// GET accounts, GET chats, GET/POST chat messages:
// https://developers.beeper.com/desktop-api-reference/
function permitted(method, path, body) {
  if (method === 'GET' && body === undefined && (path === '/v1/accounts' || path === '/v1/chats')) return undefined;
  const segment = /^\/v1\/chats\/([^/]+)\/messages$/.exec(path)?.[1];
  if (segment) {
    const id = decodeSegment(segment);
    if (validId(id) && path === messagePath(id)) {
      if (method === 'GET' && body === undefined) return undefined;
      if (method === 'POST' && body && Reflect.ownKeys(body).length === 1 && Object.hasOwn(body, 'text') && text(body.text)) {
        return JSON.stringify({ text: body.text });
      }
    }
  }
  throw new BeeperError('disallowed', 400);
}

function decodeSegment(segment) {
  try { return decodeURIComponent(segment); } catch { return ''; }
}

export function createBeeperClient(tokenFile, {
  transport = fetch, readToken = () => readFile(tokenFile, 'utf8'), sleep = delay,
} = {}) {
  return async (method, path, { query, body } = {}) => {
    const payload = permitted(method, path, body);
    const url = new URL(path, ORIGIN);
    // Only list cursors affect upstream GETs. Writes never carry query parameters.
    if (method === 'GET' && path === '/v1/chats') {
      url.searchParams.set('limit', '200');
      if (query?.cursor) {
        url.searchParams.set('cursor', query.cursor);
        url.searchParams.set('direction', 'before');
      }
    }
    let token;
    try { token = text(await readToken()); } catch { /* Keep file errors private. */ }
    if (!token || /\s/u.test(token)) throw new BeeperError('beeper-auth', 502);
    for (let attempt = 0; ; attempt++) {
      let response;
      try {
        response = await transport(url, {
          method, headers: { authorization: `Bearer ${token}`, ...(payload && { 'content-type': 'application/json' }) },
          body: payload, redirect: 'error', signal: AbortSignal.timeout(2500),
        });
      } catch { throw new BeeperError('beeper-network', 502); }
      if (response.ok) {
        try { return await response.json(); } catch { throw new BeeperError('beeper-response', 502); }
      }
      await response.body?.cancel().catch(() => {});
      const transient = response.status === 429 || response.status >= 500;
      if (method === 'GET' && transient && attempt < 2) {
        const retryAfter = response.headers.get('retry-after');
        const wait = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : 250 * 2 ** attempt;
        await sleep(Math.min(3000, wait));
        continue;
      }
      throw new BeeperError(response.status === 401 || response.status === 403 ? 'beeper-auth' : 'beeper-request', 502);
    }
  };
}

function snapshot(load, refreshMs) {
  let value, error, pending, attemptedAt = -Infinity;
  return {
    refresh() {
      if (!pending && Date.now() - attemptedAt >= refreshMs) {
        attemptedAt = Date.now();
        pending = load(partial => { value ??= partial; }).then(next => {
          value = next;
          error = undefined;
        }, failure => { error = failure; }).finally(() => { pending = undefined; });
      }
      return pending;
    },
    get ready() { return value !== undefined; },
    read(fallback) {
      if (value === undefined && error) throw error;
      return value ?? fallback;
    },
  };
}

export function createBeeper(config, { clientOptions, coldWaitMs = 3000 } = {}) {
  const request = createBeeperClient(config.tokenFile, clientOptions);
  const refreshMs = config.refreshSeconds * 1000;
  const accounts = snapshot(async () => {
    const rows = await request('GET', '/v1/accounts');
    if (!Array.isArray(rows)) throw new BeeperError('beeper-response', 502);
    return new Map(rows.map(row => [row.accountID, text(row.network) || text(row.bridge?.type) || 'Beeper']));
  }, refreshMs);
  let closed = false;
  const chats = snapshot(async publish => {
    const rows = new Map();
    const cursors = new Set();
    let cursor;
    do {
      const page = await request('GET', '/v1/chats', { query: { cursor } });
      if (!Array.isArray(page?.items)) throw new BeeperError('beeper-response', 502);
      for (const item of page.items) {
        if (!validId(item.id)) continue;
        rows.set(item.id, {
          id: item.id, title: text(item.title), date: date(item.lastActivity) || date(item.preview?.timestamp),
          unread: Number(item.unreadCount) > 0 || item.isMarkedUnread === true, readOnly: item.isReadOnly === true,
          account: item.accountID, network: text(item.network),
        });
      }
      if (!page.hasMore || closed) break;
      cursor = text(page.oldestCursor);
      if (!cursor || cursors.has(cursor)) throw new BeeperError('beeper-response', 502);
      cursors.add(cursor);
      publish({ items: rows, partial: true });
    } while (!closed);
    return { items: rows, partial: false };
  }, refreshMs);

  let timer;
  let listStarted = false;
  function refresh(includeChats) {
    timer ??= setInterval(() => { accounts.refresh(); if (listStarted) chats.refresh(); }, refreshMs);
    timer.unref();
    const catalog = accounts.refresh();
    if (!includeChats) return accounts.ready ? [] : [catalog];
    listStarted = true;
    const list = chats.refresh();
    return [...(accounts.ready ? [] : [catalog]), ...(chats.ready ? [] : [list])];
  }
  const badRequest = () => new BeeperError('bad request', 400);
  const routes = {
    'GET /api/chat/networks': async () => {
      await before(Promise.all(refresh(false)), Date.now() + coldWaitMs);
      return [...new Set(accounts.read(new Map()).values())].sort((a, b) => a.localeCompare(b));
    },
    'GET /api/chat/list': async params => {
      const page = Number(params.get('page') ?? 0);
      if (!Number.isSafeInteger(page) || page < 0) throw badRequest();
      const networks = new Set((params.get('networks') ?? '').split(',').filter(Boolean));
      await before(Promise.all(refresh(true)), Date.now() + coldWaitMs);
      const catalog = accounts.read(new Map());
      const { items, partial } = chats.read({ items: new Map(), partial: false });
      const matches = [...items.values()].filter(item => !networks.size ||
        networks.has(catalog.get(item.account) ?? item.network)).sort((a, b) => b.date - a.date);
      const start = page * PAGE_SIZE;
      return {
        items: matches.slice(start, start + PAGE_SIZE).map(({ id, title, date, unread, readOnly }) => ({ id, title, date, unread, readOnly })),
        unread: matches.filter(item => item.unread).length, hasMore: start + PAGE_SIZE < matches.length || (partial && start < matches.length),
      };
    },
    'GET /api/chat/messages': async params => {
      const id = params.get('id');
      if (!validId(id)) throw badRequest();
      const page = await request('GET', messagePath(id));
      if (!Array.isArray(page?.items)) throw new BeeperError('beeper-response', 502);
      return { messages: page.items.filter(item => !item.isHidden && !item.isDeleted && text(item.text)).map(item => ({
        from: text(item.senderName), own: item.isSender === true, date: date(item.timestamp), text: text(item.text),
      })).sort((a, b) => a.date - b.date) };
    },
    'POST /api/chat/send': async (_params, input) => {
      if (!input || Object.keys(input).length !== 2 || !validId(input.chatId) || !text(input.text)) throw badRequest();
      const result = await request('POST', messagePath(input.chatId), { body: { text: input.text } });
      if (!text(result?.pendingMessageID)) throw new BeeperError('beeper-response', 502);
      return { ok: true };
    },
  };
  return { routes, close: () => { closed = true; clearInterval(timer); } };
}
