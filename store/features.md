# Orca Glass features (paste source for Even Hub)

Updated: 2026-11-27. Current beta: **1.0.80**. Public: **1.0.36**.

Open this file when you update a release in Even Hub:

- **Description** (Store listing > Description > Edit): paste the block under "Paste: store
  description". Portal limit 2,000 characters. `store/description.txt` holds the same text; a test
  (`tests/store-features.test.mjs`) fails if the two differ or the block is over the limit.
- **Japanese description:** `store/description.ja.txt` (matches the English text of beta 1.0.80,
  updated 2026-11-26). It is the agent's translation; a native review is still pending.
  Update it together with the English block.
- **Changelog** (the build's release note): paste the block under "Paste: what's new". Limit 500
  characters (`npm run beta:update` refuses longer text).

Rule for every agent: each beta release updates this file in the release commit: the feature list,
"Paste: what's new", and the description block when a listed feature changed. See `CLAUDE.md`,
"Release policy".

## Feature list (beta 1.0.80)

### All modules

- Row 0 of the home screen selects the module: [Coding], or [Email] when the bridge offers it (the
  brackets mark it as a button). Click cycles; the title "Orca-glass <version>" sits in the centre and the module's count on the right.
  The app reopens in the last module. A module opened before shows its last rows at once and
  refreshes in place.
- Phone page (in the Even app): the same module switch, linked both ways with row 0.
- Reader shared by every module: nine text rows, whole-page swipes with `Pg X/Y` in the status row,
  hanging indents on wrapped lines, one Font list (Native text and pixel fonts: Departure 7x14,
  Misc Fixed 6x13, Terminus 6x12, GohuFont 6x11, Scientifica 5x11; Compare fonts screen), App
  Brightness 15 down to 1. Both lists wrap at the ends.
- With a pixel font, the user's turns sit on a dim background so they stand out. The reader's
  long-press menu has a Background menu: Compare backgrounds, Halo On/Off, None, Ink 5/8, 1/2 and
  1/4, Lines 1/3 (default) and 1/4, Dots 1/3, 1/4 and 1/8, Tube 1/2, 1/4 and 1/8, Tube, 1px frame,
  and three terminal-style marks that light nothing behind the letters: Left bar (a quote bar in
  place of the '/'), Underline, and Dim replies (the other side's text dimmer; Email shows None).
  Halo keeps the background dark next to every letter. Compare fonts and Compare backgrounds choose
  directly: swipe moves the '>' mark, click uses it, double-click goes back unchanged.
  Tube draws CRT scanlines on every third pixel row across the whole screen; Tube 1/2, 1/4 and
  1/8 scan your turns over a half-, quarter- and eighth-lit band.
  The 1px frame puts consecutive messages of yours in one frame.
  Native text has no background option in the SDK.
- Keeps loading with the phone screen off.
- English and Japanese (switch in the phone app); Japanese in small text uses Shinonome 12x12
  glyphs in every pixel font.
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

- Opening a thread marks it read in Gmail. With a Bluetooth keyboard: compose, reply, reply all and
  forward (plain text; a forward leaves out attachments), archive, delete (to Trash), mark unread or
  read, star, and undo (z) for a minute. Drafts show on the glasses; the bridge sends each draft once.
- Threads newest first, eight a page (seven with two mailboxes), sender and subject, time today or date, `/` for unread
  and `-` for read in the gutter, unread count on row 0. While a page loads, a moving dot shows
  Email is working (Loading email…, then Loading more… until the page is complete).
- Several Gmail accounts, one on screen at a time. With two or more, the row under row 0 shows the
  mailbox address and a click switches to the next one; the phone page has a choice per address.
  Each mailbox keeps its own label picks. A newly added mailbox starts with its Inbox.
- Filter by Label on the glasses and the phone page (shared picks): the labels of the mailbox on
  screen with unread counts, several at once. The phone has a type-to-narrow box; on the glasses,
  hold to search by voice (labels containing every spoken word; double-click clears).
- Threads read oldest to newest and open at the top of the newest message; quoted reply history is
  removed and hard-wrapped plain text is reflowed to the glasses' width.
- Mail routes answer only over the private Tailscale address, never through the public tunnel.

### Chat (Beeper; only when the bridge has a Beeper set-up)

- Chats from the networks Beeper Desktop connects (WhatsApp, Signal, Telegram, ...), eight a page,
  most recent first, `/` unread and `-` read, unread chats counted on row 0.
- Filter by Network on the glasses and the phone page (shared picks).
- Reader opens at the newest message; your messages start `/ `, others `> ` with the sender, with
  no blank row between messages and line breaks kept.
- Voice notes and other media show as tags (`[Voice 0:12]`, `[Photo]`, ...). A click transcribes
  the voice notes on the page on screen, on the PC (FunASR SenseVoice, tuned for Cantonese, HK
  Traditional characters).
- Translate: English (reader menu and phone, off by default) adds an English translation in
  brackets after messages and transcripts in other languages, made by a local Ollama model.
- Each of these is offered only when the bridge PC has its engine: without FunASR and ffmpeg a
  click does not transcribe; without Ollama and the model, Translate is hidden.
- Voice reply as in Coding: hold, release to review, click to send, double-click to cancel. A send
  is never repeated automatically. Opening an unread chat marks it read in Beeper.

### Bluetooth keyboard (paired with the phone, while Orca Glass is open in the Even app)

- Gmail's PC shortcuts in every module: j/k or Up/Down move (in a reader: next or previous row of
  its list), o or Enter opens, u or Esc goes back (never closes the app), Space and Shift+Space turn
  pages, Tab switches module, ? shows the keys on the glasses.
- Email: c compose, r reply, a reply all, f forward, e archive, # delete, Shift+U unread, Shift+I
  read, s star, z undo. Coding and Chat: r types a reply.
- Drafts open on the glasses and are typed in the phone page's boxes (Tab moves between To, Cc,
  Subject and message). Mail: Enter is a new line, Ctrl+Enter reviews; a reply: Enter reviews,
  Shift+Enter is a new line. Enter on the review sends once; Esc edits; Esc while typing closes and
  keeps the draft.
