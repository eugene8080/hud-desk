# Email for self-hosters

Updated: 2026-11-27

HUD Desk's bridge can use Gmail API or IMAP with SMTP. Accounts can mix providers.
The phone and glasses use the same Email module and private bridge routes. Keep
the bridge behind your private HTTPS hostname and include that hostname in
`privateHosts` in `bridge/config.local.json`. Run `npm ci` in the bridge
checkout to install the Node dependencies.

## IMAP and SMTP with an app password

1. Enable IMAP if your provider requires it. Generate an app password with mail
   access. Save only that password on the first line of a UTF-8 text file under
   the checkout's gitignored `.local/` directory, for example
   `.local/my-mail.pass`. Use permissions that let only the bridge user read
   it. On Windows, check the file's inherited NTFS permissions. Google displays
   app passwords in groups. Enter the password without the grouping spaces.
2. Add this `mail` block to `bridge/config.local.json`, or add the account
   to your existing `mail.accounts` array. Use a unique `id` and your own
   address. Both endpoints authenticate as that address unless you set
   `username` on the endpoint. Both require validated TLS.

   ```json
   {
     "mail": {
       "accounts": [{
         "id": "personal",
         "short": "P",
         "provider": "imap",
         "address": "you@example.com",
         "secretFile": ".local/my-mail.pass",
         "imap": { "host": "imap.gmail.com", "port": 993, "tls": "implicit" },
         "smtp": { "host": "smtp.gmail.com", "port": 465, "tls": "implicit" }
       }],
       "windowDays": 30,
       "refreshSeconds": 120
     },
     "privateHosts": ["your-private-bridge.example.com"]
   }
   ```

3. Start your self-hosted bridge with that configuration and select Email in
   HUD Desk. The account status checks IMAP sign-in. SMTP is used on Send.

