// Pairing code `eho1.<topic>.<token>` and the bridge origin.
// Tailscale only (2026-11-27): the app reaches the bridge at the HTTPS origin its build names
// (ORCA_GLASS_BRIDGE_ORIGIN, also listed in app/app.json's network whitelist). The Cloudflare
// quick tunnel and the signed ntfy.sh discovery it needed were removed; the topic part of the code
// is kept so existing codes still parse, and is no longer used.
declare const __BRIDGE_ORIGIN__: string;

export type Pairing = { topic: string; token: string };

export function parseCode(code: string): Pairing | null {
  const m = code.trim().match(/^eho1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/);
  return m ? { topic: m[1], token: m[2] } : null;
}

// The build's bridge origin, or null for a build without one (only the demo works there).
export async function resolveBase(_p: Pairing): Promise<string | null> {
  return __BRIDGE_ORIGIN__ || null;
}
