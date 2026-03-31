#!/bin/bash
# InfraWatch Agent for Linux
# Single-file, zero-dependency agent. Requires: bash, curl, and standard Linux tools.
# Usage: INFRAWATCH_URL=https://infrawatch.example.com INFRAWATCH_TOKEN=iw_XXXX ./infrawatch-agent.sh
# Or configure in /etc/infrawatch/agent.conf
#
# Supported: Ubuntu 20.04+, Debian 10+, CentOS 7+, RHEL 7+, Alpine 3.14+, Amazon Linux 2

set -euo pipefail

AGENT_VERSION="1.0.0"
CONFIG_FILE="${INFRAWATCH_CONFIG_FILE:-/etc/infrawatch/agent.conf}"
LOG_FILE="${INFRAWATCH_LOG_FILE:-/var/log/infrawatch-agent.log}"
COLLECT_CONNECTIONS="${COLLECT_CONNECTIONS:-false}"
COLLECT_DOCKER="${COLLECT_DOCKER:-true}"
COLLECT_PIP="${COLLECT_PIP:-false}"
COLLECT_NPM="${COLLECT_NPM:-false}"

# Load config from file if it exists (env vars already set take precedence)
if [ -f "$CONFIG_FILE" ]; then
    # shellcheck source=/dev/null
    source "$CONFIG_FILE"
fi

INFRAWATCH_URL="${INFRAWATCH_URL:?'INFRAWATCH_URL is required (e.g. https://infrawatch.example.com)'}"
INFRAWATCH_TOKEN="${INFRAWATCH_TOKEN:?'INFRAWATCH_TOKEN is required (e.g. iw_abc123...)'}"
REPORT_ENDPOINT="${INFRAWATCH_URL%/}/api/v1/agent/report"

# ─── Logging ───

log() {
    local level="$1"; shift
    local msg
    msg="[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [$level] $*"
    echo "$msg" >> "$LOG_FILE" 2>/dev/null || true
    if [ "$level" = "ERROR" ]; then
        echo "$msg" >&2
    fi
}

# ─── JSON helpers ───
# Escape a string for safe inclusion in a JSON value.
# Handles: backslash, double quote, newline, tab, carriage return, and control chars.

json_escape() {
    local s="$1"
    s="${s//\\/\\\\}"      # backslash first
    s="${s//\"/\\\"}"      # double quote
    s="${s//$'\n'/\\n}"    # newline
    s="${s//$'\r'/\\r}"    # carriage return
    s="${s//$'\t'/\\t}"    # tab
    # Strip any remaining control chars (0x00-0x1F) except those already handled
    # Use tr to remove them as bash parameter expansion can't handle all
    s="$(printf '%s' "$s" | tr -d '\000-\010\013\014\016-\037')"
    printf '%s' "$s"
}

# Build a JSON string field: "key": "value"
json_str() {
    local key="$1" val="$2"
    printf '"%s":"%s"' "$key" "$(json_escape "$val")"
}

# Build a JSON number field: "key": N
json_num() {
    local key="$1" val="$2"
    # Validate it's a number, default to 0
    if [[ "$val" =~ ^[0-9]+$ ]]; then
        printf '"%s":%s' "$key" "$val"
    else
        printf '"%s":0' "$key"
    fi
}

# Build a JSON null field: "key": null
json_null() {
    printf '"%s":null' "$1"
}

# ─── OS Info Collection ───

collect_os_info() {
    log "INFO" "Collecting OS information"

    # Hostname (try FQDN first)
    COLLECTED_HOSTNAME="$(hostname -f 2>/dev/null || hostname 2>/dev/null || echo "unknown")"

    # IP address
    COLLECTED_IP="$(hostname -I 2>/dev/null | awk '{print $1}')" || true
    if [ -z "$COLLECTED_IP" ]; then
        COLLECTED_IP="$(ip route get 1.0.0.0 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}')" || true
    fi
    if [ -z "$COLLECTED_IP" ]; then
        COLLECTED_IP="unknown"
    fi

    # OS info from /etc/os-release
    COLLECTED_OS="Unknown"
    COLLECTED_OS_VERSION=""
    COLLECTED_OS_PRETTY=""
    if [ -f /etc/os-release ]; then
        # shellcheck source=/dev/null
        source /etc/os-release
        # shellcheck disable=SC2034
        COLLECTED_OS="${ID:-Unknown}"
        COLLECTED_OS_VERSION="${VERSION_ID:-}"
        COLLECTED_OS_PRETTY="${PRETTY_NAME:-${COLLECTED_OS}}"
    fi

    # Architecture
    COLLECTED_ARCH="$(uname -m 2>/dev/null || echo "unknown")"

    log "INFO" "OS: ${COLLECTED_OS_PRETTY} (${COLLECTED_ARCH}), Host: ${COLLECTED_HOSTNAME}, IP: ${COLLECTED_IP}"
}

