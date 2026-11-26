# Super app (Coding, Email, Chat, Reader): task brief for the implementing agent

Generated: 2026-11-26. Revised 2026-11-26 with Eugene's decisions (see "Decisions").

Eugene, 2026-11-26: "I just want all the reading and replying apps together into a super app under the
existing orca-glass repo. That would be Coding (orca), Email (gmail), Chat (beeper), Reader (text, pdfs
parsed into text). The transport schedule and gym apps would not be included as they are not primarily text
readers." Also: "the reader is a later build. first start with the easy stuff which is the email", and for
the UI: "the main menu of orca glass does not use the first row for selection. so I'm thinking we can select
between coding email chat or reader on the first row, left side. the 'Orca-glass [version]' title can move to
center."

On email, the same day: "i only want to read emails, and mark them read ... from the g2. i dont want to draft
emails", and "for now, the app does not archive at all. open an email just changes them from unread to read."

Read first: `CLAUDE.md` (constraints, terminal policy, release policy), `INTERNAL.md` (untracked: mailbox
address, OAuth client file, origins; ask Eugene if it is missing), `docs/session-reader.md`,
`docs/voice-input.md`, `git log --oneline -15`.

## Phases

| Phase | Scope | Changes anything outside the app? | Status 2026-11-26 |
|---|---|---|---|
| S0 | Module selector on row 0; Coding = today's app, unchanged | no | to build |
| E1 | Email, work account: label filter, thread list, reader; opening a thread marks it read in Gmail | the Gmail unread flag only | to build with S0 |
| E2 | Email: add the personal account | the Gmail unread flag only | when Eugene asks |
| C | Chat: Beeper Desktop API through the bridge | chat replies | later |
| R | Reader: share-in, PDF and article to text, library | no | later; design notes only |

Build S0 + E1 first, release them, and wait for Eugene's G2 check.

## State at handoff (2026-11-26)

- Branch `windows-android-codex` is this fork's working branch. `main` mirrors upstream (`6315d7f`);
  upstream (2ero20ne) last pushed 2026-10-13. Beta 1.0.59, public 1.0.36, 164 tests.
- **Uncommitted work from 2026-11-11 is in the main checkout**: `bridge/conversation.mjs`, `bridge/orca.mjs`,
  `bridge/session-titles.mjs`, `tests/session-titles.test.mjs` and the new `bridge/cursor-title.mjs`,
  `tests/cursor-title.test.mjs`. It is not part of this task. Do not commit, stash or discard it; ask Eugene
  who owns it. Develop this task in its own Orca worktree off `windows-android-codex` (terminal policy).
- Email on the glasses today is a stop-gap in another repo: github.com/eugene8080/messenger-glass
  `companion/mail-facade.mjs` adds one read-only Gmail label to the GazeChat fork by imitating the Beeper
  Desktop API. Eugene confirmed it works on 2026-11-26, then rejected GazeChat as an email reader: six
  readable rows, a large left indent, a total row at the top, a tap-to-reply so sensitive that it sends
  replies by accident, and email mixed in with WhatsApp. This brief replaces it.
- The label Eugene reads first skips the Inbox: on 2026-11-26 every one of its 458 messages from the last 30
  days was outside the Inbox, and 443 were unread (counts only; label name in `INTERNAL.md`). So list threads
  by label, never by `in:inbox`, and expect most rows to be unread.
- Working Gmail code to port (MIT, same owner), all in github.com/eugene8080/messenger-glass:
  - `companion/mail-auth.mjs`: one-time PKCE loopback consent. It checks the granted scope and that
    `users/me/profile` returns the expected address, then writes the refresh token. Change its scope to
    `gmail.modify` and add an `--account <id>` argument.
  - `companion/mail-facade.mjs`: `googleAccessToken`, `gmail` (exponential back-off on 429 and on 403
    `rateLimitExceeded`), `decodeEntities`, `htmlToText`, `tidy` (strips URLs and zero-width characters),
    `findPart`, `bodyText` (prefers text/plain; falls back to HTML when the plain part is under 200
    characters), `parseFrom`, `resolveLabelId`, `listIds`.
  - Lesson: a cold fetch of 250 full messages at 3 parallel calls hit `rateLimitExceeded` and took about
    2 minutes. Fetch metadata for the visible page only, and bodies on open.
  - Lesson: write the zero-width character class from code points (`new RegExp` built from numbers). An
    editor tool once turned the U+2028 escape (backslash-u-2028) into a literal line terminator inside the
    regex.
