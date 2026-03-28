# Security Model

This document describes InfraWatch's security architecture, credential handling, network requirements, and hardening recommendations.

## Architecture Overview

InfraWatch follows an agentless, pull-based model. The API server initiates all connections to scan targets — no inbound connections from monitored infrastructure are required.

```
                    +-----------------+
                    |   Web Browser   |
                    +--------+--------+
                             | HTTPS :80 (nginx)
                    +--------+--------+
                    |     nginx       |
                    | (reverse proxy) |
                    +--------+--------+
                             | HTTP :3001 (internal)
                    +--------+--------+
                    |   API Server    |----> PostgreSQL :5432 (internal)
                    +--------+--------+
                             |
              Outbound connections only
                             |
         +-------------------+-------------------+
         |          |         |         |         |
      SSH:22    WinRM:5985  K8s:6443  AWS API   Docker:2376
                   :5986              (HTTPS)      :2375
```

## Credential Storage

### Encryption at Rest

All scan target connection configs (passwords, private keys, access keys) are encrypted before storage using **AES-256-GCM**:

- **Algorithm**: AES-256-GCM (authenticated encryption)
- **Key derivation**: SHA-256 hash of `MASTER_KEY` environment variable
- **IV**: Random 16 bytes per encryption operation
- **Auth tag**: 16 bytes (prevents tampering)
- **Storage format**: Base64-encoded `IV + authTag + ciphertext` in PostgreSQL JSONB column

The `MASTER_KEY` is never stored in the database. It exists only in:
- The `.env` file on the host
- The API container's environment variables
- Process memory during runtime

### Key Rotation

To rotate the `MASTER_KEY`:
1. Export all scan targets via the API
2. Update `MASTER_KEY` in `.env`
3. Restart the API container
4. Re-create each scan target (or write a migration script that decrypts with the old key and re-encrypts with the new one)

## API Authentication

### API Key

When `API_KEY` is set, all `/api/v1/*` routes (except `/api/v1/health`) require the `X-API-Key` header:

```
X-API-Key: <your-api-key>
```

The health endpoint is always unauthenticated to support Docker health checks and load balancer probes.

If `API_KEY` is empty or unset, authentication is disabled entirely. This is intentional for easy initial setup but should be configured for production.

### Web Frontend

The web frontend includes the API key via `VITE_API_KEY`, which is baked into the JavaScript bundle at build time. This means:

- The API key is visible in the browser's JavaScript source
- It provides protection against casual/automated access, not against determined attackers who can read the frontend code
- For stronger auth, implement user-based authentication (sessions, JWT, OAuth) in a future version

## Security Headers

