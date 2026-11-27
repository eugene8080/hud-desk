# HUD Desk: opening it to other users
Updated: 2026-11-27

Eugene asked (2026-11-27): setup for other users (Google), Beeper with only a login (like Chesly),
coding beyond Orca (like Claude Remote), and freemium (self-host free, hosted paid). He thinks the
small user count comes from Orca being niche. Listing stats that day: 51 installs, 41 current,
6 weekly active users.

## Facts checked (2026-11-27)

- **Other users cannot connect at all today.** `app/app.json` whitelists one origin,
  `https://pscap11.tailf91bf7.ts.net:8443` (Eugene's PC). The Even app blocks any other destination
  before the request leaves the WebView. Even Hub's networking docs do not say whether wildcards work
  (not tested). Everyone else gets the demo only. Source: hub.evenrealities.com/docs/build/networking.
- **Gmail.** `gmail.modify` is a restricted scope. A public app needs Google's restricted-scope
  verification, plus a yearly CASA security assessment when mail data is stored on or passes through
  a server. Exceptions: personal use under 100 users, or the app left in Testing. In Testing, consent
  and refresh tokens expire after 7 days. A self-hoster's own Google project published "In production"
  but unverified avoids the 7-day expiry (with an unverified-app warning, 100-user cap).
- **Beeper.** The Beeper Desktop API runs inside Beeper Desktop and needs it running. Remote Access
  exposes it beyond localhost. No hosted cloud API was found. The CLI docs mention a "Beeper Server";
  whether it runs without a desktop session is not confirmed.
- **Even Hub payments.** No public information on paid apps, subscriptions or revenue share was found.
- **Chesly.** Says it hosts everything ("no computer needed"). Its architecture was not checked.
- **Claude Remote** (Even Hub #18). Its own tagline says "Reverse-Engineered Claude /rc Controller".

## Whitelist enforcement in practice (2026-11-27)

RESULT 2026-11-27: Eugene's phone (beta 1.0.93, Android) connected with Bridge address
`https://pscap11.tailf91bf7.ts.net:8444`, which is not in app/app.json ("Connected · PC bridge ·
1682ms", 43 Coding sessions). The app uses the typed address whenever it parses (no fallback to the
built-in one), so the request went to :8444. Limit: only the PORT differed from the whitelisted
origin; a different HOST is covered by the two apps below, not by this test. The first outside
user's PC will be the full proof. Consequence: self-hosters can use their own Tailscale address
(their phone must run Tailscale too); the relay is needed only for phones without Tailscale, the
hosted tier, or if Even starts enforcing the whitelist.

Evidence that the Even app may not enforce the network whitelist, despite its docs:
- Upstream Orca Glass (2ero20ne, published 1.0.0/1.0.1) whitelists only `https://ntfy.sh`, yet its
  app fetches each user's random `https://<name>.trycloudflare.com` tunnel (app/src/pairing.ts at
  upstream 6315d7f).
- Claude Code G2 (Even Hub) asks each user for "your own backend URL and bearer token" (Mac over
  Tailscale), which no build whitelist can list.
Test: beta 1.0.93 adds an optional Bridge address on the phone's Settings; PSCAP11 serves the bridge
on a second tailnet-only address, `https://pscap11.tailf91bf7.ts.net:8444` (`tailscale serve`,
remove with `tailscale serve --https=8444 off`), which is NOT in app/app.json. If Eugene's phone
connects through it, user-typed addresses work and the relay becomes optional (users without
Tailscale, the hosted tier, or a fallback if Even starts enforcing). If blocked, the relay is required.

## Options (agent's recommendation; nothing decided)

1. Let any self-hoster connect. This fixes the whitelist blocker and makes "free self-host" exist.
2. Coding without Orca: plain Claude Code and Codex CLIs. The bridge already reads their transcripts;
   input would go through each CLI's own resume or headless mode (to verify against current CLI docs),
   not reverse-engineered APIs.
3. Email for self-hosters: IMAP with an app password, or the user's own Google project.
4. Hosted paid tier later, after 1-3 show demand. Needs: Google verification + CASA for Gmail,
   hosted chat bridges (privacy, network terms; WhatsApp bans unofficial clients), a payment route
   outside Even Hub unless Even offers one, and a new privacy policy (developer would then hold user data).
