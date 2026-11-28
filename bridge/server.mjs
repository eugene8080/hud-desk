// Even Hub アプリ(グラス)と orca CLI をつなぐ中継サーバ。
// アプリの静的ファイルも同じオリジンで配るので、CORS は不要。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { extname, join, normalize } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { executable } from './platform.mjs';
import * as o from './orca.mjs';
import * as secrets from './secrets.mjs';
import { transcribe, voiceAvailable, warmWhisper } from './whisper.mjs';
import { MailError } from './gmail.mjs';
import { allowPrivateHost, createMail, readMailConfig } from './mail.mjs';
import { BeeperError, createBeeper, readBeeperConfig } from './beeper.mjs';
import { createImaging, ImageError, readView } from './image.mjs';
import { relayIdentity, relayOrigin } from './relay-config.mjs';
import { createLocalAgents, isLocalAgent, localAgentKey } from './local-agents.mjs';
import { patientConnections } from './network.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const DIST = join(here, '../app/dist');
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
// config.json(共有の既定値)に config.local.json(各自の環境・git 管理外)を上書きする
const config = JSON.parse(readFileSync(join(here, 'config.json'), 'utf8'));
const localFile = join(here, 'config.local.json');
const local = existsSync(localFile) ? JSON.parse(readFileSync(localFile, 'utf8')) : {};
// Images on the glasses (2026-11-27): ffmpeg from PATH, `ffmpegPath`, or the Chat voice set-up's path.
// The Read view uses the local Ollama vision model: `visionModel`, else the Chat translation model.
const imaging = createImaging({ ffmpeg: local.ffmpegPath ?? local.beeper?.ffmpegPath,
  model: local.visionModel ?? local.beeper?.translationModel });
Object.assign(config, local);

function authorized(req, token) {
  const got = Buffer.from(req.headers.authorization?.replace(/^Bearer /, '') || '');
  const want = Buffer.from(token);
  return got.length === want.length && timingSafeEqual(got, want);
}

async function installed(cmd) {
  return !!executable(cmd);
}

// This Windows fork always serves English, including legacy ?lang=ja URLs.
const L = {
  en: {
    unknownUsage: 'usage unknown', unavailable: 'unavailable', weekLimit: 'weekly limit ({0})', sessionLimit: '5h limit ({0})',
    week: 'week', notInstalled: 'not installed', noMenu: 'No choice menu on screen',
    dialog: 'a confirmation dialog is open', notReady: 'the agent did not become ready',
  },
};
const langOf = (q) => (q?.get('lang') === 'ja' ? 'ja' : 'en');
const msg = (lang, key, ...a) => L[lang][key].replace(/\{(\d)\}/g, (_, i) => a[i]);
// Accept English strings and legacy localized objects containing an en value.
const pick = (v, lang) => (typeof v === 'string' ? v : v.en ?? '');

function limitSummary(rl, lang) {
  if (!rl) return { ok: true, note: msg(lang, 'unknownUsage') };
  if (rl.status === 'unavailable') return { ok: false, note: msg(lang, 'unavailable') };
  const s = rl.session?.usedPercent;
  const w = rl.weekly?.usedPercent;
  if (w >= 100) return { ok: false, note: msg(lang, 'weekLimit', rl.weekly.resetDescription) };
  if (s >= 100) return { ok: false, note: msg(lang, 'sessionLimit', rl.session.resetDescription) };
  const parts = [s != null && `5h ${s}%`, w != null && `${msg(lang, 'week')} ${w}%`].filter(Boolean);
  return { ok: true, note: parts.join(' ') || msg(lang, 'unknownUsage') };
}

async function providers(q, orca) {
  const lang = langOf(q);
  const limits = await orca.usage().catch(() => ({}));
  return Promise.all(
    config.agents.filter(a => a.id === 'codex').map(async (a) => {
      const has = await installed(a.command);
      const lim = limitSummary(limits[a.id], lang);
      return { id: a.id, models: a.models, ok: has && lim.ok, note: has ? lim.note : msg(lang, 'notInstalled') };
    }),
  );
}

const MAX_AUDIO = 16000 * 2 * 90; // 90秒分

async function raw(req, max) {
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > max) throw new Error('too large');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

async function body(req) {
  if (req.headers['content-type'] === 'application/octet-stream') return raw(req, MAX_AUDIO);
  const s = (await raw(req, 64 * 1024)).toString('utf8');
  return s ? JSON.parse(s) : {};
}

