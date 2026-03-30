#!/usr/bin/env python3
"""Generate InfraWatch User Manual PDF with screenshots."""

import os
from datetime import date
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor, white, black
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Image, PageBreak,
    Table, TableStyle, KeepTogether, ListFlowable, ListItem,
    HRFlowable,
)

SCREENSHOTS = "docs/screenshots"
OUTPUT = "docs/InfraWatch-User-Manual.pdf"

# Colors
PRIMARY = HexColor("#4f46e5")   # Indigo
DARK = HexColor("#1e293b")
GRAY = HexColor("#64748b")
LIGHT_BG = HexColor("#f8fafc")
BORDER = HexColor("#e2e8f0")
SUCCESS = HexColor("#22c55e")
WARNING = HexColor("#f59e0b")
DANGER = HexColor("#ef4444")

WIDTH, HEIGHT = letter
MARGIN = 0.75 * inch


def build_styles():
    styles = getSampleStyleSheet()

    styles.add(ParagraphStyle(
        "ManualTitle", parent=styles["Title"],
        fontSize=32, leading=40, textColor=PRIMARY, spaceAfter=6,
        alignment=TA_CENTER,
    ))
    styles.add(ParagraphStyle(
        "Subtitle", parent=styles["Normal"],
        fontSize=14, leading=18, textColor=GRAY,
        alignment=TA_CENTER, spaceAfter=30,
    ))
    styles.add(ParagraphStyle(
        "ChapterTitle", parent=styles["Heading1"],
        fontSize=22, leading=28, textColor=PRIMARY,
        spaceBefore=0, spaceAfter=12,
        borderWidth=0, borderPadding=0,
    ))
    styles.add(ParagraphStyle(
        "SectionTitle", parent=styles["Heading2"],
        fontSize=16, leading=20, textColor=DARK,
        spaceBefore=16, spaceAfter=8,
    ))
    styles.add(ParagraphStyle(
        "SubSection", parent=styles["Heading3"],
        fontSize=13, leading=16, textColor=HexColor("#334155"),
        spaceBefore=12, spaceAfter=6,
    ))
    styles.add(ParagraphStyle(
        "Body", parent=styles["Normal"],
        fontSize=10.5, leading=15, textColor=DARK,
        spaceAfter=8, alignment=TA_JUSTIFY,
    ))
    styles.add(ParagraphStyle(
        "BodyBold", parent=styles["Normal"],
        fontSize=10.5, leading=15, textColor=DARK,
        spaceAfter=4, fontName="Helvetica-Bold",
    ))
    styles.add(ParagraphStyle(
        "CodeBlock", parent=styles["Code"],
        fontSize=9, leading=12, textColor=DARK,
        backColor=HexColor("#f1f5f9"),
        borderWidth=1, borderColor=BORDER, borderPadding=8,
        spaceAfter=8, leftIndent=12, rightIndent=12,
        fontName="Courier",
    ))
    styles.add(ParagraphStyle(
        "CodeInline", parent=styles["Normal"],
        fontSize=9.5, fontName="Courier", textColor=HexColor("#7c3aed"),
    ))
    styles.add(ParagraphStyle(
        "Caption", parent=styles["Normal"],
        fontSize=9, leading=12, textColor=GRAY, alignment=TA_CENTER,
        spaceBefore=4, spaceAfter=16, fontName="Helvetica-Oblique",
    ))
    styles.add(ParagraphStyle(
        "TOCEntry", parent=styles["Normal"],
        fontSize=11, leading=18, textColor=DARK,
        leftIndent=20,
    ))
    styles.add(ParagraphStyle(
        "TOCChapter", parent=styles["Normal"],
        fontSize=12, leading=20, textColor=PRIMARY,
        fontName="Helvetica-Bold",
    ))
    styles.add(ParagraphStyle(
        "Note", parent=styles["Normal"],
        fontSize=10, leading=14, textColor=HexColor("#1e40af"),
        backColor=HexColor("#eff6ff"), borderWidth=1,
        borderColor=HexColor("#bfdbfe"), borderPadding=10,
        spaceAfter=12, leftIndent=12, rightIndent=12,
    ))
    styles.add(ParagraphStyle(
        "Warning", parent=styles["Normal"],
        fontSize=10, leading=14, textColor=HexColor("#92400e"),
        backColor=HexColor("#fffbeb"), borderWidth=1,
        borderColor=HexColor("#fde68a"), borderPadding=10,
        spaceAfter=12, leftIndent=12, rightIndent=12,
    ))
    styles.add(ParagraphStyle(
        "Footer", parent=styles["Normal"],
        fontSize=8, textColor=GRAY, alignment=TA_CENTER,
    ))
    return styles


def screenshot(name, caption, styles, max_width=6.5*inch):
    """Return list of flowables for a screenshot with caption."""
    path = os.path.join(SCREENSHOTS, f"{name}.png")
    if not os.path.exists(path):
        return [Paragraph(f"[Screenshot: {name} not found]", styles["Caption"])]

    img = Image(path)
    aspect = img.imageWidth / img.imageHeight
    w = min(max_width, WIDTH - 2 * MARGIN)
    h = w / aspect
    max_h = 4.5 * inch
    if h > max_h:
        h = max_h
        w = h * aspect
    img._restrictSize(w, h)

    return [
        img,
        Paragraph(caption, styles["Caption"]),
    ]


def hr():
    return HRFlowable(width="100%", thickness=1, color=BORDER, spaceAfter=12, spaceBefore=12)


def bullet_list(items, styles):
    return ListFlowable(
        [ListItem(Paragraph(item, styles["Body"]), bulletColor=PRIMARY) for item in items],
        bulletType="bullet", bulletFontSize=8, leftIndent=24,
        spaceBefore=4, spaceAfter=8,
    )


def env_table(rows, styles):
    """Create an environment variable table."""
    header = [
        Paragraph("<b>Variable</b>", styles["Body"]),
        Paragraph("<b>Description</b>", styles["Body"]),
        Paragraph("<b>Default</b>", styles["Body"]),
    ]
    data = [header]
    for var, desc, default in rows:
        data.append([
            Paragraph(f'<font face="Courier" size="9">{var}</font>', styles["Body"]),
            Paragraph(desc, styles["Body"]),
            Paragraph(f'<font face="Courier" size="9">{default}</font>' if default else "<i>required</i>", styles["Body"]),
        ])

    t = Table(data, colWidths=[2 * inch, 3.2 * inch, 1.3 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HexColor("#f1f5f9")),
        ("TEXTCOLOR", (0, 0), (-1, 0), DARK),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ]))
    return t