# ─── Package Collection ───

collect_packages() {
    log "INFO" "Collecting installed packages"

    PACKAGES_JSON=""
    local count=0

    # Debian/Ubuntu (dpkg)
    if command -v dpkg-query >/dev/null 2>&1; then
        log "INFO" "Detected dpkg package manager"
        while IFS=$'\t' read -r name version; do
            [ -z "$name" ] && continue
            local obj
            obj="{$(json_str "name" "$name"),$(json_str "version" "$version"),$(json_str "manager" "apt"),$(json_str "ecosystem" "debian")}"
            if [ -n "$PACKAGES_JSON" ]; then
                PACKAGES_JSON="${PACKAGES_JSON},${obj}"
            else
                PACKAGES_JSON="$obj"
            fi
            count=$((count + 1))
        done < <(dpkg-query -W -f='${Package}\t${Version}\n' 2>/dev/null || true)
    fi

    # RHEL/CentOS (rpm)
    if command -v rpm >/dev/null 2>&1 && [ "$count" -eq 0 ]; then
        log "INFO" "Detected rpm package manager"
        while IFS=$'\t' read -r name version; do
            [ -z "$name" ] && continue
            local obj
            obj="{$(json_str "name" "$name"),$(json_str "version" "$version"),$(json_str "manager" "yum"),$(json_str "ecosystem" "rhel")}"
            if [ -n "$PACKAGES_JSON" ]; then
                PACKAGES_JSON="${PACKAGES_JSON},${obj}"
            else
                PACKAGES_JSON="$obj"
            fi
            count=$((count + 1))
        done < <(rpm -qa --queryformat '%{NAME}\t%{VERSION}-%{RELEASE}\n' 2>/dev/null || true)
    fi

    # Alpine (apk)
    if command -v apk >/dev/null 2>&1 && [ "$count" -eq 0 ]; then
        log "INFO" "Detected apk package manager"
        while IFS=' ' read -r nameversion rest; do
            [ -z "$nameversion" ] && continue
            # apk format: "name-version-rN arch {origin} (license)"
            # Extract name and version by splitting on last two hyphens
            local name version
            # Use sed to split: everything up to the last hyphen-digit is the name
            name="${nameversion%-[0-9]*}"
            version="${nameversion#"${name}-"}"
            local obj
            obj="{$(json_str "name" "$name"),$(json_str "version" "$version"),$(json_str "manager" "apk"),$(json_str "ecosystem" "alpine")}"
            if [ -n "$PACKAGES_JSON" ]; then
                PACKAGES_JSON="${PACKAGES_JSON},${obj}"
            else
                PACKAGES_JSON="$obj"
            fi
            count=$((count + 1))
        done < <(apk list -I 2>/dev/null || true)
    fi

    # Optional: pip packages
    if [ "$COLLECT_PIP" = "true" ] && command -v pip3 >/dev/null 2>&1; then
        log "INFO" "Collecting pip packages"
        local pip_json
        pip_json="$(pip3 list --format=json 2>/dev/null || echo "[]")"
        # Parse minimal JSON: [{"name":"X","version":"Y"},...]
        # Use grep/sed since we can't rely on jq
        while IFS= read -r line; do
            local name version
            name="$(echo "$line" | sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
            version="$(echo "$line" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
            [ -z "$name" ] && continue
            local obj
            obj="{$(json_str "name" "$name"),$(json_str "version" "$version"),$(json_str "manager" "pip"),$(json_str "ecosystem" "pypi")}"
            if [ -n "$PACKAGES_JSON" ]; then
                PACKAGES_JSON="${PACKAGES_JSON},${obj}"
            else
                PACKAGES_JSON="$obj"
            fi
            count=$((count + 1))
        done < <(echo "$pip_json" | tr ',' '\n' | tr -d '[]{}' | paste - - 2>/dev/null || true)
    fi

    # Optional: npm global packages
    if [ "$COLLECT_NPM" = "true" ] && command -v npm >/dev/null 2>&1; then
        log "INFO" "Collecting npm global packages"
        local npm_out
        npm_out="$(npm list -g --depth=0 --json 2>/dev/null || echo "{}")"
        # Parse dependencies from JSON
        while IFS= read -r line; do
            local name version
            name="$(echo "$line" | sed -n 's/.*"\([^"]*\)"[[:space:]]*:.*/\1/p')"
            version="$(echo "$line" | sed -n 's/.*:[[:space:]]*{.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
            [ -z "$name" ] || [ -z "$version" ] && continue
            local obj
            obj="{$(json_str "name" "$name"),$(json_str "version" "$version"),$(json_str "manager" "npm"),$(json_str "ecosystem" "npm")}"
            if [ -n "$PACKAGES_JSON" ]; then
                PACKAGES_JSON="${PACKAGES_JSON},${obj}"
            else
                PACKAGES_JSON="$obj"
            fi
            count=$((count + 1))
        done < <(echo "$npm_out" | grep -E '"[^"]+"\s*:\s*\{' 2>/dev/null || true)
    fi

    log "INFO" "Collected $count packages"
}

# ─── Service Collection ───

# Detect the version of a known service
detect_service_version() {
    local name="$1"
    local version=""

    case "$name" in
        nginx*)
            version="$(nginx -v 2>&1 | grep -oP '[\d.]+' | head -1)" || true
            ;;
        apache2*|httpd*)
            version="$(apache2 -v 2>&1 | head -1 | grep -oP '[\d.]+' | head -1)" || true
            if [ -z "$version" ]; then
                version="$(httpd -v 2>&1 | head -1 | grep -oP '[\d.]+' | head -1)" || true
            fi
            ;;
        postgres*)
            version="$(psql --version 2>/dev/null | grep -oP '[\d.]+' | head -1)" || true
            ;;
        mysql*|mariadb*)
            version="$(mysql --version 2>/dev/null | grep -oP '[\d.]+' | head -1)" || true
            ;;
        redis*)
            version="$(redis-server --version 2>/dev/null | grep -oP 'v=[\d.]+' | cut -d= -f2)" || true
            ;;
        docker*)
            version="$(docker --version 2>/dev/null | grep -oP '[\d.]+' | head -1)" || true
            ;;
        node*)
            version="$(node --version 2>/dev/null | tr -d 'v')" || true
            ;;
        java*|jvm*)
            version="$(java -version 2>&1 | head -1 | grep -oP '[\d._]+' | head -1)" || true
            ;;
        sshd*|ssh*)
            version="$(sshd -V 2>&1 | grep -oiP 'OpenSSH_[\d.p]+' | sed 's/OpenSSH_//' | head -1)" || true
            ;;
    esac

    printf '%s' "$version"
}

