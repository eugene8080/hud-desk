import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { promisify } from 'node:util';
import { createLocalAgents, localAgentKey } from '../bridge/local-agents.mjs';
import { orcaProviderSessions } from '../bridge/conversation.mjs';

const exec = promisify(execFile);
const id = n => `12345678-0123-4567-8901-${String(n).padStart(12, '0')}`;
const old = new Date(Date.now() - 120_000);
const older = new Date(Date.now() - 180_000);

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'hud-desk-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cwd = join(dir, 'Sample workspace');
  const claude = join(dir, 'claude-home', 'projects'), codex = join(dir, 'codex-home', 'sessions');
  await mkdir(cwd);
  return {
    dir, cwd, claude, codex,
    async put(agent, n, { at = old, pending = false, source = 'cli', folder } = {}) {
      const sessionId = id(n);
      const file = agent === 'claude'
        ? join(claude, folder ?? 'project', `${sessionId}.jsonl`)
        : join(codex, '2026', '11', '27', `rollout-2026-11-27T12-00-00-${sessionId}.jsonl`);
      await mkdir(dirname(file), { recursive: true });
      const records = agent === 'claude' ? [
        { type: 'attachment', attachment: { kind: 'fixture' } },
        { type: 'user', sessionId, cwd, entrypoint: source, message: { role: 'user', content: 'Inspect the fixture\nsecond line' } },
        ...(!pending ? [{ type: 'assistant', sessionId, cwd, message: { role: 'assistant', content: [{ type: 'text', text: 'Fixture inspected.' }], model: 'claude-sonnet-4-6', stop_reason: 'end_turn' } }] : []),
      ] : [
        { type: 'session_meta', payload: { id: sessionId, cwd, source } },
        { type: 'turn_context', payload: { model: 'gpt-6.2-sol', effort: 'medium' } },
        { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Check the fixture' }] } },
        ...(pending ? [{ type: 'event_msg', payload: { type: 'task_started' } }] : [
          { type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'Fixture checked.' }] } },
          { type: 'event_msg', payload: { type: 'task_complete' } },
        ]),
      ];
      await writeFile(file, records.map(row => JSON.stringify(row)).join('\n') + '\n');
      await utimes(file, at, at);
      return localAgentKey(agent, sessionId);
    },
  };
}

