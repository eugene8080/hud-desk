import test from 'node:test';
import assert from 'node:assert/strict';
import { chatActivity, chatSessionId, chatText, chatThreads, isChat } from '../bridge/orca-chats.mjs';

const id = '0f1e2d3c-4b5a-4968-8776-655443322110';

test('Orca chats become read-only Coding rows; terminal agents and bad IDs are left out', () => {
  const agents = [
    { kind: 'chat', orcaSessionId: id, agent: 'claude', state: 'working', worktreeId: 'w1', repo: 'fixture-repo', title: ' Fixture chat ', updatedAt: 20 },
    { kind: 'chat', orcaSessionId: 'not-a-uuid', agent: 'cursor', state: 'done', worktreeId: 'w1' },
    { kind: 'terminal', orcaSessionId: id, agent: 'codex', state: 'done', worktreeId: 'w1' },
    { kind: 'chat', orcaSessionId: id.replace('0f', 'aa'), agent: 'cursor', state: 'done', worktreeId: 'missing', repo: 'other-repo', title: null, updatedAt: 5 },
  ];
  const worktrees = [{ worktreeId: 'w1', path: 'D:/dev/fixture-repo', repo: 'fixture-repo', isMainWorktree: true }];
  const rows = chatThreads(agents, worktrees);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { handle: `chat:${id}`, title: 'Fixture chat', agent: 'claude', workspaceId: 'w1',
    workspaceName: 'fixture-repo', workspaceLabel: 'fixture-repo', state: 'busy', lastOutputAt: 20, readOnly: true });
  assert.deepEqual([rows[1].title, rows[1].state, rows[1].workspaceName], ['Orca chat', 'idle', 'other-repo']);
  assert.deepEqual(chatThreads(undefined, []), []);
});

test('chat handles are validated before reaching the Orca CLI', () => {
  assert.equal(isChat(`chat:${id}`), true);
  assert.equal(isChat('term_123'), false);
  assert.equal(chatSessionId(`chat:${id}`), id);
  for (const bad of ['chat:', 'chat:--limit', `chat:${id};rm`, 'term_1', 42]) assert.throws(() => chatSessionId(bad), /Invalid Orca chat/);
  assert.deepEqual(['working', 'blocked', 'waiting', 'done', 'other'].map(chatActivity), ['working', 'attention', 'waiting', 'waiting', 'unknown']);
});

test('chat text keeps user and assistant messages with role prefixes and drops tool entries', () => {
  const text = chatText([
    { kind: 'message', role: 'user', text: 'First line\nSecond line' },
    { kind: 'tool', name: 'Bash', state: 'done' },
    { kind: 'message', role: 'assistant', text: 'Reply.\r\nMore.' },
    { kind: 'message', role: 'system', text: 'hidden' },
    { kind: 'message', role: 'assistant', text: '   ' },
  ]);
  assert.equal(text, '/ First line\n  Second line\n\n> Reply.\n  More.');
  assert.equal(chatText(null), '');
});
