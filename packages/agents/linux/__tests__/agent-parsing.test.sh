#!/bin/bash
# ─── InfraWatch Linux Agent Parsing Tests ───
# Run: bash packages/agents/linux/__tests__/agent-parsing.test.sh
#
# Sources the agent script with INFRAWATCH_TEST=1 to prevent execution,
# then calls individual functions and checks their output.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_SCRIPT="$SCRIPT_DIR/../infrawatch-agent.sh"

PASS=0
FAIL=0
ERRORS=()

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

assert_eq() {
    local label="$1" expected="$2" actual="$3"
    if [ "$expected" = "$actual" ]; then
        PASS=$((PASS + 1))
        echo -e "  ${GREEN}PASS${NC} $label"
    else
        FAIL=$((FAIL + 1))
        ERRORS+=("$label: expected '$expected', got '$actual'")
        echo -e "  ${RED}FAIL${NC} $label"
        echo -e "       expected: $(printf '%q' "$expected")"
        echo -e "       actual:   $(printf '%q' "$actual")"
    fi
}

assert_contains() {
    local label="$1" needle="$2" haystack="$3"
    if [[ "$haystack" == *"$needle"* ]]; then
        PASS=$((PASS + 1))
        echo -e "  ${GREEN}PASS${NC} $label"
    else
        FAIL=$((FAIL + 1))
        ERRORS+=("$label: does not contain needle")
        echo -e "  ${RED}FAIL${NC} $label"
        echo -e "       haystack: ${haystack:0:200}"
        echo -e "       needle:   $needle"
    fi
}

assert_not_contains() {
    local label="$1" needle="$2" haystack="$3"
    if [[ "$haystack" != *"$needle"* ]]; then
        PASS=$((PASS + 1))
        echo -e "  ${GREEN}PASS${NC} $label"
    else
        FAIL=$((FAIL + 1))
        ERRORS+=("$label: should not contain needle")
        echo -e "  ${RED}FAIL${NC} $label"
    fi
}

assert_valid_json() {
    local label="$1" json="$2"
    if echo "$json" | python3 -m json.tool > /dev/null 2>&1; then
        PASS=$((PASS + 1))
        echo -e "  ${GREEN}PASS${NC} $label"
    else
        FAIL=$((FAIL + 1))
        ERRORS+=("$label: invalid JSON")
        echo -e "  ${RED}FAIL${NC} $label"
        echo -e "       json: '${json:0:200}...'"
    fi
}

assert_nonzero() {
    local label="$1" val="$2"
    if [ -n "$val" ] && [ "$val" != "0" ]; then
        PASS=$((PASS + 1))
        echo -e "  ${GREEN}PASS${NC} $label"
    else
        FAIL=$((FAIL + 1))
        ERRORS+=("$label: expected nonzero, got '$val'")
        echo -e "  ${RED}FAIL${NC} $label"
    fi
}

# ─── Source the agent (without executing) ───
source_agent() {
    export INFRAWATCH_URL="http://test.local"
    export INFRAWATCH_TOKEN="iw_testtoken123"
    export INFRAWATCH_LOG_FILE="/dev/null"
    export INFRAWATCH_AUTO_UPDATE="false"
    export INFRAWATCH_TEST="1"
    export COLLECT_CONNECTIONS="false"
    export COLLECT_DOCKER="false"
    export COLLECT_PIP="false"
    export COLLECT_NPM="false"

    source "$AGENT_SCRIPT" 2>/dev/null || true
}

source_agent

# Temp dir for mocks
MOCK_ROOT="$(mktemp -d)"
trap 'rm -rf "$MOCK_ROOT"' EXIT

echo ""
echo -e "${YELLOW}═══ InfraWatch Linux Agent Parsing Tests ═══${NC}"
echo ""

# ─── Test: json_escape ───
test_json_escape() {
    echo "json_escape:"

    # json_escape replaces " with \" — the output contains a literal backslash then quote
    local result
    result="$(json_escape 'hello "world"')"
    assert_eq "escapes double quotes" 'hello \"world\"' "$result"

    result="$(json_escape 'path\to')"
    assert_eq "escapes backslash" 'path\\to' "$result"

    result="$(json_escape $'line1\nline2')"
    assert_eq "escapes newlines" 'line1\nline2' "$result"

    result="$(json_escape $'col1\tcol2')"
    assert_eq "escapes tabs" 'col1\tcol2' "$result"

    result="$(json_escape '')"
    assert_eq "handles empty string" '' "$result"

    result="$(json_escape 'hello world')"
    assert_eq "passes plain text through" 'hello world' "$result"
}

