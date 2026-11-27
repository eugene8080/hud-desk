import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseOrigin } from '../app/src/bridge-origin.mjs';
import { token, topic } from '../bridge/secrets.mjs';
import { clipboardCommand } from '../bridge/platform.mjs';
import { relayIdentity, relayOrigin, relayRouteId } from '../bridge/relay-config.mjs';
import { readLocalConfig } from './self-host-config.mjs';

export function pairingCode({ publicOrigin, origin, getToken, getTopic, getRelayCode }) {
  const address = parseOrigin(origin ?? publicOrigin);
  if (origin !== undefined && !address) {
    throw new Error('--origin requires an HTTPS origin such as https://pc.example.net:8443');
  }
  if (address) return `eho3.${Buffer.from(address).toString('base64url')}.${getToken()}`;
  return getRelayCode?.() || `eho1.${getTopic()}.${getToken()}`;
}

export function printPairingCode(code, { print = console.log, copy = copyToClipboard } = {}) {
  print('Pairing code (paste into HUD Desk on your phone):');
  print(code);
  if (code.startsWith('eho2.')) return;
  try {
    copy(code);
    print('Pairing code copied to the clipboard.');
  } catch {
    print('Clipboard unavailable. Copy the code above.');
  }
}

function copyToClipboard(code) {
  const clipboard = clipboardCommand();
  if (!clipboard) throw new Error('Clipboard unavailable');
  execFileSync(clipboard, { input: code, windowsHide: true });
}

function main(args) {
  if (args.length && (args.length !== 2 || args[0] !== '--origin')) {
    throw new Error('Usage: npm run pair -- [--origin https://pc.example.net:8443]');
  }
  const config = readLocalConfig();
  const code = pairingCode({
    publicOrigin: config?.publicOrigin,
    origin: args[1],
    getToken: token,
    getTopic: topic,
    getRelayCode() {
      if (!relayOrigin()) return null;
      const { registration, key } = relayIdentity();
      return `eho2.${relayRouteId(registration)}.${key}`;
    },
  });
  printPairingCode(code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
