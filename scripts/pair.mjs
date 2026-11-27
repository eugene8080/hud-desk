// Copy direct pairing codes to the clipboard. Relay pairing codes are printed locally.
import { execFileSync } from 'node:child_process';
import { token, topic } from '../bridge/secrets.mjs';
import { clipboardCommand } from '../bridge/platform.mjs';
import { relayIdentity, relayOrigin, relayRouteId } from '../bridge/relay-config.mjs';

if (relayOrigin()) {
  const { registration, key } = relayIdentity();
  console.log('Relay pairing code (paste into HUD Desk on your phone):');
  console.log(`eho2.${relayRouteId(registration)}.${key}`);
} else {
  printDirectCode();
}

function printDirectCode() {
  const code = `eho1.${topic()}.${token()}`;
  const clipboard = clipboardCommand();
  try {
    if (!clipboard) throw new Error('clipboard unavailable');
    execFileSync(clipboard, { input: code, windowsHide: true });
    console.log('Pairing code copied. Paste it into HUD Desk in the Even Realities app on your phone.');
  } catch {
    console.log('Pairing code (paste into HUD Desk on your phone):');
    console.log(code);
  }
}