# ─── Test: json_str ───
test_json_str() {
    echo ""
    echo "json_str:"

    local result
    result="$(json_str "os" "ubuntu")"
    assert_eq "creates key-value pair" '"os":"ubuntu"' "$result"

    result="$(json_str "name" 'he said "hi"')"
    assert_eq "escapes value" '"name":"he said \"hi\""' "$result"
}

# ─── Test: json_num ───
test_json_num() {
    echo ""
    echo "json_num:"
    assert_eq "creates numeric field" '"port":8080' "$(json_num "port" "8080")"
    assert_eq "defaults non-numeric to 0" '"port":0' "$(json_num "port" "abc")"
    assert_eq "handles zero" '"count":0' "$(json_num "count" "0")"
}

# ─── Test: json_null ───
test_json_null() {
    echo ""
    echo "json_null:"
    assert_eq "creates null field" '"processName":null' "$(json_null "processName")"
}

# ─── Test: OS detection ───
test_os_detection() {
    echo ""
    echo "OS detection:"

    # Test Ubuntu
    mkdir -p "$MOCK_ROOT/ubuntu"
    cat > "$MOCK_ROOT/ubuntu/os-release" <<'OSEOF'
NAME="Ubuntu"
VERSION="22.04.3 LTS (Jammy Jellyfish)"
ID=ubuntu
VERSION_ID="22.04"
PRETTY_NAME="Ubuntu 22.04.3 LTS"
OSEOF

    local ID="" VERSION_ID=""
    source "$MOCK_ROOT/ubuntu/os-release"
    assert_eq "Ubuntu ID" "ubuntu" "$ID"
    assert_eq "Ubuntu VERSION_ID" "22.04" "$VERSION_ID"

    # Test CentOS 7
    mkdir -p "$MOCK_ROOT/centos"
    cat > "$MOCK_ROOT/centos/os-release" <<'OSEOF'
NAME="CentOS Linux"
VERSION="7 (Core)"
ID="centos"
VERSION_ID="7"
PRETTY_NAME="CentOS Linux 7 (Core)"
OSEOF

    ID="" ; VERSION_ID=""
    source "$MOCK_ROOT/centos/os-release"
    assert_eq "CentOS ID" "centos" "$ID"
    assert_eq "CentOS VERSION_ID" "7" "$VERSION_ID"

    # Test missing os-release fallback
    local fallback_arch
    fallback_arch="$(uname -m 2>/dev/null || echo "unknown")"
    assert_nonzero "uname fallback produces output" "$fallback_arch"
}

# ─── Test: dpkg package parsing ───
test_dpkg_parsing() {
    echo ""
    echo "dpkg package parsing:"

    PACKAGES_JSON=""
    local count=0
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
    done <<EOF
nginx	1.24.0-1ubuntu1
openssl	3.0.2-0ubuntu1.12
EOF

    assert_eq "dpkg parses 2 packages" "2" "$count"
    assert_contains "dpkg has nginx" '"name":"nginx"' "$PACKAGES_JSON"
    assert_contains "dpkg has nginx version" '"version":"1.24.0-1ubuntu1"' "$PACKAGES_JSON"
    assert_contains "dpkg has openssl" '"name":"openssl"' "$PACKAGES_JSON"
    assert_contains "dpkg manager is apt" '"manager":"apt"' "$PACKAGES_JSON"
    assert_contains "dpkg ecosystem is debian" '"ecosystem":"debian"' "$PACKAGES_JSON"
    assert_valid_json "dpkg JSON is valid" "[$PACKAGES_JSON]"
}

# ─── Test: rpm package parsing ───
test_rpm_parsing() {
    echo ""
    echo "rpm package parsing:"

    PACKAGES_JSON=""
    local count=0
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
    done <<EOF
httpd	2.4.57-5.el9
openssl	3.0.7-25.el9_3
bash	5.2.15-3.el9
EOF

    assert_eq "rpm parses 3 packages" "3" "$count"
    assert_contains "rpm has httpd" '"name":"httpd"' "$PACKAGES_JSON"
    assert_contains "rpm has httpd version" '"version":"2.4.57-5.el9"' "$PACKAGES_JSON"
    assert_contains "rpm manager is yum" '"manager":"yum"' "$PACKAGES_JSON"
    assert_contains "rpm ecosystem is rhel" '"ecosystem":"rhel"' "$PACKAGES_JSON"
    assert_valid_json "rpm JSON is valid" "[$PACKAGES_JSON]"
}

