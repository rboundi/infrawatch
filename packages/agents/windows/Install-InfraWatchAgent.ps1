#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Install the InfraWatch Agent for Windows.
.DESCRIPTION
    Copies agent script, creates config template, and registers a scheduled task
    to run the agent every 6 hours.
.PARAMETER ReportInterval
    Hours between reports (default: 6).
#>

param(
    [int]$ReportInterval = 6
)

$ErrorActionPreference = "Stop"
$InstallDir = "C:\ProgramData\InfraWatch"
$AgentScript = "infrawatch-agent.ps1"
$TaskName = "InfraWatch Agent"

Write-Host "Installing InfraWatch Agent..." -ForegroundColor Cyan

# ─── Create install directory ───

if (-not (Test-Path $InstallDir)) {
    New-Item -Path $InstallDir -ItemType Directory -Force | Out-Null
}
Write-Host "  Directory: $InstallDir"

# ─── Copy agent script ───

$scriptSource = Join-Path $PSScriptRoot $AgentScript
if (Test-Path $scriptSource) {
    Copy-Item $scriptSource "$InstallDir\$AgentScript" -Force
    Write-Host "  Agent script: $InstallDir\$AgentScript"
} else {
    Write-Error "Agent script not found: $scriptSource. Place Install-InfraWatchAgent.ps1 in the same directory as infrawatch-agent.ps1."
    exit 1
}

# ─── Create config template ───

$configPath = "$InstallDir\agent.conf"
if (-not (Test-Path $configPath)) {
    $configContent = @"
{
    "url": "",
    "token": "",
    "collectConnections": false,
    "collectDocker": true
}
"@
    Set-Content -Path $configPath -Value $configContent -Encoding UTF8
    Write-Host "  Config template: $configPath"
} else {
    Write-Host "  Config exists: $configPath (not overwritten)"
}

# ─── Register Scheduled Task ───

# Remove existing task if present
try {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
} catch { }

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-ExecutionPolicy Bypass -NonInteractive -WindowStyle Hidden -File `"$InstallDir\$AgentScript`""

$trigger = New-ScheduledTaskTrigger `
    -Once `
    -At (Get-Date).Date `
    -RepetitionInterval (New-TimeSpan -Hours $ReportInterval) `
    -RepetitionDuration (New-TimeSpan -Days 365250)

$principal = New-ScheduledTaskPrincipal `
    -UserId "SYSTEM" `
    -RunLevel Highest `
    -LogonType ServiceAccount

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable `
    -MultipleInstances IgnoreNew

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description "InfraWatch inventory agent - reports system state every $ReportInterval hours" | Out-Null

Write-Host "  Scheduled task: '$TaskName' (every ${ReportInterval}h as SYSTEM)"

# ─── Done ───

Write-Host ""
Write-Host "Installation complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Edit $configPath"
Write-Host "     Set `"url`" to your InfraWatch server URL"
Write-Host "     Set `"token`" to an agent token (create one in the InfraWatch UI)"
Write-Host ""
Write-Host "  2. Test the agent:"
Write-Host "     powershell -ExecutionPolicy Bypass -File `"$InstallDir\$AgentScript`""
Write-Host ""
Write-Host "  3. The agent will automatically run every $ReportInterval hours."
Write-Host ""
Write-Host "  To uninstall: powershell -ExecutionPolicy Bypass -File `"$PSScriptRoot\Uninstall-InfraWatchAgent.ps1`""
