#!/usr/bin/env bash
# Set up the local HUD Desk bridge and its tailnet-only HTTPS address.
set -euo pipefail

DRY_RUN=0
VOICE=0
usage() { printf 'Usage: bash scripts/setup-macos.sh [--voice] [--dry-run]\n'; }
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --voice) VOICE=1 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
  shift
done

say() { printf '%s\n' "$*"; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
confirm() {
  local answer
  [ "$DRY_RUN" -eq 0 ] || return 0
  read -r -p "$1 [y/N] " answer || die "Run setup in a Terminal to approve installation."
  case "$answer" in y|Y|yes|Yes|YES) ;; *) die "Installation declined." ;; esac
}

step() {
  local description="$1" output
  shift
  if [ "$DRY_RUN" -eq 1 ]; then
    say "Dry run: $description"
  elif output=$("$@" 2>&1); then
    say "OK: $description"
  else
    printf '%s\n' "$output" >&2
    die "$description failed."
  fi
}

[ "$(uname -s)" = Darwin ] || die "Run this setup on macOS."
[ "$EUID" -ne 0 ] || die "Run setup as your signed-in macOS user, without sudo."
cd "$(dirname "$0")/.."
export TAILSCALE_BE_CLI=1
CONFIG=bridge/config.local.json
TARGET=http://127.0.0.1:8787
APP_CLI=/Applications/Tailscale.app/Contents/MacOS/Tailscale

find_brew() {
  BREW=$(command -v brew || true)
  if [ -z "$BREW" ]; then
    for candidate in /opt/homebrew/bin/brew /usr/local/bin/brew; do
      if [ -x "$candidate" ]; then BREW=$candidate; break; fi
    done
  fi
  if [ -n "$BREW" ]; then export PATH="$PATH:${BREW%/*}"; fi
}

find_brew
if [ -z "$BREW" ]; then
  if [ "$DRY_RUN" -eq 1 ]; then
    say "Dry run: install Homebrew after approval."
  else
    confirm "Install Homebrew using its official installer?"
    installer=$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)
    /bin/bash -c "$installer"
    find_brew
    [ -n "$BREW" ] || die "Homebrew was not found after installation."
    say "Homebrew installed."
  fi
else
  say "Homebrew available."
fi

node_ready() {
  command -v npm >/dev/null 2>&1 &&
    node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' 2>/dev/null
}
if ! node_ready && [ -n "$BREW" ] && [ -x "${BREW%/*}/node" ]; then
  # Use a compatible Homebrew Node that was previously shadowed on PATH.
  if "${BREW%/*}/node" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
    export PATH="${BREW%/*}:$PATH"
  fi
fi
if ! node_ready; then
  confirm "Install current Node.js and npm with Homebrew?"
  step "Install Node.js and npm (brew install node)" "${BREW:-brew}" install node
  if [ "$DRY_RUN" -eq 0 ]; then
    export PATH="${BREW%/*}:$PATH"
    hash -r
    node_ready || die "Put Node.js 22 or later and its npm on PATH, then rerun setup."
  fi
else
  say "Node.js $(node --version) and npm available."
fi

if command -v git >/dev/null 2>&1; then
  say "Git available."
else
  confirm "Install Git with Homebrew?"
  step "Install Git (brew install git)" "${BREW:-brew}" install git
fi

if ! command -v tailscale >/dev/null 2>&1 && [ ! -x "$APP_CLI" ]; then
  confirm "Install the Tailscale app with Homebrew?"
  # The cask can show a macOS authentication or VPN approval prompt.
  if [ "$DRY_RUN" -eq 1 ]; then
    say "Dry run: install Tailscale (brew install --cask tailscale-app)."
  else
    "$BREW" install --cask tailscale-app
    say "Tailscale installed."
  fi
else
  say "Tailscale available."
fi

find_tailnet() {
  local cli status result path_cli
  path_cli=$(command -v tailscale || true)
  # If two variants are installed, use the first CLI connected to a tailnet.
  for cli in "$APP_CLI" "$path_cli"; do
    [ -n "$cli" ] && [ -x "$cli" ] || continue
    if ! status=$("$cli" status --json 2>/dev/null); then continue; fi
    if result=$(node -e '
      const fs = require("node:fs");
      const status = JSON.parse(fs.readFileSync(0, "utf8"));
      if (status.BackendState !== "Running") process.exit(1);
      const host = status.Self?.DNSName?.replace(/\.$/, "").toLowerCase() ?? "";
      if (status.CurrentTailnet?.MagicDNSEnabled === false ||
          !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.){2,}ts\.net$/.test(host)) process.exit(2);
      console.log(host);
    ' <<<"$status"); then
      TAILSCALE=$cli
      DNS_NAME=$result
      return 0
    elif [ "$?" -eq 2 ]; then
      die "Enable MagicDNS in the Tailscale admin console, then rerun setup."
    fi
  done
  die "Tailscale is not connected. Open Tailscale and sign in, or start tailscaled and run tailscale up for a CLI-only install, then rerun setup."
}

TAILSCALE=
DNS_NAME='<mac>.<tailnet>.ts.net'
if node_ready && { command -v tailscale >/dev/null 2>&1 || [ -x "$APP_CLI" ]; }; then
  find_tailnet
  say "Tailscale connected as $DNS_NAME."