- OAuth client: reuse the existing Google OAuth client named in `INTERNAL.md` (type "installed", External,
  in production, so refresh tokens do not expire after 7 days). It already holds working tokens for both of
  Eugene's mailboxes (checked 2026-11-26). Eugene: "leave the hermes oauth". Do not create, edit or replace
  any Google Cloud project or client. Google's consent screen shows the project name "Hermes"; that is
  expected. Mint a NEW token for this app; do not reuse another tool's token files. The stop-gap's token is
  `gmail.readonly`, which cannot clear the unread flag, so a new consent is needed in any case.

## Why one app

- G2 runs one Even Hub plugin at a time, in the foreground. With separate apps Eugene must leave one app and
  start another from the phone. In one app it is one click.
- The modules share the reader (nine rows, whole-page swipes, the font list, App Brightness, the status
  row), the voice flow (hold, release, review, click to send, double-click to cancel; Coding and Chat only),
  pairing, the bridge, Whisper and the tailnet origin.
- The transport schedule and gym apps stay separate. They are not text readers, and they have their own
  loops (Workout Glass keeps a countdown running with the phone screen off).

## Constraints (in addition to `CLAUDE.md`)

1. **Orca Glass is a public Even Hub app.** Other users must see only Coding. The bridge lists the modules it
   can serve in `GET /api/capabilities` (for example `{ "voice": true, "modules": ["coding", "email"] }`);
   the app offers only those in the selector. With no `mail` block in `bridge/config.local.json` the bridge
   offers Coding only, and the app behaves as today apart from the row-0 layout.
2. **Mail stays private.** No mail content, address, display name, subject or label name in a tracked file,
   a test fixture, a log line, a diagnostic or a commit message. Tests use synthetic MIME fixtures. Bridge log
   lines carry the route, status code, counts and timings only. Gmail tokens live under `.local/`
   (gitignored), written with mode 0600, never in `bridge/config.json`.
   Tracked files here already name the PC's tailnet host (`app/app.json` and some docs); add no more.
   Suggest to Eugene, do not add unasked: a private-pattern pre-commit hook like messenger-glass's
   `.githooks/pre-commit`.
3. **Mail and chat routes refuse the public tunnel.** `tunnel/watch.mjs` publishes `127.0.0.1:8787` through a
   Cloudflare Quick Tunnel for prototype loading, and Cloudflare terminates TLS there
   (`docs/windows-android.md`, "Data handling"). Mail read that way is visible to Cloudflare and reachable
   from the internet with only the bearer token. The packaged beta reaches the bridge through
   `tailscale serve` only (its allowlist has no trycloudflare origin). So every `/api/mail/*` (and later
   `/api/chat/*`) route answers 403 when the request carries a `cf-ray` or `cf-connecting-ip` header, or when
   its Host is not in `privateHosts` in `bridge/config.local.json`. Check which Host header `tailscale serve`
   forwards before you fill `privateHosts`. Test both refusals.
4. **Email only reads and clears the unread flag.** No send, no draft, no archive, no label change, no
   Trash, no delete. `gmail.modify` is the narrowest Google scope that can clear the unread flag
   (`gmail.readonly` cannot change labels), but it also permits sending, drafts, label changes and moving
   mail to Trash. So `bridge/gmail.mjs` sends a request only when it matches this allowlist, and throws
   before any network call otherwise:
   - `GET` `profile`, `labels`, `labels/{id}`, `threads` (list), `threads/{id}`, `messages/{id}`;
   - `POST` `threads/{id}/modify` with a body exactly `{ "removeLabelIds": ["UNREAD"] }`.
   Unit-test the allowlist: a send, a draft, a trash, an `addLabelIds`, a `removeLabelIds` with any other
   label, and an unknown path must all throw without calling the transport.
