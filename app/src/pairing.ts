// Both origins are fixed by the build and must be permitted by app/app.json.
import type { RelayPairing } from './relay-transport';
declare const __BRIDGE_ORIGIN__: string;
declare const __RELAY_ORIGIN__: string;

export type Pairing = { topic: string; token: string } | RelayPairing;

export function parseCode(code: string): Pairing | null {
  const clean = code.trim();
  const direct = clean.match(/^eho1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/);
  if (direct) return { topic: direct[1], token: direct[2] };
  // 32 bytes in canonical base64url have 43 characters and two zero pad bits.
  const relay = clean.match(/^eho2\.([A-Za-z0-9_-]{42}[AEIMQUYcgkosw048])\.([A-Za-z0-9_-]{42}[AEIMQUYcgkosw048])$/);
  return relay ? { routeId: relay[1], key: relay[2] } : null;
}

// A bridge address typed on the phone (2026-11-27, like Claude Code G2's connect screen): an HTTPS
// origin only, so a path, query, credentials or plain http cannot be smuggled in. Lower-cased; the
// default port is dropped. Returns null for anything else.
export function parseOrigin(text: string): string | null {
  const m = text.trim().toLowerCase().match(/^https:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::(\d{1,5}))?\/?$/);
  if (!m) return null;
  const port = m[2] ? Number(m[2]) : 443;
  if (port < 1 || port > 65535) return null;
  return port === 443 ? `https://${m[1]}` : `https://${m[1]}:${port}`;
}

// The bridge origin: for a direct (eho1) pairing the typed address when there is one, else the
// build's; relay pairings always use the build's relay origin. Null when neither exists (demo only).
export async function resolveBase(pairing: Pairing, typed = ''): Promise<string | null> {
  if ('routeId' in pairing) return __RELAY_ORIGIN__ || null;
  return parseOrigin(typed) ?? (__BRIDGE_ORIGIN__ || null);
}
