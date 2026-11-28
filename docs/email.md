# Email module (E1): bridge setup, routes and glasses UI

Updated: 2026-11-26

## Bridge setup

For IMAP/SMTP or a Gmail API account using your own Google Cloud project, see
[Email for self-hosters](email-providers.md).

Add the following keys to the existing gitignored `bridge/config.local.json` in the checkout that runs the bridge. Fill the private values from the checkout's local setup notes. Use the existing installed-app OAuth client and mint an Orca Glass token for the chosen mailbox.

```json
{
  "mail": {
    "oauthClientFile": "<path to installed-app OAuth client JSON>",
    "accounts": [
      {
        "id": "work",
        "short": "W",
        "address": "<configured Gmail address>",
        "tokenFile": ".local/mail/work.json"
      }
    ],
    "windowDays": 30,
    "refreshSeconds": 120
  },
  "privateHosts": ["<Tailscale Serve DNS hostname>"]
}
```

Run the one-time consent command from the bridge checkout.

```powershell
node scripts/mail-auth.mjs --account work
```

Open the consent URL printed in the terminal and sign in to the configured mailbox. The script uses PKCE, validates the state on a random loopback port, and checks both the granted `gmail.modify` scope and the Gmail profile address. It saves a refresh token under the gitignored `.local/` tree with creation mode `0600`. On Windows the directory's inherited NTFS permissions govern access. The access token stays in process memory.

## Bridge routes

| Request | Response |
| --- | --- |
| `GET /api/capabilities` | Voice support and `modules`. Coding is always listed. A valid mail block adds Email. |
| `GET /api/mail/accounts` | Account aliases and connection status. |
| `GET /api/mail/labels?account=work` | Inbox first, then user labels by name. Counts come from Gmail's `threadsUnread`. |
| `GET /api/mail/threads?filter=work:INBOX,work:Label_123&page=0&size=8` | Union of the chosen labels, deduplicated by account and thread. Includes newest-first summaries, `hasMore`, and the total unread in the configured window. Pages start at 0 and sizes default to 8 and cap at 20. |
| `GET /api/mail/thread?account=work&id=<thread-id>` | Thread subject and cleaned plain-text messages, oldest first. This operation only reads. |
| `POST /api/mail/read` with `{"account":"work","threadId":"<thread-id>"}` | Clears UNREAD on the entire thread and returns `{"ok":true}`. Repeating the operation is safe. |
| `POST /api/mail/modify` with account, threadId and action | Mark read or unread, star or unstar, archive or restore, and trash or restore. |
| `GET /api/mail/compose?account=work&id=<thread-id>&mode=reply` | Prefills recipients and subject for reply, replyAll or forward. |
| `POST /api/mail/send` with account, mode, sendId, to, cc, subject and body | Sends a new message or uses threadId to quote an original. |
| `GET /api/mail/image?account=work&message=<message-id>&part=<part-id>` | Renders one image. Use remote instead of part for an HTML picture index. |

The bridge uses paged Gmail thread ID lists for label membership, ordering and unread totals. It loads From, Subject and Date metadata only for the visible E1 page and fetches bodies on explicit open. When configured for multiple accounts, it also reads dates for candidates to merge mailbox orderings. The per-account snapshots refresh in the background after first use. A cold list waits up to about three seconds before returning cached results. A successful mark-read clears the unread flag and count in memory immediately.

## Allowed Gmail operations

All paths are relative to Gmail's `/gmail/v1/users/me`.

- GET `/profile`, `/labels`, `/labels/{id}`, `/threads`, `/threads/{id}`, `/messages/{id}`, and `/messages/{id}/attachments/{id}`.
- POST `/threads/{id}/modify` with a single addition or removal of UNREAD, INBOX or STARRED.
- POST `/threads/{id}/trash`, `/threads/{id}/untrash` and `/messages/send` with their allowlisted payloads.

The client rejects any other method, path or mutation body before credential refresh or transport. The granted Google scope permits broader changes, so the bridge enforces this narrower list at the client boundary.

## Private routing and data handling

The mail routes require the bridge bearer token. A request carrying either `cf-ray` or `cf-connecting-ip`, or whose Host is absent from `privateHosts`, gets HTTP 403 with `{"error":"private-route"}`. Host matching ignores case and the port. The browser's unauthenticated CORS preflight also passes through the private-host check.

The installed Tailscale version checked on 2026-11-26 was 1.104.7. Its HTTP reverse proxy to `127.0.0.1:8787` forwards the client's original Host header. The source sets `r.Out.Host = r.In.Host` for HTTP proxy backends reached through TCP. Configure the hostname in the private HTTPS URL clients use for Serve. [Tailscale v1.104.7 reverse proxy source](https://github.com/tailscale/tailscale/blob/v1.104.7/ipn/ipnlocal/serve.go#L923-L942)