5. **Live checks touch only mail Eugene names.** Opening a thread on the glasses changes his real mailbox.
   Build and test the UI in demo mode and the simulator with synthetic mail. Call the mark-read route
   against the real mailbox only for a thread Eugene names for the test.
6. **No new network surface for mail.** Mail uses the existing bridge origin. No new allowlist entry, no
   Tailscale Funnel, no public tunnel.

## S0: module selector on row 0

Today (beta 1.0.59) row 0 of the home screen is not selectable. The page in `show()`
(`app/src/main.ts`, the `sessionList` branch) puts `sessionHeading()` ("Orca-glass 1.0.59",
`app/src/session-list.ts`) in `HEAD` at width 300 and "N sessions" in `menu-count` at x 300. The cursor
column `MENU_CURSOR` starts at y 28, so the cursor reaches rows 1 to 9 only (`home()`: two filter rows and
seven sessions).

New row 0:

```
>Email               Orca-glass 1.0.60                  3 unread
```

- Left: the current module name. It is the first selectable row of every page (cursor `>` in the gutter, so
  `MENU_CURSOR` starts at y 0).
- Centre: "Orca-glass <version>". Native text has no alignment flag: pad with measured widths, as
  `nativeRight()` does. Check the fit with `glassWidth()`.
- Right: the module's count. Coding: N sessions. Email: N unread. Chat: N unread chats. Reader: N documents.
- Stay inside the six text containers the page uses today (left and centre in `HEAD`, right in
  `menu-count`), so the firmware is asked for nothing new.
- Rows 1 to 9 belong to the module. Coding keeps its rows exactly as today.

Input (Eugene chose cycling, 2026-11-26; show a simulator preview with the release report):

- Click on row 0: next module, wrapping (Coding, Email, Chat, Reader, Coding), over the modules the bridge
  offers. The label changes at once. The module's rows load after about 0.6 s without a further click, so
  clicking past a module does not load it.
- Swipe up from row 1 lands on row 0. Swipe up from row 0 turns to the previous page, as row 1 does today.
  A module changes only on a click, never on a swipe.
- Each module keeps its own page, cursor and filters. The app reopens in the last module
  (`setLocalStorage('module', ...)`).
- Double-click on a module's list closes the app, as on today's home screen.
- Long press opens the firmware menu with that module's actions (`menuActions`). Coding keeps Refresh,
  New session and Usage. Email: Refresh.

## E1: Email, work account

### Glasses

- **List.** Row 0 selector. Row 1 `* Filter [<label> +2]`, which opens the label picker. Rows 2 to 9:
  eight threads, newest first. Left column "Sender - Subject", fitted with `menuTitle()`; right column the
  time today (`14:05`) or the date (`25 Nov`). Unread marker in the gutter, where Coding shows `/ * ?`. Page
  swipes as on the Coding list. Once E2 adds the personal account, the right column starts with the account
  letter (`[W] 14:05`).
- **Label picker.** Built like Filter by Workspace (ten rows, no title, Done first, paged with
  `v more below` / `^ more above`). One heading per account, then that account's labels with the unread
  count; click toggles a label; several labels can be on at once. Saved with `setLocalStorage`. First-run
  default: Inbox.
- **Reader.** The existing reader: nine text rows, whole-page swipes, the font list, App Brightness, the
  status row (for example `Pg 2/7`). Each message starts with three header lines (From, Date, Subject), a
  blank line, then the body. A thread reads oldest to newest and opens at the top of the newest message (the
  same mechanic as Coding opening at the top of the latest response, `latestResponseStart()` in
  `app/src/text.ts`). Strip quoted history from each message (lines starting `>` and the "On ... wrote:"
  line before them), because the earlier messages are already on screen. Hold does nothing in Email; the
  long-press menu has the reader's Font and App Brightness only.
- **Read state (Gmail sync).** When the first page of a thread is on screen, the app asks the bridge to mark
  the thread read; the bridge clears `UNREAD` on the whole thread in Gmail. The list then shows it read.
  Nothing else changes in Gmail: no archive, no mark-unread, no label change. If the call fails, the thread
  stays unread in the list and the next open tries again; the status row shows `not marked read`.

### Bridge

