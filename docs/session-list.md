# Session list

## Read marks (2026-11-27, beta 1.0.95)

Eugene: Orca shows a bell for unread sessions and a dot for read ones; Coding should use `/` for
unread and `-` for read, like Email and Chat. Marks now: `/` unread, `-` read, the moving dot while
working, `?` unknown. Logic: `app/src/coding-read.ts`.

- Orca rows (terminals and Orca chats) carry Orca's own read state from `orca worktree ps`
  (agent `activity.unread`, the sidebar bell, and `activity.sortAt`); `bridge/activity.mjs`
  `orcaReadState` passes them as `unread` and `activityAt`. A chat's row in `orca agent list` has
  no read state, so the bridge takes it from the same session ID in `orca worktree ps`.
- Other rows (plain Claude Code and Codex CLI, Hermes) have no read state anywhere. A row is
  unread when its last write (`lastOutputAt`) is newer than the stamp recorded when it was last
  opened on the glasses. Rows seen for the first time start read, so a first install does not mark
  every old session unread.
- Opening a session records its activity stamp (`coding-seen` in the Even app's storage, at most
  300 entries). Going back to the list records the stamp again, so output produced while it was
  on screen counts as read. All stamps are PC-clock values, never the phone's clock.
- Opening a session on the glasses does not clear Orca's bell. Orca 1.4.277's CLI can clear unread
  for a whole worktree (`orca worktree set --read`), not for one session.
- Limits: a plain CLI session you use at the PC also turns `/` on the glasses, because the bridge
  cannot see that you read it there. Leaving a reader for another module and returning to Coding
  later records the stamp at that later time.
- Live check 2026-11-27 (counts only, new bridge code run read-only against Orca): 22 Orca and
  Hermes rows; idle with the bell 2, idle without 6, working 1, unknown 1, Hermes without a flag 12.
  The bell part needs a bridge restart; until then Orca rows use the new-output rule.

## Module selector (2026-11-26, unreleased)

Row 0 selects the module. The module name is at the left, `Orca-glass <version>`
is centered using measured native text widths, and the active module's count
is at the right. The aligned page uses six text containers. Coding's two
filter rows and seven session slots start at row 1.

Click row 0 to cycle through modules offered by the bridge. The name updates
immediately and the list loads after 600 ms without another click. Bridges
with no `modules` field offer Coding. The last module is stored on the phone.
Each module retains its page, cursor and filters when switching. Swipe up from
row 1 to row 0, then swipe up again to reach the previous page if there is one.
Double-click from the list closes the app. Coding's firmware menu offers
Refresh sessions, New Session and Usage.

On 2026-11-26, 168 tests and the app build passed. The isolated Even simulator
automation confirmed the six-container Coding home, cursor at row 0, and
Coding-only behavior with a legacy capabilities response. The simulator's
glasses screenshot endpoint returned solid green, so the layout was checked
from container positions and content in the automation log. Physical G2
verification is pending.

## Earlier changes

Updated: 2026-11-03

Unreleased1.0.17: first menu row starts y28 directly after28px header. Cursor,
right column and marker strip origin move together. Agent list excludes ordinary
shells with no detected agentIdentity or exact-pane agentType, including observed
cmd.exe pane, without a provider allowlist. Live metadata yields four agents
(two Codex, Claude, Pi) and excludes the shell. Native simulator gap verified;
72 tests/build pass. No beta upload while spinner mode diagnosis is pending.
User confirms Filter placement/contextual removal; alignment not yet checked.

2026-11-03 hardware confirmation: User confirms menu text remains stable during up/down swipes on physical G2. Startup/load and screen rejection recovery also confirmed. Spinner/alignment/filter placement are separate checks.

Version1.0.16: Filter by Agent is the first main-list row; its right column shows
All sessions or selected provider. Refresh is second, followed by New Session,
Usage and terminals. Filter is removed from contextual menu; OS controls remain.
First page has up to4 terminals, later pages up to3 so neither page exceeds9 rows.
Activity polls every3s independently of navigation. Marker strips render static
icons and animated Braille above the native title gutter; title text stays native
and stationary. Polling/animation stop on page change or system exit. Persistent
phone label distinguishes Aligned native text from Compact compatibility mode.
The user confirmed1.0.15 opens on both phone and G2;1.0.16 rendering pending.

Version1.0.15 recovery: user still gets rejected-screen status after force-stop.
Initial startup now uses the known small two-text shape, then attempts aligned
menu through rebuild. If rejected, it rebuilds a three-text compact menu with a
separate blank input capture. This keeps text stationary while cursor updates
the compact body; labels are inline and marker images are disabled in fallback.
Successful fallback is retained for subsequent menus during that app run. Phone
Status identifies fallback activation and phone heading shows installed version.
The cursor container is24px wide (previously16), removing a possible firmware
size constraint; exact original hardware rejection cause remains unconfirmed.
68 tests/build pass. Isolated simulator explicitly rejected aligned rebuilds;
fallback native rendering, selection and entry into reader passed. Hardware
acceptance is pending. Do not describe fallback as satisfying right alignment
or animated list Braille, which remain conditional on aligned-layout acceptance.

