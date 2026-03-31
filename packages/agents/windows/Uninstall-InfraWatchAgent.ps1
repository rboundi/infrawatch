#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Uninstall the InfraWatch Agent for Windows.
.DESCRIPTION
    Removes the scheduled task, agent script, config, and log files.
#>

$ErrorActionPreference = "Stop"
$InstallDir = "C:\ProgramData\InfraWatch"
$TaskName = "InfraWatch Agent"

Write-Host "Uninstalling InfraWatch Agent..." -ForegroundColor Cyan

# ─── Remove Scheduled Task ───

try {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($task) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "  Removed scheduled task: '$TaskName'"
    } else {
        Write-Host "  Scheduled task not found (skipped)"
    }
} catch {
    Write-Host "  Failed to remove scheduled task: $_" -ForegroundColor Yellow
}

# ─── Remove install directory ───

if (Test-Path $InstallDir) {
    Remove-Item -Path $InstallDir -Recurse -Force
    Write-Host "  Removed directory: $InstallDir"
} else {
    Write-Host "  Install directory not found (skipped)"
}

Write-Host ""
Write-Host "InfraWatch Agent has been uninstalled." -ForegroundColor Green
Write-Host "Hosts that reported with this agent will remain in the InfraWatch inventory."