- Typing in the Email label picker searches labels. Voice stays on the glasses' tap-and-hold.

### Not yet built

- Reader for documents. Sign-in for other people's own Google accounts (each
  user runs the bridge with a mail set-up on their own PC today).

## Paste: store description

<!-- description:start -->
Read your agent sessions, email and chats on G2. Speak your next step.

Orca Glass connects Even Realities G2 glasses to agents running in Orca on your Windows PC, and to Hermes Agent. Row 0 switches between Coding, Email and Chat.

Coding:
- Agents: Claude, Codex, Cursor, OpenCode, Pi, OpenClaude and Hermes Agent, with the model name and working or waiting status.
- Filter by Agent and Filter by Workspace on the glasses and the phone page. Usage for Codex, Claude and Cursor with reset times.
- Voice: hold for a full-screen voice page with local Whisper on your PC. Release to review, click to send, double-click to cancel. Answer numbered choices and Hermes clarify questions.

Email (Gmail, when your bridge is set up for it):
- Bluetooth keyboard with Gmail shortcuts: compose, reply, forward, archive, delete, undo; drafts show on the glasses.
- One or more Gmail accounts, one at a time (click the address to switch). Filter by Label on the glasses or the phone, with voice search on the glasses. Threads open at the newest message with quoted history removed and plain text reflowed.

Chat (Beeper Desktop, when set up): Filter by Network, voice replies, voice notes transcribed on click (Cantonese tuned), English translation.

Reader for all: book-style pages, swipe to turn, one Font list with Native text and pixel fonts (Departure, Misc Fixed, Terminus, GohuFont, Scientifica), backgrounds for your turns, App Brightness 15 to 1. Keeps loading with the phone screen off. English and Japanese.

Requires G2, the Even Realities app (iPhone untested), Orca and the companion bridge. The packaged connection targets a configured private PC over Tailscale; self-service setup for any PC is not offered yet. Agents and mail access run on your PC, not the glasses. Try the demo without a PC.

Source/setup: https://github.com/eugene8080/orca-glass/tree/windows-android-codex
Independent fork of 2ero20ne's Orca Glass under MIT.
Original: https://github.com/2ero20ne/orca-glass
<!-- description:end -->

## Paste: what's new

<!-- whatsnew:start -->
1.0.80: Choose on the comparison pages. Compare fonts and Compare backgrounds open with a > on the current choice; swipe to move it, click to use the marked font or background, double-click to go back without a change.
<!-- whatsnew:end -->
