#Requires -Version 5.1
<#
.SYNOPSIS
    InfraWatch Agent for Windows
.DESCRIPTION
    Single-file PowerShell agent that collects system inventory and reports to an InfraWatch server.
    Requires: PowerShell 5.1+ and network access to the InfraWatch server.
.PARAMETER Url
    InfraWatch server URL (e.g. https://infrawatch.example.com). Overrides config file.
.PARAMETER Token
    Agent token (e.g. iw_abc123...). Overrides config file.
.EXAMPLE
    .\infrawatch-agent.ps1 -Url "https://infrawatch.example.com" -Token "iw_XXXX"
.EXAMPLE
    # Configure in C:\ProgramData\InfraWatch\agent.conf, then:
    .\infrawatch-agent.ps1
#>

param(
    [string]$Url,
    [string]$Token
)

$ErrorActionPreference = "Stop"
$AgentVersion = "1.0.0"
$ConfigPath = "C:\ProgramData\InfraWatch\agent.conf"
$LogPath = "C:\ProgramData\InfraWatch\agent.log"
$AutoUpdate = $true

# ─── Logging ───

function Write-Log {
    param([string]$Level, [string]$Message)
    $ts = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    $line = "[$ts] [$Level] $Message"
    try {
        $dir = Split-Path $LogPath -Parent
        if (-not (Test-Path $dir)) { New-Item -Path $dir -ItemType Directory -Force | Out-Null }
        Add-Content -Path $LogPath -Value $line -ErrorAction SilentlyContinue
    } catch { }
    if ($Level -eq "ERROR") { Write-Error $line }
}

# ─── Config Loading ───

function Load-Config {
    # Load from config file if it exists
    if (Test-Path $ConfigPath) {
        try {
            $conf = Get-Content $ConfigPath -Raw | ConvertFrom-Json
            if (-not $script:Url -and $conf.url) { $script:Url = $conf.url }
            if (-not $script:Token -and $conf.token) { $script:Token = $conf.token }
            if ($conf.collectConnections) { $script:CollectConnections = $conf.collectConnections }
            if ($conf.collectDocker) { $script:CollectDocker = $conf.collectDocker }
            if ($null -ne $conf.autoUpdate) { $script:AutoUpdate = $conf.autoUpdate }
        } catch {
            Write-Log "WARN" "Failed to parse config file: $_"
        }
    }

    if (-not $Url) { throw "INFRAWATCH_URL is required. Set via -Url parameter or config file at $ConfigPath" }
    if (-not $Token) { throw "INFRAWATCH_TOKEN is required. Set via -Token parameter or config file at $ConfigPath" }

    # Strip trailing slash
    $script:Url = $Url.TrimEnd("/")
}

# ─── OS Info ───

function Collect-OsInfo {
    Write-Log "INFO" "Collecting OS information"
    $info = @{}

    try {
        $os = Get-CimInstance Win32_OperatingSystem
        $info.hostname = [System.Net.Dns]::GetHostName()
        $info.os = $os.Caption
        $info.osVersion = $os.Version
        $info.arch = $env:PROCESSOR_ARCHITECTURE
    } catch {
        Write-Log "WARN" "Failed to collect OS info: $_"
        $info.hostname = $env:COMPUTERNAME
        $info.os = "Windows"
        $info.osVersion = ""
        $info.arch = $env:PROCESSOR_ARCHITECTURE
    }

    # Primary IP
    try {
        $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object { $_.InterfaceAlias -notlike "*Loopback*" -and $_.PrefixOrigin -ne "WellKnown" } |
            Select-Object -First 1).IPAddress
        $info.ip = if ($ip) { $ip } else { "unknown" }
    } catch {
        $info.ip = "unknown"
    }

    Write-Log "INFO" "OS: $($info.os) ($($info.arch)), Host: $($info.hostname), IP: $($info.ip)"
    return $info
}

# ─── Package Collection ───

