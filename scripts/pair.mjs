// Prints the pairing code eho1.<topic>.<token> and copies it to the clipboard where possible.
// The topic is part of the code format only (Tailscale only since 2026-11-27); both secrets are
// created on first use.
import { execFileSync } from 'node:child_process';
import { token, topic } from '../bridge/secrets.mjs';
import { clipboardCommand } from '../bridge/platform.mjs';

const code = `eho1.${topic()}.${token()}`;
const clipboard = clipboardCommand();
try {
  if (!clipboard) throw new Error('clipboard unavailable');
  execFileSync(clipboard, { input: code, windowsHide: true });
  console.log('Pairing code copied. Paste it into Orca Glass in the Even Realities app on your phone.');
} catch {
  console.log('Pairing code (paste into Orca Glass on your phone):');
  console.log(code);
}
