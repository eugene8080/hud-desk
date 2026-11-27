import { aad, concat, MAX_PACKET, NONCE_BYTES, pack, RPC_TIMEOUT_MS, unpack } from './relay-wire.mjs';

export type RelayPairing = { routeId: string; key: string };

export function createRelayTransport(origin: string, { routeId, key }: RelayPairing) {
  const endpoint = `${origin}/r/${routeId}/`;
  let cryptoKey: Promise<CryptoKey> | undefined;
  let session: Promise<string> | undefined;

  async function exchange(meta: object, body: Uint8Array | undefined, signal: AbortSignal) {
    if (!globalThis.crypto?.subtle) throw new Error('Relay pairing requires WebCrypto in the Even WebView');
    cryptoKey ??= crypto.subtle.importKey('raw',
      Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)),
      { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    const secret = await cryptoKey;
    const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
    nonce[0] &= 0x7f; // Reserve the high bit for bridge-generated response nonces.
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: aad(routeId) },
      secret, pack({ ...meta, sentAt: Date.now() }, body),
    );
    const res = await fetch(endpoint, {
      method: 'POST', headers: { 'content-type': 'application/octet-stream' },
      body: concat(nonce, new Uint8Array(ciphertext)), signal, cache: 'no-store',
      credentials: 'omit', redirect: 'error',
    });
    if (!res.ok) {
      if (res.status === 401) throw new Error('Relay request refused. Check the pairing code and device clocks.');
      throw new Error(`Relay unavailable (HTTP ${res.status})`);
    }
    // Bound the response before decoding even if the relay is malicious or misconfigured.
    const stream = res.body?.getReader();
    if (!stream) throw new Error('Empty relay response');
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await stream.read();
      if (done) break;
      size += value.length;
      if (size > MAX_PACKET) {
        await stream.cancel();
        throw new Error('Relay response too large');
      }
      chunks.push(value);
    }
    const packet = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      packet.set(chunk, offset);
      offset += chunk.length;
    }
    if (size < NONCE_BYTES + 16 || !(packet[0] & 0x80)) throw new Error('Invalid relay response nonce');
    const clear = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: packet.subarray(0, NONCE_BYTES), additionalData: aad(routeId, nonce) },
      secret, packet.subarray(NONCE_BYTES),
    );
    return unpack(new Uint8Array(clear));
  }

  function getSession() {
    if (!session) {
      session = exchange({ kind: 'hello' }, undefined, AbortSignal.timeout(8000)).then(({ meta }) => {
        if (meta.kind !== 'hello' || typeof meta.epoch !== 'string') throw new Error('Invalid relay session');
        return meta.epoch;
      }).catch(error => {
        session = undefined;
        throw error;
      });
    }
    return session;
  }

  return async (method: 'GET' | 'POST', path: string, body?: Uint8Array, contentType?: string, timeoutMs = 0) => {
    const signal = AbortSignal.timeout(timeoutMs || RPC_TIMEOUT_MS + 5000);
    let linked = getSession();
    const request = async () => exchange({ kind: 'request', epoch: await linked, method, path, contentType }, body, signal);
    let reply = await request();
    if (reply.meta.kind === 'expired') {
      // Authenticated by the bridge and bound to our request. The bridge refused to
      // execute it because it belongs to a previous bridge process.
      if (session === linked) session = undefined;
      linked = getSession();
      reply = await request();
    }
    const { kind, status, contentType: responseType } = reply.meta;
    if (kind !== 'response' || typeof status !== 'number' || !Number.isInteger(status) ||
        status < 200 || status > 599 || typeof responseType !== 'string') {
      throw new Error('Invalid relay response');
    }
    return new Response([204, 205, 304].includes(status) ? null : reply.body,
      { status, headers: { 'content-type': responseType } });
  };
}
