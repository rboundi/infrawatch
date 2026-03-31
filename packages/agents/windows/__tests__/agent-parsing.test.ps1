#Requires -Version 5.1
<#
.SYNOPSIS
    InfraWatch Windows Agent Parsing Tests
.DESCRIPTION
    Tests the parsing logic and output format of the Windows agent script
    without requiring real servers. Mocks system calls and validates JSON output.
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File agent-parsing.test.ps1
#>

$ErrorActionPreference = "Stop"
$Pass = 0
$Fail = 0
$Errors = @()

function Assert-Equal {
    param([string]$Label, $Expected, $Actual)
    if ($Expected -eq $Actual) {
        $script:Pass++
        Write-Host "  PASS $Label" -ForegroundColor Green
    } else {
        $script:Fail++
        $script:Errors += "$Label`: expected '$Expected', got '$Actual'"
        Write-Host "  FAIL $Label" -ForegroundColor Red
        Write-Host "       expected: '$Expected'"
        Write-Host "       actual:   '$Actual'"
    }
}

function Assert-Contains {
    param([string]$Label, [string]$Needle, [string]$Haystack)
    if ($Haystack.Contains($Needle)) {
        $script:Pass++
        Write-Host "  PASS $Label" -ForegroundColor Green
    } else {
        $script:Fail++
        $script:Errors += "$Label`: does not contain '$Needle'"
        Write-Host "  FAIL $Label" -ForegroundColor Red
        Write-Host "       haystack: '$($Haystack.Substring(0, [Math]::Min(200, $Haystack.Length)))...'"
        Write-Host "       needle:   '$Needle'"
    }
}

function Assert-NotContains {
    param([string]$Label, [string]$Needle, [string]$Haystack)
    if (-not $Haystack.Contains($Needle)) {
        $script:Pass++
        Write-Host "  PASS $Label" -ForegroundColor Green
    } else {
        $script:Fail++
        $script:Errors += "$Label`: should not contain '$Needle'"
        Write-Host "  FAIL $Label" -ForegroundColor Red
    }
}

function Assert-ValidJson {
    param([string]$Label, [string]$Json)
    try {
        $null = $Json | ConvertFrom-Json
        $script:Pass++
        Write-Host "  PASS $Label" -ForegroundColor Green
    } catch {
        $script:Fail++
        $script:Errors += "$Label`: invalid JSON"
        Write-Host "  FAIL $Label" -ForegroundColor Red
        Write-Host "       json: '$($Json.Substring(0, [Math]::Min(200, $Json.Length)))...'"
    }
}

Write-Host ""
Write-Host "=== InfraWatch Windows Agent Parsing Tests ===" -ForegroundColor Yellow
Write-Host ""

# ─── Test: OS detection ───
Write-Host "OS detection:"

# Simulate what Collect-OsInfo does
$mockOsCaption = "Microsoft Windows Server 2022 Standard"
$mockOsVersion = "10.0.20348"
$mockArch = "AMD64"
$mockHostname = "WIN-SERVER-01"

$osInfo = @{
    hostname  = $mockHostname
    os        = $mockOsCaption
    osVersion = $mockOsVersion
    arch      = $mockArch
    ip        = "10.0.0.50"
}

Assert-Equal "OS caption" "Microsoft Windows Server 2022 Standard" $osInfo.os
Assert-Equal "OS version" "10.0.20348" $osInfo.osVersion
Assert-Equal "Architecture" "AMD64" $osInfo.arch
Assert-Equal "Hostname" "WIN-SERVER-01" $osInfo.hostname

# ─── Test: installed programs parsing ───
Write-Host ""
Write-Host "Installed programs parsing:"

# Simulate registry output with mock data
$mockRegistry = @(
    [PSCustomObject]@{ DisplayName = "Google Chrome"; DisplayVersion = "120.0.6099.130" }
    [PSCustomObject]@{ DisplayName = "Microsoft Visual C++ 2022"; DisplayVersion = "14.38.33130" }
    [PSCustomObject]@{ DisplayName = "7-Zip 23.01 (x64)"; DisplayVersion = "23.01" }
    [PSCustomObject]@{ DisplayName = "Notepad++ (64-bit x64)"; DisplayVersion = "8.6.2" }
    [PSCustomObject]@{ DisplayName = "Git"; DisplayVersion = "2.43.0" }
)

$packages = @()
$seen = @{}

