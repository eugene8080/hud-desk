$ErrorActionPreference = 'Stop'
$scripts = Join-Path (Split-Path $PSScriptRoot -Parent) 'scripts'
foreach ($file in 'setup-windows.ps1', 'install-windows-startup.ps1', 'start-windows.ps1', 'setup-voice.ps1') {
    $tokens = $null
    $errors = $null
    $null = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $scripts $file), [ref]$tokens, [ref]$errors)
    if ($errors) { throw "$file did not parse: $errors" }
}
. (Join-Path $scripts 'setup-windows.ps1')

function Assert-Throws([scriptblock]$Action, [string]$Expected) {
    try { & $Action | Out-Null }
    catch {
        if ($_.Exception.Message -like "*$Expected*") { return }
        throw
    }
    throw "Expected error: $Expected"
}

$name = 'pc.example.ts.net'
$target = 'http://127.0.0.1:8787'
$signedIn = ConvertFrom-Json '{"BackendState":"Running","Self":{"DNSName":"PC.Example.ts.net."},"CurrentTailnet":{"MagicDNSEnabled":true}}'
if ((Get-TailnetName $signedIn) -ne $name) { throw 'Expected the current device MagicDNS name.' }
Assert-Throws { Get-TailnetName (ConvertFrom-Json '{"BackendState":"NeedsLogin"}') } 'Sign in'
Assert-Throws { Get-TailnetName (ConvertFrom-Json '{"BackendState":"Stopped","Self":{"DNSName":"pc.example.ts.net."}}') } 'Sign in'
Assert-Throws { Get-TailnetName (ConvertFrom-Json '{"BackendState":"Running","Self":{"DNSName":"pc.example.ts.net."}}') } 'Enable MagicDNS'

$selection = Get-ServeSelection (ConvertFrom-Json '{}') $name $target @()
if ($selection.Port -ne 8443 -or $selection.Reuse) { throw 'Expected to configure 8443 by default.' }
$busy = ConvertFrom-Json '{"TCP":{"8443":{"HTTPS":true}},"Web":{"pc.example.ts.net:8443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:9000"}}}}}'
$selection = Get-ServeSelection $busy $name $target @()
if ($selection.Port -ne 8444 -or $selection.Reuse) { throw 'Expected to skip the unrelated HTTPS mapping.' }
$selection = Get-ServeSelection $busy $name $target @(8444)
if ($selection.Port -ne 10000 -or $selection.Reuse) { throw 'Expected to skip a local TCP listener.' }
Assert-Throws { Get-ServeSelection $busy $name $target @(8444, 10000) } 'already in use'

$configured = ConvertFrom-Json '{"TCP":{"8444":{"HTTPS":true}},"Web":{"pc.example.ts.net:8444":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:8787"}}}}}'
$selection = Get-ServeSelection $configured $name $target @()
if ($selection.Port -ne 8444 -or -not $selection.Reuse) { throw 'Expected to reuse the existing bridge on 8444.' }
$configured | Add-Member NoteProperty AllowFunnel (ConvertFrom-Json '{"pc.example.ts.net:8444":true}')
$selection = Get-ServeSelection $configured $name $target @()
if ($selection.Port -ne 8443 -or $selection.Reuse) { throw 'Expected to skip the public Funnel mapping.' }
$foreground = ConvertFrom-Json '{"Foreground":{"abc":{"TCP":{"8443":{"TCPForward":"127.0.0.1:8787"}}}}}'
$selection = Get-ServeSelection $foreground $name $target @()
if ($selection.Port -ne 8444 -or $selection.Reuse) { throw 'Expected to skip the foreground TCP mapping.' }
Write-Output 'PowerShell parser and setup checks passed.'