function Collect-Packages {
    Write-Log "INFO" "Collecting installed programs"
    $packages = @()
    $seen = @{}

    try {
        # 64-bit registry
        $regPaths = @(
            "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*"
            "HKLM:\Software\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
        )

        foreach ($regPath in $regPaths) {
            try {
                $items = Get-ItemProperty $regPath -ErrorAction SilentlyContinue |
                    Where-Object { $_.DisplayName -and $_.DisplayName.Trim() }
                foreach ($item in $items) {
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
            } catch {
                Write-Log "WARN" "Failed to read registry path ${regPath}: $_"
            }
        }
    } catch {
        Write-Log "WARN" "Failed to collect packages: $_"
    }

    Write-Log "INFO" "Collected $($packages.Count) packages"
    return $packages
}

# ─── Service Collection ───

function Collect-Services {
    Write-Log "INFO" "Collecting running services"
    $services = @()

    # Build port-to-process map
    $portMap = @{}
    try {
        $listeners = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue
        foreach ($l in $listeners) {
            if ($l.OwningProcess -and $l.LocalPort) {
                try {
                    $procName = (Get-Process -Id $l.OwningProcess -ErrorAction SilentlyContinue).ProcessName
                    if ($procName) { $portMap[$procName] = $l.LocalPort }
                } catch { }
            }
        }
    } catch {
        Write-Log "WARN" "Failed to build port map: $_"
    }

    try {
        $runningSvcs = Get-Service | Where-Object { $_.Status -eq "Running" }
        foreach ($svc in $runningSvcs) {
            $svcName = $svc.Name
            $svcType = "system"
            $version = $null
            $port = $null

            # Classify and detect versions for known services
            switch -Wildcard ($svcName) {
                "W3SVC" {
                    $svcType = "webserver"
                    try {
                        $version = (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\InetStp" -ErrorAction SilentlyContinue).VersionString
                    } catch { }
                    if ($portMap.ContainsKey("w3wp")) { $port = $portMap["w3wp"] }
                }
                "MSSQL*" {
                    $svcType = "database"
                    try {
                        $sqlSetup = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\*\Setup" -ErrorAction SilentlyContinue |
                            Select-Object -First 1
                        if ($sqlSetup) { $version = $sqlSetup.Version }
                    } catch { }
                    if ($portMap.ContainsKey("sqlservr")) { $port = $portMap["sqlservr"] }
                }
                "MySQL*" {
                    $svcType = "database"
                    try {
                        $version = (& mysql --version 2>$null) -replace '.*Distrib ([\d.]+).*', '$1'
                    } catch { }
                    if ($portMap.ContainsKey("mysqld")) { $port = $portMap["mysqld"] }
                }
                "postgresql*" {
                    $svcType = "database"
                    try {
                        $version = (& psql --version 2>$null) -replace '.*(\d+\.\d+[\.\d]*).*', '$1'
                    } catch { }
                    if ($portMap.ContainsKey("postgres")) { $port = $portMap["postgres"] }
                }
                "Redis*" {
                    $svcType = "cache"
                    if ($portMap.ContainsKey("redis-server")) { $port = $portMap["redis-server"] }
                }
                "sshd*" {
                    $svcType = "remote-access"
                    if ($portMap.ContainsKey("sshd")) { $port = $portMap["sshd"] }
                }
                "docker*" {
                    $svcType = "container-runtime"
                    try {
                        $version = (& docker --version 2>$null) -replace '.*version ([\d.]+).*', '$1'
                    } catch { }
                }
            }

            $svcObj = @{
                name   = $svcName
                type   = $svcType
                status = "running"
            }
            if ($version) { $svcObj.version = $version }
            if ($port) { $svcObj.port = [int]$port }

            $services += $svcObj
        }
    } catch {
        Write-Log "WARN" "Failed to collect services: $_"
    }

    Write-Log "INFO" "Collected $($services.Count) services"
    return $services
}

# ─── Docker Collection ───

function Collect-Docker {
    $dockerPkgs = @()
    $dockerSvcs = @()

    if (-not $script:CollectDocker) { $script:CollectDocker = $true }
    if ($script:CollectDocker -ne $true -and $script:CollectDocker -ne "true") { return @{ packages = $dockerPkgs; services = $dockerSvcs } }

    try {
        $null = & docker info 2>$null
        if ($LASTEXITCODE -ne 0) { return @{ packages = $dockerPkgs; services = $dockerSvcs } }
    } catch {
        return @{ packages = $dockerPkgs; services = $dockerSvcs }
    }

    Write-Log "INFO" "Collecting Docker containers"

    try {
        $containers = & docker ps --format "{{.Image}}`t{{.Names}}`t{{.Status}}`t{{.Ports}}" 2>$null
        foreach ($line in $containers) {
            if (-not $line) { continue }
            $parts = $line -split "`t"
            $image = $parts[0]
            $cname = if ($parts.Count -gt 1) { $parts[1] } else { $image }
            $ports = if ($parts.Count -gt 3) { $parts[3] } else { "" }

            # Parse image name:tag
            $imgParts = $image -split ":"
            $imgName = $imgParts[0]
            $imgVersion = if ($imgParts.Count -gt 1) { $imgParts[1] } else { "latest" }

            $dockerPkgs += @{
                name      = $imgName
                version   = $imgVersion
                manager   = "docker"
                ecosystem = "docker"
            }

            $svcObj = @{
                name    = $cname
                type    = "container-runtime"
                version = $imgVersion
                status  = "running"
            }

            # Extract mapped port
            if ($ports -match "(\d+)->") {
                $svcObj.port = [int]$Matches[1]
            }

            $dockerSvcs += $svcObj
        }
    } catch {
        Write-Log "WARN" "Failed to collect Docker containers: $_"
    }

    Write-Log "INFO" "Collected $($dockerPkgs.Count) Docker containers"
    return @{ packages = $dockerPkgs; services = $dockerSvcs }
}

# ─── Connection Collection ───

function Collect-Connections {
    $connections = @()

    if (-not $script:CollectConnections -or $script:CollectConnections -ne $true -and $script:CollectConnections -ne "true") {
        return $connections
    }

    Write-Log "INFO" "Collecting established connections"

    try {
        $established = Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue
        foreach ($conn in $established) {
            # Skip loopback
            if ($conn.RemoteAddress -eq "127.0.0.1" -or $conn.RemoteAddress -eq "::1") { continue }

            $procName = $null
            try {
                $procName = (Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue).ProcessName
            } catch { }

            $connections += @{
                localPort   = $conn.LocalPort
                remoteIp    = $conn.RemoteAddress
                remotePort  = $conn.RemotePort
                processName = $procName
                protocol    = "tcp"
            }
        }
    } catch {
        Write-Log "WARN" "Failed to collect connections: $_"
    }

    Write-Log "INFO" "Collected $($connections.Count) connections"
    return $connections
}

# ─── Metadata Collection ───

function Collect-Metadata {
    Write-Log "INFO" "Collecting system metadata"
    $meta = @{}

    try {
        $os = Get-CimInstance Win32_OperatingSystem
        $bootTime = $os.LastBootUpTime
        $uptime = (Get-Date) - $bootTime
        $meta.uptime = "{0}d {1}h {2}m" -f $uptime.Days, $uptime.Hours, $uptime.Minutes
        $meta.totalMemoryMb = [math]::Round($os.TotalVisibleMemorySize / 1024)
    } catch {
        Write-Log "WARN" "Failed to collect OS metadata: $_"
    }

    try {
        $meta.kernelVersion = [System.Environment]::OSVersion.Version.ToString()
    } catch { }

    try {
        $meta.cpuCores = (Get-CimInstance Win32_Processor | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum
    } catch {
        $meta.cpuCores = $env:NUMBER_OF_PROCESSORS
    }

    try {
        $meta.dotnetVersion = [System.Runtime.InteropServices.RuntimeInformation]::FrameworkDescription
    } catch { }

    try {
        $meta.powershellVersion = $PSVersionTable.PSVersion.ToString()
    } catch { }

    return $meta
}

# ─── Build & Send Report ───

function Send-Report {
    param($OsInfo, $Packages, $Services, $Connections, $Metadata)

    $payload = @{
        agentVersion = $AgentVersion
        hostname     = $OsInfo.hostname
        ip           = $OsInfo.ip
        os           = $OsInfo.os
        osVersion    = $OsInfo.osVersion
        arch         = $OsInfo.arch
        reportedAt   = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        packages     = $Packages
        services     = $Services
        connections  = $Connections
        metadata     = $Metadata
    }

    $jsonPayload = $payload | ConvertTo-Json -Depth 5 -Compress
    $endpoint = "$Url/api/v1/agent/report"

    Write-Log "INFO" "Sending report to $endpoint"

    try {
        # Use TLS 1.2+ for HTTPS
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13

        $headers = @{
            "Authorization" = "Bearer $Token"
            "Content-Type"  = "application/json"
        }

        $response = Invoke-RestMethod -Uri $endpoint -Method POST -Headers $headers -Body $jsonPayload -TimeoutSec 30
        Write-Log "INFO" "Report sent successfully: hostname=$($response.hostname), packages=$($response.packagesCount), services=$($response.servicesCount)"
        return $response
    } catch {
        $statusCode = $null
        $responseBody = $null
        if ($_.Exception.Response) {
            $statusCode = [int]$_.Exception.Response.StatusCode
            try {
                $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
                $responseBody = $reader.ReadToEnd()
                $reader.Close()
            } catch { }
        }
        Write-Log "ERROR" "Report failed (HTTP $statusCode): $responseBody - $_"
        return $null
    }
}

# ─── Self-Update ───

function Check-Update {
    param($Response)

    if (-not $Response -or -not $Response.updateAvailable) { return }

    $latestVersion = $Response.latestAgentVersion
    $updateUrl = $Response.updateUrl

    if (-not $updateUrl) {
        Write-Log "INFO" "Update available (v$latestVersion) but no update URL provided"
        return
    }

    if ($script:AutoUpdate -ne $true -and $script:AutoUpdate -ne "true") {
        Write-Log "INFO" "Update available: v$AgentVersion -> v$latestVersion (auto-update disabled)"
        return
    }

    Write-Log "INFO" "Downloading agent update v$latestVersion from $updateUrl"

    $tmpScript = "$env:TEMP\infrawatch-agent-new.ps1"
    try {
        $headers = @{ "Authorization" = "Bearer $Token" }
        Invoke-WebRequest -Uri $updateUrl -Headers $headers -OutFile $tmpScript -TimeoutSec 30 -UseBasicParsing
    } catch {
        Write-Log "ERROR" "Failed to download agent update: $_"
        Remove-Item -Path $tmpScript -Force -ErrorAction SilentlyContinue
        return
    }

    # Basic sanity check — must contain PowerShell content
    $firstLine = Get-Content $tmpScript -First 1 -ErrorAction SilentlyContinue
    if ($firstLine -notmatch "Requires|param|function|<#") {
        Write-Log "ERROR" "Downloaded script failed sanity check: $firstLine"
        Remove-Item -Path $tmpScript -Force -ErrorAction SilentlyContinue
        return
    }

    # Replace the agent script
    $installDir = "C:\ProgramData\InfraWatch"
    $targetPath = "$installDir\infrawatch-agent.ps1"

    try {
        Copy-Item -Path $tmpScript -Destination $targetPath -Force
        Write-Log "INFO" "Agent updated from v$AgentVersion to v$latestVersion"
    } catch {
        Write-Log "ERROR" "Failed to replace agent script at ${targetPath}: $_"
    }

    Remove-Item -Path $tmpScript -Force -ErrorAction SilentlyContinue
}

# ─── Main ───

function Main {
    Write-Log "INFO" "InfraWatch Agent v$AgentVersion starting"

    try {
        Load-Config
    } catch {
        Write-Log "ERROR" "Configuration error: $_"
        exit 1
    }

    $osInfo = Collect-OsInfo
    $packages = @(Collect-Packages)
    $services = @(Collect-Services)
    $connections = @(Collect-Connections)
    $metadata = Collect-Metadata

    # Add Docker containers
    $docker = Collect-Docker
    $packages += @($docker.packages)
    $services += @($docker.services)

    $response = Send-Report -OsInfo $osInfo -Packages $packages -Services $services -Connections $connections -Metadata $metadata

    if ($response) {
        Write-Log "INFO" "Agent run completed successfully"
        Check-Update -Response $response
        exit 0
    } else {
        Write-Log "ERROR" "Agent run failed"
        exit 1
    }
}

Main
