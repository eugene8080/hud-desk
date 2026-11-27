# Chat module

## Setup

Keep Beeper Desktop running on the bridge PC. In **Beeper Settings → Developers**, create an access token for Orca Glass and save the token as plain text in `.local/beeper-token.txt` in the bridge checkout. Use a dedicated token. Beeper Remote Access can stay off because the bridge connects to `http://127.0.0.1:23373`. [Beeper Desktop API](https://developers.beeper.com/desktop-api/)

Add these keys to the bridge checkout's gitignored `bridge/config.local.json`. If `privateHosts` already exists for Email, keep its allowed Tailscale Serve hostname.

```json
{
  "beeper": {
    "tokenFile": ".local/beeper-token.txt",
    "refreshSeconds": 120
  },
  "privateHosts": ["<Tailscale Serve hostname>"]
}
```

An empty `beeper` object uses both defaults. Keep the token file under the gitignored `.local/` directory and restrict access using its file permissions. The bridge reads the config at startup and loads the token from the file when calling Beeper.

## Use

Click row 0 to cycle through the offered modules or select **Chat** on the phone. The first row below it opens **Filter by Network**. Network checkboxes on the phone and the glasses share the same saved selection. The glasses show up to eight chats per page in activity order, with `/` for unread and `-` for read. The count covers the selected networks.

The reader starts at the beginning of the newest message. Swipe up for earlier pages and swipe down on the last page to refresh. Your messages begin with `/ ` and incoming messages begin with `> ` and the sender name. Opening a chat does not mark it read in Beeper.

Hold to dictate using local Whisper. Release to review the text, click to send, or double-click to cancel. The reader shows `sent` when Beeper accepts the submission and assigns a pending message ID. It shows `not sent` when the app receives no success response. A disconnect can hide an accepted send, so refresh the chat to check before submitting again. Neither the app nor the bridge automatically replays a send. [Beeper send response](https://developers.beeper.com/desktop-api-reference/resources/messages/methods/send/)

## Bridge routes

| Request | Response |
| --- | --- |
| `GET /api/capabilities` | Adds `chat` to `modules` when the Beeper block is configured. |
| `GET /api/chat/networks` | Sorted network names from Beeper accounts. |
| `GET /api/chat/list?networks=&page=0` | `{ items, unread, hasMore }` with eight chats per page. Pass comma-separated network names or leave the filter empty for all networks. |
| `GET /api/chat/messages?id=<chat-id>` | `{ messages }` with the latest Beeper message batch in chronological order. |
| `POST /api/chat/send` with `{"chatId":"<chat-id>","text":"<reply>"}` | `{"ok":true}` after Beeper accepts one text message. |

The Chat routes require the bridge bearer token and an allowed private Host. Cloudflare headers cause a 403, including on CORS preflights. Responses use `Cache-Control: no-store`. The bridge keeps account and chat list snapshots in memory, refreshes them in the background, and waits up to about three seconds for a cold list before serving available rows. The unread count can be partial during initial loading. Transient upstream read failures use bounded retries with back-off. Bridge logs include the route, status, count and elapsed time.

## Beeper allowlist and beta limits

The bridge permits `GET /v1/accounts`, `GET /v1/chats`, and `GET` or `POST /v1/chats/{chatID}/messages`. The POST accepts only a non-empty `text` field. Other operations fail before reaching Beeper. [Beeper Desktop API reference](https://developers.beeper.com/desktop-api-reference/)

The reader displays text from Beeper's latest message batch. Older server-side history, attachments, quoted-message replies, editing, and read-state changes are outside this beta. Chats Beeper marks read-only show the reader without voice reply.

The test suite and Even simulator fixture use synthetic Beeper data.