function codingRoutes(agents, orca) {
  let listing, listedAt = -Infinity, pending;
  async function loadOrca() {
    const excluded = new Set();
    const threads = await orca.listThreads({ timeoutMs: 2_500, onBindings: bindings => {
      for (const { provider, id } of bindings) excluded.add(localAgentKey(provider, id));
    } }).catch(() => null);
    listing = { available: !!threads, threads: threads || [], excluded };
    listedAt = Date.now();
    return listing;
  }
  function orcaSnapshot(fresh = false) {
    if (!fresh && Date.now() - listedAt < 3_000) return listing;
    return pending ??= loadOrca().finally(() => { pending = null; });
  }
  const readThread = handle => isLocalAgent(handle)
    ? agents.read(handle).then(history => ({ ...history, menu: null, progress: '' }))
    : orca.readThread(handle);
  const sendToThread = (handle, text, enter) => isLocalAgent(handle)
    ? agents.send(handle, text, async () => (await orcaSnapshot(true)).excluded)
    : orca.sendToThread(handle, text, enter);
  const routes = {
    'GET /api/threads': async () => {
      const { threads, excluded } = await orcaSnapshot();
      return [...threads, ...await agents.list(excluded)].sort((a, b) => (b.lastOutputAt || 0) - (a.lastOutputAt || 0));
    },
    'GET /api/activity': (q) => {
      const handle = q.get('handle');
      return isLocalAgent(handle) ? agents.activity(handle) : orca.activity(handle);
    },
    'GET /api/thread': (q) => readThread(q.get('handle')),
    'GET /api/history': (q) => {
      const handle = q.get('handle');
      return isLocalAgent(handle) ? agents.read(handle) : orca.readHistory(handle);
    },
    // An image pasted into a Claude or Codex session, by its [Image N] number in the history.
    // Not cached: a /clear restarts the numbering on the same terminal.
    // The app left the picture viewer (2026-11-28): stop the model's background readings
    // (prefetched AI Readout and AI Labels of the chart that was open).
    'POST /api/image/idle': () => { imaging.idle(); return { ok: true }; },
    'GET /api/history/image': (q) => {
      const index = Number(q.get('index'));
      if (!Number.isSafeInteger(index) || index < 1) throw new ImageError('bad request', 400);
      const handle = q.get('handle');
      return imaging.render(null, () => isLocalAgent(handle) ? agents.image(handle, index) : orca.readHistoryImage(handle, index),
        readView(key => q.get(key)));
    },
    'POST /api/choice': (_q, b) => {
      if (isLocalAgent(b.handle)) throw new Error('Local CLI sessions do not expose terminal choices.');
      return orca.choose(b.handle, b.menuId, b.value);
    },
    'GET /api/replies': (q) => config.replies.filter(r => r.enter).map((r) => pick(r.label, langOf(q))),
    'POST /api/reply': async (q, b) => {
      const lang = langOf(q);
      const r = config.replies.filter(r => r.enter)[b.index];
      if (!r) throw new Error('unknown reply');
      const text = pick(r.text, lang);
      if (!isLocalAgent(b.handle) && (await readThread(b.handle)).menu) throw new Error('Use the current question choices, not a text reply');
      await sendToThread(b.handle, text, r.enter);
      return { sent: pick(r.label, lang) };
    },
    // 音声入力: 文字起こしと、確認後の自由文送信
    'POST /api/transcribe': async (q, pcm) => ({ text: pcm.length ? await transcribe(pcm, langOf(q)) : '' }),
    'POST /api/say': async (_q, b) => {
      if (!isLocalAgent(b.handle) && (await readThread(b.handle)).menu) throw new Error('Use the current question choices, not a text reply');
      const text = String(b.text || '').trim();
      if (!text || text.length > 2000) throw new Error('bad text');
      await sendToThread(b.handle, text, true);
      return { sent: text };
    },
    'GET /api/usage': () => orca.usage(),
    'GET /api/providers': async (q) => (await orcaSnapshot()).available ? providers(q, orca) : [],
    // Orca のフォルダ(非git)は CLI で名前を引けないため config で明示する
    'GET /api/workspaces': async () => [...(config.workspaces || []), ...((await orcaSnapshot()).available
      ? await orca.listWorkspaces().catch(() => []) : [])],
    'GET /api/prompts': (q) => config.prompts.map((p) => pick(p.label, langOf(q))),
    'POST /api/session': async (q, b) => {
      const lang = langOf(q);
      const agent = config.agents.find((a) => a.id === b.agent);
      const prompt = config.prompts[b.prompt];
      if (!agent || agent.id !== 'codex' || !prompt || !agent.models.includes(b.model)) throw new Error('Only Codex sessions are enabled');
      if (!(await orcaSnapshot()).available) throw new Error('Starting a new session requires Orca.');
      const command = b.model === 'default' ? agent.command : `${agent.command} --model ${b.model}`;
      const r = await orca.startSession({ workspaceId: b.workspaceId, command, prompt: pick(prompt.text, lang) });
      return r.reason ? { ...r, reason: msg(lang, r.reason) } : r;
    },
  };
  return { routes, orcaAvailable: async () => (await orcaSnapshot()).available };
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const activityTrace = new Map();

export function createBridge({
  token = process.env.EHO_TOKEN || secrets.token(),
  mailConfig = local.mail, beeperConfig = local.beeper, privateHosts = local.privateHosts, mailOptions, beeperOptions,
  relayConfig = null, identity,
  localAgentsConfig = config.localAgents, localAgentsOptions,
} = {}) {
  const agents = createLocalAgents(localAgentsConfig, localAgentsOptions);
  const { routes, orcaAvailable } = codingRoutes(agents, o);
  const settings = readMailConfig(mailConfig);
  const mail = settings && createMail(settings, { imaging, ...mailOptions });
  const beeperSettings = readBeeperConfig(beeperConfig);
  const chat = beeperSettings && createBeeper(beeperSettings, { imaging, ...beeperOptions });
  const privateHostAllowed = allowPrivateHost(privateHosts);
  // imageLabels: the AI Labels view (charts) exists on this bridge and the vision model answers;
  // bridges before it omit the field, and the app does not offer the view.
  const capabilities = async () => {
    const read = await imaging.readable();
    return { voice: voiceAvailable(), images: imaging.available(), imageRead: read, imageLabels: read, modules: ['coding', ...(mail ? ['email'] : []), ...(chat ? ['chat'] : [])],
      orca: await orcaAvailable(), localAgents: agents.capabilities(),
      ...(chat?.features && { chatFeatures: await chat.features() }) };
  };
  const direct = (req, res) => handle(req, res, token, routes, capabilities, mail, chat, privateHostAllowed);
  const server = createServer(direct);
  const origin = relayOrigin(relayConfig);
  if (origin) {
    const pairing = identity ?? relayIdentity();
    // Only traffic authenticated and replay-checked by connectRelay enters this
    // adapter. Internet callers cannot claim a trusted host with an HTTP header.
    const trusted = (req, res) => handle(req, res, token, routes, capabilities, mail, chat, () => true);
    let stopRelay;
    server.once('listening', async () => {
      try {
        const { connectRelay } = await import('./relay-client.mjs');
        if (server.listening) {
          stopRelay = connectRelay({ origin, identity: pairing,
            dispatch: (meta, bytes) => relayRequest(trusted, token, meta, bytes) });
        }
      } catch {
        console.error('Could not start the outbound relay client. Check the relay setup in docs/relay.md.');
      }
    });
    server.once('close', () => stopRelay?.());
  }
  if (mail) server.once('close', mail.close);
  if (chat) server.once('close', chat.close);
  return server;
}

async function relayRequest(handler, token, { method, path, contentType }, bytes) {
  const bad = { status: 400, contentType: 'application/json', bytes: Buffer.from('{"error":"Invalid relay request"}') };
  if ((method !== 'GET' && method !== 'POST') || typeof path !== 'string' || !path.startsWith('/') ||
      path.startsWith('//') || path.includes('\\') || /[\r\n\t#]/.test(path)) return bad;
  const url = new URL(path, 'http://bridge.invalid');
  if (url.origin !== 'http://bridge.invalid' || (url.pathname !== '/healthz' && !url.pathname.startsWith('/api/'))) return bad;
  if (method === 'POST' && contentType !== 'application/json' && contentType !== 'application/octet-stream') return bad;
  if (method === 'GET' && bytes.length) return bad;
  const req = Object.assign(Readable.from(bytes.length ? [bytes] : []), {
    method, url: url.pathname + url.search,
    headers: { authorization: `Bearer ${token}`, 'content-type': contentType },
  });
  const headers = new Map();
  let result;
  const res = {
    statusCode: 200,
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    writeHead(status, values) {
      this.statusCode = status;
      for (const [name, value] of Object.entries(values)) this.setHeader(name, value);
    },
    end(data = '') {
      result = { status: this.statusCode, contentType: headers.get('content-type') ?? 'application/octet-stream',
        bytes: Buffer.from(data) };
    },
  };
  await handler(req, res);
  return result;
}

async function handle(req, res, token, routes, capabilities, mail, chat, privateHostAllowed) {
  const url = new URL(req.url, 'http://x');
  // アプリを別オリジン(固定の置き場所)から開いても呼べるようにする。認証は Bearer なので Cookie は使わない
  res.setHeader('access-control-allow-origin', '*');
  const key = `${req.method} ${url.pathname}`;
  if (mail && url.pathname.startsWith('/api/mail/')) {
    return handlePrivate(req, res, url, 'mail', mail.routes[key], token, privateHostAllowed);
  }
  if (url.pathname.startsWith('/api/chat/')) {
    return handlePrivate(req, res, url, 'chat', chat?.routes[key], token, privateHostAllowed);
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-methods': 'GET, POST',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-max-age': '600',
    });
    return res.end();
  }
  try {
    // トンネル死活監視用。情報は何も返さない
    if (url.pathname === '/healthz') return send(res, 200, { ok: true });
    if (url.pathname.startsWith('/api/')) {
      if (!authorized(req, token)) return send(res, 401, { error: 'unauthorized' });
      const route = key === 'GET /api/capabilities' ? capabilities : routes[key];
      if (!route) return send(res, 404, { error: 'not found' });
      const result = await route(url.searchParams, req.method === 'POST' ? await body(req) : {});
      if (url.pathname === '/api/activity') {
        // Local diagnostics contain no bearer token, transcript, or full URL.
        const handle = url.searchParams.get('handle')?.slice(-6);
        const origin = req.headers.origin || 'no-origin';
        const key = `${handle}:${origin}`;
        const previous = activityTrace.get(key);
        if (!previous || previous.state !== result.state || Date.now() - previous.time > 15000) {
          console.log('[activity]', JSON.stringify({ time: new Date().toISOString(), handle, origin, state: result.state }));
          activityTrace.set(key, { time: Date.now(), state: result.state });
          if (activityTrace.size > 200) activityTrace.delete(activityTrace.keys().next().value);
        }
      }
      return send(res, 200, result);
    }
    const file = join(DIST, normalize(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(DIST)) return send(res, 403, { error: 'forbidden' });
    const data = await readFile(file).catch(() => null);
    if (!data) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch (e) {
    if (e instanceof ImageError) return send(res, e.status, { error: e.code });
    console.error(e);
    send(res, 500, { error: String(e.message || e) });
  }
}

async function handlePrivate(req, res, url, module, route, token, privateHostAllowed) {
  const started = Date.now();
  let count = 0;
  // Browsers send preflight without bearer credentials. Apply the host gate to preflight as well.
  try {
    if (req.method !== 'OPTIONS' && !authorized(req, token)) return send(res, 401, { error: 'unauthorized' });
    res.setHeader('cache-control', 'no-store');
    if (!privateHostAllowed(req.headers)) return send(res, 403, { error: 'private-route' });
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-methods': 'GET, POST',
        'access-control-allow-headers': 'authorization, content-type',
        'access-control-max-age': '600',
      });
      return res.end();
    }
    if (!route) return send(res, 404, { error: 'not found' });
    let input;
    if (req.method === 'POST') {
      try {
        input = JSON.parse((await raw(req, 64 * 1024)).toString('utf8'));
      } catch {
        throw new MailError('bad request', 400);
      }
    }
    const result = await route(url.searchParams, input);
    const transcribed = module === 'chat' && url.pathname === '/api/chat/transcribe' && Boolean(result.text);
    count = Array.isArray(result) ? result.length : result.items?.length ?? result.messages?.length ?? Number(transcribed);
    return send(res, 200, result);
  } catch (error) {
    return error instanceof MailError || error instanceof BeeperError || error instanceof ImageError
      ? send(res, error.status, { error: error.code })
      : send(res, 500, { error: 'internal' });
  } finally {
    const path = route ? url.pathname : `/api/${module}/*`;
    console.log(`[${module}] ${path} ${res.statusCode} count=${count} ${Date.now() - started}ms`);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  // Before any outbound call: a slow IPv4 route must not lose to a dead IPv6 one (bridge/network.mjs).
  patientConnections();
  createBridge({ relayConfig: config.relay }).listen(PORT, HOST, () => {
    console.log(`evenhub-orca bridge: http://${HOST}:${PORT}/ (pair with npm run pair)`);
    if (voiceAvailable()) warmWhisper().then(() => console.log('Local speech engine ready')).catch(e => console.error(e.message));
  });
}

function send(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}