# Classify a service into a type
classify_service() {
    local name="$1"
    case "$name" in
        nginx*|apache2*|httpd*)             echo "webserver" ;;
        postgres*|mysql*|mariadb*|mongo*)   echo "database" ;;
        redis*|memcached*)                  echo "cache" ;;
        docker*|containerd*)                echo "container-runtime" ;;
        sshd*|ssh*)                         echo "remote-access" ;;
        cron*|atd*)                         echo "scheduler" ;;
        node*|java*|python*|ruby*|php*)     echo "runtime" ;;
        haproxy*|envoy*|traefik*)           echo "proxy" ;;
        *)                                  echo "system" ;;
    esac
}

# Build a port lookup: newline-separated "process=port" entries
PORT_MAP_DATA=""

build_port_map() {
    PORT_MAP_DATA=""
    local line
    # Try ss first, fall back to netstat
    local ss_output
    ss_output="$(ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || true)"
    [ -z "$ss_output" ] && return

    while IFS= read -r line; do
        # ss format: LISTEN ... 0.0.0.0:80 ... users:(("nginx",pid=1234,...))
        local port proc
        port="$(echo "$line" | grep -oP '(?<=:)\d+(?=\s)' | head -1)" || true
        proc="$(echo "$line" | grep -oP '(?<=\(\(")[^"]+' | head -1)" || true
        if [ -n "$port" ] && [ -n "$proc" ]; then
            PORT_MAP_DATA="${PORT_MAP_DATA}${proc}=${port}"$'\n'
        fi
    done <<< "$ss_output"
}

