import type { Thread } from './api';

// Read marks on Coding rows (Eugene, 2026-11-27): '/' unread and '-' read, the same marks as the
// Email and Chat lists. A working session keeps the moving dot; an unknown state keeps '?'.
//
// Where "unread" comes from:
// - Orca rows (terminals and chats) carry Orca's own flag, the bell in Orca's sidebar, plus the
//   time of the row's latest activity (bridge/activity.mjs orcaReadState).
// - Other rows (plain Claude Code and Codex CLI, Hermes) have no read state anywhere, so a row is
//   unread when its latest output is newer than the last time it was opened on the glasses.
// Opening a session here marks it read here only. Orca's CLI can clear unread for a whole worktree
// (`orca worktree set --read`), not for one session, so Orca's own bell stays until the session is
// viewed in Orca.
//
// Every stamp is a bridge (PC clock) value, never the phone's clock, so clock skew between the
// phone and the PC cannot make a row flip.

export type SeenMap = Record<string, number>;
export type ReadFields = Pick<Thread, 'handle' | 'state' | 'unread' | 'activityAt' | 'lastOutputAt'>;

// Upper bound on stored entries; the oldest stamps go first. 300 covers many more sessions than
// the bridge lists (30 CLI sessions plus Orca's live panes).
export const SEEN_LIMIT = 300;

// The PC-clock time of the row's latest activity: Orca's activity time when reported, otherwise
// the terminal's or transcript's last write.
export const activityStamp = (t: ReadFields): number => t.activityAt ?? t.lastOutputAt ?? 0;

export function isUnread(t: ReadFields, seen: SeenMap): boolean {
  // Only a finished session waiting for you can be unread; a working one shows the dot instead.
  if (t.state !== 'idle') return false;
  const opened = seen[t.handle];
  // Opened on the glasses since its latest activity: read, whatever Orca says.
  if (opened !== undefined && opened >= activityStamp(t)) return false;
  if (typeof t.unread === 'boolean') return t.unread;
  // No Orca flag: newer output than the stamp recorded when it was last opened (or first listed).
  // A row with no stamp yet is read; withBaseline gives it one on the same list load.
  return opened !== undefined;
}

// Gutter mark for one Coding row.
export function readMarker(t: ReadFields, seen: SeenMap): string {
  if (t.state === 'busy') return '';
  if (t.state !== 'idle') return '?';
  return isUnread(t, seen) ? '/' : '-';
}

// Rows without an Orca flag that appear for the first time start as read, so a first install (or a
// new PC) does not mark every old session unread. Orca rows need no baseline: Orca decides until
// the row is opened here. Returns the same object when nothing changed, so callers can skip a save.
export function withBaseline(threads: ReadFields[], seen: SeenMap): SeenMap {
  let next = seen;
  for (const t of threads) {
    if (next[t.handle] !== undefined || typeof t.unread === 'boolean') continue;
    if (next === seen) next = { ...seen };
    next[t.handle] = activityStamp(t);
  }
  return next === seen ? seen : prune(next);
}

// Record that the row was seen with its current activity; later activity makes it unread again.
export function markSeen(t: ReadFields, seen: SeenMap): SeenMap {
  const stamp = activityStamp(t);
  if (seen[t.handle] !== undefined && seen[t.handle] >= stamp) return seen;
  return prune({ ...seen, [t.handle]: stamp });
}

function prune(seen: SeenMap): SeenMap {
  const entries = Object.entries(seen);
  if (entries.length <= SEEN_LIMIT) return seen;
  return Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, SEEN_LIMIT));
}

// Parse the stored map defensively: anything that is not a handle -> finite number is dropped,
// so a damaged or older value cannot break the list.
export function parseSeen(raw: string | null): SeenMap {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const seen: SeenMap = {};
    for (const [handle, stamp] of Object.entries(value as Record<string, unknown>)) {
      if (typeof stamp === 'number' && Number.isFinite(stamp)) seen[handle] = stamp;
    }
    return prune(seen);
  } catch {
    return {};
  }
}
