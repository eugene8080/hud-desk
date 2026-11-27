import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { FRAME_ID_BYTES, MAX_PACKET, NONCE_BYTES, ROUTE_ID, RPC_TIMEOUT_MS } from '../app/src/relay-wire.mjs';

const MIN_PACKET = NONCE_BYTES + 16;
const MAX_ROUTES = 256;
const MAX_PENDING = 32;
const PER_ROUTE_PENDING = 4;
const RATE_WINDOW_MS = 60_000;
// The coding reader may make three calls each second while it displays saved history.
const RATE_PER_MINUTE = 360;
const RATE_BURST = 48;
const HEARTBEAT_MS = 20_000;

function routeFor(url, prefix) {
  const match = url?.match(prefix);
  return match && ROUTE_ID.test(match[1]) ? match[1] : null;
}

function reply(res, status, bytes, headers) {
  res.writeHead(status, {
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(bytes);
}

export function createRelay() {
  const routes = new Map();
  let inFlight = 0;
  const wss = new WebSocketServer({
    noServer: true, maxPayload: FRAME_ID_BYTES + MAX_PACKET, perMessageDeflate: false,
  });

  const server = createServer({ headersTimeout: 10_000, requestTimeout: 15_000 }, (req, res) => {
    const id = routeFor(req.url, /^\/r\/([^/]+)\/$/);
    if (!id) return reply(res, 404);
    if (req.method === 'OPTIONS') {
      return reply(res, 204, undefined, {
        'access-control-allow-methods': 'POST',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '600',
      });
    }
    if (req.method !== 'POST' || req.headers['content-type'] !== 'application/octet-stream') {
      return reply(res, 415);
    }
    const route = routes.get(id);
    const ws = route?.link;
    if (ws?.readyState !== 1) return reply(res, 503);
    if (inFlight >= MAX_PENDING || route.active >= PER_ROUTE_PENDING) return reply(res, 429);
    const now = performance.now();
    route.allowance = Math.min(RATE_BURST, route.allowance + (now - route.updated) * RATE_PER_MINUTE / RATE_WINDOW_MS);
    route.updated = now;
    if (route.allowance < 1) return reply(res, 429);
    route.allowance--;

    const declared = Number(req.headers['content-length']);
    if (declared > MAX_PACKET) return reply(res, 413, undefined, { connection: 'close' });
    const frameId = randomBytes(FRAME_ID_BYTES);
    const requestId = frameId.toString('hex');
    let chunks = [];
    let size = 0;
    let finished = false;
    let writeTimer;
    let timer = setTimeout(() => finish(408), 15_000);
    inFlight++;
    route.active++;

    function finish(status, bytes) {
      if (finished) return;
      finished = true;
      chunks = [];
      clearTimeout(timer);
      ws.pending.delete(requestId);
      if (status && !res.destroyed) {
        // Keep this slot until the response leaves Node's write queue.
        writeTimer = setTimeout(() => res.destroy(), 15_000);
        reply(res, status, bytes, status === 200 ? { 'content-type': 'application/octet-stream' }
          : status === 408 || status === 413 ? { connection: 'close' } : undefined);
      }
    }

    function release() {
      clearTimeout(writeTimer);
      res.off('finish', release);
      res.off('close', release);
      finish();
      inFlight--;
      route.active--;
    }

    ws.pending.set(requestId, { finish, forwarded: false });
    res.once('finish', release);
    res.once('close', release);
    req.on('error', () => res.destroy());
    req.on('data', chunk => {
      if (finished) return;
      size += chunk.length;
      if (size > MAX_PACKET) return finish(413);
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (finished) return;
      if (size < MIN_PACKET) return finish(400);
      if (ws.bufferedAmount + size > MAX_PACKET * PER_ROUTE_PENDING) return finish(503);
      clearTimeout(timer);
      timer = setTimeout(() => finish(504), RPC_TIMEOUT_MS);
      ws.pending.get(requestId).forwarded = true;
      const frame = Buffer.concat([frameId, ...chunks], FRAME_ID_BYTES + size);
      chunks = [];
      ws.send(frame, error => { if (error) finish(503); });
    });
  });
  server.maxConnections = 512;

  server.on('upgrade', (req, socket, head) => {
    const id = routeFor(req.url, /^\/bridge\/([^/]+)$/);
    const proof = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? '')?.[1];
    const authenticated = id && proof && createHash('sha256').update(proof).digest('base64url') === id;
    if (!authenticated || req.headers.origin || (!routes.has(id) && routes.size >= MAX_ROUTES)) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, ws => {
      const route = routes.get(id) ?? { allowance: RATE_BURST, updated: performance.now(), active: 0 };
      // A fresh, authenticated socket supersedes half-open connections after a network change.
      route.link?.terminate();
      route.link = ws;
      routes.set(id, route);
      ws.alive = true;
      ws.pending = new Map();
      ws.on('error', () => ws.terminate());
      ws.on('pong', () => { ws.alive = true; });
      ws.on('close', () => {
        for (const { finish } of ws.pending.values()) finish(503);
        if (route.link === ws) {
          route.link = undefined;
          route.disconnected = performance.now();
        }
      });
      ws.on('message', (frame, binary) => {
        if (!binary || frame.length < FRAME_ID_BYTES) return ws.terminate();
        const slot = ws.pending.get(frame.subarray(0, FRAME_ID_BYTES).toString('hex'));
        if (!slot?.forwarded) return;
        const bytes = frame.subarray(FRAME_ID_BYTES);
        if (!bytes.length) return slot.finish(401);
        if (bytes.length < MIN_PACKET) return slot.finish(502);
        slot.finish(200, bytes);
      });
    });
  });

  const heartbeat = setInterval(() => {
    for (const [id, route] of routes) {
      if (!route.link) {
        if (performance.now() - route.disconnected > RATE_WINDOW_MS) routes.delete(id);
      } else if (!route.link.alive) {
        route.link.terminate();
      } else {
        route.link.alive = false;
        route.link.ping();
      }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  return {
    server,
    close() {
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { server, close } = createRelay();
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 8797);
  server.listen(port, host, () => console.log(`HUD Desk relay listening on ${host}:${server.address().port}`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
    // Ensure that uploads still open at shutdown cannot prevent a restart.
    const closed = close();
    server.closeAllConnections();
    closed.catch(() => { process.exitCode = 1; });
  });
}
