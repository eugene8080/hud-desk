// Orca chat sessions (Eugene, 2026-11-27: the G2 Coding list did not show this Orca chat or chats in
// other worktrees). Orca 1.4 runs an agent either as a terminal pane or as a chat; `orca terminal
// list` returns only the panes, so chats are listed from `orca agent list` and read with
// `orca agent read <orcaSessionId>`. Orca's CLI has no command that sends into a chat, so a chat is
// read-only on the glasses: the bridge refuses any send to it.
import { workspaceLabels } from './workspace-label.mjs';
import { orcaReadState } from './activity.mjs';

export const CHAT_PREFIX = 'chat:';
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isChat = handle => typeof handle === 'string' && handle.startsWith(CHAT_PREFIX);

// The Orca session ID inside a chat handle; anything else is refused before it reaches the CLI.
export function chatSessionId(handle) {
  const id = isChat(handle) ? handle.slice(CHAT_PREFIX.length) : '';
  if (!SESSION_ID.test(id)) throw new Error('Invalid Orca chat');
  return id;
}

// Orca agent states -> the reader's activity states.
export function chatActivity(state) {
  if (state === 'working') return 'working';
  if (state === 'blocked') return 'attention';
  if (state === 'waiting' || state === 'done') return 'waiting';
  return 'unknown';
}

// Thread rows for the Coding list, in the same shape as terminal rows plus readOnly.
export function chatThreads(agents, worktrees) {
  return (Array.isArray(agents) ? agents : [])
    .filter(a => a?.kind === 'chat' && SESSION_ID.test(a.orcaSessionId ?? '') && typeof a.agent === 'string')
    .map(a => {
      const workspace = (worktrees ?? []).find(w => w.worktreeId === a.worktreeId);
      const labels = workspace ? workspaceLabels(workspace) : { name: a.repo || 'Orca', label: a.repo || 'Orca' };
      const activity = chatActivity(a.state);
      // `orca agent list` has no read state; the same chat's row in `orca worktree ps` does.
      const psAgent = workspace?.agents?.find(x => x?.orcaSessionId === a.orcaSessionId);
      return {
        handle: CHAT_PREFIX + a.orcaSessionId,
        title: typeof a.title === 'string' && a.title.trim() ? a.title.trim() : 'Orca chat',
        agent: a.agent,
        workspaceId: a.worktreeId,
        workspaceName: labels.name,
        workspaceLabel: labels.label,
        state: activity === 'working' ? 'busy' : activity === 'waiting' ? 'idle' : 'unknown',
        lastOutputAt: Number(a.updatedAt) || 0,
        readOnly: true,
        ...orcaReadState(psAgent),
      };
    });
}

// The conversation as reader text: your messages start '/ ', the agent's '> ', continuation lines
// are indented two spaces, tool entries are left out, one blank line between messages.
export function chatText(entries) {
  return (Array.isArray(entries) ? entries : [])
    .filter(e => e?.kind === 'message' && (e.role === 'user' || e.role === 'assistant') && typeof e.text === 'string' && e.text.trim())
    .map(e => `${e.role === 'user' ? '/' : '>'} ${e.text.trim().replace(/\r\n?|\n/g, '\n  ')}`)
    .join('\n\n');
}