| Mail service | IMAP | SMTP | Setup |
| --- | --- | --- | --- |
| Gmail | `imap.gmail.com:993`, implicit | `smtp.gmail.com:465`, implicit | Enable 2-Step Verification, then generate an [app password](https://support.google.com/accounts/answer/185833). Keep All Mail and any desired labels visible in IMAP. Google Workspace policy and some Google account security settings can block app passwords. |
| iCloud Mail | `imap.mail.me.com:993`, implicit | `smtp.mail.me.com:587`, starttls | Use an [Apple app-specific password](https://support.apple.com/en-us/102654). If IMAP expects the local part, put it in `imap.username` and keep the full address for SMTP. [Apple server settings](https://support.apple.com/en-us/102525) |
| Fastmail | `imap.fastmail.com:993`, implicit | `smtp.fastmail.com:465`, implicit | Use an app password with mail access and a plan that includes third-party mail clients. [Fastmail server settings](https://www.fastmail.help/hc/en-us/articles/1500000278342-Server-names-and-ports) |

Microsoft lists OAuth 2.0 as required for Outlook.com IMAP and SMTP. This
password-based setup needs a server that accepts password authentication over
TLS. A Microsoft mailbox that requires Modern Auth needs a separate Microsoft
OAuth integration. Outlook used as a desktop client for a supported mailbox
doesn't affect the bridge's setup. [Microsoft server settings](https://support.microsoft.com/en-us/outlook/pop-imap-and-smtp-settings-for-outlook-com)

## Gmail API with your own Google Cloud project

1. In [Google Cloud Console](https://console.cloud.google.com/), create or
   select a project you control. In **APIs & Services → Library**, find
   **Gmail API** and choose **Enable**. [Enable the Gmail API](https://developers.google.com/workspace/guides/enable-apis)
2. In **Google Auth platform → Branding**, enter the app name, support email
   and contact email. In **Audience**, choose **External**. In **Data Access**,
   add `https://www.googleapis.com/auth/gmail.modify`.
   [Configure Google Auth platform](https://developers.google.com/workspace/gmail/api/quickstart/python)
3. Under **Audience**, choose **Publish app** and confirm the status is
   **In production** before authorizing. External projects in **Testing** issue
   refresh tokens for this scope that expire after seven days. An unverified
   production project can be used for a small audience. Google shows an
   unverified-app warning and caps new authorizations at 100 users for the
   project. Workspace policy can still block access. [Publishing and authorization limits](https://support.google.com/cloud/answer/15549945)
4. Go to **Google Auth platform → Clients → Create client** and choose
   **Desktop app**. Download its JSON file to a private location such as
   `.local/my-google-client.json` in your bridge checkout.
   [Create a desktop OAuth client](https://developers.google.com/workspace/guides/create-credentials)
5. Configure the account in `bridge/config.local.json` using the file you just
   downloaded. Keep the client and refresh token files private.

   ```json
   {
     "mail": {
       "accounts": [{
         "id": "personal",
         "short": "P",
         "provider": "gmail-api",
         "address": "you@gmail.com",
         "oauthClientFile": ".local/my-google-client.json",
         "tokenFile": ".local/my-google-token.json"
       }],
       "windowDays": 30,
       "refreshSeconds": 120
     },
     "privateHosts": ["your-private-bridge.example.com"]
   }
   ```

6. From the bridge checkout run
   `node scripts/mail-auth.mjs --account personal --client .local/my-google-client.json`.
   Open the URL the script prints and sign into the configured mailbox. When
   Google's warning appears for the project you just created, choose
   **Advanced**, then the option to continue to your app. Grant the requested
   access. The script verifies the scope and the account address before saving
   the refresh token. Start your self-hosted bridge with the new configuration.

Existing Gmail setups can keep the default provider and the shared
`mail.oauthClientFile`. The account-level file takes precedence. The consent
script also accepts the existing `--account` command without `--client`.
If you change a configured account's provider, reselect its saved labels in
HUD Desk. Each provider uses its own label IDs.

## Behavior and limits

| Feature | Gmail API | Gmail IMAP | Other IMAP servers |
| --- | --- | --- | --- |
| Labels and threads | Gmail labels and canonical thread IDs. Gmail supplies per-label unread-thread counts. | Gmail labels and canonical thread IDs through `X-GM-LABELS` and `X-GM-THRID`. Counts are computed from unseen IMAP messages grouped by thread and label. Only IMAP-visible labels are offered. | Selectable folders act as labels. Threads are grouped by Message-ID, References and In-Reply-To across folders. Counts are unseen threads within each folder. The picker omits Junk, Trash, Drafts and virtual All/Flagged folders. |
| Lists and search | Pages ordered by Gmail, with metadata fetched for visible rows. | `X-GM-RAW` finds recent and unread messages in All Mail. An opened thread includes its older read messages too. Summary counts and labels can miss older read messages that fell outside the metadata scan. | Metadata is scanned across folders to group whole threads, then cached for `refreshSeconds`. Cold lists and actions may take longer on large accounts. Messages without usable threading headers appear separately. |
| Read, unread, star | Gmail label operations. | IMAP `\Seen` and `\Flagged`. | IMAP `\Seen` and `\Flagged` on all copies. |
| Archive, trash and undo | Gmail labels and Trash operations. | Archive removes the Inbox label. Trash moves messages to the server's Trash folder. Undo tries to restore original user labels and Inbox membership from the local journal. | Archive moves Inbox copies to Archive. Trash moves all known copies to Trash. Undo restores original folders using the local journal. Moves need Archive/Trash as applicable and server support for MOVE or UIDPLUS. |
| Compose and pictures | Gmail API sends. Inline and remote images can be opened. | SMTP sends. Inline CID images and linked newsletter pictures can be opened, and full MIME fetches are limited to 25 MiB per message. | Same SMTP and image behavior as Gmail IMAP. |

The thread endpoint for lists also accepts an optional `q` parameter.
Gmail uses Gmail query syntax. Generic IMAP searches message text and headers
in the selected folder using the server's search behavior. The app's existing
label search continues to filter the label picker.

Generic IMAP normally files a copy in the server's Sent folder when available.
Set `saveSent: false` on the account if the SMTP server already files Sent,
or if the bridge should skip filing. Gmail files its SMTP submissions itself.
A Sent append failure leaves the original SMTP result intact.

Undo journals and SMTP send IDs live in the running bridge for ten minutes.
After a restart, restore generic Trash messages in your mail client. An
uncertain SMTP result stays linked to the original send ID during that window.
Check Sent and the intended recipients before starting a new send. A partial
SMTP acceptance also returns a fixed error while preventing a retry with the
same send ID.

Password files stay on the bridge. Mail route logs include path, HTTP status,
count and timing. Protocol logging is disabled. Remote pictures are downloaded
only when opened, through the bridge's existing public-HTTPS image restrictions.
See [bridge routes and UI](email.md).

## Bridge dependencies

- [ImapFlow](https://imapflow.com/docs/guides/searching/) handles TLS, mailbox
  selection, UID operations and Gmail's proprietary search and thread data.
  Per-mailbox UIDVALIDITY checks keep old UIDs from targeting new messages.
- [Nodemailer](https://nodemailer.com/message/custom-source) submits the existing
  RFC 5322 message with an explicit SMTP envelope and required TLS.
- [MailParser](https://nodemailer.com/extras/mailparser) decodes MIME, transfer
  encodings and charsets while preserving CID links for the existing renderer.

These are installed in the bridge checkout. The app bundle has no provider
dependencies.
