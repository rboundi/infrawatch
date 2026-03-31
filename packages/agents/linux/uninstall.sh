#!/bin/bash
# InfraWatch Agent Uninstaller for Linux
# Usage: sudo ./uninstall.sh

set -euo pipefail

INSTALL_DIR="/usr/local/bin"
CONFIG_DIR="/etc/infrawatch"
LOG_FILE="/var/log/infrawatch-agent.log"
CRON_FILE="/etc/cron.d/infrawatch"
LOGROTATE_FILE="/etc/logrotate.d/infrawatch"
INSTALLED_NAME="infrawatch-agent"

# ─── Checks ───

if [ "$(id -u)" -ne 0 ]; then
    echo "Error: This uninstaller must be run as root (use sudo)." >&2
    exit 1
fi

echo "Uninstalling InfraWatch Agent..."

# ─── Remove cron entry ───

if [ -f "$CRON_FILE" ]; then
    rm -f "$CRON_FILE"
    echo "  Removed cron schedule: ${CRON_FILE}"
else
    echo "  Cron schedule not found (skipped)"
fi

# ─── Remove agent script ───

if [ -f "${INSTALL_DIR}/${INSTALLED_NAME}" ]; then
    rm -f "${INSTALL_DIR}/${INSTALLED_NAME}"
    echo "  Removed agent: ${INSTALL_DIR}/${INSTALLED_NAME}"
else
    echo "  Agent script not found (skipped)"
fi

# ─── Remove logrotate config ───

if [ -f "$LOGROTATE_FILE" ]; then
    rm -f "$LOGROTATE_FILE"
    echo "  Removed logrotate config: ${LOGROTATE_FILE}"
else
    echo "  Logrotate config not found (skipped)"
fi

# ─── Remove config directory ───

if [ -d "$CONFIG_DIR" ]; then
    rm -rf "$CONFIG_DIR"
    echo "  Removed config directory: ${CONFIG_DIR}"
else
    echo "  Config directory not found (skipped)"
fi

# ─── Ask about log file ───

if [ -f "$LOG_FILE" ]; then
    echo ""
    read -rp "  Remove log file ${LOG_FILE}? [y/N] " remove_logs
    if [[ "$remove_logs" =~ ^[Yy]$ ]]; then
        rm -f "$LOG_FILE"
        echo "  Removed log file: ${LOG_FILE}"
    else
        echo "  Log file kept: ${LOG_FILE}"
    fi
fi

echo ""
echo "InfraWatch Agent has been uninstalled."
echo "Hosts that reported with this agent will remain in the InfraWatch inventory."