# Look up a port by process name
port_for_process() {
    local name="$1"
    echo "$PORT_MAP_DATA" | grep "^${name}=" | head -1 | cut -d= -f2
}

collect_services() {
    log "INFO" "Collecting running services"

    SERVICES_JSON=""
    local count=0

    build_port_map

    # systemd-based systems
    if command -v systemctl >/dev/null 2>&1; then
        while IFS= read -r unit_line; do
            [ -z "$unit_line" ] && continue
            # Format: "unit.service loaded active running Description..."
            local svc_name
            svc_name="$(echo "$unit_line" | awk '{print $1}' | sed 's/\.service$//')"
            [ -z "$svc_name" ] && continue

            local version svc_type
            version="$(detect_service_version "$svc_name")"
            svc_type="$(classify_service "$svc_name")"

            # Try to find port from our map
            local port_val
            port_val="$(port_for_process "$svc_name")"

            local obj="{"
            obj+="$(json_str "name" "$svc_name")"
            obj+=",$(json_str "type" "$svc_type")"
            if [ -n "$version" ]; then
                obj+=",$(json_str "version" "$version")"
            fi
            if [ -n "$port_val" ] && [[ "$port_val" =~ ^[0-9]+$ ]]; then
                obj+=",$(json_num "port" "$port_val")"
            fi
            obj+=",$(json_str "status" "running")"
            obj+="}"

            if [ -n "$SERVICES_JSON" ]; then
                SERVICES_JSON="${SERVICES_JSON},${obj}"
            else
                SERVICES_JSON="$obj"
            fi
            count=$((count + 1))
        done < <(systemctl list-units --type=service --state=running --no-pager --plain --no-legend 2>/dev/null || true)
    fi

    # OpenRC fallback (Alpine, Gentoo)
    if [ "$count" -eq 0 ] && command -v rc-status >/dev/null 2>&1; then
        while IFS= read -r line; do
            local svc_name
            svc_name="$(echo "$line" | awk '/\[.*started.*\]/{print $1}')"
            [ -z "$svc_name" ] && continue

            local version svc_type
            version="$(detect_service_version "$svc_name")"
            svc_type="$(classify_service "$svc_name")"

            local obj="{"
            obj+="$(json_str "name" "$svc_name")"
            obj+=",$(json_str "type" "$svc_type")"
            if [ -n "$version" ]; then
                obj+=",$(json_str "version" "$version")"
            fi
            obj+=",$(json_str "status" "running")"
            obj+="}"

            if [ -n "$SERVICES_JSON" ]; then
                SERVICES_JSON="${SERVICES_JSON},${obj}"
            else
                SERVICES_JSON="$obj"
            fi
            count=$((count + 1))
        done < <(rc-status 2>/dev/null || true)
    fi

    log "INFO" "Collected $count services"
}

# ─── Connection Collection ───

