# Changelog

## v1.0.0 (2026-03-28)

Initial release of InfraWatch.

### Infrastructure Scanning

- **SSH/Linux scanner**: Discovers OS, packages (dpkg/rpm/apk/pip/npm), services, and Docker containers over SSH
- **Kubernetes scanner**: Inventories deployments, pods, container images, services, and namespaces via the Kubernetes API
- **AWS scanner**: Discovers EC2 instances, RDS databases, ECS services, and Lambda functions across multiple regions
- **VMware scanner**: Scans vCenter for ESXi hosts, VMs, VMware Tools versions, and guest OS info
- **Docker scanner**: Enumerates containers, images, and daemon info via the Docker API
- **WinRM scanner**: Discovers installed programs, services, Windows features, and IIS sites on Windows hosts
- **Network discovery**: Uses nmap to find active hosts, open ports, and OS fingerprints on subnets

### Inventory Management

- Host inventory with OS, IP, architecture, environment tags, and status tracking
- Package tracking across ecosystems (Debian, RHEL, Alpine, npm, PyPI, Docker, Windows)
- Service discovery with port and version information
- Stale host detection (marks hosts not seen in 24 hours)

### Version Monitoring & Alerts

- Automatic version checking against npm, PyPI, Docker Hub, and GitHub releases
- Alert generation for outdated packages with severity levels (critical, high, medium, low, info)
- CVE-aware severity: critical for 5+ CVEs, high for 1-4 CVEs
- Alert acknowledgement (single and bulk) with notes and attribution
- Daily email digest of critical and high alerts via SMTP

### Network Discovery

- Subnet scanning with configurable profiles (stealthy, polite, normal, aggressive)
- OS fingerprinting and service version detection
- Port scanning profiles (common, infrastructure, full, custom)
- Promote discovered hosts to full scan targets
- Dismiss irrelevant discoveries

### Web Dashboard

- Overview dashboard with host, package, alert, and scan target counts
- Host list with filtering (status, environment, platform, ports), sorting, and search
- Host detail with packages, services, and recent alerts
- Alert list with severity filtering, bulk acknowledge, and search
- Scan target management (create, edit, delete, test connection, trigger scan)
- Discovery results with promote/dismiss actions
- Dark/light theme toggle
- Responsive layout

### API

- RESTful API at `/api/v1` with full CRUD for all resources
- Paginated list endpoints with filtering and sorting
- API key authentication (`X-API-Key` header)
- Rate limiting (100/min global, 10/min for scans, 5/min for auth)
- Security headers via Helmet.js
- CORS configuration
- Request body size limit (1 MB)

### Security

- AES-256-GCM encryption for stored credentials
- Non-root container execution
- Multi-stage Docker builds (no dev dependencies in production)
- Database connection pooling with limits
- Graceful shutdown with scan completion waiting
- Unhandled rejection and uncaught exception handlers

### Deployment

- Production Docker Compose with PostgreSQL, API, and nginx
- One-command setup script with automatic secret generation
- Health checks on all containers
- Resource limits (512 MB API, 512 MB PostgreSQL, 128 MB nginx)
- Automatic database migrations on startup