- New files: `bridge/gmail.mjs` (OAuth refresh, the endpoint allowlist, REST calls, back-off),
  `bridge/mail-text.mjs` (MIME to text; pure functions), `bridge/mail.mjs` (routes, per-account cache),
  `scripts/mail-auth.mjs` (consent, ported from messenger-glass).
- Register the mail routes only when `bridge/config.local.json` has a `mail` block. The `accounts` list
  takes more entries later (E2):

  ```json
  "mail": {
    "oauthClientFile": "<from INTERNAL.md>",
    "accounts": [
      { "id": "work", "short": "W", "address": "<from INTERNAL.md>", "tokenFile": ".local/mail/work.json" }
    ],
    "windowDays": 30,
    "refreshSeconds": 120
  },
  "privateHosts": ["<from INTERNAL.md>"]
  ```

- Routes (bearer token as today, plus the private-host gate):
  - `GET /api/mail/accounts`: `[{ id, short, ok, error? }]`. No address.
  - `GET /api/mail/labels?account=`: `[{ id, name, unread }]`. User labels plus INBOX; other system labels
    hidden.
  - `GET /api/mail/threads?filter=<account>:<labelId>,...&page=`: `{ items: [{ account, id, from, subject,
    date, unread, count }], hasMore }`. Use `users.threads.list` (`labelIds`, `newer_than:<windowDays>d`)
    and `users.threads.get` with `format=metadata` (From, Subject, Date) for the visible page only.
  - `GET /api/mail/thread?account=&id=`: `{ subject, messages: [{ id, from, to, cc, date, text }] }`,
    `format=full`, converted with `mail-text.mjs`. Reading a thread does not mark it read; only the next
    route does.
  - `POST /api/mail/read` `{ account, threadId }`: `threads.modify` with `removeLabelIds: ["UNREAD"]`;
    returns `{ ok }`. It is idempotent, so a repeat is harmless.
- Keep a per-account snapshot, refreshed every `refreshSeconds`; update it at once after a mark-read. On a
  cold start answer within about 3 s with whatever is cached, as the messenger-glass facade does.
- `GET /api/capabilities` adds `modules`.

### App

- `app/src/main.ts` is 1,524 lines and holds every screen. Put Email in a new file (`app/src/mail.ts`; later
  `chat.ts` and `library.ts`). Move only the shared parts Email needs behind small interfaces.
- The reader is typed to an Orca session today (`reader?: Thread` in the `Screen` type near the top of
  `app/src/main.ts`, and `record(t, ...)` takes a `Thread`). Generalise it to a reader source (title, load,
  status text, and an optional hold handler) so Email and Chat reuse paging, fonts, brightness and the status
  row; Chat also reuses the voice flow.
- `app/src/api.ts`: add `api.mail.*`. Keep its rule that a POST is never replayed after a disconnect.
- `app/src/demo.ts`: add synthetic mail for demo mode and the simulator.

## E2: personal account (when Eugene asks)

Add a second entry to `mail.accounts`, run `node scripts/mail-auth.mjs --account personal` for one more
consent, and show the account letter in the list. No other change.

## C: Chat (later)