The API server uses [Helmet.js](https://helmetjs.github.io/) to set security headers:

| Header | Value |
|--------|-------|
| Content-Security-Policy | `default-src 'self'; ...` |
| Strict-Transport-Security | `max-age=31536000; includeSubDomains` |
| X-Content-Type-Options | `nosniff` |
| X-Frame-Options | `SAMEORIGIN` |
| X-XSS-Protection | `0` (disabled per modern best practice) |
| Referrer-Policy | `no-referrer` |
| Cross-Origin-Opener-Policy | `same-origin` |

## Rate Limiting

| Scope | Limit | Window |
|-------|-------|--------|
| Global (all `/api/` routes) | 100 requests | 1 minute |
| Scan triggers (`/targets/:id/scan`, `/targets/:id/test`) | 10 requests | 1 minute |
| Auth endpoints (`/auth/*`) | 5 requests | 1 minute |

Rate limits are per-IP and use the `RateLimit` response header (draft-7 standard).

## CORS

The API only accepts requests from the origin specified by `CORS_ORIGIN` (default: `http://localhost`). Allowed methods: `GET`, `POST`, `PATCH`, `DELETE`. Allowed headers: `Content-Type`, `X-API-Key`.

## Network Requirements

### Outbound (from InfraWatch)

These ports must be open from the InfraWatch container to your infrastructure:

| Protocol | Port | Target | Purpose |
|----------|------|--------|---------|
| TCP | 22 | Linux hosts | SSH scanning |
| TCP | 5985 | Windows hosts | WinRM (HTTP) |
| TCP | 5986 | Windows hosts | WinRM (HTTPS) |
| TCP | 6443 | Kubernetes API | Cluster scanning |
| TCP | 443 | AWS endpoints | AWS API calls |
| TCP | 443 | vCenter | VMware API |
| TCP | 2375/2376 | Docker daemons | Docker API |
| TCP/UDP | Various | Target subnets | nmap network discovery |
| TCP | 443 | registry.npmjs.org | Version checking |
| TCP | 443 | pypi.org | Version checking |
| TCP | 443 | hub.docker.com | Version checking |
| TCP | 443 | api.github.com | Version checking |
| TCP | 587/465 | SMTP server | Alert emails |

### Inbound (to InfraWatch)

| Port | Source | Purpose |
|------|--------|---------|
| 80 (or `WEB_PORT`) | Users/browsers | Web UI access |

No inbound connections from monitored infrastructure are required.

### Internal (between containers)

| From | To | Port | Purpose |
|------|----|------|---------|
| nginx (web) | api | 3001 | API proxy |
| api | postgres | 5432 | Database |

All internal communication happens on the `infrawatch-net` Docker bridge network and is not exposed to the host.

## Container Security

### Non-Root Execution

The API container runs as a dedicated `infrawatch` user (UID 100), not root. The only exception is `nmap`, which requires elevated privileges for raw packet operations — this is handled via a sudoers rule limited to `/usr/bin/nmap` only.

### Resource Limits

| Container | Memory Limit |
|-----------|-------------|
| PostgreSQL | 512 MB |
| API | 512 MB |
| Web (nginx) | 128 MB |

### Image Security

- Multi-stage builds: build dependencies are not included in production images
- Base images: `node:20-alpine` and `nginx:alpine` (minimal attack surface)
- No development dependencies in production (`npm prune --production`)

## Database Security

- Connection pooling with limits: max 20 connections, 30s idle timeout, 5s connection timeout
- Pool-level error handler prevents unhandled crashes
- Credentials stored as encrypted JSONB — even database dumps don't expose plaintext secrets
- Parameterized queries throughout (no SQL injection vectors)

## Hardening Recommendations

### Production Deployment

1. **Set `API_KEY`**: Always set a strong API key in production
2. **Use HTTPS**: Put a TLS-terminating reverse proxy (Caddy, Traefik, or cloud LB) in front of InfraWatch
3. **Restrict network access**: Use firewall rules to limit who can reach port 80
4. **Rotate secrets**: Periodically rotate `DB_PASSWORD`, `MASTER_KEY`, and `API_KEY`
5. **Backup the database**: Regular `pg_dump` of the PostgreSQL volume
6. **Monitor logs**: Forward pino JSON logs to your log aggregation system
7. **Limit scan scope**: Use the most restrictive credentials possible for each scan target

### SSH Key Security

- Use Ed25519 keys (not RSA) for better security with shorter key lengths
- Set a passphrase on the key and store it in the connection config
- Restrict the `infrawatch` user's sudo to specific read-only commands
- Consider using SSH certificates instead of static keys for easier rotation

### AWS Security

- Use IAM roles instead of access keys when running InfraWatch in AWS
- Enable CloudTrail to audit InfraWatch's API calls
- Use the minimum IAM policy documented in the README
- Consider using AWS Organizations SCPs to limit the scope

### Network Isolation

- Run InfraWatch in a management/monitoring VLAN with access to target infrastructure
- Don't expose the web UI to the public internet without a VPN or zero-trust gateway
- Use Docker network policies to restrict container-to-container communication

## Vulnerability Reporting

If you discover a security vulnerability, please report it responsibly by emailing security@your-org.com. Do not open a public issue.
