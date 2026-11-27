import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { relaySecrets } from './secrets.mjs';

export function relayOrigin(config = readLocalRelay()) {
  if (config == null || config.url === '') return null;
  const url = new URL(config.url);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.origin !== config.url || (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))) {
    throw new Error('relay.url must be an HTTPS origin (HTTP is reserved for localhost testing)');
  }
  return url.origin;
}

function readLocalRelay() {
  const shared = JSON.parse(readFileSync(new URL('./config.json', import.meta.url), 'utf8'));
  try {
    const local = JSON.parse(readFileSync(new URL('./config.local.json', import.meta.url), 'utf8'));
    return Object.hasOwn(local, 'relay') ? local.relay : shared.relay;
  } catch (error) {
    if (error.code === 'ENOENT') return shared.relay;
    throw error;
  }
}

export function makeRelayIdentity() {
  const registration = randomBytes(32).toString('base64url');
  const key = randomBytes(32).toString('base64url');
  return { registration, key };
}

export function relayIdentity() {
  return JSON.parse(relaySecrets(() => JSON.stringify(makeRelayIdentity())));
}

export function relayRouteId(registration) {
  return createHash('sha256').update(registration).digest('base64url');
}
