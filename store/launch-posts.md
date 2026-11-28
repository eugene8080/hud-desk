# HUD Desk launch posts (drafts)

Updated: 2026-11-27

Drafts for Eugene to post from his own accounts. An agent does not post them. Each post needs
his approval of the final text.

## Before posting

| # | Condition | Status 2026-11-27 | Waits on |
| --- | --- | --- | --- |
| 1 | Even Hub approves 1.0.94. Until then, the public build is 1.0.36, which connects only to Eugene's PC. A stranger who installs it today cannot use it. | In review since 2026-11-27 4:23 PM (portal time) | Even Realities |
| 2 | One-command setup works on a second PC (PSCAP10: also the different-host proof) | Not run | Eugene / agent |
| 3 | The GitHub landing page shows HUD Desk. The default branch is `main` = upstream 6315d7f ("Orca Glass", Mac-only text). Fix: make `windows-android-codex` the default branch, or fast-forward `main` to it (`main` is an ancestor). | Not done | Eugene's yes (repo setting) |
| 4 | A feedback channel exists. GitHub Issues are disabled on eugene8080/hud-desk. | Not done | Eugene's yes (repo setting) |
| 5 | README facts current (Orca optional, IMAP, macOS, 1.0.94) | Fixed 2026-11-27 | - |
| 6 | 30-60 s demo clip recorded from the store fixture (fictional data) | Not recorded | Eugene / agent |

Post the Mac setup as new and not yet tested on a real Mac until someone runs it.

## Rules for every post

- Images and video: only the store fixture (`scripts/store-preview.mjs`, fictional data) or
  `store/screenshots/`. Never a real session, mail, chat or contact.
- Say what is untested: iPhone, and macOS until a Mac user confirms.
- Describe what the app does and how to set it up. Do not discuss Even Hub platform internals
  such as the network whitelist handling in `docs/growth-options.md`. A public post could lead Even
  to change that behaviour, which would break self-hosting.
- Read each subreddit's self-promotion rules and flair before posting. Post in one community per
  day and answer comments the same day.
- Link: https://github.com/eugene8080/hud-desk (after item 3 above, the landing page is correct).

## Order

1. Day 0 (after items 1-4): r/EvenRealities and the Even Realities Discord.
2. Day 1-2: the video on YouTube Shorts and X; link the video in the Reddit thread.
3. Day 3-5: r/ClaudeAI, then r/beeper.
4. After one outside user has set it up: Show HN.
5. Any time after Day 0: the note to Even Realities (section 7).

## 1. r/EvenRealities

Images (gallery, in this order): `store/screenshots/04-coding-list.png`, `01-coding-dense.png`,
`06-voice.png`, `07-email.png`, `15-chat-translate.png`, `09-picture.png`. Add the demo clip when
it exists.

**Title:** I made HUD Desk: my coding agents, email and chats on the G2 (free, runs on your own PC)

**Body:**

