[CmdletBinding()]
param([switch]$Voice, [switch]$DryRun)

function Find-Application([string]$Name, [string]$InstalledPath) {
    $command = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { return $command.Source }
    if ($InstalledPath -and (Test-Path -LiteralPath $InstalledPath -PathType Leaf)) { return $InstalledPath }
}

function Confirm-Install([string]$Name) {
    if ((Read-Host "Install ${Name}? [y/N]") -notmatch '^y(es)?$') {
        throw "Setup stopped. Install $Name or rerun and approve its installation."
    }
}

function Install-Prerequisite([string]$Package, [string]$Name) {
    $winget = Find-Application 'winget.exe'
    if (-not $winget) { throw 'WinGet is missing. Install or update App Installer from Microsoft Store and rerun setup.' }
    Confirm-Install $Name
    & $winget install --id $Package --exact --source winget --accept-package-agreements --accept-source-agreements --disable-interactivity
    if ($LASTEXITCODE -ne 0) { throw "WinGet could not install or update $Name (exit $LASTEXITCODE)." }
    # The current shell does not receive environment changes from installers.
    $env:Path += ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine') +
        ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

function Get-NodeVersion([string]$Path) {
    if ($Path) { return (& $Path --version | Select-Object -First 1) }
}

function Test-SupportedNode([string]$Version) {
    return $Version -match '^v([0-9]+)\.' -and [int]$Matches[1] -ge 22
}

function Get-TailnetName($Status) {
    if ($Status.BackendState -ne 'Running' -or -not $Status.Self) {
        throw 'Tailscale is not connected. Sign in and connect from the Tailscale tray icon, then rerun setup.'
    }
    $name = ([string]$Status.Self.DNSName).TrimEnd('.').ToLowerInvariant()
    if (-not $Status.CurrentTailnet.MagicDNSEnabled -or $name -notmatch '^[a-z0-9-]+(?:\.[a-z0-9-]+)+\.ts\.net$') {
        throw 'Enable MagicDNS in the Tailscale admin console and rerun setup.'
    }
    return $name
}

function Get-ServeProperty($Object, [string]$Name) {
    if ($null -ne $Object) { return $Object.PSObject.Properties[$Name] }
}

function Get-ServeSelection($Serve, [string]$TailnetName, [string]$Target, [int[]]$ListeningPorts) {
    $free = $null
    foreach ($port in 8443, 8444, 10000) {
        $key = "${TailnetName}:${port}"
        $tcp = Get-ServeProperty $Serve.TCP "$port"
        $web = @($Serve.Web.PSObject.Properties | Where-Object { $_.Name -like "*:${port}" })
        $funnel = @($Serve.AllowFunnel.PSObject.Properties | Where-Object { $_.Value -and $_.Name -like "*:${port}" })
        $foreground = @($Serve.Foreground.PSObject.Properties | Where-Object {
            (Get-ServeProperty $_.Value.TCP "$port") -or
                ($_.Value.Web.PSObject.Properties | Where-Object { $_.Name -like "*:${port}" })
        })
        if ($port -in $ListeningPorts -or $funnel.Count -or $foreground.Count) { continue }
        $root = (Get-ServeProperty $Serve.Web $key).Value.Handlers
        if ($tcp.Value.HTTPS -eq $true -and $web.Count -eq 1 -and $root.PSObject.Properties.Name -ceq '/' -and
            @($root.PSObject.Properties).Count -eq 1 -and (Get-ServeProperty $root '/').Value.Proxy -ceq $Target) {
            return @{ Port = $port; Reuse = $true }
        }
        if (-not $free -and -not $tcp -and -not $web.Count) { $free = @{ Port = $port; Reuse = $false } }
    }
    if ($free) { return $free }
    throw 'Tailscale HTTPS ports 8443, 8444 and 10000 are already in use. Free one and rerun setup.'
}

function Get-TailscaleJson([string]$Cli, [string[]]$Arguments) {
    $output = & $Cli @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Tailscale $($Arguments -join ' ') failed. Check that Tailscale is running and connected." }
    if (-not $output) { return [pscustomobject]@{} }
    # Keep empty JSON objects usable for property lookups on Windows PowerShell.
    return ($output -join [Environment]::NewLine) | ConvertFrom-Json
}

function Wait-BridgeHealth([string]$Origin) {
    for ($attempt = 0; $attempt -lt 12; $attempt++) {
        try {
            $result = Invoke-RestMethod -Uri "$Origin/healthz" -TimeoutSec 4 -MaximumRedirection 0
            if ($result.ok -eq $true) { return }
        } catch { }
        if ($attempt -lt 11) { Start-Sleep -Seconds 2 }
    }
    throw "Bridge check failed at $Origin/healthz. Check the HUD Desk Bridge task, .local/startup.log and Tailscale Serve status."
}

function Confirm-BridgeListener([string]$Repo) {
    # The startup launcher records its supervisor PID. Only reuse a listener
    # spawned by that supervisor, so Serve cannot expose an unrelated service.
    $pidFile = Join-Path $Repo '.local/custom.pid'
    $supervisor = 0
    if (Test-Path -LiteralPath $pidFile) {
        $null = [int]::TryParse((Get-Content -LiteralPath $pidFile -Raw).Trim(), [ref]$supervisor)
    }
    if ($supervisor -gt 0) {
        $listener = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue
        if ($listener) {
            $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
            $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $supervisor"
            if ($owner.ParentProcessId -eq $supervisor -and $parent.CommandLine -match '\bscripts/start\.mjs\b' -and
                $owner.CommandLine -match '\bbridge/server\.mjs\b' -and $parent.CreationDate -le $owner.CreationDate) {
                return
            }
        }
    }
    throw 'Port 8787 is occupied by a process outside this clone''s startup task. Stop that process and rerun setup.'
}

function Invoke-WindowsSetup([switch]$Voice, [switch]$DryRun) {
    $ErrorActionPreference = 'Stop'
    $repo = Split-Path $PSScriptRoot -Parent
    $nodeInstall = Join-Path $env:ProgramFiles 'nodejs/node.exe'
    $gitInstall = Join-Path $env:ProgramFiles 'Git/cmd/git.exe'
    $tailscaleInstall = Join-Path $env:ProgramFiles 'Tailscale/tailscale.exe'
    $target = 'http://127.0.0.1:8787'
    $node = Find-Application 'node.exe' $nodeInstall
    $version = Get-NodeVersion $node
    $git = Find-Application 'git.exe' $gitInstall
    $tailscale = Find-Application 'tailscale.exe' $tailscaleInstall

    if ($DryRun) {
        Write-Host 'Dry run. Setup will make no changes.'
        if (Test-SupportedNode $version) { Write-Host "Node.js: found $version." }
        else { Write-Host 'Node.js: ask before installing or updating Node.js LTS (22+) with WinGet.' }
        if ($git) { Write-Host 'Git: already installed.' }
        else { Write-Host 'Git: ask before installing Git with WinGet.' }
        if ($tailscale) { Write-Host 'Tailscale: already installed.' }
        else { Write-Host 'Tailscale: ask before installing Tailscale with WinGet.' }
        Write-Host 'Dependencies: run npm ci and npm ci --prefix app.'
        Write-Host 'Tailscale: check sign-in and MagicDNS, then reuse or choose a free HTTPS port (8443, 8444, 10000).'
        Write-Host "Tailscale Serve: run tailscale serve --bg --https=<port> $target if the selected mapping is new."
        Write-Host 'Bridge config: create a minimal bridge/config.local.json if missing, otherwise merge publicOrigin only.'
        if ($Voice) { Write-Host 'Voice: ask before running scripts/setup-voice.ps1 for local Whisper.' }
        else { Write-Host 'Voice: skip local Whisper (use -Voice to install it).' }
        Write-Host 'Startup: register HUD Desk Bridge for the current user and start it now.'
        Write-Host 'Health: check /healthz locally and over Tailscale.'
        Write-Host 'Pairing: run npm run pair to print and copy the code.'
        Write-Host 'Phone: connect Tailscale using the same account, install HUD Desk from Even Hub and paste the code.'
        return
    }

    if (-not (Test-SupportedNode $version)) {
        Write-Host 'Node.js: Node.js 22+ is required.'
        Install-Prerequisite 'OpenJS.NodeJS.LTS' 'Node.js LTS'
        if (Test-Path -LiteralPath $nodeInstall) { $node = $nodeInstall }
        else { $node = Find-Application 'node.exe' }
        $version = Get-NodeVersion $node
        if (-not (Test-SupportedNode $version)) { throw 'Node.js 22+ is still unavailable. Check your Node installation and rerun setup.' }
    }
    Write-Host "Node.js: using $version."
    if (-not $git) { Install-Prerequisite 'Git.Git' 'Git' }
    if (-not (Find-Application 'git.exe' $gitInstall)) { throw 'Git is unavailable after installation.' }
    Write-Host 'Git: ready.'
    if (-not $tailscale) { Install-Prerequisite 'Tailscale.Tailscale' 'Tailscale' }
    $tailscale = Find-Application 'tailscale.exe' $tailscaleInstall
    if (-not $tailscale) { throw 'Tailscale is unavailable after installation.' }
    Write-Host 'Tailscale: installed. Checking sign-in and MagicDNS.'
    $name = Get-TailnetName (Get-TailscaleJson $tailscale @('status', '--json'))

    $npm = Join-Path (Split-Path $node -Parent) 'npm.cmd'
    if (-not (Test-Path -LiteralPath $npm)) { throw 'npm.cmd is missing from the Node.js installation.' }
    Push-Location -LiteralPath $repo
    try {
        Write-Host 'Dependencies: installing locked bridge and app packages.'
        & $npm ci
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed for the bridge.' }
        & $npm ci --prefix app
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed for the app.' }

        & $node scripts/self-host-config.mjs --check
        if ($LASTEXITCODE -ne 0) { throw 'Bridge config validation failed.' }
        $listeners = [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners().Port
        if (8787 -in $listeners) { Confirm-BridgeListener $repo }
        $serve = Get-TailscaleJson $tailscale @('serve', 'status', '--json')
        $selection = Get-ServeSelection $serve $name $target $listeners
        $port = $selection.Port
        $origin = "https://${name}:${port}"
        if ($selection.Reuse) {
            Write-Host "Tailscale Serve: reusing $origin."
        } else {
            Write-Host "Tailscale Serve: mapping $origin to $target."
            & $tailscale serve --bg "--https=$port" $target
            if ($LASTEXITCODE -ne 0) { throw 'Tailscale Serve failed. Follow any HTTPS enablement instructions above, then rerun setup.' }
        }
        & $node scripts/self-host-config.mjs $origin
        if ($LASTEXITCODE -ne 0) { throw 'Could not save the bridge origin.' }

        if ($Voice) {
            Confirm-Install 'the local Whisper voice engine and model'
            Write-Host 'Voice: setting up local Whisper.'
            & (Join-Path $PSScriptRoot 'setup-voice.ps1')
        } else { Write-Host 'Voice: skipped (use -Voice to install local Whisper).' }

        Write-Host 'Startup: registering HUD Desk Bridge to start at sign-in.'
        & (Join-Path $PSScriptRoot 'install-windows-startup.ps1') -NodePath $node | Out-Null
        if ((Get-ScheduledTask -TaskName 'HUD Desk Bridge').State -ne 'Running') {
            Start-ScheduledTask -TaskName 'HUD Desk Bridge'
        }
        Write-Host 'Health: checking the local and Tailscale /healthz endpoints.'
        Wait-BridgeHealth $target
        Confirm-BridgeListener $repo
        Wait-BridgeHealth $origin
        Write-Host 'Pairing: generating your private code.'
        # npm resolves node from PATH when it launches scripts.
        $env:Path = (Split-Path $node -Parent) + ';' + $env:Path
        & $npm run pair
        if ($LASTEXITCODE -ne 0) { throw 'Could not generate the pairing code.' }
        Write-Host 'Phone: connect Tailscale using the same account, install HUD Desk from Even Hub and paste the code.'
    } finally {
        Pop-Location
    }
}

if ($MyInvocation.InvocationName -ne '.') { Invoke-WindowsSetup -Voice:$Voice -DryRun:$DryRun }
