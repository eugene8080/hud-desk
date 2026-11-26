## Glasses UI

2026-11-26, unreleased. When the bridge offers Email, select row 0, click and
wait for the list to load. The right edge shows the unread thread count for the
selected labels. The next row opens the label picker. It defaults to Inbox,
shows each account with the unread counts for its labels, and saves multiple
selections. Done and double-click return to the list.

Each page holds up to eight threads, newest first. An asterisk marks an unread
thread. Dates use the phone's local clock and show the time for today's mail.
Refresh reloads the list. Open a thread to start at the top of the newest
message. Swipe up for earlier pages and down for later pages. The reader menu
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
same directory holds the automation call logs. 168 tests passed and the app
build succeeded. Live mailbox and physical G2 verification remain pending.