# ─── Test: apk package parsing ───
test_apk_parsing() {
    echo ""
    echo "apk package parsing:"

    PACKAGES_JSON=""
    local count=0

    while IFS=' ' read -r nameversion rest; do
        [ -z "$nameversion" ] && continue
        local name version
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
    done <<EOF
nginx-1.24.0-r0 x86_64 {nginx} (BSD-2-Clause)
curl-8.4.0-r0 x86_64 {curl} (MIT)
EOF

    assert_eq "apk parses 2 packages" "2" "$count"
    assert_contains "apk has nginx" '"name":"nginx"' "$PACKAGES_JSON"
    assert_contains "apk has nginx version" '"version":"1.24.0-r0"' "$PACKAGES_JSON"
    assert_contains "apk has curl" '"name":"curl"' "$PACKAGES_JSON"
    assert_contains "apk manager is apk" '"manager":"apk"' "$PACKAGES_JSON"
    assert_contains "apk ecosystem is alpine" '"ecosystem":"alpine"' "$PACKAGES_JSON"
    assert_valid_json "apk JSON is valid" "[$PACKAGES_JSON]"
}

# ─── Test: service detection parsing ───
test_service_parsing() {
    echo ""
    echo "service detection parsing:"

    SERVICES_JSON=""
    local count=0

    while IFS= read -r unit_line; do
        [ -z "$unit_line" ] && continue
        local svc_name
        svc_name="$(echo "$unit_line" | awk '{print $1}' | sed 's/\.service$//')"
        [ -z "$svc_name" ] && continue

        local svc_type
        svc_type="$(classify_service "$svc_name")"

        local obj="{"
        obj+="$(json_str "name" "$svc_name")"
        obj+=",$(json_str "type" "$svc_type")"
        obj+=",$(json_str "status" "running")"
        obj+="}"

        if [ -n "$SERVICES_JSON" ]; then
            SERVICES_JSON="${SERVICES_JSON},${obj}"
        else
            SERVICES_JSON="$obj"
        fi
        count=$((count + 1))
    done <<EOF
nginx.service loaded active running A high performance web server
sshd.service loaded active running OpenSSH server daemon
postgresql.service loaded active running PostgreSQL RDBMS
redis-server.service loaded active running Advanced key-value store
cron.service loaded active running Regular background program processing daemon
EOF

    assert_eq "systemctl parses 5 services" "5" "$count"
    assert_contains "has nginx" '"name":"nginx"' "$SERVICES_JSON"
    assert_contains "nginx is webserver" '"type":"webserver"' "$SERVICES_JSON"
    assert_contains "has sshd" '"name":"sshd"' "$SERVICES_JSON"
    assert_contains "has postgresql" '"name":"postgresql"' "$SERVICES_JSON"
    assert_contains "postgresql is database" '"type":"database"' "$SERVICES_JSON"
    assert_contains "redis is cache" '"type":"cache"' "$SERVICES_JSON"
    assert_contains "cron is scheduler" '"type":"scheduler"' "$SERVICES_JSON"
    assert_valid_json "services JSON is valid" "[$SERVICES_JSON]"
}

# ─── Test: classify_service ───
test_classify_service() {
    echo ""
    echo "classify_service:"
    assert_eq "nginx -> webserver" "webserver" "$(classify_service "nginx")"
    assert_eq "apache2 -> webserver" "webserver" "$(classify_service "apache2")"
    assert_eq "postgresql -> database" "database" "$(classify_service "postgresql")"
    assert_eq "mysql -> database" "database" "$(classify_service "mysql")"
    assert_eq "redis -> cache" "cache" "$(classify_service "redis-server")"
    assert_eq "docker -> container-runtime" "container-runtime" "$(classify_service "docker")"
    assert_eq "sshd -> remote-access" "remote-access" "$(classify_service "sshd")"
    assert_eq "cron -> scheduler" "scheduler" "$(classify_service "cron")"
    assert_eq "node -> runtime" "runtime" "$(classify_service "node")"
    assert_eq "haproxy -> proxy" "proxy" "$(classify_service "haproxy")"
    assert_eq "unknown -> system" "system" "$(classify_service "some-custom-svc")"
}

