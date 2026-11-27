// Used by the phone and the pairing CLI so both accept the same HTTPS origins.
export function parseOrigin(text) {
  if (typeof text !== 'string') return null;
  const m = text.trim().toLowerCase().match(/^https:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::(\d{1,5}))?\/?$/);
  if (!m) return null;
  const port = m[2] ? Number(m[2]) : 443;
  if (port < 1 || port > 65535) return null;
  return port === 443 ? `https://${m[1]}` : `https://${m[1]}:${port}`;
}