> HUD Desk is on Even Hub (it used to be called Orca Glass). It connects the G2 to things running
> on your own Windows PC or Mac. The top row switches between three modules:
>
> - **Coding:** read your Claude Code and Codex sessions while they work. Hold to talk, Whisper
>   transcribes on your PC, you check the text and click to send. Through Orca it also shows Cursor,
>   OpenCode, Pi and Hermes sessions, and usage bars for Codex, Claude and Cursor.
> - **Email:** Gmail or any IMAP account. One mailbox at a time, filter by label, pictures in
>   newsletters. With a Bluetooth keyboard you can reply, archive and star with Gmail's shortcuts.
> - **Chat:** WhatsApp, Signal, Telegram and more through Beeper. Voice notes are transcribed, and
>   a translation shows under each foreign-language line.
>
> Pictures are tuned for the G2's 16 green levels, with zoom and an optional "AI Readout" from a
> local vision model. The reader has pixel fonts down to 5x11 (114 columns), with Chinese and
> Japanese.
>
> Everything runs on your computer. I run no server and there is no account. Your phone connects to
> your PC over your own Tailscale network. Setup is one command on Windows or macOS. The app has a
> demo mode if you just want to look.
>
> Tested with Android and Windows. iPhone is untested, and the Mac setup is new. I'd like to hear
> from anyone who tries either.
>
> Source and setup (MIT, a fork of 2ero20ne's Orca Glass): https://github.com/eugene8080/hud-desk
>
> Feedback and bug reports welcome here or on GitHub.

## 2. Even Realities Discord

Post in the channel the server uses for sharing apps (check the channel list; `even-hub-help` is
for help questions). Attach `04-coding-list.png`, `07-email.png` and `15-chat-translate.png`.

> **HUD Desk** (formerly Orca Glass) is on Even Hub: coding agents (Claude Code, Codex, and more
> through Orca), email (Gmail or IMAP) and Beeper chats on the G2. Hold to talk with local Whisper,
> Bluetooth keyboard shortcuts, pictures tuned for the display, pixel fonts down to 114 columns.
> Everything runs on your own PC or Mac over Tailscale; nothing is hosted. Free and open source.
> Setup: https://github.com/eugene8080/hud-desk
> iPhone untested. If you try it, tell me what broke.

## 3. r/ClaudeAI

Check the subreddit's flair for projects (for example "Built with Claude") before posting.
Images: `01-coding-dense.png`, `06-voice.png`, `11-usage.png`.

**Title:** Reading and answering my Claude Code sessions from smart glasses

**Body:**

> I use Claude Code a lot and wanted to follow long sessions away from the desk. HUD Desk is a free
> app for Even Realities G2 glasses that lists your Claude Code (and Codex) sessions from your own
> computer and shows each one as a book-style reader, with the model, a thinking animation and a
> timer in the status row.
>
> To answer, you press and hold, speak, and Whisper transcribes on your PC. You read the text on
> the glasses and click to send. The bridge sends it with the official CLI
> (`claude -p --resume <session>`), in the session's own folder, with your normal permissions. It
> never answers on its own. With Orca it also shows Claude, Codex and Cursor usage as bars.
>
> It runs entirely on your machine over Tailscale. No server, no account. Setup is one command on
> Windows or macOS. Most of the code was written by Claude Code and Codex agents, with me
> reviewing on the glasses.
>
> https://github.com/eugene8080/hud-desk (MIT)

## 4. r/beeper

Images: `14-chat-networks.png`, `13-chat.png`, `15-chat-translate.png`.

**Title:** All my Beeper chats on smart glasses, with voice notes transcribed and translated

**Body:**

> I built HUD Desk, a free app for Even Realities G2 glasses. Its Chat module reads Beeper Desktop's
> local API on your own PC: WhatsApp, Signal, Telegram and the rest in one list, filtered by network,
> with the day and the app on each row.
>
> Voice notes are transcribed on your PC (I tuned it for Cantonese), and a translation shows under
> each foreign-language line, using a local Ollama model. Photos open on the glasses. Replies are
> by voice, and you review each one before it goes. Opening a chat marks it read.
>
> Nothing goes through a server of mine. Beeper Desktop must run on the PC, with an access token
> you create in Settings > Developers. Setup: https://github.com/eugene8080/hud-desk

## 5. Show HN

Post only after an outside user has set it up (HN readers will try it).

**Title:** Show HN: HUD Desk – Claude Code, email and chats on Even Realities G2 glasses

**Text:**

> HUD Desk is an app for the Even Realities G2 (a monochrome green HUD in normal-looking glasses).
> It shows coding-agent sessions, email and chats from your own computer. Everything runs locally:
> a Node bridge on your PC or Mac, Tailscale Serve for a private HTTPS address, and the app in the
> Even phone app's WebView. I run no server.
>
> Some details:
>
> - The display is 576x288 with 16 green levels. An app gets at most four image containers of
>   288x144, so the small-text reader draws pixel fonts (Scientifica 5x11 gives 114 columns, with
>   a CJK table from Fusion Pixel) into those four tiles. It repaints only tiles that changed.
> - Replies to Claude Code and Codex go through the official CLIs
>   (`claude -p --resume`, `codex exec resume`). You review each transcribed reply before it is
>   sent. Speech is local whisper.cpp with VAD.
> - Email is Gmail's API or plain IMAP/SMTP. Chats come from Beeper Desktop's local API. Voice notes
>   are transcribed with FunASR and translated line by line with a local Ollama model.
> - Pictures: charts get flat tones; photos get gamma, thin Sobel edges and ordered dithering to
>   stay readable in 16 levels.
>
> Setup is one command on Windows or macOS (the Mac script is new). It is a fork of 2ero20ne's Orca
> Glass, under MIT. Most of the code was written by Claude Code and Codex agents that I directed and
> reviewed.
>
> https://github.com/eugene8080/hud-desk

## 6. X / Bluesky / Threads

> My coding agents, inbox and chats, on my glasses.
> HUD Desk for Even Realities G2: Claude Code and Codex sessions, Gmail/IMAP, WhatsApp/Signal/
> Telegram via Beeper. Hold to talk, local Whisper. Runs on your own PC. Free, open source.
> https://github.com/eugene8080/hud-desk
> [attach the demo clip]

## 7. Note to Even Realities

Send through the developer portal's contact route or the Discord, whichever Even names for
developer relations.

> Hi Even team, I'm the developer of HUD Desk (com.eugene8080.orcaglass, formerly Orca Glass).
> 1.0.94 adds Email, Chat (Beeper), pictures and self-hosting on Windows and macOS. If you feature
> community apps in a newsletter, blog or the Hub, I'd be glad to supply a short clip and
> screenshots. Thanks for the SDK.

## 8. Demo video (45 s, vertical 9:16 for Shorts, or 16:9 with the display centred)

Source: record the glasses view from the official simulator running the store fixture
(`scripts/store-preview.mjs` on port 8792; simulator started with `--automation-port 9899`). All
data is fictional. Optional real shots: Eugene wearing the G2, the Bluetooth keyboard, the phone.
Burn in captions (most viewers watch muted).

| Time | Shot | Caption | Voiceover |
| --- | --- | --- | --- |
| 0:00-0:03 | Wearing the G2 (real), cut to the Coding list with the moving dot (`04-coding-list`) | My agents, inbox and chats. On my glasses. | "These are my coding agents, my inbox and my chats, on my glasses." |
| 0:03-0:13 | Open the Opus session: thinking bars and Braille spinner (`01-coding-dense`); hold, the transcript appears (`06-voice`); click send | Hold to talk. Whisper runs on my PC. | "Claude Code and Codex sessions, live. I hold to talk, Whisper transcribes on my own PC, I check the text, and click to send." |
| 0:13-0:21 | Email list (`07-email`), open the newsletter with pictures (`08-email-pictures`); keyboard B-roll | Gmail or any IMAP account | "Email: Gmail or any IMAP account, pictures included. With a Bluetooth keyboard I reply with Gmail's shortcuts." |
| 0:21-0:31 | Filter by Network (`14-chat-networks`), translated chat (`15-chat-translate`), a photo (`09-picture`) | WhatsApp, Signal, Telegram via Beeper | "Chats from WhatsApp, Signal and Telegram through Beeper. Voice notes are transcribed, and English appears under each line." |
| 0:31-0:38 | Compare fonts (`18-compare-fonts`), Scientifica on Tube (`01-coding-dense`) | 114 columns in a 5x11 pixel font | "Pixel fonts fit 114 columns on the display, Chinese and Japanese too." |
| 0:38-0:45 | Architecture map (`02-architecture`), then the [>_] icon and the name | Runs on your PC · Free on Even Hub · Open source | "Everything runs on your own computer. HUD Desk: free on Even Hub, open source on GitHub." |

Voiceover: about 100 words, about 2.2 words a second.

**YouTube title:** HUD Desk: Claude Code, email and chats on Even Realities G2 glasses

**Description:** HUD Desk is a free, open-source app for Even Realities G2. Coding agents (Claude
Code, Codex, Orca), email (Gmail or IMAP) and Beeper chats, all from your own PC or Mac over
Tailscale. Setup: https://github.com/eugene8080/hud-desk