Mail response caching is disabled for HTTP clients. Bridge logs record the fixed route, status, count and elapsed time. Returned errors use fixed codes. Keep mailbox addresses, labels, message contents, tokens and private hostnames out of tracked files and diagnostics. Use synthetic mail for fixtures and previews.

## Status

- 2026-11-26. `npm test` passed all 174 tests and `npm --prefix app run build` succeeded. Synthetic tests cover both private-host refusals, Gmail's request allowlist and retry behavior, MIME conversion, capability discovery, paging, and mark-read cache updates.
- 2026-11-26. Production bridge and tunnel were left running. Google consent, live mailbox checks, and beta delivery are outside this bridge implementation pass.

## Glasses UI

When the bridge offers Email, select row 0 and click to switch modules. The
name changes immediately. After 400 ms without another click, a previously
shown list appears from its cached rows and refreshes in place, keeping the
cursor on the same row while it exists. The right edge shows the unread thread count for the
selected labels. The next row opens the label picker. It defaults to Inbox,
shows each account with the unread counts for its labels, and saves multiple
selections. Done returns to the list.

When voice is available, hold in the label picker and speak. The voice page
shows a live caption. Release to apply the search and return to the picker.
Every spoken word must match the label name. Case and punctuation are ignored,
numbered labels can be found by name alone, and number words one through
twenty match the corresponding digits. Hold again to replace the search.
Double-click clears an active search or returns to the list from the full picker.

Each page holds up to eight threads, newest first. An asterisk marks an unread
thread. Dates use the phone's local clock and show the time for today's mail.
Refresh reloads the list. Open a thread to start at the top of the newest
message, which starts its own page; a one-message mail opens on page 1.
Earlier messages page forward from the top. (Betas 1.0.98-1.0.99 gave Email
Chat's fill-from-the-newest-row paging, so a one-message mail opened on its
last page; Eugene, 2026-11-28. 1.0.100 restores forward paging for Email only.)
Swipe up for earlier pages and down for later pages. The reader menu
offers Font and App Brightness. Double-click returns to the list.

Once the opening page displays, the app requests mark-read for an unread
thread. If that request fails, the reader shows `not marked read` and the next
open retries while the thread is still unread. The transport makes one POST
per attempt, including after a disconnect.

On 2026-11-26, the official Even simulator used the synthetic fixture on port
8796 and its automation API on port 9906. Automation verified the list and
label picker, newest message at the top of the opening page, swipes to pages
1 and 2, the two reader menu items, and a synthetic unread count dropping by
one. The PNG captures under `.local/super-app-ui/` returned solid green. The
same directory holds the automation call logs. Eugene confirmed the beta
1.0.60 layout and live mark-read on the G2 on 2026-11-26.

The 2026-11-26 follow-up passed 185 tests and the app build. Synthetic Even
simulator automation exercised hold, live caption, release, search replacement,
no matches and clearing the search. The glasses PNG returned solid green.
Physical G2 verification of the follow-up is pending.

The switch timings below use the simulator WebView's monotonic clock and a
fixture configured to wait 200 ms on each module list request. The render
column measures the native rebuild request through its acknowledgement. The
visible column runs from the row-0 name update through that acknowledgement.

| Warm switch | Settle | Fetch | Render | Visible |
| --- | ---: | ---: | ---: | ---: |
| Coding before | 611–612 ms | 218–219 ms | 1–2 ms | 831–834 ms |
| Coding after | 408–415 ms | 214–217 ms after render | 2–4 ms | 411–418 ms |
| Email before | 609 ms | 205 ms | 2 ms | 819 ms |
| Email after | 406 ms | 220 ms after render | 2 ms | 409 ms |

An uncached Email switch after the change measured 402 ms to start the fetch,
217 ms fetching, 2 ms rendering and 623 ms from name update to acknowledgement.
Unchanged refreshed rows required no native text update. Regression tests
exercise changed rows and verify that their text updates without a rebuild or
cursor move. Raw timings are in `.local/super-app-ui/module-before.json` and
`.local/super-app-ui/module-after.json`.

## Phone page

Home in the Even app has a module switch populated from bridge capabilities.
Switching on the phone redraws the glasses without the row-0 settle delay.
Switching on the glasses updates the phone selection. Both use the same saved
module.

In Email, **Filter by Label** shows account headings, unread counts and label
checkboxes. Type in **Search labels** to narrow the list, then check or clear
labels. The phone and glasses share the same picks. Coding shows its agent,
workspace and usage controls.

On 2026-11-26, the isolated phone preview at port 8806 showed both modules,
shared checkbox persistence, and label search at a 390 px viewport. The
preview screenshot is `.local/super-app-ui/phone-email-labels.png`.
