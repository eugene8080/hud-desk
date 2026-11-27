// Shared wire format. The relay only uses the size limits and route identifier pattern.
export const ROUTE_ID = /^[A-Za-z0-9_-]{43}$/;
export const NONCE_BYTES = 12;
export const FRAME_ID_BYTES = 16;
const TAG_BYTES = 16;
const MAX_META = 8192;
export const MAX_BODY = 4 * 1024 * 1024;
export const MAX_PACKET = 2 + MAX_META + MAX_BODY + NONCE_BYTES + TAG_BYTES;
export const RPC_TIMEOUT_MS = 390_000;

const utf8 = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function concat(a, b) {
  const joined = new Uint8Array(a.length + b.length);
  joined.set(a);
  joined.set(b, a.length);
  return joined;
}

export function pack(meta, body = new Uint8Array()) {
  const header = utf8.encode(JSON.stringify(meta));
  if (header.length > MAX_META || body.length > MAX_BODY) throw new Error('Relay message too large');
  const bytes = new Uint8Array(2 + header.length + body.length);
  new DataView(bytes.buffer).setUint16(0, header.length);
  bytes.set(header, 2);
  bytes.set(body, 2 + header.length);
  return bytes;
}

export function unpack(bytes) {
  if (bytes.length < 2 || bytes.length > MAX_PACKET - NONCE_BYTES - TAG_BYTES) throw new Error('Invalid relay message');
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(0);
  if (length > MAX_META || 2 + length > bytes.length || bytes.length - 2 - length > MAX_BODY) {
    throw new Error('Invalid relay message length');
  }
  const meta = JSON.parse(decoder.decode(bytes.subarray(2, 2 + length)));
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('Invalid relay metadata');
  return { meta, body: bytes.subarray(2 + length) };
}

// A response authenticates the nonce of its exact request. Reflection and swapping
// across directions, route IDs or in-flight requests fail authentication.
export function aad(routeId, requestNonce) {
  return requestNonce
    ? concat(utf8.encode(`hud-desk/2/response/${routeId}/`), requestNonce)
    : utf8.encode(`hud-desk/2/request/${routeId}`);
}
