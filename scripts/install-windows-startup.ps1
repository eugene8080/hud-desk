[CmdletBinding()]
param([string]$NodePath)

$ErrorActionPreference = 'Stop'
$userId = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$repoRoot = Split-Path $PSScriptRoot -Parent
$powerShellPath = (Get-Process -Id $PID).Path
if (-not $NodePath) { $NodePath = (Get-Command node.exe -ErrorAction Stop).Source }
$scriptPath = Join-Path $PSScriptRoot 'start-windows.ps1'
# conhost --headless keeps the launcher off the desktop. Pin Node so a just-installed
# runtime works even when the Task Scheduler service still has an older PATH.
$conhostPath = Join-Path $env:WINDIR 'System32/conhost.exe'
$arguments = '--headless "' + $powerShellPath + '" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' +
    $scriptPath + '" -NodePath "' + $NodePath + '"'
$action = New-ScheduledTaskAction -Execute $conhostPath -Argument $arguments -WorkingDirectory $repoRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'HUD Desk Bridge' -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings `
    -Description 'Start the HUD Desk bridge at Windows sign-in and restart it after a failure.' `
    -Force | Out-Null
$readback = Get-ScheduledTask -TaskName 'HUD Desk Bridge'
if ($readback.Actions[0].Execute -ine $conhostPath -or $readback.Actions[0].Arguments -cne $arguments) {
    throw 'Task readback differs from registered headless action.'
}
$readback | Select-Object TaskName, State
