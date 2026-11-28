# HUD Desk features (paste source for Even Hub)

Formerly Orca Glass (renamed 2026-11-27; the plugin ID stays com.eugene8080.orcaglass).

Updated: 2026-11-27. Current beta: **1.0.95**. Public: **1.0.36**.

Open this file when you update a release in Even Hub:

- **Description** (Store listing > Description > Edit): paste the block under "Paste: store
  description". Portal limit 2,000 characters. `store/description.txt` holds the same text; a test
  (`tests/store-features.test.mjs`) fails if the two differ or the block is over the limit.
- **Japanese description:** `store/description.ja.txt` (matches the English text of beta 1.0.91,
  updated 2026-11-27). It is the agent's translation; a native review is still pending.
  Update it together with the English block.
- **Changelog** (the build's release note): paste the block under "Paste: what's new". Limit 500
  characters (`npm run beta:update` refuses longer text).

Rule for every agent: each beta release updates this file in the release commit: the feature list,
"Paste: what's new", and the description block when a listed feature changed. See `CLAUDE.md`,
"Release policy".

## Feature list (beta 1.0.89)

### All modules

- Row 0 of the home screen selects the module: [Coding], or [Email] when the bridge offers it (the
  brackets mark it as a button). Click cycles; the title "HUD Desk <version>" sits in the centre and the module's count on the right.
  The app reopens in the last module. A module opened before shows its last rows at once and
  refreshes in place.
- Phone page (in the Even app): the same module switch, linked both ways with row 0.
- Reader shared by every module: nine text rows, whole-page swipes with `Pg X/Y` in the status row,
  hanging indents on wrapped lines, one Font list (Native text and pixel fonts: Departure 7x14,
  Misc Fixed 6x13, Terminus 6x12, GohuFont 6x11, Scientifica 5x11; Compare fonts screen), App
  Brightness 15 down to 1. Both lists wrap at the ends.
- With a pixel font, the user's turns sit on a dim background so they stand out. The reader's
  long-press menu's Background row opens Compare backgrounds, where you choose: Halo On/Off, None, Ink 5/8, 1/2 and
  1/4, Lines 1/3 (default) and 1/4, Dots 1/3, 1/4 and 1/8, Tube 1/2 and 1/4, Tube, 1px frame,
  and three terminal-style marks that light nothing behind the letters: Left bar (a quote bar in
  place of the '/'), Underline, and Dim replies (the other side's text dimmer; Email shows None).
  Halo (on by default, 2 px) keeps the background dark next to every letter. Font and Background open their comparison
  pages directly: swipe moves the '>' mark, click uses it (on the Halo row: toggles it), double-click
  goes back unchanged. Compare fonts lists Native text first, then the pixel fonts large to small.
- Images: [Photo N] in Chat; [Image N: name] in a mail where the picture appears, including pictures a
  newsletter links to (fetched from the sender's server only when opened, https and public addresses
  only; tracking pixels, icons and ad servers skipped); [Image N] where a picture was pasted
  into a Claude or Codex session. A click on the page opens its first picture. A click cycles the
  views: Original Picture (whole; a chart or screenshot in four flat tones, a photo as thin bright outlines over a
  dot pattern, as G2oom draws its scenes; a mostly white picture in negative), Zoom (at least twice
  the size, in sections; a tall screenshot fills the width), Outline (1 px edges only, lit lines on
  black) and AI Readout (the PC's local vision model reads it as text: chart values, screen text, or
  what a photo shows; its pages have no divider and "AI Readout 1/2" in the caption box). Swipe moves through sections or text pages, then pictures; n toggles negative; a caption
  shows the view and position; double-click goes back.
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
- Read marks as in Email and Chat (1.0.95): '/' unread, '-' read, the moving dot while working.
  Orca sessions use Orca's own unread flag (its bell); other sessions turn '/' on new output since
  they were last opened on the glasses. Opening marks a session read on the glasses only: Orca's
  bell stays until the session is viewed in Orca (its CLI clears unread per worktree only).
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

### Bluetooth keyboard (paired with the phone, while HUD Desk is open in the Even app)

- Gmail's PC shortcuts in every module: j/k or Up/Down move (in a reader j/k open the next or
  previous row of its list and Up/Down turn pages), o or Enter opens, u or Esc goes back (never closes
  the app), Space and Shift+Space (or Left/Right, PageUp/PageDown) turn pages, Tab switches module,
  ? shows the keys on the glasses, one row per action with its keys on the right.
- Email: c compose, r reply, a reply all, f forward, e archive, # delete, Shift+U unread, Shift+I
  read, s star, z undo. Coding and Chat: r types a reply.
- Drafts open on the glasses and are typed in the phone page's boxes (Tab moves between To, Cc,
  Subject and message). Mail: Enter is a new line, Ctrl+Enter reviews; a reply: Enter reviews,
  Shift+Enter is a new line. Enter on the review sends once; Esc edits; Esc while typing closes and
  keeps the draft.