- The bridge calls the Beeper Desktop API on `127.0.0.1:23373` with its own Beeper token (mint one for Orca
  Glass; do not share GazeChat's). The phone never talks to Beeper, so Beeper's Remote Access can be
  switched off.
- Port, do not embed: GazeChat (github.com/eugene8080/gazechat) is React with even-toolkit; Orca Glass is
  plain TypeScript. Take the chat list, the message reader and the voice reply with review. Chat replies
  keep a review step; never send to a real contact during development.
- Facts (messenger-glass `docs/design.md` Q7): Eugene's WhatsApp, Signal and Telegram run on Beeper Cloud
  (`bridge.provider: "cloud"`; on 2026-11-26 Beeper Desktop's only remote connections went to Beeper's
  Matrix server), so chat content passes through Beeper's servers. Beeper does not bridge Telegram
  channels. The Desktop API WebSocket `/v1/ws` needs an `Authorization` header; the `?access_token=` form
  gets 401.

## R: Reader (later; design notes only)

- **Intake.** An Even Hub plugin runs inside the Even Realities app, so it cannot be an Android share
  target. Two routes:
  1. Gmail to self, recommended first. Android Share, Gmail, send to a plus-address of one of Eugene's
     mailboxes; a Gmail filter labels it; the bridge reads that label with the E1 code and takes attachments
     (PDF, text, Markdown) and URLs from the body. No phone code. Gmail's attachment limit is 25 MB. Which
     mailbox (work now, or personal after E2) is Eugene's choice at R.
  2. A PWA share target, later and smoother. A small page served by the bridge at the tailnet origin with a
     web app manifest `share_target` (POST, multipart, files). Chrome on Android lists an installed PWA in
     the share sheet. The phone needs Tailscale on, which the glasses already need.
  Beeper's self-chat would also work but sends documents through Beeper Cloud.
- **Conversion on the PC.** PDF to Markdown with Marker, locally. Claude or Codex only for scans or complex
  layouts, and only when Eugene chooses that per document (third-party processing and cost). Whisper is
  speech to text; it does not read PDFs.
- **Articles.** Fetch the page and extract it with Mozilla Readability into Markdown. If the page is
  paywalled or gone: an existing archive.today snapshot (`https://archive.ph/newest/<url>`), then the
  Wayback Machine availability API (`https://archive.org/wayback/available?url=<url>`). archive.today often
  answers automated requests with a CAPTCHA; check this before relying on it, and never solve CAPTCHAs
  automatically.
- **Storage.** The library of record is on the PC (`.local/reader/`, one Markdown file per document plus an
  index). The app caches the open document and the most recent few with `setLocalStorage` for offline
  reading; check the SDK's storage limit first. Eugene asked for documents "stored as plain text" on the
  phone: confirm with him whether the cache is enough or the phone must hold the full library. Save the
  reading position per document.

## Decisions (Eugene, 2026-11-26)

| # | Decision | Ruling |
|---|---|---|
| 1 | Gmail scope | `gmail.modify`, used only to clear the unread flag; the endpoint allowlist (constraint 4) blocks everything else |
| 2 | Replies and drafts | none: Email never sends or drafts |
| 3 | Archive | none for now: "the app does not archive at all" |
| 4 | Where | this repo (orca-glass), modules in one app |
| 5 | Module switch | click on row 0 cycles |
| 6 | Accounts | work first; personal later (E2) |
| 7 | Read state | Gmail sync: opening a thread marks it read in Gmail |
| 8 | Mark unread | not built (not requested) |

## Approvals

- Beta upload: follow the `CLAUDE.md` release policy (automatic after `npm test` and the app build). Row 0
  changes for every user, so share a simulator preview of Coding and Email with the release report. The
  `TODOS.md` header still says visual changes need preview approval before a beta; the 2026-11-10 policy in
  `CLAUDE.md` is newer. Follow `CLAUDE.md` and point the conflict out to Eugene once.
- Bridge restart: ask Eugene each time (`CLAUDE.md`).
- Gmail consent: Eugene does it, work account only at E1, scope `gmail.modify`. Run
  `node scripts/mail-auth.mjs --account work` and put the consent URL at the top of your message to him, not
  only in a log (on 2026-11-26 he could not find it in a log). Tell him the consent screen lists everything
  `gmail.modify` allows, and that the allowlist limits the app to reading and clearing the unread flag.
- Public Even Hub release: only on his explicit request. The listing and the `app/app.json` network
  description mention email and chat only then.
- After E1 is confirmed on G2, tell Eugene that the messenger-glass Gmail facade can go back to Beeper-only
  (messenger-glass `TODOS.md` #14). Do not change that repo from here unless he asks.

## Done when

- S0 + E1: on the G2, Eugene switches to Email on row 0, picks labels, and reads a long newsletter with the
  reader's fonts. In Gmail on the web that thread now shows as read, and no label on it has changed. Coding
  is unchanged. With no `mail` config the bridge offers Coding only. The allowlist tests and both
  private-host refusals pass. `npm test` and the app build pass, the beta is uploaded per policy, and
  `TODOS.md` and the `CLAUDE.md` Current work log are updated.
- Report: what changed, the test count, the beta version, and what was not done and why.
