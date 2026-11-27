import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const gitBash = join(process.env.ProgramFiles || 'C:/Program Files', 'Git', 'bin', 'bash.exe');
const bash = process.platform === 'win32' ? gitBash : 'bash';
const skip = (process.platform === 'win32' && !existsSync(bash)) ||
  (typeof process.getuid === 'function' && process.getuid() === 0)
  ? 'Requires Bash and a non-root user' : false;
const host = 'fixture.example.ts.net';
const target = 'http://127.0.0.1:8787';

test('macOS setup dry run preserves config, checks login and selects a safe Serve port', { skip }, t => {
  const root = mkdtempSync(join(tmpdir(), 'hud-desk-mac-test-'));
  t.after(() => rmSync(root, { recursive: true }));
  const fixtures = join(root, 'bin');
  const configPath = join(root, 'bridge', 'config.local.json');
  const original = '{"publicOrigin":"https://old.example.ts.net:8443","localAgents":{"enabled":false}}\n';
  for (const dir of ['bin', 'scripts', 'bridge']) mkdirSync(join(root, dir));
  const setup = readFileSync(new URL('../scripts/setup-macos.sh', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  // Keep the fixture isolated from an installed Tailscale app, even on a Mac.
  writeFileSync(join(root, 'scripts', 'setup-macos.sh'),
    setup.replace('/Applications/Tailscale.app/Contents/MacOS/Tailscale', './bin/unused-app-cli'));
  writeFileSync(join(root, 'scripts', 'setup-macos-config.mjs'),
    readFileSync(new URL('../scripts/setup-macos-config.mjs', import.meta.url)));
  writeFileSync(configPath, original);

  const stub = (name, source) => writeFileSync(join(fixtures, name), `#!/bin/bash\n${source}\n`, { mode: 0o755 });
  stub('uname', 'echo Darwin');
  stub('lsof', '[[ "$*" == *"-iTCP:$BUSY_LOCAL "* ]]');
  const failOnWrite = 'echo "$0 $*" >>"$MUTATIONS"; exit 99';
  for (const command of ['brew', 'npm', 'curl', 'launchctl']) stub(command, failOnWrite);
  stub('tailscale', `
case "$*" in
  'status --json') printf '%s\\n' "$TAILSCALE_STATUS" ;;
  'serve status --json') printf '%s\\n' "$SERVE_STATUS" ;;
  *) ${failOnWrite} ;;
esac`);
  const mutations = './mutations.log';
  const running = { BackendState: 'Running', Self: { DNSName: host + '.' } };
  const run = (mappings, status = running, busyLocal = '') => {
    const result = spawnSync(bash, ['-c', 'export PATH="./bin:$PATH"; exec "$BASH" "$@"', 'fixture',
      'scripts/setup-macos.sh', '--dry-run', '--voice'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, MUTATIONS: mutations,
        BUSY_LOCAL: busyLocal, TAILSCALE_STATUS: JSON.stringify(status), SERVE_STATUS: JSON.stringify(mappings) },
    });
    assert.ifError(result.error);
    assert.equal(readFileSync(configPath, 'utf8'), original);
    assert.equal(existsSync(join(root, mutations)), false);
    assert.equal(existsSync(join(root, '.local')), false);
    return result;
  };
  const dry = run({ TCP: { 8443: { TCPForward: '127.0.0.1:9000' } } });
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /--https=8444/);
  assert.match(dry.stdout, /npm ci --prefix app/);
  assert.match(dry.stdout, /npm run pair/);
  assert.match(dry.stdout, /scripts\/setup-voice\.sh/);

  const fallback = run({ Foreground: { session: { TCP: { 8443: { HTTPS: true } } } } }, running, '8444');
  assert.equal(fallback.status, 0, fallback.stderr);
  assert.match(fallback.stdout, /--https=10000/);

  const sameMapping = { TCP: { 8444: { HTTPS: true } },
    Web: { [host + ':8444']: { Handlers: { '/': { Proxy: target } } } } };
  const reuse = run(sameMapping);
  assert.equal(reuse.status, 0, reuse.stderr);
  assert.match(reuse.stdout, /Reuse the existing tailnet-only Serve mapping at .*:8444/);
  assert.doesNotMatch(reuse.stdout, /serve --bg/);
  const funnel = run({ ...sameMapping, AllowFunnel: { [host + ':8444']: true } });
  assert.equal(funnel.status, 0, funnel.stderr);
  assert.match(funnel.stdout, /--https=8443/);

  const occupied = run({ TCP: { 8443: { HTTP: true }, 8444: { HTTPS: true }, 10000: { HTTPS: true } } });
  assert.equal(occupied.status, 1);
  assert.match(occupied.stderr, /all in use/);
  const loggedOut = run({}, { BackendState: 'NeedsLogin', Self: { DNSName: host + '.' } });
  assert.equal(loggedOut.status, 1);
  assert.match(loggedOut.stderr, /Tailscale is not connected/);
  assert.doesNotMatch(loggedOut.stdout, /npm ci/);
});

test('macOS setup config updater preserves unrelated fields and is idempotent', t => {
  const root = mkdtempSync(join(tmpdir(), 'hud-desk-mac-config-test-'));
  t.after(() => rmSync(root, { recursive: true }));
  const file = join(root, 'config.json');
  const script = fileURLToPath(new URL('../scripts/setup-macos-config.mjs', import.meta.url));
  const origin = `https://${host}:8443`;
  const run = (...args) => spawnSync(process.execPath, [script, file, ...args],
    { encoding: 'utf8' });

  assert.equal(run().status, 0);
  assert.equal(existsSync(file), false);
  assert.equal(run(origin).status, 0);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { publicOrigin: origin });

  const unchanged = '{"localAgents":{"enabled":false},"chat":{"enabled":true}}';
  writeFileSync(file, unchanged);
  const merge = run(origin);
  assert.equal(merge.status, 0, merge.stderr);
  const merged = readFileSync(file, 'utf8');
  assert.deepEqual(JSON.parse(merged), { ...JSON.parse(unchanged), publicOrigin: origin });
  assert.equal(run(origin).status, 0);
  assert.equal(readFileSync(file, 'utf8'), merged);

  writeFileSync(file, '{invalid json}');
  const invalid = run(origin);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /invalid JSON/);
  assert.equal(readFileSync(file, 'utf8'), '{invalid json}');
});
