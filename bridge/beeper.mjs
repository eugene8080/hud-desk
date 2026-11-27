import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { before } from './mail.mjs';
import { createChatSpeech, MAX_ASSET_BYTES } from './chat-voice.mjs';
import { DEFAULT_TRANSLATION_MODEL, localModelName, translateEnglish } from './chat-translate.mjs';

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
  const { tokenFile = '.local/beeper-token.txt', refreshSeconds = 120, translationModel = DEFAULT_TRANSLATION_MODEL } = config;
  if (!text(tokenFile) || !Number.isInteger(refreshSeconds) || refreshSeconds < 1 ||
      refreshSeconds * 1000 > 2 ** 31 - 1) return null;
  const file = resolve(ROOT, tokenFile);
  const fromLocal = relative(resolve(ROOT, '.local'), file);
  if (!fromLocal || fromLocal === '..' || fromLocal.startsWith('..' + sep) || isAbsolute(fromLocal)) return null;
  const { asrLanguage = 'yue', asrScript = 's2hk' } = config;
  const path = key => text(config[key]) ? resolve(ROOT, config[key]) : undefined;
  const speech = {
    python: path('asrPython'), ffmpeg: path('ffmpegPath'), modelDir: path('asrModelDir'), vadDir: path('asrVadDir'),
    language: ['yue', 'auto', 'zh'].includes(asrLanguage) ? asrLanguage : 'yue',
    script: asrScript === 'none' ? 'none' : 's2hk',
  };
  return { tokenFile: file, refreshSeconds, translationModel, speech };
}

const messagePath = id => `/v1/chats/${encodeURIComponent(id)}/messages`;
// Mark a whole chat read (https://developers.beeper.com/desktop-api-reference/resources/chats/methods/mark_read).
const readPath = id => `/v1/chats/${encodeURIComponent(id)}/read`;

