# Orca Glass features (paste source for Even Hub)

Updated: 2026-11-26. Current beta: **1.0.60**. Public: **1.0.36**.

Open this file when you update a release in Even Hub:

- **Description** (Store listing > Description > Edit): paste the block under "Paste: store
  description". Portal limit 2,000 characters. `store/description.txt` holds the same text; a test
  (`tests/store-features.test.mjs`) fails if the two differ or the block is over the limit.
- **Changelog** (the build's release note): paste the block under "Paste: what's new". Limit 500
  characters (`npm run beta:update` refuses longer text).

Rule for every agent: each beta release updates this file in the release commit: the feature list,
"Paste: what's new", and the description block when a listed feature changed. See `CLAUDE.md`,
"Release policy".

## Feature list (beta 1.0.60)

### All modules

- Row 0 of the home screen selects the module: Coding, or Email when the bridge offers it. Click
  cycles; the title "Orca-glass <version>" sits in the centre and the module's count on the right.
  The app reopens in the last module.
- Reader shared by every module: nine text rows, whole-page swipes with `Pg X/Y` in the status row,
  hanging indents on wrapped lines, one Font list (Native text and pixel fonts: Misc Fixed 9x15,
  GohuFont 8x14, Departure 7x14, Misc Fixed 6x13, Shinonome 6x12, Terminus 6x12, GohuFont 6x11,
  Scientifica 5x11; Compare fonts screen), App Brightness 15 down to 1. Both lists wrap at the ends.
- Keeps loading with the phone screen off.
- English and Japanese (switch in the phone app); Shinonome covers Japanese in small text.
- Bridge on Windows; macOS bridge scripts exist but are not verified on a real Mac.

### Coding (Orca and Hermes agents)

- Sessions from Claude, Codex, Cursor, OpenCode, OpenCode 2, Pi, OpenClaude and Hermes Agent
  (bots, sessions, scheduled jobs), with workspace and agent labels and the model name.
- Filter by Agent and Filter by Workspace (multi-select), on the glasses and the phone page.
- Reader opens at the start of the latest reply; swipe down on the last page to refresh. Status row
  shows working or waiting, the model, a spinner and the response timer. Markdown tables line up in
  small fonts.
- Voice: hold for a full-screen voice page, local Whisper on the PC with silence detection; release
  to review, click to send, double-click to cancel.
- Numbered choices: click opens the current question's choices; answer single-select Hermes
  clarify questions.
- Usage for Codex, Claude and Cursor with reset times in Computer, Phone or Absolute mode.

### Email (Gmail; only when the bridge has a mail set-up)

- Read-only: no sending, drafts, archive or label changes. Opening a thread marks it read in Gmail.
- List of eight threads a page, newest first, sender and subject, time today or date, unread marker,
  unread count on row 0.
- Filter by Label on the glasses: one heading per account, labels with unread counts, several at
  once.
- Threads read oldest to newest and open at the top of the newest message; quoted reply history is
  removed and hard-wrapped plain text is reflowed to the glasses' width.
- Mail routes answer only over the private Tailscale address, never through the public tunnel.

### Not yet released (built or in progress)

- Phone page: module switch and Filter by Label (in progress, 2026-11-26).
- Voice search inside Filter by Label on the glasses (in progress).
- Faster module switching from cached rows (in progress).
- Later: Filter by email address, personal Gmail account (E2), Chat through Beeper, Reader for
  documents.

## Paste: store description

<!-- description:start -->
Read your Orca agent sessions and your email on G2. Speak your next step.

Orca Glass connects Even Realities G2 glasses to agents running in Orca on your Windows PC, and to Hermes Agent. Row 0 of the home screen switches between Coding and Email.

Coding:
- Agents: Claude, Codex, Cursor, OpenCode, Pi, OpenClaude and Hermes Agent (bots, sessions and scheduled jobs), with the model name and working or waiting status.
- Filter by Agent and Filter by Workspace on the glasses and the phone page. Usage for Codex, Claude and Cursor with reset times.
- Voice: hold for a full-screen voice page with local Whisper on your PC. Release to review, click to send, double-click to cancel. Answer numbered choices and Hermes clarify questions.

Email (Gmail, when your bridge is set up for it):
- Read only: no sending, drafts or archive. Opening a thread marks it read.
- Filter by Label, eight threads a page, unread markers. Threads open at the newest message with quoted history removed.

Reader for both: book-style pages, swipe to turn, one Font list with Native text and pixel fonts (Misc Fixed, GohuFont, Departure, Shinonome, Terminus, Scientifica), App Brightness 15 to 1. Keeps loading with the phone screen off. English and Japanese.

Requires G2, the Even Realities app (iPhone untested), Orca and the companion bridge. The packaged connection targets a configured private PC over Tailscale; self-service setup for any PC is not offered yet. Agents and mail access run on your PC, not the glasses. Try the demo without a PC.

Source/setup: https://github.com/eugene8080/orca-glass/tree/windows-android-codex
Independent fork of 2ero20ne's Orca Glass under MIT.
Original: https://github.com/2ero20ne/orca-glass
<!-- description:end -->

## Paste: what's new

<!-- whatsnew:start -->
1.0.60: Row 0 of the home screen is now a module selector. Click it to switch between Coding and Email (Email appears only when your bridge is set up for it). The title moves to the centre. Email reads Gmail by label, eight threads a page; opening a thread marks it read. Coding is unchanged.
<!-- whatsnew:end -->
