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

// The build's bridge origin, or null for a build without one (only the demo works there).
export async function resolveBase(pairing: Pairing): Promise<string | null> {
  return ('routeId' in pairing ? __RELAY_ORIGIN__ : __BRIDGE_ORIGIN__) || null;
}