const assetPath = '/v1/assets/serve';
const assetURL = value => typeof value === 'string' && value.length <= 4096 &&
  /^(?:local)?mxc:\/\/[^\s?#\\]+$/u.test(value) ? value : '';

// GET accounts, chats and message assets, GET/POST chat messages:
// https://developers.beeper.com/desktop-api-reference/
function permitted(method, path, body, query) {
  if (method === 'GET' && body === undefined && (path === '/v1/accounts' || path === '/v1/chats')) return undefined;
  if (method === 'GET' && path === assetPath && body === undefined && assetURL(query?.url)) return undefined;
  // Mark read: the whole chat, no message ID, empty body (opened on the glasses, 2026-11-27).
  const read = /^\/v1\/chats\/([^/]+)\/read$/.exec(path)?.[1];
  if (read && method === 'POST' && body && Reflect.ownKeys(body).length === 0) {
    const id = decodeSegment(read);
    if (validId(id) && path === readPath(id)) return '{}';
  }
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
    const payload = permitted(method, path, body, query);
    const url = new URL(path, ORIGIN);
    // Writes never carry query parameters. Asset URLs come from a message read.
    if (method === 'GET' && path === '/v1/chats') {
      url.searchParams.set('limit', '200');
      if (query?.cursor) {
        url.searchParams.set('cursor', query.cursor);
        url.searchParams.set('direction', 'before');
      }
    }
    if (path === assetPath) url.searchParams.set('url', query.url);
    let token;
    try { token = text(await readToken()); } catch { /* Keep file errors private. */ }
    if (!token || /\s/u.test(token)) throw new BeeperError('beeper-auth', 502);
    for (let attempt = 0; ; attempt++) {
      let response;
      try {
        response = await transport(url, {
          method, headers: { authorization: `Bearer ${token}`, ...(payload && { 'content-type': 'application/json' }) },
          body: payload, redirect: 'error', signal: AbortSignal.timeout(path === assetPath ? 30000 : 2500),
        });
      } catch { throw new BeeperError('beeper-network', 502); }
      if (response.ok) {
        try { return path === assetPath ? await readAsset(response) : await response.json(); }
        catch { throw new BeeperError('beeper-response', 502); }
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

async function readAsset(response) {
  const chunks = [];
  let size = 0;
  // The limit applies even if Beeper has no Content-Length.
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_ASSET_BYTES) throw new Error('Audio too large');
    chunks.push(chunk);
  }
  if (!size) throw new Error('Empty audio');
  return Buffer.concat(chunks, size);
}

const media = { VOICE: 'Voice', AUDIO: 'Audio', IMAGE: 'Photo', VIDEO: 'Video', STICKER: 'Sticker', FILE: 'File', LOCATION: 'Location' };
const visible = item => item && !item.isHidden && !item.isDeleted && item.type !== 'REACTION';
const isAudio = attachment => attachment?.type === 'audio' || attachment?.isVoiceNote === true ||
  /^audio\//i.test(text(attachment?.mimeType));
const english = lang => /^(en(?:[-_].+)?|english)$/i.test(lang ?? '');

function chatMessage(item, transcript) {
  const attachments = Array.isArray(item.attachments) ? item.attachments : [];
  const audio = item.type === 'VOICE' || item.type === 'AUDIO' || attachments.some(isAudio);
  const attachment = audio ? attachments.find(a => isAudio(a) && a.isVoiceNote) ?? attachments.find(isAudio) : undefined;
  const tag = audio ? (item.type === 'VOICE' || attachment?.isVoiceNote ? 'Voice' : 'Audio')
    : Object.hasOwn(media, item.type) ? media[item.type] : undefined;
  // HTML line breaks in Beeper's text become real ones, so the translator and the app see lines.
  const caption = text(text(item.text).replace(/<br\s*\/?>/gi, '\n'));
  if (!tag && !caption) return null;
  const url = assetURL(attachment?.srcURL) || assetURL(attachment?.id);
  const stored = text(attachment?.transcription?.transcription);
  const spoken = stored ? { text: stored, language: text(attachment.transcription.language) }
    : transcript?.url === url ? transcript : undefined;
  const id = validId(item.id) ? item.id : undefined;
  return {
    url,
    message: {
      id, from: text(item.senderName), own: item.isSender === true, date: date(item.timestamp), text: caption,
      ...(tag && { media: tag }),
      ...(audio && { voice: {
        id, ...(Number.isFinite(attachment?.duration) && attachment.duration >= 0 && { duration: attachment.duration }),
        ...(spoken && { transcript: spoken.text, language: spoken.language }),
      } }),
    },
  };
}

function retain(map, key, value) {
  map.delete(key);
  map.set(key, value);
  if (map.size > 2048) map.delete(map.keys().next().value);
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

export function createBeeper(config, { clientOptions, coldWaitMs = 3000, speech = createChatSpeech(config.speech), ollamaTransport } = {}) {
  const request = createBeeperClient(config.tokenFile, clientOptions);
  const transcripts = new Map(), transcribing = new Map(), translations = new Map(), translating = new Map();
  const messageKey = (chatId, id) => JSON.stringify([chatId, id]);
  async function messages(chatId) {
    const page = await request('GET', messagePath(chatId));
    if (!Array.isArray(page?.items)) throw new BeeperError('beeper-response', 502);
    return page.items.filter(visible).map(item => chatMessage(item, transcripts.get(messageKey(chatId, item.id)))).filter(Boolean);
  }
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
      return { messages: (await messages(id)).map(row => row.message).sort((a, b) => a.date - b.date) };
    },
    'POST /api/chat/transcribe': async (_params, input) => {
      if (!input || Object.keys(input).length !== 2 || !validId(input.chatId) || !validId(input.messageId)) throw badRequest();
      const { chatId, messageId } = input;
      const row = (await messages(chatId)).find(row => row.message.id === messageId);
      if (!row?.message.voice) throw new BeeperError('voice-unavailable', 404);
      const { transcript, language } = row.message.voice;
      if (transcript) return { text: transcript, language: language || '' };
      if (!row.url) throw new BeeperError('voice-unavailable', 404);
      const key = messageKey(chatId, messageId);
      if (transcribing.has(key)) return transcribing.get(key);
      if (transcribing.size >= 24) throw new BeeperError('voice-busy', 503);
      const pending = (async () => {
        try {
          const result = await speech.transcribe(() => request('GET', assetPath, { query: { url: row.url } }));
          const value = { text: text(result?.text), language: text(result?.language) };
          if (!value.text || !value.language) throw new Error('Empty transcript');
          retain(transcripts, key, { ...value, url: row.url });
          return value;
        } catch { throw new BeeperError('transcription-failed', 502); }
        finally { transcribing.delete(key); }
      })();
      transcribing.set(key, pending);
      return pending;
    },
    'POST /api/chat/translate': async (_params, input) => {
      if (!input || Object.keys(input).length !== 2 || !validId(input.chatId) || !Array.isArray(input.messageIds) ||
          input.messageIds.length > 200 || !input.messageIds.every(validId)) throw badRequest();
      const { chatId, messageIds } = input;
      const ids = new Set(messageIds);
      const rows = (await messages(chatId)).map(row => row.message).filter(message => ids.has(message.id));
      const items = rows.map(({ id }) => ({ id }));
      const entries = [];
      rows.forEach((message, i) => {
        for (const [field, source] of [['text', message.text], ['voice', !english(message.voice?.language) && message.voice?.transcript]]) {
          if (!source) continue;
          const key = messageKey(chatId, message.id);
          const cached = translations.get(key)?.[field];
          if (cached?.source === source) items[i][field] = cached.value;
          else entries.push({ i, key, field, source });
        }
      });
      if (entries.length) {
        const key = JSON.stringify(entries.map(({ key, field, source }) => [key, field, source]));
        let pending = translating.get(key);
        if (!pending) {
          if (translating.size >= 4) throw new BeeperError('translation-busy', 503);
          if (!localModelName(config.translationModel)) throw new BeeperError('translation-model', 502);
          pending = translateEnglish(config.translationModel, entries.map(entry => entry.source), ollamaTransport)
            .catch(() => { throw new BeeperError('translation-failed', 502); })
            .finally(() => translating.delete(key));
          translating.set(key, pending);
        }
        (await pending).forEach((value, index) => {
          const { i, key, field, source } = entries[index];
          retain(translations, key, { ...translations.get(key), [field]: { source, value } });
          items[i][field] = value;
        });
      }
      return { items };
    },
    // Opening a chat on the glasses marks it read in Beeper (Eugene, 2026-11-27), as Email does.
    'POST /api/chat/read': async (_params, input) => {
      if (!input || Object.keys(input).length !== 1 || !validId(input.chatId)) throw badRequest();
      await request('POST', readPath(input.chatId), { body: {} });
      // The list shows it read before the next snapshot; a failure here only waits for that refresh.
      try { const row = chats.read(undefined)?.items.get(input.chatId); if (row) row.unread = false; } catch { /* next snapshot */ }
      return { ok: true };
    },
    'POST /api/chat/send': async (_params, input) => {
      if (!input || Object.keys(input).length !== 2 || !validId(input.chatId) || !text(input.text)) throw badRequest();
      const result = await request('POST', messagePath(input.chatId), { body: { text: input.text } });
      if (!text(result?.pendingMessageID)) throw new BeeperError('beeper-response', 502);
      return { ok: true };
    },
  };
  return { routes, close: () => { closed = true; clearInterval(timer); speech.close?.(); } };
}
