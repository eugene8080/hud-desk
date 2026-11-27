# HUD Desk
## Privacy Policy
Updated 27 November 2026 | Developer: Quiet Signal

HUD Desk was called Orca Glass until 27 November 2026.

### No developer collection of app data
HUD Desk connects your glasses and phone to a companion bridge on a PC you control. Quiet Signal does not receive, collect, store, sell or share your microphone recordings, transcripts, conversations, prompts, emails, chat messages, pictures, session details or account-usage data through the app. The app has no Quiet Signal analytics, advertising or tracking service. Processing on your devices is not collection by Quiet Signal.

### How your data is processed
**Coding.** Session titles, conversation text, activity and available usage information travel from your PC to the app for display. The bridge uses your local Orca sessions and permissions.

**Voice.** When you start voice input, microphone audio travels from the glasses through the Even Realities app to your PC bridge, where Whisper transcribes it. You review the transcript before it is sent; cancelling sends nothing.

**Email.** If you connect a Gmail account, the bridge on your PC reads your mailbox through the Gmail API with the permission you grant (gmail.modify) and stores that authorisation on your PC. Opening a thread marks it read. Archive, delete, star, unread and undo change your mailbox only when you choose them. A message is sent only after you review it and confirm. Pictures in an email open only when you open them; a picture hosted on the sender's server is then fetched from that server by your PC, so the sender may see that it was opened.

**Chat.** If you connect Beeper Desktop, the bridge reads your chats through Beeper Desktop's local API on your PC. Opening an unread chat marks it read. A reply is sent only after you review and confirm it. Voice notes you choose to transcribe are transcribed on your PC; translation and the AI Readout of a picture use a model running on your PC (Ollama).

Microphone access enables voice input. Network access connects to the PC bridge over your Tailscale network. HUD Desk does not request location, push-notification or direct Bluetooth access, and does not track your location. The Even Realities app manages the glasses connection under its own permissions and privacy policy.

### Your devices, accounts and service providers
Your Tailscale connection, Gmail account, Beeper account and any LLM services are configured and controlled under your own accounts. A confirmed instruction may be processed by the LLM provider used by your selected desktop agent; email goes through Google and chat messages through the networks Beeper connects to. This is your use of those services, not Quiet Signal collecting your content and sharing it. Those services and Even Realities have their own policies, retention settings and terms.

### Storage and your controls
Pairing credentials and display preferences are stored through the Even app's local storage. The Gmail authorisation and Beeper token stay on your PC. Audio is buffered for transcription; the bridge does not intentionally save recordings or log transcripts, email or chat content. Orca, your agents, Gmail, Beeper and your PC may retain content and logs according to their own configuration. Quiet Signal has no central copy of this app data to retrieve or erase.

You can stop processing by closing the app or stopping the bridge, revoke microphone access, revoke the Gmail permission in your Google account, revoke the Beeper token in Beeper Desktop, and manage local histories and provider records through their own controls. Uninstalling HUD Desk does not necessarily delete PC histories or records held by your providers.

### Support and privacy enquiries
If you choose to email quietsignal.apps@gmail.com, Quiet Signal receives your email address and whatever you include, through Gmail. This voluntary support correspondence is separate from app operation. We use it to answer your request and keep necessary support records, not for marketing. Do not send credentials or private conversations. You can request access, correction or deletion of support correspondence at the same address, subject to applicable retention requirements. We publish an updated policy when these practices change.

---

## Terms of Use
Updated 27 November 2026 | Developer: Quiet Signal

### Scope and requirements
HUD Desk (formerly Orca Glass) is an independent Windows/Android fork of Orca Glass by 2ero20ne. It is a companion interface for coding agents, email and chats on your PC, not an LLM, email or messaging service. You supply compatible glasses, the Even Realities app, Orca, a configured PC bridge, network connectivity and any required accounts (Gmail, Beeper, providers). Some test builds are restricted to a configured PC and are not a self-service installation for arbitrary PCs.

### Your control and responsibilities
Use only devices, workspaces, accounts, mailboxes, chats and content you are authorised to access. Protect your pairing credentials and review the selected session, message and recipients before sending. Instructions sent to an agent may cause actions on your PC or through your accounts; your agent's permissions and approval settings govern them. You remain responsible for configuring them and for complying with the terms of services you use.

Speech recognition, translation, picture readouts and AI output can be wrong. Review output and proposed actions before relying on them. Features and compatibility may change with updates to the glasses, Even SDK, Orca, Gmail, Beeper or provider tools. No uninterrupted availability or support response time is promised.

### Open-source licence and attribution
The software is distributed under the MIT License. The original copyright notice is Copyright (c) 2026 2ero20ne. Preserve the applicable copyright and licence notices when redistributing copies or substantial portions. Nothing in these terms removes or restricts rights granted by the MIT License, including rights to use, copy, modify and distribute the software. Other components retain their respective licences. Quiet Signal is the name used by this fork's developer; it does not imply endorsement by the original author or Even Realities.

Source and full licence:
https://github.com/eugene8080/hud-desk/tree/windows-android-codex

Original project:
https://github.com/2ero20ne/orca-glass

### Warranty and liability
The software is supplied "as is", under the warranty disclaimer and liability provisions in its MIT License. Nothing in this document excludes rights or liabilities that applicable law does not allow to be excluded.

### Other services and updates
Even Realities, Tailscale, Google, Beeper and any agents or LLM providers you use operate under their own terms. This document does not replace those terms. A revised version will carry a new update date. Updates do not revoke the rights already granted under the MIT License.

### Contact
Quiet Signal | quietsignal.apps@gmail.com
