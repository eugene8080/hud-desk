import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { open, readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { readTranscript, readTranscriptImageFile, visibleClaudeMessage, visibleMessage } from './conversation.mjs';
import { executable } from './platform.mjs';
import { modelLabel } from './reader-text.mjs';

const run = promisify(execFile);
const PROVIDERS = ['claude', 'codex'];
const UUID = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
const FILES = { claude: new RegExp(`^(${UUID})\\.jsonl$`, 'i'), codex: new RegExp(`^rollout-.+-(${UUID})\\.jsonl$`, 'i') };
const SAMPLE_BYTES = 256 * 1024;
const QUIET_MS = 30_000;
const PROCESS_CACHE_MS = 5_000;
const WORKING_CODEX = new Set(['task_started', 'turn_started', 'user_message']);
const IDLE_CODEX = new Set(['task_complete', 'turn_complete', 'turn_aborted']);
const WINDOWS_EXEC = /\.exe$/i;

export const isLocalAgent = handle => typeof handle === 'string' && handle.startsWith('local:');
export const localAgentKey = (agent, id) => `local:${agent}:${id.toLowerCase()}`;

function bounded(value, fallback, min, max) {
  return Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function readLocalAgentsConfig(input, env = process.env, home = homedir()) {
  if (input === false || input?.enabled === false) return { providers: [], limit: 0, cacheMs: 10_000 };
  const homes = {
    claude: env.CLAUDE_CONFIG_DIR || join(home, '.claude'),
    codex: env.CODEX_HOME || join(home, '.codex'),
  };
  const providers = PROVIDERS.filter(agent => input?.[agent] !== false && input?.[agent]?.enabled !== false).map(agent => {
    const settings = input?.[agent];
    const directory = agent === 'claude' ? 'projects' : 'sessions';
    const root = resolve(typeof settings?.root === 'string' && settings.root ? settings.root : join(homes[agent], directory));
    const command = settings?.command;
    return { agent, root, directory, command };
  });
  return { providers, limit: bounded(input?.limit, 30, 1, 100), cacheMs: bounded(input?.cacheMs, 10_000, 1_000, 60_000) };
}

function cli(provider) {
  const { agent, command } = provider;
  if (command !== undefined) {
    return typeof command === 'string' && isAbsolute(command) &&
      (process.platform !== 'win32' || WINDOWS_EXEC.test(command)) && existsSync(command) ? command : null;
  }
  if (process.platform !== 'win32') {
    return executable(agent) || [join(homedir(), '.local', 'bin', agent), join('/opt/homebrew/bin', agent),
      join('/usr/local/bin', agent)].find(existsSync) || null;
  }
  const native = executable(`${agent}.exe`);
  if (native) return native;
  // Windows npm .cmd shims need a shell. Locate their packaged executables
  // instead, and use the native CLI directly so no command text is evaluated.
  const shim = executable(`${agent}.cmd`);
  if (!shim) return null;
  const modules = join(dirname(shim), 'node_modules');
  if (agent === 'claude') {
    const file = join(modules, '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
    return existsSync(file) ? file : null;
  }
  const cpu = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  const vendor = ['vendor', `${cpu}-pc-windows-msvc`, 'bin', 'codex.exe'];
  return [join(modules, '@openai', 'codex', 'node_modules'),
    modules].map(base => join(base, '@openai', `codex-win32-${process.arch}`, ...vendor))
    .concat(join(modules, '@openai', 'codex', ...vendor)).find(existsSync) || null;
}

// A fresh idle terminal has no recent transcript writes. Check the process
// table too, including native app servers and npm's Node CLI wrapper.
export async function runningLocalAgents() {
  const options = { timeout: 3_500, windowsHide: true, maxBuffer: 2 * 1024 * 1024 };
  const windows = process.platform === 'win32';
  let processes;
  if (windows) {
    const script = "Get-CimInstance Win32_Process -Filter \"Name LIKE 'claude%' OR Name LIKE 'codex%' OR Name = 'node.exe'\" -ErrorAction Stop | Select-Object Name,CommandLine | ConvertTo-Json -Compress";
    const shell = join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const { stdout } = await run(shell, ['-NoProfile', '-NonInteractive', '-Command', script], options);
    // Windows PowerShell 5.1 emits a single object for a one-row pipeline.
    const result = JSON.parse(stdout.trim() || '[]');
    processes = (Array.isArray(result) ? result : [result]).map(row => [row.Name || '', row.CommandLine || '']);
  } else {
    const { stdout } = await run('/bin/ps', ['-axww', '-o', 'ucomm=', '-o', 'args='], options);
    processes = stdout.split('\n').map(line => /^\s*(\S+)\s*(.*)$/.exec(line)?.slice(1) || ['', '']);
  }
  const active = new Set();
  for (const [name, command] of processes) {
    const processName = basename(name).toLowerCase().replace(/\.exe$/, '');
    for (const agent of PROVIDERS) {
      const wrapper = agent === 'codex' ? /[/\\]@openai[/\\]codex[/\\]bin[/\\]codex\.js\b/i
        : /[/\\]@anthropic-ai[/\\]claude-code[/\\](?:bin[/\\])?cli\.js\b/i;
      if (processName === agent || processName.startsWith(`${agent}-`) ||
          (processName === 'node' && (!command || wrapper.test(command)))) active.add(agent);
    }
  }
  return active;
}

async function filesUnder(at, agent, files, depth = 0) {
  const entries = await readdir(at, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const file = join(at, entry.name);
    const id = FILES[agent].exec(entry.name)?.[1];
    if (entry.isDirectory() && depth < (agent === 'claude' ? 1 : 8)) await filesUnder(file, agent, files, depth + 1);
    else if (id && entry.isFile() && (agent !== 'claude' || depth === 1)) files.push({ id, file });
  }
}

async function records(fd, offset, length, partialHead = false, partialTail = false) {
  const bytes = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const { bytesRead } = await fd.read(bytes, read, length - read, offset + read);
    if (!bytesRead) break;
    read += bytesRead;
  }
  const lines = bytes.subarray(0, read).toString('utf8').split('\n');
  if (partialHead) lines.shift();
  if (partialTail) lines.pop();
  return lines.flatMap(line => {
    try { const record = JSON.parse(line); return record && typeof record === 'object' ? [record] : []; }
    catch { return []; }
  });
}

async function summarize({ agent, id, file, size }) {
  const fd = await open(file, 'r');
  try {
    const head = await records(fd, 0, Math.min(SAMPLE_BYTES, size), false, size > SAMPLE_BYTES);
    const tail = size > SAMPLE_BYTES ? await records(fd, size - SAMPLE_BYTES, SAMPLE_BYTES, true, true) : head;
    const claude = agent === 'claude';
    const first = claude ? head.find(r => ['user', 'assistant'].includes(r.type) && !r.isSidechain) : head[0];
    const meta = claude ? first : first?.type === 'session_meta' ? first.payload : null;
    const nativeId = claude ? meta?.sessionId : meta?.id || meta?.session_id;
    // Exclude known IDE, SDK, sidechain and other non-CLI transcripts.
    if (nativeId !== id || typeof meta.cwd !== 'string' || !isAbsolute(meta.cwd) ||
        (claude ? meta.entrypoint && !['cli', 'print'].includes(meta.entrypoint) :
          meta.source && !['cli', 'exec'].includes(meta.source))) return null;
    const visible = claude ? visibleClaudeMessage : visibleMessage;
    const firstUser = head.map(visible).find(message => message?.role === 'user' && message.text);
    const summary = claude ? [...tail].reverse().find(r => r.type === 'summary' && typeof r.summary === 'string')?.summary : null;
    let model = modelLabel(meta.model), unfinished = false;
    for (const record of tail) {
      if (claude && !record.isSidechain) {
        if (record.type === 'assistant') {
          model = modelLabel(record.message?.model) || model;
          const reason = record.message?.stop_reason;
          unfinished = reason ? !['end_turn', 'stop_sequence', 'max_tokens', 'refusal'].includes(reason)
            : !visibleClaudeMessage(record);
        } else if (record.type === 'user' && !record.isMeta && !record.isCompactSummary) unfinished = true;
      } else if (!claude && record.type === 'turn_context') {
        model = modelLabel(record.payload?.model, record.payload?.effort) || model;
        unfinished = true;
      } else if (!claude && record.type === 'event_msg') {
        if (WORKING_CODEX.has(record.payload?.type)) unfinished = true;
        if (IDLE_CODEX.has(record.payload?.type)) unfinished = false;
      } else if (!claude && record.type === 'response_item' && record.payload?.phase === 'final_answer') {
        unfinished = false;
      }
    }
    const title = (firstUser?.text || summary?.trim() || (claude ? 'Claude Code session' : 'Codex session')).replace(/\s+/g, ' ').slice(0, 160);
    return { title, cwd: meta.cwd, model: model || undefined, unfinished };
  } finally { await fd.close(); }
}

function sameVersion(a, b) {
  return a.mtimeMs === b.mtimeMs && a.size === b.size && a.ino === b.ino && a.dev === b.dev;
}

async function launch(file, args, { cwd, env }, text) {
  // No shell, no prompt in argv or logs, and no CLI stdout/stderr in API errors.
  // Hold the HTTP request and the writer reservation until the CLI actually exits.
  const child = spawn(file, args, { cwd, env, windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
  let inputError;
  const finished = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => code === 0 && !inputError ? resolve() : reject(new Error('CLI did not complete')));
    child.stdin.on('error', error => { inputError = error; });
  });
  child.stdin.end(text, 'utf8');
  const timer = setTimeout(() => child.kill('SIGKILL'), 10 * 60_000);
  try { await finished; }
  finally { clearTimeout(timer); }
}

export function createLocalAgents(input, { running = runningLocalAgents, now = Date.now } = {}) {
  const settings = readLocalAgentsConfig(input);
  const inFlight = new Set();
  let inventory = [], inventoryAt = -Infinity, scanPending;
  let processState = null, processAt = -Infinity, processPending;
  const loadProcesses = () => Promise.resolve().then(running).catch(() => null);
  function processes() {
    if (now() - processAt < PROCESS_CACHE_MS) return processState;
    return processPending ??= loadProcesses().then(result => {
      processState = result;
      processAt = now();
      return result;
    }).finally(() => { processPending = null; });
  }

  async function scan() {
    const candidates = [];
    for (const provider of settings.providers) {
      const root = await realpath(provider.root).catch(() => null);
      if (!root) continue;
      const files = [];
      await filesUnder(root, provider.agent, files);
      for (let start = 0; start < files.length; start += 32) {
        await Promise.all(files.slice(start, start + 32).map(async file => {
          const info = await stat(file.file).catch(() => null);
          if (!info?.isFile() || !info.size) return;
          const { agent } = provider;
          candidates.push({ ...file, ...provider, root, info, agent, size: info.size, handle: localAgentKey(agent, file.id) });
        }));
      }
    }
    inventory = candidates.sort((a, b) => b.info.mtimeMs - a.info.mtimeMs);
    inventoryAt = now();
    return inventory;
  }

  function candidates() {
    if (now() - inventoryAt < settings.cacheMs) return inventory;
    return scanPending ??= scan().finally(() => { scanPending = null; });
  }

  const metadata = new Map();
  async function describe(candidate) {
    const cached = metadata.get(candidate.file);
    if (cached && sameVersion(cached.info, candidate.info)) return cached.session;
    const session = await summarize(candidate).then(meta => meta && { ...candidate, ...meta }, () => null);
    metadata.delete(candidate.file);
    metadata.set(candidate.file, { info: candidate.info, session });
    if (metadata.size > 512) metadata.delete(metadata.keys().next().value);
    return session;
  }

  function status(session, active, ownSend = false) {
    const { agent, directory, root, info, unfinished } = session;
    const recentWrite = now() - info.mtimeMs < QUIET_MS;
    const working = (inFlight.has(agent) && !ownSend) || (recentWrite && unfinished);
    const readOnly = (inFlight.has(agent) && !ownSend) || recentWrite || active === null ||
      active.has(agent) || basename(root) !== directory || !cli(session) || !existsSync(session.cwd);
    return { working, readOnly };
  }

  async function list(excluded = new Set()) {
    if (!settings.limit) return [];
    const [files, active] = await Promise.all([candidates(), processes()]);
    const counts = new Map();
    for (const { handle } of files) counts.set(handle, (counts.get(handle) || 0) + 1);
    const rows = [];
    const sampled = { claude: 0, codex: 0 };
    // Limit metadata reads even if the newest files are huge, corrupt or non-CLI.
    for (const candidate of files) {
      if (rows.length === settings.limit) break;
      if (excluded.has(candidate.handle) || counts.get(candidate.handle) !== 1 ||
          sampled[candidate.agent] >= settings.limit * 4) continue;
      sampled[candidate.agent]++;
      const session = await describe(candidate);
      if (!session) continue;
      const { handle, title, agent, cwd, model, info } = session;
      const { working, readOnly } = status(session, active);
      const workspaceName = cwd.replace(/[/\\]+$/, '').split(/[/\\]/).at(-1) || 'Workspace';
      const workspaceId = 'local:' + createHash('sha256').update(process.platform === 'win32' ? cwd.toLowerCase().replaceAll('\\', '/') : cwd).digest('hex').slice(0, 20);
      rows.push({ handle, title, agent, workspaceId, workspaceName, workspaceLabel: workspaceName, model,
        lastOutputAt: info.mtimeMs, state: working ? 'busy' : 'idle', readOnly });
    }
    return rows;
  }

  async function selected(handle) {
    const matches = (await candidates()).filter(candidate => candidate.handle === handle);
    const candidate = matches[0];
    if (matches.length !== 1 || await realpath(candidate.file).catch(() => null) !== candidate.file) {
      throw new Error('Local session is unavailable. Refresh the session list.');
    }
    const info = await stat(candidate.file);
    const session = info.isFile() && await describe({ ...candidate, info, size: info.size });
    if (!session) throw new Error('Local session identity could not be verified.');
    return session;
  }

  async function read(handle) {
    const session = await selected(handle);
    const history = await readTranscript(session.file, { ...session, provider: session.agent });
    return { ...history, model: history.model || session.model };
  }

  async function send(handle, text, excluded) {
    const session = await selected(handle);
    const { agent, cwd, id, info, file, root } = session;
    const readOnlyError = () => new Error('This local session is read-only. Close running agent terminals and try again after transcript writes stop.');
    if (inFlight.has(agent)) throw readOnlyError();
    inFlight.add(agent);
    try {
      // Re-read Orca ownership and the OS process table for every send. Reserve
      // before checking so another request in this bridge cannot race this one.
      if ((await excluded()).has(handle)) throw readOnlyError();
      const active = await loadProcesses();
      if (status(session, active, true).readOnly || await realpath(file).catch(() => null) !== file ||
          !sameVersion(info, await stat(file)) || !await stat(cwd).then(s => s.isDirectory(), () => false)) throw readOnlyError();
      const command = cli(session);
      if (!command) throw readOnlyError();
      const args = agent === 'claude' ? ['-p', '--resume', id] : ['exec', 'resume', '--skip-git-repo-check', id, '-'];
      const homeVariable = agent === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME';
      try { await launch(command, args, { cwd, env: { ...process.env, [homeVariable]: dirname(root) } }, text); }
      catch { throw new Error('Resume did not complete. Check the saved conversation before sending again.'); }
    } finally {
      inFlight.delete(agent);
      processAt = inventoryAt = -Infinity;
    }
  }

  return {
    list, read, send,
    capabilities: () => Object.fromEntries(settings.providers.map(provider => [provider.agent, { resume: !!cli(provider) }])),
    async activity(handle) {
      const session = await selected(handle);
      const { working, readOnly } = status(session, await processes());
      return { state: working ? 'working' : 'waiting', elapsedSeconds: null, readOnly };
    },
    async image(handle, index) {
      const session = await selected(handle);
      return readTranscriptImageFile(session.file, { ...session, provider: session.agent }, index);
    },
  };
}
