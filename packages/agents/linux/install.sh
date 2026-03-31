#!/bin/bash
# InfraWatch Agent Installer for Linux
# Usage: sudo ./install.sh
#   or:  curl -fsSL https://infrawatch.example.com/install.sh | sudo bash

set -euo pipefail

INSTALL_DIR="/usr/local/bin"
CONFIG_DIR="/etc/infrawatch"
LOG_FILE="/var/log/infrawatch-agent.log"
CRON_FILE="/etc/cron.d/infrawatch"
LOGROTATE_FILE="/etc/logrotate.d/infrawatch"
AGENT_SCRIPT="infrawatch-agent.sh"
INSTALLED_NAME="infrawatch-agent"
REPORT_INTERVAL="${REPORT_INTERVAL:-6}"  # hours, default 6

# ─── Checks ───

if [ "$(id -u)" -ne 0 ]; then
    echo "Error: This installer must be run as root (use sudo)." >&2
    exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
    echo "Error: curl is required but not installed." >&2
    exit 1
fi

if ! command -v bash >/dev/null 2>&1; then
    echo "Error: bash is required but not installed." >&2
    exit 1
fi

# ─── Install agent script ───

echo "Installing InfraWatch Agent..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -f "${SCRIPT_DIR}/${AGENT_SCRIPT}" ]; then
    cp "${SCRIPT_DIR}/${AGENT_SCRIPT}" "${INSTALL_DIR}/${INSTALLED_NAME}"
else
    echo "Error: ${AGENT_SCRIPT} not found in ${SCRIPT_DIR}" >&2
    echo "  Place install.sh in the same directory as infrawatch-agent.sh" >&2
    exit 1
fi

chmod 755 "${INSTALL_DIR}/${INSTALLED_NAME}"
echo "  Installed: ${INSTALL_DIR}/${INSTALLED_NAME}"

# ─── Create config directory and template ───

mkdir -p "$CONFIG_DIR"
chmod 700 "$CONFIG_DIR"

if [ ! -f "${CONFIG_DIR}/agent.conf" ]; then
    cat > "${CONFIG_DIR}/agent.conf" << 'CONF'
# InfraWatch Agent Configuration
# Docs: https://github.com/infrawatch/infrawatch

# Required: InfraWatch server URL (no trailing slash)
INFRAWATCH_URL=""

# Required: Agent token (get one from InfraWatch > Settings > Agent Tokens)
INFRAWATCH_TOKEN=""

# Optional: Collect established TCP connections (default: false)
# COLLECT_CONNECTIONS="true"

# Optional: Collect Docker containers (default: true)
# COLLECT_DOCKER="true"

# Optional: Collect pip packages (default: false)
# COLLECT_PIP="true"

# Optional: Collect npm global packages (default: false)
# COLLECT_NPM="true"
CONF
    chmod 600 "${CONFIG_DIR}/agent.conf"
    echo "  Config created: ${CONFIG_DIR}/agent.conf"
else
    echo "  Config exists: ${CONFIG_DIR}/agent.conf (not overwritten)"
fi

# ─── Create log file ───

touch "$LOG_FILE"
chmod 644 "$LOG_FILE"
echo "  Log file: ${LOG_FILE}"

# ─── Create cron entry ───

cat > "$CRON_FILE" << EOF
# InfraWatch Agent - report every ${REPORT_INTERVAL} hours
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
0 */${REPORT_INTERVAL} * * * root ${INSTALL_DIR}/${INSTALLED_NAME} >> ${LOG_FILE} 2>&1
EOF

chmod 644 "$CRON_FILE"
echo "  Cron schedule: every ${REPORT_INTERVAL}h (${CRON_FILE})"

# ─── Create logrotate config ───

cat > "$LOGROTATE_FILE" << EOF
${LOG_FILE} {
    weekly
    rotate 4
    compress
    delaycompress
    missingok
    notifempty
    create 644 root root
}
EOF

chmod 644 "$LOGROTATE_FILE"
echo "  Logrotate: weekly, keep 4 (${LOGROTATE_FILE})"

# ─── Done ───

echo ""
echo "Installation complete!"
echo ""
echo "Next steps:"
echo "  1. Edit ${CONFIG_DIR}/agent.conf"
echo "     Set INFRAWATCH_URL to your InfraWatch server URL"
echo "     Set INFRAWATCH_TOKEN to an agent token (create one in the InfraWatch UI)"
echo ""
echo "  2. Test the agent:"
echo "     sudo ${INSTALL_DIR}/${INSTALLED_NAME}"
echo ""
echo "  3. The agent will automatically run every ${REPORT_INTERVAL} hours via cron."
echo "     To change the interval, edit ${CRON_FILE}"
echo ""
echo "  To uninstall: sudo $(dirname "${BASH_SOURCE[0]}")/uninstall.sh"
