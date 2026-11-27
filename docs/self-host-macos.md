# Self-host HUD Desk on macOS

Updated: 2026-11-27

Your Mac runs the HUD Desk bridge. Tailscale Serve gives it a private HTTPS
address on your tailnet. Your phone uses that address and a pairing code.

## Requirements

- An Apple silicon or Intel Mac with a macOS version supported by your
  [Tailscale client](https://tailscale.com/docs/install/mac) and
  [Homebrew](https://docs.brew.sh/Installation).
- Git to clone the repository. On a new Mac, accept the macOS Command Line
  Tools prompt if `git clone` opens it.
- Homebrew, Node.js 22 or later with npm, and Tailscale on the Mac. Setup
  asks before installing anything missing. An existing Tailscale CLI or App
  Store installation works.
- A phone with Tailscale and a version of HUD Desk in the Even Realities app
  that accepts `eho3` pairing codes.

## Set up the Mac

In Terminal, run the following in a directory where you want to keep the
checkout. If you already cloned it, run `bash scripts/setup-macos.sh` there.

```bash
git clone --branch windows-android-codex https://github.com/eugene8080/hud-desk.git && cd hud-desk && bash scripts/setup-macos.sh
```

If setup installs Tailscale or reports a disconnected client, open Tailscale,
approve the VPN configuration and sign in. Rerun `bash scripts/setup-macos.sh`
from the checkout. If Tailscale asks you to enable HTTPS for your tailnet, open
its approval link. The tailnet also needs
[MagicDNS and HTTPS certificates](https://tailscale.com/docs/how-to/set-up-https-certificates).

Setup preserves your settings in `bridge/config.local.json` and sets
`publicOrigin` to the chosen Tailscale address. The LaunchAgent starts the
bridge at login. Keep the checkout in the same directory and leave your Mac
awake and connected to Tailscale when you want to use HUD Desk.

Use `bash scripts/setup-macos.sh --dry-run` to preview the steps. Add
`--voice` to set up local voice transcription. The optional
[Email](email-providers.md) and [Chat](chat.md) guides cover account setup.

## Pair the phone

1. On your phone, open Tailscale, connect to the same tailnet as the Mac and
   approve the VPN configuration if prompted.
2. In the Even Realities app, open HUD Desk. On **Home**, tap the connection bar
   to open **Settings**.
3. Paste the `eho3` pairing code into **Pairing code** and save. If the Mac and
   phone do not share a clipboard, transfer the code privately. It grants
   access to the bridge. Run `npm run pair` in the checkout to get it again.
4. Check that HUD Desk shows a connected bridge.

## Troubleshooting

- **Tailscale app or CLI.** With the Mac App Store version, run
  `/Applications/Tailscale.app/Contents/MacOS/Tailscale status --json`. If you
  installed the standalone app, you can also enable its CLI integration in
  Tailscale Settings. For a CLI-only install, start `tailscaled` and run
  `tailscale up` as required by your installation. [Tailscale CLI on macOS](https://tailscale.com/docs/reference/tailscale-cli?tab=macos)
- **macOS permissions or login startup.** Run setup from Terminal in your
  signed-in graphical session, without `sudo`. Approve Tailscale's VPN or
  system-extension request in System Settings. If the checkout is in a
  protected folder and the LaunchAgent cannot read it, move the checkout to
  an ordinary folder such as `~/dev/hud-desk` and rerun setup. Check
  `bash scripts/install-macos-startup.sh status`, `.local/startup.log`,
  `.local/launchd-error.log` and `.local/custom-error.log`.
- **Port busy.** Setup tries HTTPS ports `8443`, `8444` and `10000`, or
  reuses an existing private mapping to this bridge. It skips ports used by
  other services. Inspect `tailscale serve status` and free one of those
  ports if all three are busy. The local bridge needs `127.0.0.1:8787`.
  Use `lsof -nP -iTCP:8787 -sTCP:LISTEN` to identify a conflicting process.
- **Local health passes but tailnet health fails.** Check that both devices
  are connected to the same tailnet and that your tailnet policy permits the
  phone to reach the Mac on the chosen HTTPS port. Open the setup address
  with `/healthz` on the phone. A healthy bridge returns `{"ok":true}`.

The setup script has been checked with stubbed commands on Windows. A
run on Mac hardware and pairing a phone to that Mac remain to be verified.