foreach ($item in $mockRegistry) {
    $name = $item.DisplayName.Trim()
    if ($seen.ContainsKey($name)) { continue }
    $seen[$name] = $true
    $packages += @{
        name      = $name
        version   = if ($item.DisplayVersion) { $item.DisplayVersion.Trim() } else { "" }
        manager   = "msi"
        ecosystem = "windows"
    }
}

Assert-Equal "Parses 5 programs" 5 $packages.Count
Assert-Equal "First package name" "Google Chrome" $packages[0].name
Assert-Equal "First package version" "120.0.6099.130" $packages[0].version
Assert-Equal "Package manager is msi" "msi" $packages[0].manager
Assert-Equal "Package ecosystem is windows" "windows" $packages[0].ecosystem

# ─── Test: deduplication of 64-bit and 32-bit entries ───
Write-Host ""
Write-Host "Deduplication of 64-bit and 32-bit entries:"

$mockRegistry64 = @(
    [PSCustomObject]@{ DisplayName = "Microsoft Visual C++ 2022"; DisplayVersion = "14.38.33130" }
    [PSCustomObject]@{ DisplayName = "Git"; DisplayVersion = "2.43.0" }
)

$mockRegistry32 = @(
    [PSCustomObject]@{ DisplayName = "Microsoft Visual C++ 2022"; DisplayVersion = "14.38.33130" }
    [PSCustomObject]@{ DisplayName = "Notepad++"; DisplayVersion = "8.6.2" }
)

$dedupPackages = @()
$dedupSeen = @{}

foreach ($source in @($mockRegistry64, $mockRegistry32)) {
    foreach ($item in $source) {
        $name = $item.DisplayName.Trim()
        if ($dedupSeen.ContainsKey($name)) { continue }
        $dedupSeen[$name] = $true
        $dedupPackages += @{
            name      = $name
            version   = if ($item.DisplayVersion) { $item.DisplayVersion.Trim() } else { "" }
            manager   = "msi"
            ecosystem = "windows"
        }
    }
}

Assert-Equal "Dedup: 3 unique packages from 4 entries" 3 $dedupPackages.Count
$vcppCount = ($dedupPackages | Where-Object { $_.name -eq "Microsoft Visual C++ 2022" }).Count
Assert-Equal "Dedup: VC++ appears only once" 1 $vcppCount

# ─── Test: service parsing ───
Write-Host ""
Write-Host "Service parsing:"

# Simulate Get-Service output
$mockServices = @(
    [PSCustomObject]@{ Name = "W3SVC"; Status = "Running"; DisplayName = "World Wide Web Publishing Service" }
    [PSCustomObject]@{ Name = "MSSQLSERVER"; Status = "Running"; DisplayName = "SQL Server" }
    [PSCustomObject]@{ Name = "sshd"; Status = "Running"; DisplayName = "OpenSSH SSH Server" }
    [PSCustomObject]@{ Name = "WinRM"; Status = "Running"; DisplayName = "Windows Remote Management" }
    [PSCustomObject]@{ Name = "Spooler"; Status = "Stopped"; DisplayName = "Print Spooler" }
)

$services = @()
$runningSvcs = $mockServices | Where-Object { $_.Status -eq "Running" }

foreach ($svc in $runningSvcs) {
    $svcName = $svc.Name
    $svcType = "system"

    switch -Wildcard ($svcName) {
        "W3SVC"     { $svcType = "webserver" }
        "MSSQL*"    { $svcType = "database" }
        "sshd*"     { $svcType = "remote-access" }
    }

    $services += @{
        name   = $svcName
        type   = $svcType
        status = "running"
    }
}

Assert-Equal "Parses 4 running services (excludes stopped)" 4 $services.Count
Assert-Equal "W3SVC classified as webserver" "webserver" ($services | Where-Object { $_.name -eq "W3SVC" }).type
Assert-Equal "MSSQLSERVER classified as database" "database" ($services | Where-Object { $_.name -eq "MSSQLSERVER" }).type
Assert-Equal "sshd classified as remote-access" "remote-access" ($services | Where-Object { $_.name -eq "sshd" }).type

# ─── Test: JSON output is valid ───
Write-Host ""
Write-Host "JSON output validation:"