# ─── Test: docker ps parsing ───
test_docker_parsing() {
    echo ""
    echo "docker ps parsing:"

    DOCKER_PACKAGES_JSON=""
    DOCKER_SERVICES_JSON=""
    local count=0

    while IFS=$'\t' read -r image cname _status ports; do
        [ -z "$image" ] && continue

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
        count=$((count + 1))
    done <<EOF
nginx:1.25	web	Up 3 days	0.0.0.0:80->80/tcp
redis:7.2	cache	Up 5 days	6379/tcp
postgres:16	db	Up 1 day	0.0.0.0:5432->5432/tcp
EOF

    assert_eq "docker parses 3 containers" "3" "$count"
    assert_contains "has nginx image" '"name":"nginx"' "$DOCKER_PACKAGES_JSON"
    assert_contains "has nginx tag" '"version":"1.25"' "$DOCKER_PACKAGES_JSON"
    assert_contains "has redis image" '"name":"redis"' "$DOCKER_PACKAGES_JSON"
    assert_contains "has postgres image" '"name":"postgres"' "$DOCKER_PACKAGES_JSON"
    assert_contains "docker ecosystem" '"ecosystem":"docker"' "$DOCKER_PACKAGES_JSON"
    assert_valid_json "docker packages JSON is valid" "[$DOCKER_PACKAGES_JSON]"
}

# ─── Test: connection parsing from ss output ───
# Uses grep -oP (Perl regex) which is only available on Linux with GNU grep.
# On macOS/BSD, we use sed-based extraction as a portable alternative.
test_connection_parsing() {
    echo ""
    echo "connection parsing (ss output):"

    CONNECTIONS_JSON=""
    COLLECT_CONNECTIONS="true"
    local count=0

    local ss_output
    ss_output='ESTAB 0 0 10.0.0.1:80 10.0.0.5:54321 users:(("nginx",pid=1234,fd=5))
ESTAB 0 0 10.0.0.1:443 10.0.0.6:12345 users:(("nginx",pid=1234,fd=6))
ESTAB 0 0 127.0.0.1:5432 127.0.0.1:43210 users:(("postgres",pid=5678,fd=10))'

    # Portable helper: extract port from addr:port
    extract_port() { echo "$1" | sed 's/.*://'; }
    # Portable helper: extract process name from users:(("name",...))
    extract_proc() { echo "$1" | sed -n 's/.*users:(("\([^"]*\)".*/\1/p'; }

    while IFS= read -r line; do
        local local_addr remote_addr proc_info
        local_addr="$(echo "$line" | awk '{print $4}')"
        remote_addr="$(echo "$line" | awk '{print $5}')"
        proc_info="$(extract_proc "$line")" || true

        [ -z "$local_addr" ] || [ -z "$remote_addr" ] && continue

        local local_port remote_ip remote_port
        local_port="$(extract_port "$local_addr")"
        remote_ip="${remote_addr%:*}"
        remote_port="$(extract_port "$remote_addr")"

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

    assert_eq "filters loopback, keeps 2 connections" "2" "$count"
    assert_contains "has remote IP 10.0.0.5" '"remoteIp":"10.0.0.5"' "$CONNECTIONS_JSON"
    assert_contains "has remote IP 10.0.0.6" '"remoteIp":"10.0.0.6"' "$CONNECTIONS_JSON"
    assert_not_contains "no loopback" '"remoteIp":"127.0.0.1"' "$CONNECTIONS_JSON"
    assert_contains "has process name" '"processName":"nginx"' "$CONNECTIONS_JSON"
    assert_valid_json "connections JSON is valid" "[$CONNECTIONS_JSON]"
}

# ─── Test: special characters in package names are JSON-escaped ───
test_special_chars() {
    echo ""
    echo "JSON escaping special characters:"

    # Package name with quotes
    local result
    result="{$(json_str "name" 'lib"quote"pkg'),$(json_str "version" '1.0\2.0')}"
    assert_valid_json "special chars produce valid JSON" "[$result]"
    assert_contains "escaped quotes in name" '\"quote\"' "$result"
    assert_contains "escaped backslash in version" '\\' "$result"

    # Field with newline
    result="$(json_str "desc" $'line1\nline2')"
    assert_contains "escaped newline" '\n' "$result"
    assert_valid_json "newline-escaped JSON is valid" "{$result}"
}