def build_pdf():
    styles = build_styles()
    story = []

    # ─── COVER PAGE ───
    story.append(Spacer(1, 2 * inch))
    story.append(Paragraph("InfraWatch", styles["ManualTitle"]))
    story.append(Paragraph("Infrastructure Inventory Management", styles["Subtitle"]))
    story.append(Spacer(1, 0.3 * inch))
    story.append(HRFlowable(width="40%", thickness=2, color=PRIMARY, spaceAfter=20, spaceBefore=0))
    story.append(Paragraph("User Manual &amp; Administration Guide", styles["Subtitle"]))
    story.append(Spacer(1, 1 * inch))
    story.append(Paragraph(f"Version 0.1.0 | {date.today().strftime('%B %Y')}", styles["Subtitle"]))
    story.append(Paragraph("For IT Operations, DevOps, and Infrastructure Teams", styles["Subtitle"]))
    story.append(PageBreak())

    # ─── TABLE OF CONTENTS ───
    story.append(Paragraph("Table of Contents", styles["ChapterTitle"]))
    story.append(hr())
    toc = [
        ("1", "Introduction"),
        ("2", "Installation &amp; Deployment"),
        ("3", "Initial Setup &amp; Configuration"),
        ("4", "Dashboard Overview"),
        ("5", "Host Inventory Management"),
        ("6", "Alert Management &amp; Remediation"),
        ("7", "Change Tracking"),
        ("8", "End-of-Life (EOL) Tracking"),
        ("9", "Host Groups"),
        ("10", "Dependency Mapping"),
        ("11", "Compliance Scoring"),
        ("12", "Network Discovery"),
        ("13", "Scan Target Management"),
        ("14", "Scheduled Reports"),
        ("15", "Notifications"),
        ("16", "API Reference"),
        ("17", "Updating &amp; Maintenance"),
        ("18", "Troubleshooting"),
    ]
    for num, title in toc:
        story.append(Paragraph(f"<b>{num}.</b>&nbsp;&nbsp;{title}", styles["TOCChapter"] if True else styles["TOCEntry"]))
    story.append(PageBreak())

    # ─── CHAPTER 1: INTRODUCTION ───
    story.append(Paragraph("1. Introduction", styles["ChapterTitle"]))
    story.append(hr())
    story.append(Paragraph(
        "InfraWatch is an agentless infrastructure inventory management platform that automatically "
        "discovers, scans, and monitors your servers, containers, and cloud resources. It provides "
        "real-time visibility into installed packages, running services, security vulnerabilities, "
        "and compliance posture across your entire fleet.",
        styles["Body"]
    ))
    story.append(Paragraph("Key Features", styles["SectionTitle"]))
    story.append(bullet_list([
        "<b>Agentless Scanning</b> - No software to install on target hosts. Connects via SSH, WinRM, Kubernetes API, AWS API, VMware vSphere, or Docker daemon.",
        "<b>Package &amp; Vulnerability Tracking</b> - Discovers installed packages, checks for newer versions, and creates alerts for outdated or vulnerable software.",
        "<b>End-of-Life Monitoring</b> - Tracks products approaching or past their end-of-life dates to prevent security gaps.",
        "<b>Compliance Scoring</b> - Rates each host 0-100 across five weighted factors, with fleet-wide and group-level aggregation.",
        "<b>Dependency Mapping</b> - Visualizes network connections between hosts to understand service dependencies and blast radius.",
        "<b>Change Auditing</b> - Records every host, package, service, and configuration change for audit trails.",
        "<b>Automated Remediation</b> - Generates platform-aware fix commands (apt, yum, pip, npm, etc.) for each alert.",
        "<b>Scheduled Reports</b> - Generates and emails PDF reports on a configurable schedule.",
        "<b>Multi-Channel Notifications</b> - Sends alerts via Slack, Microsoft Teams, email, or generic webhooks.",
    ], styles))

    story.append(Paragraph("Architecture", styles["SectionTitle"]))
    story.append(Paragraph(
        "InfraWatch consists of three components deployed as Docker containers:",
        styles["Body"]
    ))
    story.append(bullet_list([
        "<b>API Server</b> (Node.js/Express) - REST API, background services (scan orchestration, version checking, compliance scoring, notifications), and database access.",
        "<b>Web Frontend</b> (React/Vite) - Single-page application served by nginx in production. Communicates exclusively through the API.",
        "<b>PostgreSQL Database</b> - Stores all host inventory, scan results, alerts, compliance scores, and configuration. Credentials are encrypted at rest with AES-256-GCM.",
    ], styles))
    story.append(Paragraph("Supported Scanner Types", styles["SectionTitle"]))

    scanner_data = [
        [Paragraph("<b>Scanner</b>", styles["Body"]), Paragraph("<b>Protocol</b>", styles["Body"]), Paragraph("<b>Discovers</b>", styles["Body"])],
        [Paragraph("SSH (Linux)", styles["Body"]), Paragraph("SSH", styles["Body"]), Paragraph("Packages (apt/yum/apk), services, OS, network", styles["Body"])],
        [Paragraph("WinRM", styles["Body"]), Paragraph("WinRM", styles["Body"]), Paragraph("Windows programs, services, OS info", styles["Body"])],
        [Paragraph("Kubernetes", styles["Body"]), Paragraph("K8s API", styles["Body"]), Paragraph("Container images, pods, namespaces", styles["Body"])],
        [Paragraph("AWS", styles["Body"]), Paragraph("AWS API", styles["Body"]), Paragraph("EC2, RDS, Lambda instances and packages", styles["Body"])],
        [Paragraph("VMware", styles["Body"]), Paragraph("vSphere API", styles["Body"]), Paragraph("Virtual machines, guest OS, services", styles["Body"])],
        [Paragraph("Docker", styles["Body"]), Paragraph("Docker API", styles["Body"]), Paragraph("Running containers, images, ports", styles["Body"])],
        [Paragraph("Network Discovery", styles["Body"]), Paragraph("ARP/ICMP/nmap", styles["Body"]), Paragraph("Live hosts, open ports, MAC addresses", styles["Body"])],
    ]
    t = Table(scanner_data, colWidths=[1.8 * inch, 1.3 * inch, 3.4 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HexColor("#f1f5f9")),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(t)
    story.append(PageBreak())

    # ─── CHAPTER 2: INSTALLATION & DEPLOYMENT ───
    story.append(Paragraph("2. Installation &amp; Deployment", styles["ChapterTitle"]))
    story.append(hr())

    story.append(Paragraph("Prerequisites", styles["SectionTitle"]))
    story.append(bullet_list([
        "<b>Docker</b> (v20.10 or later) and <b>Docker Compose v2</b>",
        "<b>OpenSSL</b> (for generating secrets during setup)",
        "At least <b>2 GB RAM</b> and <b>10 GB disk space</b> for the application and database",
        "Network access to target hosts on their respective management ports (SSH/22, WinRM/5985, etc.)",
    ], styles))

    story.append(Paragraph("Quick Start (Automated Setup)", styles["SectionTitle"]))
    story.append(Paragraph(
        "The included setup script handles secret generation, configuration, building, and starting all services:",
        styles["Body"]
    ))
    story.append(Paragraph(
        "git clone &lt;repository-url&gt; infrawatch<br/>"
        "cd infrawatch<br/>"
        "./setup.sh",
        styles["CodeBlock"]
    ))
    story.append(Paragraph(
        "The setup script performs the following steps automatically:",
        styles["Body"]
    ))
    story.append(bullet_list([
        "Verifies Docker, Docker Compose v2, and OpenSSL are installed",
        "Generates cryptographically random secrets: <font face='Courier' size='9'>DB_PASSWORD</font>, <font face='Courier' size='9'>MASTER_KEY</font>, and <font face='Courier' size='9'>API_KEY</font>",
        "Creates the <font face='Courier' size='9'>.env</font> file from the production template",
        "Builds all Docker images (multi-stage builds)",
        "Starts PostgreSQL, API server, and web frontend",
        "Waits for health checks to pass (up to 120 seconds)",
        "Reports the access URL when ready",
    ], styles))

    story.append(Paragraph("Manual Deployment", styles["SectionTitle"]))
    story.append(Paragraph("If you prefer manual control over the deployment:", styles["Body"]))

    story.append(Paragraph("Step 1: Create the environment file", styles["SubSection"]))
    story.append(Paragraph(
        "cp .env.production.example .env",
        styles["CodeBlock"]
    ))
    story.append(Paragraph("Edit <font face='Courier' size='9.5'>.env</font> and set these required values:", styles["Body"]))
    story.append(env_table([
        ("DB_PASSWORD", "PostgreSQL password", ""),
        ("MASTER_KEY", "AES-256 encryption key for credentials (32+ chars)", ""),
        ("API_KEY", "API authentication key", ""),
        ("DB_HOST", "PostgreSQL hostname", "postgres"),
        ("DB_PORT", "PostgreSQL port", "5432"),
        ("DB_NAME", "Database name", "infrawatch"),
        ("DB_USER", "Database user", "infrawatch"),
        ("PORT", "API server port", "3001"),
        ("CORS_ORIGIN", "Allowed origin for web UI", "http://localhost"),
    ], styles))

    story.append(Spacer(1, 8))
    story.append(Paragraph("Step 2: Build and start", styles["SubSection"]))
    story.append(Paragraph(
        "docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build",
        styles["CodeBlock"]
    ))

    story.append(Paragraph("Step 3: Verify health", styles["SubSection"]))
    story.append(Paragraph(
        "curl http://localhost:3001/api/v1/health",
        styles["CodeBlock"]
    ))

    story.append(Paragraph("Development Mode", styles["SectionTitle"]))
    story.append(Paragraph("For local development with hot-reload:", styles["Body"]))
    story.append(Paragraph(
        "# Start PostgreSQL<br/>"
        "docker compose up postgres -d<br/><br/>"
        "# Build the scanner package (dependency of server)<br/>"
        "npm run build -w packages/scanner<br/><br/>"
        "# Start API server with hot-reload (terminal 1)<br/>"
        "npm run dev -w packages/server<br/><br/>"
        "# Start web frontend with Vite HMR (terminal 2)<br/>"
        "npm run dev -w packages/web",
        styles["CodeBlock"]
    ))
    story.append(Paragraph(
        "<b>Note:</b> In development mode, the API runs on port 3001 and the web UI on port 5173. "
        "Vite automatically proxies <font face='Courier' size='9.5'>/api</font> requests to the API server.",
        styles["Note"]
    ))
    story.append(PageBreak())

    # ─── CHAPTER 3: INITIAL SETUP ───
    story.append(Paragraph("3. Initial Setup &amp; Configuration", styles["ChapterTitle"]))
    story.append(hr())

    story.append(Paragraph("Environment Variables", styles["SectionTitle"]))
    story.append(Paragraph("All configuration is via environment variables in the <font face='Courier' size='9.5'>.env</font> file:", styles["Body"]))

    story.append(Paragraph("Email / SMTP Settings (optional)", styles["SubSection"]))
    story.append(env_table([
        ("SMTP_HOST", "SMTP server address", ""),
        ("SMTP_PORT", "SMTP port", "587"),
        ("SMTP_USER", "Email account username", ""),
        ("SMTP_PASS", "Email account password", ""),
        ("ALERT_EMAIL", "Recipient for alert digests", ""),
    ], styles))

    story.append(Spacer(1, 8))
    story.append(Paragraph("Tuning Parameters", styles["SubSection"]))
    story.append(env_table([
        ("DB_POOL_MAX", "Max database connections", "20"),
        ("VERSION_CHECK_INTERVAL_HOURS", "Package update check interval", "12"),
        ("ALERT_DIGEST_HOUR", "Hour to send daily digest (0-23)", "8"),
        ("REPORT_STORAGE_PATH", "Where generated reports are saved", "./data/reports"),
    ], styles))

    story.append(Paragraph("Database Migrations", styles["SectionTitle"]))
    story.append(Paragraph(
        "Migrations run automatically on server startup. For manual control:",
        styles["Body"]
    ))
    story.append(Paragraph(
        "# Apply pending migrations<br/>"
        "npm run db:migrate -w packages/server<br/><br/>"
        "# Rollback last migration<br/>"
        "npm run db:migrate:down -w packages/server<br/><br/>"
        "# Create a new migration<br/>"
        "npm run db:migrate:create -w packages/server",
        styles["CodeBlock"]
    ))

    story.append(Paragraph("API Authentication", styles["SectionTitle"]))
    story.append(Paragraph(
        "All API endpoints (except <font face='Courier' size='9.5'>/health</font>) require the "
        "<font face='Courier' size='9.5'>X-API-Key</font> header when <font face='Courier' size='9.5'>API_KEY</font> "
        "is set in the environment. The web frontend automatically includes this header from "
        "<font face='Courier' size='9.5'>VITE_API_KEY</font> (baked in at build time).",
        styles["Body"]
    ))
    story.append(Paragraph(
        "curl -H 'X-API-Key: your-api-key' http://localhost:3001/api/v1/hosts",
        styles["CodeBlock"]
    ))
    story.append(PageBreak())

    # ─── CHAPTER 4: DASHBOARD ───
    story.append(Paragraph("4. Dashboard Overview", styles["ChapterTitle"]))
    story.append(hr())
    story.append(Paragraph(
        "The dashboard provides an at-a-glance view of your infrastructure health. It is the default landing page after login.",
        styles["Body"]
    ))
    story.extend(screenshot("01-overview", "Figure 1: Dashboard showing fleet statistics, compliance score, recent alerts, groups, and changes", styles))
    story.append(Paragraph("Dashboard Widgets", styles["SectionTitle"]))
    story.append(bullet_list([
        "<b>Total Hosts</b> - Count of all hosts with active/stale breakdown",
        "<b>Packages Tracked</b> - Total number of installed packages across all hosts",
        "<b>Open Alerts</b> - Unacknowledged alerts with critical count highlighted",
        "<b>Scan Targets</b> - Configured scan targets with time since last scan",
        "<b>Fleet Compliance Score</b> - Aggregate 0-100 score with classification badge and host distribution",
        "<b>Stale Hosts Warning</b> - Banner showing hosts that haven't reported in 24+ hours",
        "<b>Recent Critical &amp; High Alerts</b> - Table of the most recent high-severity alerts with one-click acknowledge",
        "<b>Groups</b> - Cards for each host group showing member count and open alerts",
        "<b>Recent Changes</b> - Feed of the latest infrastructure changes (host discoveries, package updates, etc.)",
    ], styles))
    story.append(PageBreak())

    # ─── CHAPTER 5: HOST INVENTORY ───
    story.append(Paragraph("5. Host Inventory Management", styles["ChapterTitle"]))
    story.append(hr())
    story.append(Paragraph(
        "The Hosts page is the central inventory view of all discovered infrastructure. Hosts are automatically "
        "added when scan targets are configured and scanned.",
        styles["Body"]
    ))
    story.extend(screenshot("02-hosts", "Figure 2: Host inventory with filtering by status, environment, and group", styles))

    story.append(Paragraph("Host Table Columns", styles["SectionTitle"]))
    story.append(bullet_list([
        "<b>Hostname</b> - Clickable link to host detail page",
        "<b>IP</b> - Primary IP address",
        "<b>OS</b> - Operating system and version",
        "<b>Environment</b> - Tagged environment (production, staging, etc.)",
        "<b>Packages</b> - Number of installed packages",
        "<b>Open Alerts</b> - Count of unacknowledged alerts (color-coded by severity)",
        "<b>Last Seen</b> - Time since last successful scan",
        "<b>Status</b> - Active (green), Stale (yellow, 24h+ no report), or Decommissioned (red, 30d+ no report)",
    ], styles))

    story.append(Paragraph("Filtering &amp; Search", styles["SectionTitle"]))
    story.append(Paragraph(
        "Use the filter bar at the top to narrow results by hostname (text search), status, environment, or group. "
        "Click column headers to sort. The table supports pagination for large inventories.",
        styles["Body"]
    ))

    story.append(Paragraph("Host Detail View", styles["SectionTitle"]))
    story.extend(screenshot("03-host-detail", "Figure 3: Host detail page showing packages, services, compliance badge, and remediation", styles))
    story.append(Paragraph(
        "Click any host row to view its full details. The host detail page includes:",
        styles["Body"]
    ))
    story.append(bullet_list([
        "<b>Host header</b> - Hostname, status badge, compliance score badge, OS info, IP, environment tag",
        "<b>Remediation Plan button</b> - Opens panel with fix commands for all open alerts on this host",
        "<b>Packages tab</b> - Installed packages with installed/latest version comparison and ecosystem filter",
        "<b>Services tab</b> - Running services with status, port, and PID information",
        "<b>Dependencies tab</b> - Inbound and outbound network connections to/from this host",
    ], styles))
    story.append(PageBreak())

    # ─── CHAPTER 6: ALERTS ───
    story.append(Paragraph("6. Alert Management &amp; Remediation", styles["ChapterTitle"]))
    story.append(hr())
    story.append(Paragraph(
        "InfraWatch automatically creates alerts when it detects outdated packages, known vulnerabilities, "
        "or version mismatches during scanning. The Alerts page provides tools to triage, acknowledge, and "
        "remediate these findings.",
        styles["Body"]
    ))
    story.extend(screenshot("04-alerts", "Figure 4: Alert management with severity summary, filtering, and bulk actions", styles))

    story.append(Paragraph("Severity Levels", styles["SectionTitle"]))
    severity_data = [
        [Paragraph("<b>Level</b>", styles["Body"]), Paragraph("<b>Color</b>", styles["Body"]), Paragraph("<b>Description</b>", styles["Body"])],
        [Paragraph("Critical", styles["Body"]), Paragraph("Red", styles["Body"]), Paragraph("Known CVEs or major version gaps requiring immediate attention", styles["Body"])],
        [Paragraph("High", styles["Body"]), Paragraph("Orange", styles["Body"]), Paragraph("Significant version differences or security-relevant updates", styles["Body"])],
        [Paragraph("Medium", styles["Body"]), Paragraph("Yellow", styles["Body"]), Paragraph("Minor version updates available", styles["Body"])],
        [Paragraph("Low", styles["Body"]), Paragraph("Blue", styles["Body"]), Paragraph("Patch-level updates available", styles["Body"])],
        [Paragraph("Info", styles["Body"]), Paragraph("Gray", styles["Body"]), Paragraph("Informational findings, no action required", styles["Body"])],
    ]
    t = Table(severity_data, colWidths=[1.2 * inch, 1 * inch, 4.3 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HexColor("#f1f5f9")),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(t)

    story.append(Paragraph("Alert Actions", styles["SectionTitle"]))
    story.append(bullet_list([
        "<b>Acknowledge</b> - Mark an alert as reviewed (with optional notes). Acknowledged alerts are excluded from notification digests.",
        "<b>Bulk Acknowledge</b> - Select multiple alerts via checkboxes and acknowledge them at once.",
        "<b>Remediation (Fix)</b> - View auto-generated platform-specific commands to resolve the alert. Commands are tailored to the host's package manager (apt, yum, pip, npm, etc.).",
        "<b>Bulk Remediation</b> - Generate a combined remediation plan for multiple selected alerts.",
    ], styles))

    story.append(Paragraph(
        "<b>Important:</b> Remediation commands are generated as suggestions. Always review commands before "
        "executing them on production systems. Commands may need adjustment for your specific environment.",
        styles["Warning"]
    ))
    story.append(PageBreak())

    # ─── CHAPTER 7: CHANGES ───
    story.append(Paragraph("7. Change Tracking", styles["ChapterTitle"]))
    story.append(hr())
    story.append(Paragraph(
        "The Change Feed automatically records every infrastructure change detected during scanning. "
        "This provides a complete audit trail of what changed, when, and on which host.",
        styles["Body"]
    ))
    story.extend(screenshot("05-changes", "Figure 5: Change Feed with summary cards, 30-day trend chart, and event log", styles))

    story.append(Paragraph("Change Event Types", styles["SectionTitle"]))
    story.append(bullet_list([
        "<b>host_discovered</b> - New host first seen during a scan",
        "<b>host_disappeared / host_stale</b> - Host stopped responding",
        "<b>package_added / package_removed / package_updated</b> - Package inventory changes",
        "<b>service_added / service_removed / service_changed</b> - Service status changes",
        "<b>os_changed</b> - Operating system version change detected",
        "<b>ip_changed</b> - Host IP address changed",
        "<b>eol_detected</b> - Product approaching or past end-of-life",
    ], styles))

    story.append(Paragraph("Change Categories", styles["SectionTitle"]))
    story.append(Paragraph(
        "Changes are grouped into four categories for filtering: <b>host</b>, <b>package</b>, <b>service</b>, and <b>config</b>. "
        "The summary cards show counts for the last 24 hours, last 7 days, and total changes. "
        "The 30-day trend chart visualizes change velocity over time.",
        styles["Body"]
    ))
    story.append(PageBreak())

    # ─── CHAPTER 8: EOL ───
    story.append(Paragraph("8. End-of-Life (EOL) Tracking", styles["ChapterTitle"]))
    story.append(hr())
    story.append(Paragraph(
        "The EOL Tracker monitors installed products and operating systems against known end-of-life dates. "
        "Running software past its EOL is a security risk, as vendors stop providing patches.",
        styles["Body"]
    ))
    story.extend(screenshot("06-eol", "Figure 6: EOL Tracker showing summary cards and alert filters", styles))

    story.append(Paragraph("EOL Alert Statuses", styles["SectionTitle"]))
    story.append(bullet_list([
        "<b>Active</b> - Requires attention; product is approaching or past EOL",
        "<b>Acknowledged</b> - Team is aware; planned for migration",
        "<b>Exempted</b> - Accepted risk with documented reason (e.g., vendor extended support)",
        "<b>Resolved</b> - Product has been updated or replaced",
    ], styles))

    story.append(Paragraph("EOL Actions", styles["SectionTitle"]))
    story.append(bullet_list([
        "<b>Acknowledge</b> - Mark as reviewed; stays visible but flagged",
        "<b>Exempt</b> - Exclude from active tracking with a mandatory reason",
        "<b>Mark Resolved</b> - Close the alert after remediation",
    ], styles))
    story.append(PageBreak())

    # ─── CHAPTER 9: GROUPS ───
    story.append(Paragraph("9. Host Groups", styles["ChapterTitle"]))
    story.append(hr())
    story.append(Paragraph(
        "Host Groups let you organize hosts into logical collections such as \"Database Servers\", "
        "\"Production Web Servers\", or \"Staging Environment\". Groups are used for filtering across "
        "the application and for scoping compliance scores and reports.",
        styles["Body"]
    ))
    story.extend(screenshot("07-groups", "Figure 7: Groups page showing group cards with host count, rules, and alert summary", styles))

    story.append(Paragraph("Creating a Group", styles["SectionTitle"]))
    story.append(bullet_list([
        "Click <b>Create Group</b> in the top-right corner",
        "Enter a <b>name</b>, optional <b>description</b>, and optional <b>owner</b>",
        "Choose a <b>color</b> for visual identification",
        "Save and then add hosts manually or via auto-assignment rules",
    ], styles))

    story.append(Paragraph("Auto-Assignment Rules", styles["SectionTitle"]))
    story.append(Paragraph(
        "Rules automatically assign newly discovered hosts to groups based on criteria:",
        styles["Body"]
    ))
    story.append(bullet_list([
        "<b>Hostname pattern</b> - Regex match on hostname (e.g., <font face='Courier' size='9'>db-.*</font>)",
        "<b>OS match</b> - Filter by operating system",
        "<b>Environment tag</b> - Match on tagged environment",
        "<b>IP range</b> - Match hosts within a CIDR range",
    ], styles))
    story.append(PageBreak())

    # ─── CHAPTER 10: DEPENDENCIES ───
    story.append(Paragraph("10. Dependency Mapping", styles["ChapterTitle"]))
    story.append(hr())
    story.append(Paragraph(
        "The Dependency Map visualizes network connections between hosts in your infrastructure. "
        "Connections are automatically discovered during scans by analyzing established TCP connections "
        "and listening services.",
        styles["Body"]
    ))
    story.extend(screenshot("08-dependencies", "Figure 8: Dependency Map showing source-target connections with protocol and port", styles))

    story.append(Paragraph("View Modes", styles["SectionTitle"]))
    story.append(bullet_list([
        "<b>Table View</b> - Lists all connections with source host, target host, protocol, port, and process information. Supports text filtering.",
        "<b>Graph View</b> - Interactive network graph visualization. Hosts are nodes, connections are edges. Hover over a node to highlight its direct dependencies.",
    ], styles))

    story.append(Paragraph("Impact Analysis", styles["SectionTitle"]))
    story.append(Paragraph(
        "The dependency data powers impact analysis: when viewing a host's detail page, the Dependencies tab "
        "shows both inbound (services that depend on this host) and outbound (services this host depends on) "
        "connections. This helps assess the blast radius of taking a host offline for maintenance.",
        styles["Body"]
    ))
    story.append(PageBreak())

    # ─── CHAPTER 11: COMPLIANCE ───
    story.append(Paragraph("11. Compliance Scoring", styles["ChapterTitle"]))
    story.append(hr())
    story.append(Paragraph(
        "InfraWatch calculates a compliance score (0-100) for each host based on five weighted security factors. "
        "Scores are aggregated to group, environment, and fleet levels for executive visibility.",
        styles["Body"]
    ))
    story.extend(screenshot("09-compliance", "Figure 9: Compliance dashboard with fleet gauge, group/environment scores", styles))

    story.append(Paragraph("Scoring Model", styles["SectionTitle"]))
    score_data = [
        [Paragraph("<b>Factor</b>", styles["Body"]), Paragraph("<b>Weight</b>", styles["Body"]), Paragraph("<b>Description</b>", styles["Body"])],
        [Paragraph("Package Currency", styles["Body"]), Paragraph("35 pts", styles["Body"]), Paragraph("Ratio of up-to-date packages to total packages", styles["Body"])],
        [Paragraph("EOL Status", styles["Body"]), Paragraph("25 pts", styles["Body"]), Paragraph("No active EOL alerts = full score; past EOL = 0", styles["Body"])],
        [Paragraph("Alert Resolution", styles["Body"]), Paragraph("20 pts", styles["Body"]), Paragraph("Ratio of acknowledged critical/high alerts to total", styles["Body"])],
        [Paragraph("Scan Freshness", styles["Body"]), Paragraph("10 pts", styles["Body"]), Paragraph("Based on time since last successful scan", styles["Body"])],
        [Paragraph("Service Health", styles["Body"]), Paragraph("10 pts", styles["Body"]), Paragraph("Ratio of running services to total configured services", styles["Body"])],
    ]
    t = Table(score_data, colWidths=[1.8 * inch, 1 * inch, 3.7 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HexColor("#f1f5f9")),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(t)

    story.append(Spacer(1, 8))
    story.append(Paragraph("Score Classifications", styles["SectionTitle"]))
    class_data = [
        [Paragraph("<b>Classification</b>", styles["Body"]), Paragraph("<b>Score Range</b>", styles["Body"]), Paragraph("<b>Action</b>", styles["Body"])],
        [Paragraph("Excellent", styles["Body"]), Paragraph("90 - 100", styles["Body"]), Paragraph("No action needed; maintain current posture", styles["Body"])],
        [Paragraph("Good", styles["Body"]), Paragraph("70 - 89", styles["Body"]), Paragraph("Minor improvements recommended", styles["Body"])],
        [Paragraph("Fair", styles["Body"]), Paragraph("50 - 69", styles["Body"]), Paragraph("Several areas need attention", styles["Body"])],
        [Paragraph("Poor", styles["Body"]), Paragraph("30 - 49", styles["Body"]), Paragraph("Significant remediation required", styles["Body"])],
        [Paragraph("Critical", styles["Body"]), Paragraph("0 - 29", styles["Body"]), Paragraph("Immediate action required", styles["Body"])],
    ]
    t = Table(class_data, colWidths=[1.5 * inch, 1.3 * inch, 3.7 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HexColor("#f1f5f9")),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(t)

    story.append(Spacer(1, 8))
    story.append(Paragraph(
        "Scores recalculate automatically daily at 2:00 AM and after each scan completes. "
        "Click the <b>Recalculate</b> button on the Compliance page to trigger an immediate recalculation.",
        styles["Body"]
    ))
    story.append(PageBreak())

    # ─── CHAPTER 12: DISCOVERY ───
    story.append(Paragraph("12. Network Discovery", styles["ChapterTitle"]))
    story.append(hr())
    story.append(Paragraph(
        "Network Discovery scans your network ranges for live hosts that are not yet in the inventory. "
        "Discovered hosts can be promoted to full inventory entries or dismissed.",
        styles["Body"]
    ))
    story.extend(screenshot("10-discovery", "Figure 10: Network Discovery showing discovered IPs with platform breakdown", styles))

    story.append(Paragraph("Discovery Workflow", styles["SectionTitle"]))
    story.append(bullet_list([
        "Configure a <b>Network Discovery</b> scan target with the CIDR ranges to scan",
        "The scanner uses ARP scanning, ICMP ping, and port scanning (via nmap) to find live hosts",
        "Discovered hosts appear on this page with their IP, hostname, platform, and open ports",
        "<b>Promote</b> a discovered host to add it to your inventory (it will be assigned to a scan target for ongoing monitoring)",
        "<b>Dismiss</b> a host to hide it from the list (e.g., printers, IoT devices you don't want to track)",
    ], styles))

    story.append(Paragraph("Filters", styles["SectionTitle"]))
    story.append(Paragraph(
        "Filter discovered hosts by platform (Linux/Windows/Unknown), port number, IP/hostname search, "
        "or whether they were auto-promoted or dismissed.",
        styles["Body"]
    ))
    story.append(PageBreak())

    # ─── CHAPTER 13: SCAN TARGETS ───
    story.append(Paragraph("13. Scan Target Management", styles["ChapterTitle"]))
    story.append(hr())
    story.append(Paragraph(
        "Scan Targets define the connection details for reaching your infrastructure. Each target "
        "specifies a scanner type, connection configuration, and scan interval.",
        styles["Body"]
    ))
    story.extend(screenshot("11-scan-targets", "Figure 11: Scan Targets showing configured targets with status and actions", styles))

    story.append(Paragraph("Creating a Scan Target", styles["SectionTitle"]))
    story.append(bullet_list([
        "Click <b>Add Target</b> to open the creation form",
        "Select the <b>scanner type</b> (SSH Linux, WinRM, Kubernetes, AWS, VMware, Docker, or Network Discovery)",
        "Fill in the <b>connection configuration</b> (varies by type - e.g., hostname, port, username, password/key for SSH)",
        "Set the <b>scan interval</b> in hours (how often InfraWatch scans this target)",
        "Enable or disable the target",
    ], styles))

    story.append(Paragraph("Target Actions", styles["SectionTitle"]))
    story.append(bullet_list([
        "<b>Scan</b> - Trigger an immediate scan regardless of the schedule",
        "<b>Test</b> - Test the connection without performing a full scan",
        "<b>Edit</b> - Modify the target's configuration or interval",
        "<b>Delete</b> - Remove the target (does not remove discovered hosts)",
    ], styles))

    story.append(Paragraph(
        "<b>Security Note:</b> All connection credentials (passwords, SSH keys, API tokens) are encrypted "
        "with AES-256-GCM using the <font face='Courier' size='9.5'>MASTER_KEY</font> before storage. "
        "They are never exposed through the API or UI.",
        styles["Note"]
    ))
    story.append(PageBreak())

    # ─── CHAPTER 14: REPORTS ───
    story.append(Paragraph("14. Scheduled Reports", styles["ChapterTitle"]))
    story.append(hr())
    story.append(Paragraph(
        "InfraWatch can generate and email PDF reports on a configurable schedule. "
        "Reports provide point-in-time snapshots of your infrastructure state.",
        styles["Body"]
    ))
    story.extend(screenshot("12-reports", "Figure 12: Reports page with schedules and generation history", styles))

    story.append(Paragraph("Report Types", styles["SectionTitle"]))
    story.append(bullet_list([
        "<b>Weekly Summary</b> - Overview of fleet health, new hosts, alerts, and changes",
        "<b>EOL Report</b> - All products approaching or past end-of-life",
        "<b>Alert Report</b> - Open and recently resolved alerts by severity",
        "<b>Host Inventory</b> - Full inventory export with packages and services",
    ], styles))

    story.append(Paragraph("Schedule Presets", styles["SectionTitle"]))
    story.append(bullet_list([
        "<b>Weekly</b> - Every Monday at 8:00 AM",
        "<b>Bi-weekly</b> - Every other Monday",
        "<b>Monthly</b> - First day of each month",
        "<b>Daily</b> - Every day at 8:00 AM",
        "<b>Custom</b> - Any cron expression",
    ], styles))

    story.append(Paragraph(
        "Reports can also be triggered manually via the <b>Generate Now</b> button or previewed as HTML in the browser.",
        styles["Body"]
    ))
    story.append(PageBreak())

    # ─── CHAPTER 15: NOTIFICATIONS ───
    story.append(Paragraph("15. Notifications", styles["ChapterTitle"]))
    story.append(hr())
    story.append(Paragraph(
        "Configure notification channels to receive real-time alerts about infrastructure events. "
        "InfraWatch supports multiple channel types with configurable severity and event filters.",
        styles["Body"]
    ))
    story.extend(screenshot("13-notifications", "Figure 13: Notifications page showing channel configuration and delivery log", styles))

    story.append(Paragraph("Channel Types", styles["SectionTitle"]))
    story.append(bullet_list([
        "<b>Slack</b> - Posts to a Slack channel via incoming webhook URL",
        "<b>Microsoft Teams</b> - Posts via Teams connector webhook",
        "<b>Email</b> - Sends emails via SMTP (requires SMTP configuration)",
        "<b>Generic Webhook</b> - POSTs JSON to any HTTP endpoint",
    ], styles))

    story.append(Paragraph("Event Subscriptions", styles["SectionTitle"]))
    story.append(Paragraph("Each channel can subscribe to specific event types:", styles["Body"]))
    story.append(bullet_list([
        "<b>Alerts</b> - New vulnerability/version alerts",
        "<b>EOL</b> - End-of-life warnings",
        "<b>Host Offline</b> - Host went stale or unreachable",
        "<b>Scan Failures</b> - Scan target connection failures",
        "<b>Daily Digest</b> - Summary of all activity in the last 24 hours",
    ], styles))

    story.append(Paragraph(
        "Use the <b>Test</b> button after configuring a channel to verify delivery. "
        "The <b>Notification Log</b> at the bottom shows recent delivery attempts with success/failure status.",
        styles["Body"]
    ))
    story.append(PageBreak())

    # ─── CHAPTER 16: API REFERENCE ───
    story.append(Paragraph("16. API Reference", styles["ChapterTitle"]))
    story.append(hr())
    story.append(Paragraph(
        "All functionality is accessible via the REST API at <font face='Courier' size='9.5'>/api/v1</font>. "
        "Include the <font face='Courier' size='9.5'>X-API-Key</font> header in all requests.",
        styles["Body"]
    ))

    api_sections = [
        ("Hosts", [
            ("GET", "/api/v1/hosts", "List hosts (paginated, filterable)"),
            ("GET", "/api/v1/hosts/:id", "Get host details with packages &amp; services"),
            ("GET", "/api/v1/hosts/:id/remediation", "Get remediation plan for host"),
        ]),
        ("Alerts", [
            ("GET", "/api/v1/alerts", "List alerts (filterable by severity, host, group)"),
            ("GET", "/api/v1/alerts/summary", "Alert counts by severity"),
            ("POST", "/api/v1/alerts/:id/acknowledge", "Acknowledge an alert"),
            ("POST", "/api/v1/alerts/bulk-acknowledge", "Bulk acknowledge alerts"),
            ("GET", "/api/v1/alerts/:id/remediation", "Get fix commands for alert"),
        ]),
        ("Scan Targets", [
            ("POST", "/api/v1/targets", "Create scan target"),
            ("GET", "/api/v1/targets", "List all targets"),
            ("PATCH", "/api/v1/targets/:id", "Update target"),
            ("DELETE", "/api/v1/targets/:id", "Delete target"),
            ("POST", "/api/v1/targets/:id/scan", "Trigger scan"),
            ("POST", "/api/v1/targets/:id/test", "Test connection"),
        ]),
        ("Compliance", [
            ("GET", "/api/v1/compliance/fleet", "Fleet score, trend, distribution"),
            ("GET", "/api/v1/compliance/hosts", "Per-host scores (sorted, filtered)"),
            ("GET", "/api/v1/compliance/groups", "Group-level scores"),
            ("GET", "/api/v1/compliance/environments", "Environment-level scores"),
            ("GET", "/api/v1/compliance/trend", "Historical score trend"),
            ("POST", "/api/v1/compliance/recalculate", "Trigger recalculation"),
        ]),
        ("Other Endpoints", [
            ("GET", "/api/v1/changes", "List change events"),
            ("GET", "/api/v1/eol/alerts", "List EOL alerts"),
            ("GET", "/api/v1/groups", "List host groups"),
            ("GET", "/api/v1/dependencies/connections", "List connections"),
            ("GET", "/api/v1/dependencies/map", "Full dependency graph"),
            ("GET", "/api/v1/reports/schedules", "List report schedules"),
            ("GET", "/api/v1/notifications/channels", "List notification channels"),
            ("GET", "/api/v1/discovery", "List discovered hosts"),
        ]),
    ]

    for section_name, endpoints in api_sections:
        story.append(Paragraph(section_name, styles["SubSection"]))
        data = [[
            Paragraph("<b>Method</b>", styles["Body"]),
            Paragraph("<b>Endpoint</b>", styles["Body"]),
            Paragraph("<b>Description</b>", styles["Body"]),
        ]]
        for method, path, desc in endpoints:
            color = {"GET": "#22c55e", "POST": "#3b82f6", "PATCH": "#f59e0b", "DELETE": "#ef4444"}.get(method, "#64748b")
            data.append([
                Paragraph(f'<font color="{color}"><b>{method}</b></font>', styles["Body"]),
                Paragraph(f'<font face="Courier" size="8">{path}</font>', styles["Body"]),
                Paragraph(desc, styles["Body"]),
            ])
        t = Table(data, colWidths=[0.8 * inch, 2.8 * inch, 2.9 * inch])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), HexColor("#f1f5f9")),
            ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ]))
        story.append(t)
        story.append(Spacer(1, 6))

    story.append(PageBreak())

    # ─── CHAPTER 17: UPDATING ───
    story.append(Paragraph("17. Updating &amp; Maintenance", styles["ChapterTitle"]))
    story.append(hr())

    story.append(Paragraph("Updating InfraWatch", styles["SectionTitle"]))
    story.append(Paragraph(
        "To update to a new version:",
        styles["Body"]
    ))
    story.append(Paragraph(
        "# Pull the latest code<br/>"
        "git pull origin main<br/><br/>"
        "# Rebuild and restart containers<br/>"
        "docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build<br/><br/>"
        "# Database migrations run automatically on startup",
        styles["CodeBlock"]
    ))
    story.append(Paragraph(
        "<b>Note:</b> Database migrations are applied automatically when the API server starts. "
        "Always back up the database before upgrading to a new version.",
        styles["Warning"]
    ))

    story.append(Paragraph("Database Backup", styles["SectionTitle"]))
    story.append(Paragraph(
        "# Create a backup<br/>"
        "docker compose exec postgres pg_dump -U infrawatch infrawatch &gt; backup.sql<br/><br/>"
        "# Restore from backup<br/>"
        "docker compose exec -T postgres psql -U infrawatch infrawatch &lt; backup.sql",
        styles["CodeBlock"]
    ))

    story.append(Paragraph("Log Access", styles["SectionTitle"]))
    story.append(Paragraph(
        "# View API server logs<br/>"
        "docker compose logs -f api<br/><br/>"
        "# View web server logs<br/>"
        "docker compose logs -f web<br/><br/>"
        "# View database logs<br/>"
        "docker compose logs -f postgres",
        styles["CodeBlock"]
    ))

    story.append(Paragraph("Resource Limits (Production)", styles["SectionTitle"]))
    story.append(Paragraph(
        "The production Docker Compose file enforces these resource limits:",
        styles["Body"]
    ))
    story.append(bullet_list([
        "<b>PostgreSQL</b>: 512 MB memory",
        "<b>API Server</b>: 1 GB memory",
        "<b>Web (nginx)</b>: 128 MB memory",
    ], styles))
    story.append(Paragraph(
        "Adjust these in <font face='Courier' size='9.5'>docker-compose.prod.yml</font> based on your fleet size. "
        "Large deployments (500+ hosts) may require increasing the API server memory and database connection pool.",
        styles["Body"]
    ))
    story.append(PageBreak())

    # ─── CHAPTER 18: TROUBLESHOOTING ───
    story.append(Paragraph("18. Troubleshooting", styles["ChapterTitle"]))
    story.append(hr())

    issues = [
        ("Web UI shows \"Unable to connect\" or blank page", [
            "Verify the API server is running: <font face='Courier' size='9'>docker compose ps</font>",
            "Check API health: <font face='Courier' size='9'>curl http://localhost:3001/api/v1/health</font>",
            "Verify <font face='Courier' size='9'>CORS_ORIGIN</font> matches the URL you're accessing the UI from",
            "Check API logs for errors: <font face='Courier' size='9'>docker compose logs api</font>",
        ]),
        ("Scans fail or time out", [
            "Use the <b>Test Connection</b> button on the scan target to verify connectivity",
            "Ensure the target host allows connections on the required port (SSH: 22, WinRM: 5985)",
            "For SSH targets, verify the SSH key or password is correct",
            "For Kubernetes targets, verify the kubeconfig or service account has read access",
            "Check API logs for detailed error messages",
        ]),
        ("Hosts stuck in 'stale' status", [
            "Verify the scan target is enabled and the interval hasn't elapsed too long",
            "Trigger a manual scan from the Scan Targets page",
            "Check if the host is actually reachable on the network",
            "The StaleHostChecker marks hosts as stale after 24 hours without a successful scan",
        ]),
        ("Compliance scores not updating", [
            "Scores recalculate daily at 2:00 AM and after each scan",
            "Click <b>Recalculate</b> on the Compliance page to force an update",
            "Check API logs for errors in the ComplianceScorer service",
        ]),
        ("Email notifications not sending", [
            "Verify SMTP settings in the <font face='Courier' size='9'>.env</font> file",
            "Use the <b>Test</b> button on the notification channel to check delivery",
            "Check the Notification Log for error messages",
            "Ensure your SMTP provider allows the sending volume",
        ]),
        ("Database connection errors", [
            "Verify PostgreSQL is running: <font face='Courier' size='9'>docker compose ps postgres</font>",
            "Check that <font face='Courier' size='9'>DB_HOST</font>, <font face='Courier' size='9'>DB_PORT</font>, and <font face='Courier' size='9'>DB_PASSWORD</font> are correct",
            "Ensure the database exists: <font face='Courier' size='9'>docker compose exec postgres psql -U infrawatch -l</font>",
            "Check if the connection pool is exhausted (increase <font face='Courier' size='9'>DB_POOL_MAX</font> if needed)",
        ]),
    ]

    for title, steps in issues:
        story.append(Paragraph(title, styles["SubSection"]))
        story.append(bullet_list(steps, styles))

    story.append(Spacer(1, 20))
    story.append(hr())
    story.append(Paragraph(
        "For additional help or to report bugs, visit the project repository or contact your system administrator.",
        styles["Body"]
    ))

    # ─── BUILD ───
    doc = SimpleDocTemplate(
        OUTPUT,
        pagesize=letter,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=MARGIN,
        bottomMargin=MARGIN,
        title="InfraWatch User Manual",
        author="InfraWatch Team",
        subject="Infrastructure Inventory Management - User Manual",
    )

    def add_page_number(canvas_obj, doc):
        canvas_obj.saveState()
        canvas_obj.setFont("Helvetica", 8)
        canvas_obj.setFillColor(GRAY)
        page_num = canvas_obj.getPageNumber()
        canvas_obj.drawCentredString(WIDTH / 2, 0.5 * inch, f"InfraWatch User Manual  |  Page {page_num}")
        canvas_obj.restoreState()

    doc.build(story, onFirstPage=add_page_number, onLaterPages=add_page_number)
    print(f"Generated: {OUTPUT}")
    print(f"Pages: {doc.page}")


if __name__ == "__main__":
    build_pdf()
