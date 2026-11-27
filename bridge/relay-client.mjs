import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import { aad, FRAME_ID_BYTES, MAX_PACKET, NONCE_BYTES, pack, unpack } from '../app/src/relay-wire.mjs';
import { relayRouteId } from './relay-config.mjs';

const CLOCK_WINDOW_MS = 60_000;
const MAX_TRACKED_NONCES = 8192;
const MAX_ACTIVE = 4;
const TAG_BYTES = 16;

export function connectRelay({ origin, identity, dispatch, retryMs = 500 }) {
  const { registration, key } = identity;
  const routeId = relayRouteId(registration);
  const secret = Buffer.from(key, 'base64url');
  if (secret.length !== 32) throw new Error('Invalid relay key');
  // A new epoch fences all previously recorded application requests after a bridge restart.
  const epoch = randomBytes(16).toString('base64url');
  const seen = new Map();
  let lastTime = Date.now();
  let lastMonotonic = performance.now();
  const endpoint = new URL(`/bridge/${routeId}`, origin);
  endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';

  let ws, retryTimer, idleTimer, stopped = false, delay = retryMs, active = 0;
  function open() {
    const link = new WebSocket(endpoint, {
      headers: { authorization: `Bearer ${registration}` },
      handshakeTimeout: 8000, maxPayload: MAX_PACKET + FRAME_ID_BYTES, perMessageDeflate: false,
    });
    ws = link;
    const heartbeat = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => link.terminate(), 45_000);
    };
    link.on('open', heartbeat);
    link.on('ping', () => {
      delay = retryMs;
      heartbeat();
    });
    link.on('error', () => link.terminate());
    link.on('close', () => {
      clearTimeout(idleTimer);
      if (stopped) return;
      retryTimer = setTimeout(open, delay * (0.75 + Math.random() * 0.5));
      delay = Math.min(30_000, delay * 2);
    });
    link.on('message', (frame, binary) => {
      if (!binary || frame.length < FRAME_ID_BYTES) return link.terminate();
      const frameId = frame.subarray(0, FRAME_ID_BYTES);
      const packet = frame.subarray(FRAME_ID_BYTES);
      function send(bytes) {
        if (link.readyState !== WebSocket.OPEN) return;
        if (link.bufferedAmount + (bytes?.length ?? 0) > MAX_PACKET * MAX_ACTIVE) return link.terminate();
        link.send(bytes ? Buffer.concat([frameId, bytes]) : frameId, error => { if (error) link.terminate(); });
      }
      void processPacket(packet).then(send, () => send());
    });
  }

  async function processPacket(packet) {
    if (packet.length < NONCE_BYTES + TAG_BYTES || packet[0] & 0x80) throw new Error('Invalid relay request nonce');
    const nonce = packet.subarray(0, NONCE_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', secret, nonce);
    decipher.setAAD(aad(routeId));
    decipher.setAuthTag(packet.subarray(-TAG_BYTES));
    const { meta, body } = unpack(Buffer.concat([
      decipher.update(packet.subarray(NONCE_BYTES, -TAG_BYTES)), decipher.final(),
    ]));

    const now = performance.now();
    // A wall-clock rollback cannot make an already expired packet valid again.
    lastTime = Math.max(lastTime + now - lastMonotonic, Date.now());
    lastMonotonic = now;
    for (const [id, expiry] of seen) {
      if (expiry > now) break;
      seen.delete(id);
    }
    // Reserve the nonce before awaiting a route. A concurrent replay cannot execute it twice.
    const id = nonce.toString('hex');
    if (!Number.isSafeInteger(meta.sentAt) || Math.abs(lastTime - meta.sentAt) > CLOCK_WINDOW_MS ||
        seen.has(id) || seen.size >= MAX_TRACKED_NONCES) throw new Error('Stale relay request');
    seen.set(id, now + 2 * CLOCK_WINDOW_MS);

    function respond(metadata, bytes) {
      const iv = randomBytes(NONCE_BYTES);
      iv[0] |= 0x80;
      const cipher = createCipheriv('aes-256-gcm', secret, iv);
      cipher.setAAD(aad(routeId, nonce));
      return Buffer.concat([iv, cipher.update(pack(metadata, bytes)), cipher.final(), cipher.getAuthTag()]);
    }

    if (meta.kind === 'hello') return respond({ kind: 'hello', epoch });
    if (meta.kind !== 'request') throw new Error('Unknown relay request');
    if (meta.epoch !== epoch) return respond({ kind: 'expired' });
    if (active >= MAX_ACTIVE) {
      return respond({ kind: 'response', status: 503, contentType: 'application/json' },
        Buffer.from('{"error":"Bridge is busy"}'));
    }
    active++;
    try {
      const { status, contentType, bytes } = await dispatch(meta, body);
      return respond({ kind: 'response', status, contentType }, bytes);
    } catch {
      return respond({ kind: 'response', status: 502, contentType: 'application/json' },
        Buffer.from('{"error":"Bridge could not relay the response"}'));
    } finally {
      active--;
    }
  }

  open();
  return () => {
    stopped = true;
    clearTimeout(retryTimer);
    clearTimeout(idleTimer);
    ws.terminate();
  };
}
