import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { executable, orcaExecutable } from '../bridge/platform.mjs';
import { orca } from '../bridge/orca.mjs';
import { MODEL, voiceAvailable } from '../bridge/whisper.mjs';

let failed = false;
function check(name, ok, detail) {
  console.log(`${ok ? 'OK' : 'FAIL'} ${name}: ${detail}`);
  if (!ok) failed = true;
}
check('Node', Number(process.versions.node.split('.')[0]) >= 22, process.version);
check('Tailscale', !!executable('tailscale'), executable('tailscale') || 'Install Tailscale and publish the bridge: tailscale serve --bg --https=8443 http://127.0.0.1:8787');
check('Web build', existsSync(new URL('../app/dist/index.html', import.meta.url)), 'npm --prefix app run build');
const voiceHint = platform() === 'darwin'
  ? 'Run scripts/setup-voice.sh or brew install whisper-cpp'
  : 'Run scripts/setup-voice.ps1';
check('Voice engine', voiceAvailable(), voiceAvailable() ? MODEL : voiceHint);
try {
  const { terminals } = await orca(['terminal', 'list']);
  check('Orca', true, `${orcaExecutable()} (${terminals.filter(t => t.agentIdentity === 'codex').length} Codex terminals)`);
} catch {
  console.log('Optional Orca integration unavailable. Coding can still read and resume plain CLI sessions.');
}
console.log('Starting a new session requires Orca and is Codex-only.');
process.exitCode = failed ? 1 : 0;
