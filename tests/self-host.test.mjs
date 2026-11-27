import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLocalConfig, savePublicOrigin } from '../scripts/self-host-config.mjs';

const address = 'https://pc.example.ts.net:8444';

test('Windows setup creates a minimal local config and merges only its publicOrigin', t => {
  const folder = mkdtempSync(join(tmpdir(), 'hud-desk-config-'));
  t.after(() => rmSync(folder, { force: true, recursive: true }));
  const config = join(folder, 'config.local.json');
  assert.equal(savePublicOrigin(address, config), 'created minimal config');
  assert.deepEqual(readLocalConfig(config), { publicOrigin: address });

  const existing = { mail: { enabled: true, account: 'fixture' }, beeper: { enabled: true }, extra: ['preserved', {}] };
  writeFileSync(config, JSON.stringify(existing));
  assert.equal(savePublicOrigin(address, config), 'merged publicOrigin');
  assert.deepEqual(readLocalConfig(config), { ...existing, publicOrigin: address });

  writeFileSync(config, JSON.stringify({ ...existing, publicOrigin: address }));
  const before = readFileSync(config, 'utf8');
  assert.equal(savePublicOrigin(address, config), 'already set');
  assert.equal(readFileSync(config, 'utf8'), before);
  writeFileSync(config, '{invalid JSON');
  assert.throws(() => savePublicOrigin(address, config), /Fix invalid JSON/);
  assert.equal(readFileSync(config, 'utf8'), '{invalid JSON');
});

test('Windows PowerShell parses setup scripts and verifies port selection and login refusal',
  { skip: process.platform !== 'win32' }, () => {
    const script = fileURLToPath(new URL('./setup-windows.test.ps1', import.meta.url));
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
      { encoding: 'utf8', windowsHide: true });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /PowerShell parser and setup checks passed/);
  });