else
  [ "$DRY_RUN" -eq 1 ] || die "The Tailscale CLI was not found. Check the installation and rerun setup."
  say "Dry run: verify Tailscale sign-in and read its MagicDNS name after prerequisites are installed."
fi
if node_ready; then
  node scripts/setup-macos-config.mjs "$CONFIG"
fi

confirm "Install HUD Desk dependencies and its login LaunchAgent?"
step "Install bridge dependencies (npm ci)" npm ci
step "Install app dependencies (npm ci --prefix app)" npm ci --prefix app
step "Build the app (npm --prefix app run build)" npm --prefix app run build

if [ "$VOICE" -eq 1 ]; then
  confirm "Install the optional local voice binaries and models?"
  step "Install voice (bash scripts/setup-voice.sh)" bash scripts/setup-voice.sh
fi

check_local_port() {
  local listeners pid cwd args
  listeners=$(lsof -nP -t -iTCP:8787 -sTCP:LISTEN 2>/dev/null) || return 0
  while IFS= read -r pid; do
    # Allow a rerun if the listener is this checkout's running bridge.
    cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
    args=$(ps -p "$pid" -o args=)
    if [ "$cwd" != "$(pwd -P)" ] || [[ "$args" != *' bridge/server.mjs' ]]; then
      die "Local port 8787 is in use by another process. Free it before running setup."
    fi
  done <<<"$listeners"
}

step "Check that local port 8787 is available to HUD Desk" check_local_port

select_serve_port() {
  local status ports mode port
  status=$("$TAILSCALE" serve status --json) || die "Could not read Tailscale Serve mappings."
  ports=$(node -e '
    const fs = require("node:fs");
    const [host, target] = process.argv.slice(1);
    const config = JSON.parse(fs.readFileSync(0, "utf8")) ?? {};
    if (typeof config !== "object" || Array.isArray(config)) process.exit(1);
    const foreground = Object.values(config.Foreground ?? {});
    const onPort = (map, port) =>
      Object.entries(map ?? {}).filter(([key]) => key.endsWith(":" + port));
    const funnelOn = (entry, port) => onPort(entry.AllowFunnel, port).some(([, enabled]) => enabled);
    const occupied = (entry, port) =>
      entry.TCP?.[port] || onPort(entry.Web, port).length > 0 || funnelOn(entry, port);
    const free = [];
    for (const port of [8443, 8444, 10000]) {
      if (foreground.some(entry => occupied(entry, port))) continue;
      const key = host + ":" + port;
      const handlers = config.Web?.[key]?.Handlers ?? {};
      const proxy = handlers["/"]?.Proxy;
      if (config.TCP?.[port]?.HTTPS === true &&
          onPort(config.Web, port).length === 1 &&
          Object.keys(handlers).length === 1 && (proxy === target || proxy === target + "/") &&
          !funnelOn(config, port)) {
        console.log("reuse", port);
        process.exit(0);
      }
      if (!occupied(config, port)) free.push("new " + port);
    }
    console.log(free.join("\n"));
  ' "$DNS_NAME" "$TARGET" <<<"$status") || die "Could not parse Tailscale Serve mappings."
  while read -r mode port; do
    [ -n "$port" ] || continue
    if [ "$mode" = reuse ] || ! lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      SERVE_MODE=$mode
      SERVE_PORT=$port
      return
    fi
  done <<<"$ports"
  die "HTTPS ports 8443, 8444 and 10000 are all in use. Free one and rerun setup."
}

SERVE_MODE=new
SERVE_PORT=8443
if [ -n "$TAILSCALE" ]; then select_serve_port; fi
ORIGIN="https://$DNS_NAME:$SERVE_PORT"
if [ "$SERVE_MODE" = reuse ]; then
  say "Reuse the existing tailnet-only Serve mapping at $ORIGIN."
elif [ "$DRY_RUN" -eq 1 ]; then
  say "Dry run: set up Tailscale Serve with tailscale serve --bg --https=$SERVE_PORT $TARGET (select from 8443, 8444, 10000)."
else
  # Serve can ask a tailnet admin to enable HTTPS. Leave its output visible.
  "$TAILSCALE" serve --bg "--https=$SERVE_PORT" "$TARGET"
  say "Tailscale Serve configured at $ORIGIN."
fi

step "Set only publicOrigin in $CONFIG, creating the file if absent ($ORIGIN)" +  node scripts/setup-macos-config.mjs "$CONFIG" "$ORIGIN"
step "Install the login LaunchAgent (scripts/install-macos-startup.sh install)" +  bash scripts/install-macos-startup.sh install

wait_for_health() {
  local url="$1" attempt response
  for ((attempt = 1; attempt <= 15; attempt++)); do
    if response=$(curl --noproxy '*' -fsS --connect-timeout 2 --max-time 3 "$url") &&
       [ "$response" = '{"ok":true}' ]; then return 0; fi
    sleep 1
  done
  return 1
}

step "Check local health at $TARGET/healthz" wait_for_health "$TARGET/healthz"
step "Check tailnet health at $ORIGIN/healthz" wait_for_health "$ORIGIN/healthz"
if [ "$DRY_RUN" -eq 1 ]; then
  say "Dry run: generate and copy a pairing code (npm run pair)."
else
  npm run pair
fi
say "On your phone, connect Tailscale to the same tailnet. Open HUD Desk in the Even Realities app, paste the pairing code in Settings and check that the bridge connects."