- Typing in the Email label picker searches labels. Voice stays on the glasses' tap-and-hold.
- IDE keys (VS Code style): Ctrl+, the long-press menu's actions, Ctrl+P quick open (type to filter
  sessions, chats or mail), Ctrl+Shift+P command palette, Ctrl+Tab recent conversations (release
  Ctrl to open), Ctrl+F find in the conversation (Enter or F3 next), Ctrl+1/2/3 modules,
  Ctrl+Home/End first and last page, Ctrl+R refresh, Ctrl+N new session or mail, Alt+Left/Right
  back and forward. Ctrl+E is the recent list without holding Ctrl. The ? page shows every key in
  two columns in the pixel font. An "Enable BT keyboard" button at the top of the phone page connects
  the keyboard with one press and shows whether keys arrive. Pages opened from Ctrl+, or Ctrl+Shift+P
  go back one layer, to that menu.

### Not yet built

- Reader for documents. Sign-in for other people's own Google accounts (each
  user runs the bridge with a mail set-up on their own PC today).

## Paste: store description

<!-- description:start -->
Read your agent sessions, email and chats on G2. Talk, type on a Bluetooth keyboard, open pictures.

HUD Desk (renamed from Orca Glass) connects G2 to the coding agents, email and Beeper chats on your own Windows PC or Mac. The top row switches Coding, Email and Chat.

Coding:
- Claude Code and Codex sessions, with or without Orca; through Orca also Cursor, OpenCode, Pi, OpenClaude and Hermes Agent, with model and status.
- Filter by Agent and Workspace. Usage bars: Codex, Claude, Cursor.
- Hold to talk: local Whisper on your PC, review, then send. Answer numbered choices.

Email (Gmail, or any IMAP/SMTP account):
- One mailbox at a time, Filter by Label with voice or typed search. Opening a thread marks it read.
- With a keyboard: compose, reply, reply all, forward, archive, delete, star and undo with Gmail's keys. Drafts show on the glasses; review, then send.
- Pictures in mail, newsletters included.

Chat (Beeper: WhatsApp, Signal, Telegram and more):
- Rows show the day and the app; Filter by Network; formatting kept.
- Voice notes transcribed (Cantonese tuned). English under each line. Photos open on the glasses.

Pictures: Original Picture (tuned for G2), Zoom in sections, Outline, and AI Readout: a local vision model describes the picture.

Keyboard: Gmail-style keys everywhere, VS Code-style Ctrl+P, Ctrl+Shift+P, Ctrl+Tab, Ctrl+F; ? shows every key.

Reader: book-style pages in Native text or pixel fonts, down to Scientifica 5x11 (114 columns), with Chinese and Japanese; backgrounds (lines, dots, Tube scanlines, left bar, underline); App Brightness. English and Japanese.

Requires G2, the Even Realities app (iPhone untested), Tailscale on your phone and the bridge on your PC. Setup is one command on Windows or macOS. Everything runs on your PC. Try the demo without a PC.

Source/setup: https://github.com/eugene8080/hud-desk
Independent fork of 2ero20ne's Orca Glass under MIT.
Original: https://github.com/2ero20ne/orca-glass
<!-- description:end -->

## Paste: what's new

<!-- whatsnew:start -->
1.0.95: Coding rows show read marks like Email and Chat: '/' for a session with something you have not read, '-' for one you have. Orca sessions follow Orca's own unread bell; plain Claude Code, Codex and Hermes sessions turn '/' when they have new output since you last opened them. Opening a session on the glasses marks it read. A working session keeps the moving dot.
<!-- whatsnew:end -->
