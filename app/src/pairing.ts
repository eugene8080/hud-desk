import type { RelayPairing } from './relay-transport';
import { parseOrigin } from './bridge-origin.mjs';
export { parseOrigin };
declare const __BRIDGE_ORIGIN__: string;
declare const __RELAY_ORIGIN__: string;

export type Pairing = { topic: string; token: string; origin?: string } | RelayPairing;

export function parseCode(code: string): Pairing | null {
  const clean = code.trim();
  const direct = clean.match(/^eho1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/);
  if (direct) return { topic: direct[1], token: direct[2] };
  const addressed = clean.match(/^eho3\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/);
  if (addressed) {
    try {
      const base64 = addressed[1].replace(/-/g, '+').replace(/_/g, '/');
      const decoded = atob(base64);
      if (btoa(decoded).replace(/=+$/, '') !== base64) return null;
      const origin = parseOrigin(decoded);
      return origin ? { topic: '', token: addressed[2], origin } : null;
    } catch {
      return null;
    }
  }
  // 32 bytes in canonical base64url have 43 characters and two zero pad bits.
  const relay = clean.match(/^eho2\.([A-Za-z0-9_-]{42}[AEIMQUYcgkosw048])\.([A-Za-z0-9_-]{42}[AEIMQUYcgkosw048])$/);
  return relay ? { routeId: relay[1], key: relay[2] } : null;
}

// Direct pairings use the typed address, the code's address, then the build's address.
// Relay pairings always use the build's relay origin.
export async function resolveBase(pairing: Pairing, typed = ''): Promise<string | null> {
  if ('routeId' in pairing) return __RELAY_ORIGIN__ || null;
  return parseOrigin(typed) ?? pairing.origin ?? (__BRIDGE_ORIGIN__ || null);
}