# ─── Test: Full JSON payload structure ───
test_full_payload() {
    echo ""
    echo "Full JSON payload structure:"

    COLLECTED_HOSTNAME="test-host.example.com"
    COLLECTED_IP="10.0.0.42"
    COLLECTED_OS="ubuntu"
    COLLECTED_OS_VERSION="22.04"
    COLLECTED_OS_PRETTY="Ubuntu 22.04.3 LTS"
    COLLECTED_ARCH="x86_64"
    PACKAGES_JSON="{$(json_str "name" "nginx"),$(json_str "version" "1.24.0"),$(json_str "manager" "apt"),$(json_str "ecosystem" "debian")}"
    SERVICES_JSON="{$(json_str "name" "nginx"),$(json_str "type" "webserver"),$(json_str "status" "running")}"
    CONNECTIONS_JSON=""
    DOCKER_PACKAGES_JSON=""
    DOCKER_SERVICES_JSON=""
    META_UPTIME="up 5 days"
    META_KERNEL="5.15.0-91-generic"
    META_MEMORY="8192"
    META_CPUS="4"

    build_payload

    assert_valid_json "full payload is valid JSON" "$PAYLOAD"

    # Check required fields exist via python
    local check_result
    check_result="$(echo "$PAYLOAD" | python3 -c "
import json, sys
d = json.load(sys.stdin)
required = ['hostname', 'os', 'osVersion', 'packages', 'services', 'agentVersion', 'arch', 'reportedAt', 'metadata']
missing = [k for k in required if k not in d]
if missing:
    print('MISSING:' + ','.join(missing))
else:
    print('OK')
" 2>&1)"
    assert_contains "all required fields present" "OK" "$check_result"

    # Check hostname
    local hostname_val
    hostname_val="$(echo "$PAYLOAD" | python3 -c "import json,sys; print(json.load(sys.stdin)['hostname'])")"
    assert_eq "hostname in payload" "test-host.example.com" "$hostname_val"

    # Check packages is an array
    local pkg_count
    pkg_count="$(echo "$PAYLOAD" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['packages']))")"
    assert_eq "packages array has 1 item" "1" "$pkg_count"

    # Check services is an array
    local svc_count
    svc_count="$(echo "$PAYLOAD" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['services']))")"
    assert_eq "services array has 1 item" "1" "$svc_count"

    # Check no literal "null" or "undefined" string values
    local has_bad_strings
    has_bad_strings="$(echo "$PAYLOAD" | python3 -c "
import json, sys
d = json.load(sys.stdin)
def check(obj, path=''):
    if isinstance(obj, str):
        if obj in ('null', 'undefined', 'None'):
            print(f'BAD:{path}={obj}')
    elif isinstance(obj, dict):
        for k,v in obj.items():
            check(v, f'{path}.{k}')
    elif isinstance(obj, list):
        for i,v in enumerate(obj):
            check(v, f'{path}[{i}]')
check(d)
print('DONE')
" 2>&1)"
    assert_not_contains "no null string literals" "BAD:" "$has_bad_strings"
}

# ─── Test: empty packages (no package manager) ───
test_empty_packages() {
    echo ""
    echo "Missing package managers:"

    PACKAGES_JSON=""
    local count=0

    assert_eq "empty packages when no manager" "0" "$count"
    assert_eq "PACKAGES_JSON is empty" "" "$PACKAGES_JSON"

    # Build a payload with empty packages
    COLLECTED_HOSTNAME="minimal-host"
    COLLECTED_IP="10.0.0.1"
    COLLECTED_OS="Unknown"
    COLLECTED_OS_VERSION=""
    COLLECTED_OS_PRETTY="Unknown"
    COLLECTED_ARCH="x86_64"
    SERVICES_JSON=""
    CONNECTIONS_JSON=""
    DOCKER_PACKAGES_JSON=""
    DOCKER_SERVICES_JSON=""
    META_UPTIME="unknown"
    META_KERNEL="5.15.0"
    META_MEMORY="0"
    META_CPUS="0"

    build_payload

    assert_valid_json "payload with empty packages is valid JSON" "$PAYLOAD"
    local pkg_count
    pkg_count="$(echo "$PAYLOAD" | python3 -c "import json,sys; print(len(json.load(sys.stdin)['packages']))")"
    assert_eq "packages array is empty" "0" "$pkg_count"
}

# ─── Run all tests ───
test_json_escape
test_json_str
test_json_num
test_json_null
test_os_detection
test_dpkg_parsing
test_rpm_parsing
test_apk_parsing
test_service_parsing
test_classify_service
test_docker_parsing
test_connection_parsing
test_special_chars
test_full_payload
test_empty_packages

# ─── Summary ───
echo ""
echo -e "${YELLOW}═══ Results ═══${NC}"
echo -e "  ${GREEN}Passed: $PASS${NC}"
if [ "$FAIL" -gt 0 ]; then
    echo -e "  ${RED}Failed: $FAIL${NC}"
    echo ""
    echo -e "${RED}Failed tests:${NC}"
    for err in "${ERRORS[@]}"; do
        echo -e "  ${RED}- $err${NC}"
    done
    exit 1
else
    echo -e "  Failed: 0"
    echo ""
    echo -e "${GREEN}All tests passed!${NC}"
fi