Version1.0.14 compatibility repair follows G2 startup rejection in1.0.13.
The menu now has six native text containers plus two narrow image strips,
IDs1..8 and layers0..7. Marker text is merged into title text, above the image
strips; capture and selection cursor stay separate. The prior page declared
nine containers and included layer9. Firmware rejection cause is not proven;
this removes both count/range compatibility risks.67 tests/build pass and native
simulator menu/reader navigation works. G2 validation remains pending.

The one-shot startup call is marked consumed before awaiting its result.
If rejected, the error/reconnect path uses rebuild rather than repeating create.

2026-11-03 version1.0.13 supersedes the moving-block1.0.12 trial. A dedicated
blank native text container captures gestures. Static native title/marker/right
columns never receive cursor updates; a separate cursor column alone changes.
Header is Orca-glass VERSION with a right-hand connected count. Refresh has *
and the current filter on its right; session providers occupy a right column,
idle entries use / and active entries have animated Braille. Native text has
no alignment flag, so right columns use measured proportional-width space
padding; actual G2 alignment requires checking. Only Braille dots use images:
two20px-wide strips, serial guarded updates every500ms, no image labels/menus.
All row/title/agent text remains native. The native simulator title/right crop
is pixel-identical after a swipe. User verified1.0.12 speed;1.0.13 hardware speed,
stability and alignment remain pending.

Version1.0.12 is an authorized compact native-text trial. The sessions page uses
one multiline native text container with a `>` selection cursor, following the
pattern described in Nick Ustinov's public UI notes. Four terminals/page and
Previous/Next actions yield at most9 compact lines. Swipe moves selection using
one textContainerUpgrade; rapid moves coalesce to the latest index. Click and
Filter navigation wait for pending writes to finish. No list images or animation
timers. The filter page still uses the native list; reader/voice unchanged.
Titles truncate inside48 bytes while preserving the provider/handle suffix.
63 tests/build pass, including one update per move and rapid-swipe coalescing.
Official simulator compact layout/cursor/session/filter checks passed. G2 speed
check pending; no claim that Books' exact implementation has been reproduced.

The following1.0.11 details are historical and superseded for the session menu.

Version1.0.11 restores native text/list controls after the user reported that
1.0.10 custom image rendering was too slow. No session-list images or animation
/polling timers remain. Firmware owns selection and scrolling. Up to15 terminals
per page; Previous/Next actions keep all terminals reachable.

Header: `Orca-glass VERSION · COUNT connected terminals`, using manifest version.
Refresh: `* Refresh sessions [All sessions]` or selected provider. Session rows
contain status, title, six-character handle suffix and `[Agent]`. Native text has
no independent right-aligned columns; labels are inline. Titles truncate within
63 bytes while preserving handle/provider suffix.

Status: `/` idle, `*` working, `?` unknown, based on exact Orca worktree/pane
activity, updated by Refresh. The image-based Braille list animation was removed;
the separate reader footer spinner is unchanged.

62 tests/build pass, including no list images/timers, native capture/selection,
pagination and long Unicode title suffix retention. Native simulator shows list
and opens selected session. G2 speed confirmation pending. English-only settings
and root /images ignore remain.

## Workspace picker: no title, Recent workspaces first (2026-11-05, beta 1.0.35)

The picker drops its title row and shows ten 27px rows from y4. Page 1: `Done`,
`[x] All workspaces`, a `Recent workspaces` heading with the four most recently
active workspaces, an `Other workspaces` heading and alphabetical rows to fill the
page. Later pages show `Done`, `All workspaces` and eight more alphabetical rows.
Recency is Orca's worktree `lastActivityAt` (passed through `listWorkspaces`) or a
newer `lastOutputAt` of a session in that workspace. Headings are flush left, carry
no cursor column and are skipped by swipes; a recent workspace is not repeated in
the alphabetical list.

With the agent filter set to Hermes, which is not part of Orca, the picker lists only
the workspaces of Hermes sessions (the Orca workspace of a Hermes pane, or a Hermes
profile group) instead of the Orca catalogue. Earlier selections remain visible so
they can be cleared.

## Separate Hermes and Orca filters (2026-11-05, beta 1.0.36)

Hermes is not part of Orca, so the two never mix. Filter by Agent is a native-text
page: `<-`, `Hermes Agent`, a divider (not selectable), `All Orca Sessions`, `Claude`,
`Codex`, then any other Orca agent seen. With Hermes Agent the session list shows only
Hermes sessions and Filter by Workspace opens the Hermes page (Bots, Sessions,
Scheduled jobs), saved as `view-hermes-workspaces`. Every other choice shows only Orca
sessions (All Orca Sessions excludes Hermes) and opens the Orca page (Recent/Other),
saved as `view-workspaces`. Each page lists only its own workspaces; a saved selection
that no longer exists shows under `Unavailable` so it can be cleared.
