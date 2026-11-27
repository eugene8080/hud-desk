# Coding with Claude Code and Codex CLI

Start a session in Claude Code or Codex CLI on the bridge computer. Open Coding
in HUD Desk to find the saved conversation. Orca is optional. When Orca is
available, its rows keep their existing behavior. The bridge skips a plain row
when it can match the exact provider session ID to an Orca row.

## Sessions and limits

- Claude Code uses `~/.claude/projects/*/*.jsonl`. Codex CLI uses
  `~/.codex/sessions/**/rollout-*.jsonl`. The bridge honors `CLAUDE_CONFIG_DIR`
  and `CODEX_HOME` when set. Known IDE, SDK and subagent records are excluded.
- Rows show `[workspace/Agent]` using the session's recorded working directory.
  The title uses the first visible user message or a saved summary when available.
  The reader shows the latest model it finds, with `/ ` for user turns and
  `> ` for agent turns. It uses the same saved transcript reader as Orca.
- The bridge lists up to 30 sessions across both providers by default, newest
  first by file modification time. It caches filenames and modification times
  for 10 seconds. Discovery samples up to 256 KiB at each end of a candidate
  transcript and checks at most four times the row limit per provider per refresh. The reader
  has a 64 MiB initial transcript limit and keeps up to 1 million characters of
  visible history, with room for a single longer message.
- The activity indicator estimates work from recent writes and the latest turn
  records. It can show an open terminal as idle.
- Create new CLI sessions on the computer. HUD Desk's **New Session** action
  remains available with Orca for Codex. Terminal choice menus require Orca.

## Reviewed replies

Use the existing reply review and confirmation. HUD Desk sends the reviewed
text on stdin to the official CLI, in the session's saved working directory.
It waits for that one turn to exit. CLI permissions and configuration still
apply. The bridge sets no approval or sandbox overrides. Claude Code's help
notes that print mode skips the workspace trust dialog. Use it in workspaces
you trust.

The installed `--help` output on 2026-11-27 confirmed these commands:

- Claude Code 2.1.322, `claude -p --resume <session-id>`. The help identifies
  `-p` as print-and-exit mode for pipes and `--resume` as accepting a session ID.
- Codex CLI 0.172.0, `codex exec resume --skip-git-repo-check <session-id> -`.
  `codex exec resume --help` lists the session ID and prompt arguments,
  `-` for stdin, and `--skip-git-repo-check` for work outside Git.

**Close the agent's terminal before replying from HUD Desk.** The bridge marks
a row read-only if its transcript was written in the last 30 seconds, the
matching CLI is running, the process check fails, or the CLI or workspace is
unavailable. Because a quiet process may have no session ID in its command
line, a running Claude Code or Codex process can block replies to other sessions
of the same provider. The bridge checks again at send time, checks for Orca
ownership and file changes, and allows one reply per provider at a time.
An external terminal can still open after the check, so leave it closed until
the reply finishes. If sending times out or the CLI exits with an error,
reopen the conversation and check for the prompt before trying again.

On Windows, the bridge supports executables on PATH and the standard npm
packages behind the Windows shims. On other platforms it checks PATH and common
install locations. Custom CLI paths must point to a directly executable file
(`.exe` on Windows). The CLI inherits the bridge's environment and standard
configuration for the selected provider home.

## Configuration

Override `localAgents` in `bridge/config.local.json` on the bridge computer.
Both providers are enabled by default.

```json
{
  "localAgents": {
    "enabled": true,
    "limit": 30,
    "cacheMs": 10000,
    "claude": { "enabled": true },
    "codex": { "enabled": true }
  }
}
```

- Use `enabled: false` on the block to disable all plain sessions, or on a
  provider to disable that provider. `limit` accepts 1–100 and `cacheMs`
  accepts 1000–60000 milliseconds.
- Use `root` inside a provider to point to its transcript directory. The
  directory must be named `projects` for Claude or `sessions` for Codex to
  enable replies. The CLI uses the parent directory as its configuration home.
  Use `command` inside a provider to set an absolute executable path.
- Authenticated `GET /api/capabilities` reports `orca` and a `localAgents`
  object. A key indicates that provider is enabled. Its `resume` flag reports
  whether the CLI executable was found. The selected row's `readOnly` flag
  reports whether it is currently eligible to reply.
