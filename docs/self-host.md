# Self-host HUD Desk

Updated: 2026-11-27

The Node bridge and your agents run on your PC. The HUD Desk app runs inside
Even Realities on your phone and displays sessions on your G2. Tailscale Serve
connects the phone to the PC over your private tailnet. All HUD Desk services
run on your PC. No hosted HUD Desk bridge or public Funnel is needed.

## Windows setup

Use Windows 11 with WinGet (Microsoft App Installer), a Tailscale account and
internet access for installation. Setup checks Git, Node.js 22+ and Tailscale
and asks before installing any missing prerequisite. For Coding, use Orca or
[Claude Code or Codex CLI sessions](local-agents.md). For local voice input,
use Windows x64 and add `-Voice` at the end of the setup command.

In **Windows PowerShell as Administrator**, run this line from the parent
folder where you want to keep the bridge. The first clause installs Git with
your approval if needed. The rest clones the self-host branch and runs setup.

```powershell
$git = (Get-Command git.exe -ErrorAction SilentlyContinue).Source; if (-not $git) { $git = Join-Path $env:ProgramFiles 'Git/cmd/git.exe'; if (-not (Test-Path -LiteralPath $git)) { if ((Read-Host 'Install Git with WinGet? [y/N]') -notmatch '^y(es)?$') { throw 'Git is required to clone HUD Desk.' }; winget install --id Git.Git --exact --source winget --accept-package-agreements --accept-source-agreements; if ($LASTEXITCODE -ne 0) { throw 'Git installation failed.' } } }; & $git clone --branch windows-android-codex https://github.com/eugene8080/hud-desk.git; if ($LASTEXITCODE -eq 0) { powershell.exe -NoProfile -ExecutionPolicy Bypass -File hud-desk/scripts/setup-windows.ps1 }
```

If Tailscale needs you to sign in, do that from its system tray icon. For a
rerun, open PowerShell as Administrator **in the existing clone** and use
`powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/setup-windows.ps1`.
Add `-DryRun` to this rerun command to preview the steps. Keep the clone in
place because the **HUD Desk Bridge** scheduled task starts it from that folder
when you sign in to Windows.

## Connect your phone

1. Install Tailscale on the phone and connect using the same account as the PC.
2. In the Even Realities app, pair your G2, install HUD Desk from Even Hub and
   open a build that supports address-carrying pairing codes (`eho3`).
3. Transfer the setup's pairing code privately to your phone. Open HUD Desk's
   connection form and paste the code. Check the address shown under the code.
   Leave **Bridge address** blank to use it, then tap **Save**.

The pairing code grants access to your bridge. Keep it private. To show it
again, run `npm run pair` in the clone. Your PC must be awake and signed in
when you use HUD Desk.

## Optional modules

- [Email setup](email-providers.md) covers Gmail and IMAP/SMTP providers.
- [Chat setup](chat.md) covers Beeper Desktop and its local API.

## Troubleshooting

- **Tailscale is logged out on the PC.** Sign in from the tray icon, connect and
  rerun setup. Enable MagicDNS and HTTPS certificates for your tailnet if needed.
  Follow any enablement prompt from Tailscale Serve. [Tailscale HTTPS guide](https://tailscale.com/docs/how-to/set-up-https-certificates)
- **The phone cannot connect.** Connect Tailscale on the phone, confirm both
  devices are in the same tailnet, and clear any saved **Bridge address** that
  overrides the code. Open the code's address plus `/healthz` on the phone.
  It should return `{"ok":true}`.
- **A port is busy.** The bridge needs local port 8787. Setup reuses a matching
  private Serve mapping or tries 8443, 8444 and 10000 for a new one. If all three
  are occupied, free one of those Serve ports before rerunning. Use
  `tailscale serve status` to see existing mappings.
- **The local health check fails.** Check the **HUD Desk Bridge** task in Task
  Scheduler and the logs in `.local/startup.log` and `.local/custom-error.log`.

## macOS

See [self-host setup for macOS](self-host-macos.md).