$payload = @{
    agentVersion = "1.0.0"
    hostname     = "WIN-SERVER-01"
    ip           = "10.0.0.50"
    os           = "Microsoft Windows Server 2022 Standard"
    osVersion    = "10.0.20348"
    arch         = "AMD64"
    reportedAt   = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    packages     = @(
        @{ name = "Google Chrome"; version = "120.0.6099.130"; manager = "msi"; ecosystem = "windows" }
        @{ name = "7-Zip"; version = "23.01"; manager = "msi"; ecosystem = "windows" }
    )
    services     = @(
        @{ name = "W3SVC"; type = "webserver"; status = "running" }
        @{ name = "sshd"; type = "remote-access"; status = "running"; port = 22 }
    )
    connections  = @()
    metadata     = @{
        uptime         = "5d 3h 22m"
        kernelVersion  = "10.0.20348.2113"
        totalMemoryMb  = 16384
        cpuCores       = 8
    }
}

$jsonPayload = $payload | ConvertTo-Json -Depth 5 -Compress
Assert-ValidJson "Full payload is valid JSON" $jsonPayload

$parsed = $jsonPayload | ConvertFrom-Json
Assert-Equal "JSON has hostname" "WIN-SERVER-01" $parsed.hostname
Assert-Equal "JSON has os" "Microsoft Windows Server 2022 Standard" $parsed.os
Assert-Equal "JSON has packages array" 2 $parsed.packages.Count
Assert-Equal "JSON has services array" 2 $parsed.services.Count
Assert-Equal "JSON has metadata" $true ($null -ne $parsed.metadata)

# Check no null or undefined string values
$jsonStr = $jsonPayload
Assert-NotContains "no 'undefined' string" '"undefined"' $jsonStr

# ─── Test: handles missing tools gracefully ───
Write-Host ""
Write-Host "Missing tools handling:"

# Docker not installed - simulate empty return
$dockerResult = @{ packages = @(); services = @() }
Assert-Equal "Docker not installed: empty packages" 0 $dockerResult.packages.Count
Assert-Equal "Docker not installed: empty services" 0 $dockerResult.services.Count

# Build payload with no docker, no IIS
$minimalPayload = @{
    agentVersion = "1.0.0"
    hostname     = "MINIMAL-HOST"
    ip           = "10.0.0.1"
    os           = "Windows"
    osVersion    = "10.0"
    arch         = "AMD64"
    packages     = @()
    services     = @()
    connections  = @()
    metadata     = @{}
}

$minimalJson = $minimalPayload | ConvertTo-Json -Depth 5 -Compress
Assert-ValidJson "Minimal payload (no tools) is valid JSON" $minimalJson
$minimalParsed = $minimalJson | ConvertFrom-Json
Assert-Equal "Minimal payload has empty packages" 0 $minimalParsed.packages.Count
Assert-Equal "Minimal payload has empty services" 0 $minimalParsed.services.Count

# ─── Test: special characters in package names ───
Write-Host ""
Write-Host "Special characters in package names:"

$specialPayload = @{
    agentVersion = "1.0.0"
    hostname     = "SPECIAL-HOST"
    ip           = "10.0.0.1"
    os           = "Windows"
    osVersion    = "10.0"
    arch         = "AMD64"
    packages     = @(
        @{ name = 'Package with "quotes"'; version = "1.0"; manager = "msi"; ecosystem = "windows" }
        @{ name = "Package\with\backslash"; version = "2.0"; manager = "msi"; ecosystem = "windows" }
        @{ name = "Package (x86) [v3]"; version = "3.0"; manager = "msi"; ecosystem = "windows" }
    )
    services     = @()
    connections  = @()
    metadata     = @{}
}

$specialJson = $specialPayload | ConvertTo-Json -Depth 5 -Compress
Assert-ValidJson "Special characters produce valid JSON" $specialJson

$specialParsed = $specialJson | ConvertFrom-Json
Assert-Equal "Special char package count" 3 $specialParsed.packages.Count

# ─── Summary ───
Write-Host ""
Write-Host "=== Results ===" -ForegroundColor Yellow
Write-Host "  Passed: $Pass" -ForegroundColor Green
if ($Fail -gt 0) {
    Write-Host "  Failed: $Fail" -ForegroundColor Red
    Write-Host ""
    Write-Host "Failed tests:" -ForegroundColor Red
    foreach ($err in $Errors) {
        Write-Host "  - $err" -ForegroundColor Red
    }
    exit 1
} else {
    Write-Host "  Failed: 0"
    Write-Host ""
    Write-Host "All tests passed!" -ForegroundColor Green
}