async function fakeCli(dir) {
  if (process.platform !== 'win32') {
    const file = join(dir, 'fake-cli');
    await writeFile(file, `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync('fake-argv', process.argv.slice(2).join('\\n'));
fs.writeFileSync('fake-stdin', fs.readFileSync(0));
fs.writeFileSync('fake-homes', [process.env.CLAUDE_CONFIG_DIR, process.env.CODEX_HOME].join('\\n'));
`);
    await chmod(file, 0o755);
    return file;
  }
  const source = join(dir, 'FakeCli.cs'), file = join(dir, 'FakeCli.exe');
  await writeFile(source, `using System;
using System.IO;
using System.Text;
class FakeCli {
  static void Main(string[] args) {
    Console.InputEncoding = Encoding.UTF8;
    File.WriteAllLines("fake-argv", args);
    File.WriteAllText("fake-stdin", Console.In.ReadToEnd());
    File.WriteAllLines("fake-homes", new[] { Environment.GetEnvironmentVariable("CLAUDE_CONFIG_DIR"), Environment.GetEnvironmentVariable("CODEX_HOME") });
  }
}`);
  const compiler = join(process.env.SystemRoot, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe');
  await exec(compiler, ['/nologo', '/target:exe', `/out:${file}`, source], { windowsHide: true });
  return file;
}

test('discovers recent CLI transcripts, skips Orca bindings and ambiguous IDs, and reuses the reader', async t => {
  const f = await fixture(t);
  const claude = await f.put('claude', 1);
  const codex = await f.put('codex', 2, { at: older });
  await f.put('codex', 3, { source: 'vscode' });
  await f.put('claude', 4);
  await f.put('claude', 4, { folder: 'another-project' });
  let clock = Date.now();
  let probes = 0;
  const agents = createLocalAgents({ limit: 1, cacheMs: 1000, claude: { root: f.claude }, codex: { root: f.codex } },
    { now: () => clock, running: async () => { probes++; return new Set(['claude', 'codex']); } });
  assert.deepEqual((await agents.list()).map(row => [row.handle, row.title, row.workspaceName, row.model, row.state, row.readOnly]),
    [[claude, 'Inspect the fixture second line', 'Sample workspace', 'Sonnet4.6', 'idle', true]]);
  assert.deepEqual((await agents.list(new Set([claude]))).map(row => row.handle), [codex]);
  assert.equal((await agents.read(claude)).text, '/ Inspect the fixture\n  second line\n> Fixture inspected.');
  assert.equal((await agents.read(codex)).text, '/ Check the fixture\n> Fixture checked.');
  assert.equal(probes, 1);
  const fresh = await f.put('codex', 5, { at: new Date(), pending: true });
  assert.equal((await agents.list())[0].handle, claude, 'discovery is cached');
  clock += 1001;
  assert.equal((await agents.list())[0].handle, fresh);
  assert.deepEqual(await agents.activity(fresh), { state: 'working', elapsedSeconds: null, readOnly: true });
  assert.deepEqual(await createLocalAgents({ enabled: false }).list(), []);
});

test('extracts exact Orca terminal and chat provider IDs without matching workspaces', async t => {
  const f = await fixture(t);
  const profileDb = join(f.dir, 'profile.db'), agentDb = join(f.dir, 'chats.db');
  const profile = new DatabaseSync(profileDb), chats = new DatabaseSync(agentDb);
  const key = 'tab:pane';
  const terminal = { tabId: 'tab', leafId: 'pane', connected: true, worktreeId: 'workspace', worktreePath: f.cwd,
    incarnationId: 'incarnation', agentIdentity: 'claude' };
  const record = { paneKey: key, worktreeId: 'workspace', agent: 'claude', origin: 'live',
    providerSession: { id: id(1), cwd: f.cwd, transcriptPath: join(f.claude, 'project', `${id(1)}.jsonl`) } };
  profile.exec('CREATE TABLE profile_state_documents (domain TEXT, payload TEXT)');
  profile.prepare('INSERT INTO profile_state_documents VALUES (?, ?)').run('workspaceSession', JSON.stringify({
    terminalPtyIncarnationsByPaneKey: { [key]: terminal.incarnationId }, sleepingAgentSessionsByPaneKey: { [key]: record },
  }));
  chats.exec('CREATE TABLE agent_session_records (session_id TEXT, adopted_native_id TEXT)');
  chats.prepare('INSERT INTO agent_session_records VALUES (?, ?)').run(id(3), id(2));
  profile.close();
  chats.close();
  const bindings = orcaProviderSessions([terminal, { ...terminal, incarnationId: 'other' }], [
    { orcaSessionId: id(3), agent: 'codex', hostId: 'local' }, { orcaSessionId: id(3), agent: 'codex', hostId: 'remote' },
  ], { profileDb, agentDb });
  assert.deepEqual(bindings.map(({ provider, id: sessionId }) => localAgentKey(provider, sessionId)),
    [localAgentKey('claude', id(1)), localAgentKey('codex', id(2))]);
});

test('bridge discovers, reads, refuses live replies, and sends exact resume argv with Orca absent', async t => {
  const f = await fixture(t);
  const command = await fakeCli(f.dir);
  const claude = await f.put('claude', 1);
  const codex = await f.put('codex', 2, { at: older });
  const recent = await f.put('codex', 3, { at: new Date(), pending: true });
  const savedOrca = process.env.ORCA_BIN;
  process.env.ORCA_BIN = join(f.dir, 'missing-orca');
  const { createBridge } = await import('../bridge/server.mjs');
  if (savedOrca === undefined) delete process.env.ORCA_BIN;
  else process.env.ORCA_BIN = savedOrca;
  let live = new Set();
  const server = createBridge({ token: 'fixture-only', mailConfig: false, beeperConfig: false,
    localAgentsConfig: { claude: { root: f.claude, command }, codex: { root: f.codex, command } },
    localAgentsOptions: { running: async () => {
      if (live === null) throw new Error('simulated process query failure');
      return live;
    } },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  async function call(route, body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/${route}`, {
      method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer fixture-only', 'content-type': 'application/json' },
      body: body && JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  }
  const args = async () => (await readFile(join(f.cwd, 'fake-argv'), 'utf8')).trim().split(/\r?\n/);
  const stdin = () => readFile(join(f.cwd, 'fake-stdin'), 'utf8');
  const caps = (await call('capabilities')).data;
  assert.equal(caps.orca, false);
  assert.deepEqual(caps.localAgents, { claude: { resume: true }, codex: { resume: true } });
  assert.ok(caps.modules.includes('coding'));
  assert.deepEqual((await call('workspaces')).data, []);
  assert.deepEqual((await call('providers')).data, []);
  assert.deepEqual((await call('threads')).data.map(row => [row.handle, row.readOnly]), [[recent, true], [claude, false], [codex, false]]);
  assert.equal((await call(`history?handle=${claude}`)).data.source, 'claude-transcript');
  assert.equal((await call(`thread?handle=${codex}`)).data.text, '/ Check the fixture\n> Fixture checked.');

  // Simulate a quiet interactive terminal opened after the list is displayed.
  live = new Set(['claude']);
  assert.match((await call('say', { handle: claude, text: 'Blocked' })).data.error, /read-only/);
  live = null;
  assert.match((await call('reply', { handle: codex, index: 0 })).data.error, /read-only/);
  live = new Set();
  assert.match((await call('say', { handle: recent, text: 'Still writing' })).data.error, /read-only/);
  assert.match((await call('choice', { handle: codex, menuId: 'fake', value: '1' })).data.error, /terminal choices/);
  await assert.rejects(args(), { code: 'ENOENT' });

  const reviewed = '--option \"quoted\" & $value\nsecond line';
  assert.equal((await call('say', { handle: claude, text: reviewed })).status, 200);
  assert.deepEqual(await args(), ['-p', '--resume', id(1)]);
  assert.equal(await stdin(), reviewed);
  let homes = (await readFile(join(f.cwd, 'fake-homes'), 'utf8')).split(/\r?\n/);
  assert.equal(homes[0], dirname(f.claude));

  assert.equal((await call('reply', { handle: codex, index: 0 })).status, 200);
  assert.deepEqual(await args(), ['exec', 'resume', '--skip-git-repo-check', id(2), '-']);
  assert.equal(await stdin(), 'Continue');
  homes = (await readFile(join(f.cwd, 'fake-homes'), 'utf8')).split(/\r?\n/);
  assert.equal(homes[1], dirname(f.codex));
});