collect_connections() {
    CONNECTIONS_JSON=""

    if [ "$COLLECT_CONNECTIONS" != "true" ]; then
        return
    fi

    log "INFO" "Collecting established connections"
    local count=0

    local ss_output
    ss_output="$(ss -tnp 2>/dev/null | grep 'ESTAB' || true)"
    [ -z "$ss_output" ] && return

    while IFS= read -r line; do
        # ss format: ESTAB 0 0 10.0.0.1:80 10.0.0.5:54321 users:(("nginx",pid=...))
        local local_addr remote_addr proc_info
        local_addr="$(echo "$line" | awk '{print $4}')"
        remote_addr="$(echo "$line" | awk '{print $5}')"
        proc_info="$(echo "$line" | grep -oP '(?<=\(\(")[^"]+' | head -1)" || true

        [ -z "$local_addr" ] || [ -z "$remote_addr" ] && continue

        local local_port remote_ip remote_port
        local_port="$(echo "$local_addr" | grep -oP '(?<=:)\d+$')" || true
        remote_ip="${remote_addr%:*}"
        remote_port="$(echo "$remote_addr" | grep -oP '(?<=:)\d+$')" || true

        # Skip loopback
        case "$remote_ip" in
            127.*|::1|localhost) continue ;;
        esac

        [ -z "$local_port" ] || [ -z "$remote_port" ] && continue

        local obj="{"
        obj+="$(json_num "localPort" "$local_port")"
        obj+=",$(json_str "remoteIp" "$remote_ip")"
        obj+=",$(json_num "remotePort" "$remote_port")"
        if [ -n "$proc_info" ]; then
            obj+=",$(json_str "processName" "$proc_info")"
        else
            obj+=",$(json_null "processName")"
        fi
        obj+=",$(json_str "protocol" "tcp")"
        obj+="}"

        if [ -n "$CONNECTIONS_JSON" ]; then
            CONNECTIONS_JSON="${CONNECTIONS_JSON},${obj}"
        else
            CONNECTIONS_JSON="$obj"
        fi
        count=$((count + 1))
    done <<< "$ss_output"

    log "INFO" "Collected $count connections"
}

# ─── Docker Container Collection ───

