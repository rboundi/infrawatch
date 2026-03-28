# InfraWatch

**Agentless infrastructure inventory and vulnerability monitoring.**

InfraWatch discovers hosts, packages, and services across your infrastructure without installing agents on target machines. It connects via standard protocols (SSH, WinRM, Kubernetes API, AWS API, Docker API, VMware API), inventories what's running, tracks package versions, and alerts you when updates are available.

```
                         +------------------+
                         |   Web Dashboard  |
                         |   (React + Vite) |
                         +--------+---------+
                                  |
                              nginx :80
                              /api proxy
                                  |
                         +--------+---------+
                         |    API Server    |
                         |   (Express.js)   |
                         +--------+---------+
                                  |
               +------------------+------------------+
               |                  |                  |
        +------+------+   +------+------+   +-------+------+
        |  Scan       |   |  Version    |   |  Email       |
        |  Orchestr.  |   |  Checker    |   |  Notifier    |
        +------+------+   +------+------+   +--------------+
               |                  |
        +------+------+   +------+------+
        |  Scanners   |   |  npm/PyPI/  |
        | (agentless) |   |  Docker Hub |
        +------+------+   +-------------+
               |
    +----------+----------+----------+----------+----------+----------+
    |          |          |          |          |          |          |
  SSH/Linux  WinRM    Kubernetes   AWS     VMware    Docker    Network
                                                              Discovery
               |
        +------+------+
        |  PostgreSQL  |
        |   (data)     |
        +--------------+
```

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (v20+)
- [Docker Compose](https://docs.docker.com/compose/install/) (v2+)

### Install & Run

```bash
git clone https://github.com/your-org/infrawatch.git
cd infrawatch
chmod +x setup.sh
./setup.sh
```

The setup script will:
1. Create `.env` from the example template
2. Generate random secrets for `DB_PASSWORD`, `MASTER_KEY`, and `API_KEY`
3. Build and start all containers
4. Wait for health checks to pass

Once complete, open **http://localhost** in your browser.

### Default Ports

| Service    | Port | Description              |
|------------|------|--------------------------|
| Web UI     | 80   | Nginx serving React SPA  |
| API        | 3001 | Express API (internal)   |
| PostgreSQL | 5432 | Database (internal)      |

## Configuration

All configuration is done through environment variables in `.env`. The setup script generates this file automatically.

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `DB_NAME` | PostgreSQL database name | `infrawatch` | No |
| `DB_USER` | PostgreSQL username | `infrawatch` | No |
| `DB_PASSWORD` | PostgreSQL password | *generated* | **Yes** |
| `MASTER_KEY` | AES-256 encryption key for stored credentials (min 32 chars) | *generated* | **Yes** |
| `API_KEY` | API authentication key. If empty, auth is disabled | *generated* | No |
| `VITE_API_KEY` | API key baked into frontend build (should match `API_KEY`) | *generated* | No |
| `CORS_ORIGIN` | Allowed CORS origin for the API | `http://localhost` | No |
| `WEB_PORT` | Host port for the web UI | `80` | No |
| `SMTP_HOST` | SMTP server hostname for email alerts | *empty* | No |
| `SMTP_PORT` | SMTP server port | `587` | No |
| `SMTP_USER` | SMTP username | *empty* | No |
| `SMTP_PASS` | SMTP password | *empty* | No |
| `ALERT_EMAIL` | Recipient for alert digest emails | *empty* | No |
| `VERSION_CHECK_INTERVAL_HOURS` | How often to check for package updates | `12` | No |
| `ALERT_DIGEST_HOUR` | Hour of day (0-23) to send the alert digest email | `8` | No |

## Adding Scan Targets

Scan targets are added through the web UI (**Scan Targets > Add Target**) or via the API.

### SSH Linux

Scans Linux hosts over SSH to discover OS info, packages (dpkg/rpm/apk/pip/npm), services, and Docker containers.

**1. Create a dedicated user on target hosts:**

```bash
# On each target host
sudo useradd -r -m -s /bin/bash infrawatch
sudo mkdir -p /home/infrawatch/.ssh
sudo chmod 700 /home/infrawatch/.ssh
```

**2. Generate and deploy SSH keys:**

```bash
# On your local machine
ssh-keygen -t ed25519 -f infrawatch_key -N "" -C "infrawatch"

# Copy public key to each target
ssh-copy-id -i infrawatch_key.pub infrawatch@<target-host>
```

**3. Grant read-only sudo access:**

```bash
# On each target host, create /etc/sudoers.d/infrawatch
cat <<'EOF' | sudo tee /etc/sudoers.d/infrawatch
infrawatch ALL=(ALL) NOPASSWD: /usr/bin/dpkg-query, /usr/bin/rpm, /usr/sbin/apk, /usr/bin/pip, /usr/local/bin/pip, /usr/bin/npm, /usr/local/bin/npm, /usr/bin/systemctl list-units *, /usr/bin/docker ps *, /usr/bin/docker inspect *
EOF
sudo chmod 440 /etc/sudoers.d/infrawatch
```

**4. Connection config:**

```json
{
  "host": "10.0.1.10",
  "port": 22,
  "username": "infrawatch",
  "privateKey": "-----BEGIN OPENSSH PRIVATE KEY-----\n..."
}
```

### Kubernetes

Scans a Kubernetes cluster for deployments, pods, container images, services, and namespaces.

**1. Create a read-only ClusterRole:**

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: infrawatch-reader
rules:
  - apiGroups: [""]
    resources: ["pods", "services", "namespaces", "nodes"]
    verbs: ["get", "list"]
  - apiGroups: ["apps"]
    resources: ["deployments", "statefulsets", "daemonsets", "replicasets"]
    verbs: ["get", "list"]
  - apiGroups: ["networking.k8s.io"]
    resources: ["ingresses"]
    verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: infrawatch-reader-binding
subjects:
  - kind: ServiceAccount
    name: infrawatch
    namespace: infrawatch
roleRef:
  kind: ClusterRole
  name: infrawatch-reader
  apiGroup: rbac.authorization.k8s.io
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: infrawatch
  namespace: infrawatch
```

**2. Export the kubeconfig:**

```bash
# Get the service account token and build a kubeconfig
kubectl create token infrawatch -n infrawatch --duration=8760h
```

**3. Connection config:**

```json
{
  "kubeconfig": "<base64-encoded kubeconfig>",
  "context": "prod-cluster"
}
```

Or if InfraWatch runs inside the cluster:

```json
{
  "inCluster": true
}
```

### AWS

Scans AWS accounts for EC2 instances, RDS databases, ECS services, and Lambda functions.

**1. Create a minimum IAM policy:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances",
        "ec2:DescribeImages",
        "ec2:DescribeRegions",
        "rds:DescribeDBInstances",
        "ecs:ListClusters",
        "ecs:ListServices",
        "ecs:DescribeServices",
        "ecs:ListTasks",
        "ecs:DescribeTasks",
        "ecs:DescribeTaskDefinition",
        "eks:ListClusters",
        "eks:DescribeCluster",
        "lambda:ListFunctions",
        "lambda:GetFunction"
      ],
      "Resource": "*"
    }
  ]
}
```

**2. Create an IAM user and access key:**

```bash
aws iam create-user --user-name infrawatch
aws iam put-user-policy --user-name infrawatch \
  --policy-name InfraWatchReadOnly \
  --policy-document file://policy.json
aws iam create-access-key --user-name infrawatch
```

**3. Connection config:**

```json
{
  "region": "us-east-1",
  "regions": ["us-east-1", "eu-west-1"],
  "accessKeyId": "AKIAIOSFODNN7EXAMPLE",
  "secretAccessKey": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
}
```

### VMware

Scans vCenter for ESXi hosts, virtual machines, VMware Tools versions, and guest OS info.

**1. Create a read-only vSphere role:**

In the vSphere Client:
1. Go to **Administration > Access Control > Roles**
2. Create a new role `InfraWatch Reader` with these privileges:
   - `Virtual Machine > Interaction > Guest Operations Queries`
   - `Virtual Machine > Guest Operations > Guest Operation Queries`
   - `Host > Configuration > System Management`
   - `Global > Diagnostics`
   - Read-only on the root datacenter

3. Create a service account and assign the role at the datacenter level.

**2. Connection config:**

```json
{
  "host": "vcenter.example.com",
  "username": "infrawatch@vsphere.local",
  "password": "...",
  "ignoreSslErrors": false
}
```

### Docker

Scans a Docker daemon for running containers, images, and resource usage.

**1. Enable the Docker TCP API (if remote):**

```bash
# /etc/docker/daemon.json
{
  "hosts": ["unix:///var/run/docker.sock", "tcp://0.0.0.0:2376"],
  "tls": true,
  "tlscacert": "/etc/docker/ca.pem",
  "tlscert": "/etc/docker/server-cert.pem",
  "tlskey": "/etc/docker/server-key.pem",
  "tlsverify": true
}
```

**2. Connection config (remote with TLS):**

```json
{
  "host": "tcp://10.0.2.5",
  "port": 2376,
  "ca": "-----BEGIN CERTIFICATE-----\n...",
  "cert": "-----BEGIN CERTIFICATE-----\n...",
  "key": "-----BEGIN RSA PRIVATE KEY-----\n..."
}
```

**Connection config (local socket):**

```json
{
  "socketPath": "/var/run/docker.sock"
}
```

### WinRM (Windows)

Scans Windows hosts via WinRM for installed programs, services, Windows features, and IIS sites.

**1. Enable WinRM on target hosts:**

```powershell
# Run as Administrator on each Windows host
Enable-PSRemoting -Force
Set-Item WSMan:\localhost\Service\Auth\Basic -Value $true
Set-Item WSMan:\localhost\Service\AllowUnencrypted -Value $true  # Only for testing
```

For production, use HTTPS:

```powershell
# Create a self-signed cert or use a CA cert
$cert = New-SelfSignedCertificate -DnsName $env:COMPUTERNAME -CertStoreLocation Cert:\LocalMachine\My
winrm create winrm/config/Listener?Address=*+Transport=HTTPS "@{Hostname=`"$env:COMPUTERNAME`";CertificateThumbprint=`"$($cert.Thumbprint)`"}"
```

**2. Connection config:**

```json
{
  "host": "10.0.1.50",
  "port": 5985,
  "username": "infrawatch",
  "password": "...",
  "useSsl": false
}
```

### Network Discovery

Scans subnets using nmap to discover active hosts, open ports, and OS fingerprints.

```json
{
  "subnets": ["192.168.1.0/24", "10.0.1.0/24"],
  "excludeHosts": ["192.168.1.1"],
  "scanProfile": "polite",
  "portProfile": "infrastructure",
  "enableOsDetection": true,
  "enableVersionDetection": true
}
```

Discovered hosts can be promoted to full scan targets from the Discovery page.

## Alert Configuration

### Email Notifications

InfraWatch sends a daily digest of critical and high alerts via email.

1. Set the SMTP variables in `.env`:

```bash
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=infrawatch@example.com
SMTP_PASS=your-password
ALERT_EMAIL=ops-team@example.com
```

2. Restart the API container:

```bash
docker compose -f docker-compose.prod.yml restart api
```

The digest is sent daily at the hour configured by `ALERT_DIGEST_HOUR` (default: 8 AM UTC).

### Alert Severity

| Severity | Trigger |
|----------|---------|
| Critical | Package has 5+ known CVEs |
| High | Package has 1-4 known CVEs, or major version behind |
| Medium | Minor version behind |
| Low | Patch version behind |
| Info | Informational (new package detected, etc.) |

## Upgrading

```bash
git pull origin main
docker compose -f docker-compose.prod.yml up -d --build
```

Database migrations run automatically on startup. No manual migration step is needed.

To verify the upgrade:

```bash
curl http://localhost/api/v1/health
```

## Troubleshooting

### SSH connection fails

- Verify the target host is reachable: `ssh -i key infrawatch@host`
- Check that the SSH key is in PEM/OpenSSH format (starts with `-----BEGIN`)
- Ensure the `infrawatch` user exists and has the correct `authorized_keys`
- Verify the sudoers file has no syntax errors: `sudo visudo -c -f /etc/sudoers.d/infrawatch`
- Check firewall allows port 22 from the InfraWatch container

### AWS permissions error

- Verify the IAM policy is attached: `aws iam list-attached-user-policies --user-name infrawatch`
- Check the region is correct in the connection config
- Test locally: `AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... aws ec2 describe-instances --region us-east-1`

### Scan timeouts

- Default scan timeout is 5 minutes per target
- Network discovery can take longer for large subnets; adjust `maxScanMinutes`
- Check the scan logs in the UI for error messages
- For SSH scans: slow `dpkg-query` on hosts with thousands of packages can cause timeouts

### Database connection issues

- Verify PostgreSQL is running: `docker compose -f docker-compose.prod.yml ps postgres`
- Check logs: `docker compose -f docker-compose.prod.yml logs postgres`
- If you changed `DB_PASSWORD` after first start, you need to remove the volume: `docker compose -f docker-compose.prod.yml down -v` (warning: deletes all data)

### API returns 401 Unauthorized

- If `API_KEY` is set, the web frontend needs `VITE_API_KEY` set to the same value
- `VITE_API_KEY` is baked in at build time; rebuild the web container after changing it
- The health endpoint (`/api/v1/health`) is always unauthenticated

## Development

### Prerequisites

- Node.js 20+
- Docker & Docker Compose (for PostgreSQL)

### Running in Dev Mode

```bash
# Start PostgreSQL
docker compose up postgres -d

# Install dependencies
npm install

# Create .env (set DB_PORT=5433 for the mapped port)
cp .env.production.example .env
# Edit .env: set DB_PORT=5433, DB_PASSWORD=infrawatch_dev, MASTER_KEY=change-me-to-a-random-secret-at-least-32

# Build shared packages
npm run build -w packages/scanner

# Start API server (with hot reload)
npm run dev -w packages/server

# Start web frontend (in another terminal)
npm run dev -w packages/web
```

### Project Structure

```
infrawatch/
  packages/
    scanner/          # Agentless scanner library
      src/
        scanners/     # One file per scanner type
        types.ts      # Shared types (ScanResult, HostInventory, etc.)
        index.ts      # createScanner() factory
    server/           # Express API + background services
      src/
        routes/       # REST API endpoints
        services/     # ScanOrchestrator, VersionChecker, EmailNotifier, etc.
        middleware/    # Error handler, API key auth
        utils/        # Crypto, validation
        config.ts     # Environment config
        index.ts      # App entry point
      migrations/     # PostgreSQL migrations (node-pg-migrate)
    web/              # React SPA (Vite + TailwindCSS)
      src/
        api/          # API client + React Query hooks
        components/   # Reusable UI components
        pages/        # Route pages (Dashboard, Hosts, Alerts, etc.)
  docker-compose.yml          # Dev compose (PostgreSQL)
  docker-compose.prod.yml     # Production compose (all services)
  setup.sh                    # One-command production setup
```

### Adding a New Scanner Type

1. Create `packages/scanner/src/scanners/my-scanner.ts` implementing the `Scanner` interface:

```typescript
import type { Scanner, ScanTarget, ScanResult } from "../types.js";

export class MyScanner implements Scanner {
  async scan(target: ScanTarget): Promise<ScanResult> {
    const config = target.connectionConfig as MyConnectionConfig;
    // ... discover hosts, packages, services
    return { hosts: [...] };
  }
}
```

2. Register it in `packages/scanner/src/index.ts`:

```typescript
case "my_scanner":
  return new MyScanner();
```

3. Add the type to the database constraint in a new migration:

```sql
ALTER TABLE scan_targets DROP CONSTRAINT scan_targets_type_check;
ALTER TABLE scan_targets ADD CONSTRAINT scan_targets_type_check
  CHECK (type IN ('ssh_linux','winrm','kubernetes','aws','vmware','docker','network_discovery','my_scanner'));
```

4. Add the type to the validation enum in `packages/server/src/utils/validation.ts`.

## License

MIT