collect_docker() {
    DOCKER_PACKAGES_JSON=""
    DOCKER_SERVICES_JSON=""

    if [ "$COLLECT_DOCKER" != "true" ]; then
        return
    fi

    if ! command -v docker >/dev/null 2>&1; then
        return
    fi

    # Check if we can talk to the Docker daemon
    if ! docker info >/dev/null 2>&1; then
        log "WARN" "Docker command found but daemon is not accessible (try running as root or adding user to docker group)"
        return
    fi

    log "INFO" "Collecting Docker containers"
    local count=0

    while IFS=$'\t' read -r image cname _status ports; do
        [ -z "$image" ] && continue

        # Add image as a package
        local img_name img_version
        img_name="$(echo "$image" | cut -d: -f1)"
        img_version="$(echo "$image" | cut -d: -f2 -s)"
        [ -z "$img_version" ] && img_version="latest"

        local pkg_obj
        pkg_obj="{$(json_str "name" "$img_name"),$(json_str "version" "$img_version"),$(json_str "manager" "docker"),$(json_str "ecosystem" "docker")}"
        if [ -n "$DOCKER_PACKAGES_JSON" ]; then
            DOCKER_PACKAGES_JSON="${DOCKER_PACKAGES_JSON},${pkg_obj}"
        else
            DOCKER_PACKAGES_JSON="$pkg_obj"
        fi

        # Add container as a service
        # Extract first mapped port if available (format: "0.0.0.0:8080->80/tcp, ...")
        local container_port="null"
        if [ -n "$ports" ]; then
            local first_port
            first_port="$(echo "$ports" | grep -oP '\d+(?=->)' | head -1)" || true
            if [ -n "$first_port" ] && [[ "$first_port" =~ ^[0-9]+$ ]]; then
                container_port="$first_port"
            fi
        fi

        local svc_obj="{"
        svc_obj+="$(json_str "name" "$cname")"
        svc_obj+=",$(json_str "type" "container-runtime")"
        svc_obj+=",$(json_str "version" "$img_version")"
        if [ "$container_port" != "null" ]; then
            svc_obj+=",$(json_num "port" "$container_port")"
        fi
        svc_obj+=",$(json_str "status" "running")"
        svc_obj+="}"

        if [ -n "$DOCKER_SERVICES_JSON" ]; then
            DOCKER_SERVICES_JSON="${DOCKER_SERVICES_JSON},${svc_obj}"
        else
            DOCKER_SERVICES_JSON="$svc_obj"
        fi
        count=$((count + 1))
    done < <(docker ps --format '{{.Image}}\t{{.Names}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null || true)

    log "INFO" "Collected $count Docker containers"
}

# ─── Metadata Collection ───

collect_metadata() {
    log "INFO" "Collecting system metadata"

    META_UPTIME="$(uptime -p 2>/dev/null || uptime 2>/dev/null | sed 's/.*up/up/' || echo "unknown")"
    META_KERNEL="$(uname -r 2>/dev/null || echo "unknown")"
    META_MEMORY="$(free -m 2>/dev/null | awk '/Mem:/{print $2}' || echo "0")"
    META_CPUS="$(nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo 2>/dev/null || echo "0")"
}

# ─── Build & Send Payload ───

build_payload() {
    # Merge system packages with Docker packages
    local all_packages="$PACKAGES_JSON"
    if [ -n "$DOCKER_PACKAGES_JSON" ]; then
        if [ -n "$all_packages" ]; then
            all_packages="${all_packages},${DOCKER_PACKAGES_JSON}"
        else
            all_packages="$DOCKER_PACKAGES_JSON"
        fi
    fi

    # Merge system services with Docker services
    local all_services="$SERVICES_JSON"
    if [ -n "$DOCKER_SERVICES_JSON" ]; then
        if [ -n "$all_services" ]; then
            all_services="${all_services},${DOCKER_SERVICES_JSON}"
        else
            all_services="$DOCKER_SERVICES_JSON"
        fi
    fi

    PAYLOAD="{"
    PAYLOAD+="$(json_str "agentVersion" "$AGENT_VERSION")"
    PAYLOAD+=",$(json_str "hostname" "$COLLECTED_HOSTNAME")"
    PAYLOAD+=",$(json_str "ip" "$COLLECTED_IP")"
    PAYLOAD+=",$(json_str "os" "$COLLECTED_OS_PRETTY")"
    PAYLOAD+=",$(json_str "osVersion" "$COLLECTED_OS_VERSION")"
    PAYLOAD+=",$(json_str "arch" "$COLLECTED_ARCH")"
    PAYLOAD+=",$(json_str "reportedAt" "$(date -u +%Y-%m-%dT%H:%M:%SZ)")"
    PAYLOAD+=",\"packages\":[${all_packages}]"
    PAYLOAD+=",\"services\":[${all_services}]"
    PAYLOAD+=",\"connections\":[${CONNECTIONS_JSON}]"
    PAYLOAD+=",\"metadata\":{"
    PAYLOAD+="$(json_str "uptime" "$META_UPTIME")"
    PAYLOAD+=",$(json_str "kernelVersion" "$META_KERNEL")"
    PAYLOAD+=",$(json_num "totalMemoryMb" "$META_MEMORY")"
    PAYLOAD+=",$(json_num "cpuCores" "$META_CPUS")"
    PAYLOAD+="}"
    PAYLOAD+="}"
}

send_report() {
    log "INFO" "Sending report to ${REPORT_ENDPOINT}"

    local response http_code body

    response="$(curl -s -S -X POST "$REPORT_ENDPOINT" \
        -H "Authorization: Bearer ${INFRAWATCH_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "$PAYLOAD" \
        -w "\n%{http_code}" \
        --max-time 30 \
        --retry 3 \
        --retry-delay 10 \
        2>&1)" || {
        log "ERROR" "curl failed to connect to ${REPORT_ENDPOINT}"
        return 1
    }

    # Last line is the HTTP status code
    http_code="$(echo "$response" | tail -1)"
    body="$(echo "$response" | sed '$d')"

    if [ "$http_code" -ge 200 ] 2>/dev/null && [ "$http_code" -lt 300 ] 2>/dev/null; then
        log "INFO" "Report sent successfully (HTTP ${http_code}): ${body}"
        return 0
    else
        log "ERROR" "Report failed (HTTP ${http_code}): ${body}"
        return 1
    fi
}

# ─── Main ───

main() {
    log "INFO" "InfraWatch Agent v${AGENT_VERSION} starting"

    collect_os_info
    collect_packages
    collect_services
    collect_connections
    collect_docker
    collect_metadata
    build_payload
    send_report

    local exit_code=$?
    if [ "$exit_code" -eq 0 ]; then
        log "INFO" "Agent run completed successfully"
    else
        log "ERROR" "Agent run failed"
    fi

    exit "$exit_code"
}

main "$@"
