# API Reference

Base URL: `/api/v1`

All endpoints (except health) require the `X-API-Key` header when `API_KEY` is configured.

---

## Health

### GET /api/v1/health

Returns system health status. Always unauthenticated.

**Response 200:**

```json
{
  "status": "healthy",
  "db": "ok",
  "uptime": 3600,
  "memory": {
    "rss": 115,
    "heapUsed": 58,
    "heapTotal": 60
  },
  "activeScans": 0,
  "lastScanTime": "2025-01-15T10:30:00.000Z",
  "timestamp": "2025-01-15T14:30:00.000Z",
  "version": "0.1.0"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | `"healthy" \| "degraded"` | Degraded if database is unreachable |
| `db` | `"ok" \| "unreachable"` | Database connectivity |
| `uptime` | `number` | Seconds since server start |
| `memory.rss` | `number` | Resident set size in MB |
| `memory.heapUsed` | `number` | V8 heap used in MB |
| `memory.heapTotal` | `number` | V8 heap total in MB |
| `activeScans` | `number` | Targets currently being scanned |
| `lastScanTime` | `string \| null` | ISO timestamp of most recent scan |
| `version` | `string` | Server version from package.json |

---

## Scan Targets

### POST /api/v1/targets

Create a new scan target.

**Request:**

```json
{
  "name": "Production Web Servers",
  "type": "ssh_linux",
  "connectionConfig": {
    "host": "10.0.1.10",
    "port": 22,
    "username": "infrawatch",
    "privateKey": "-----BEGIN OPENSSH PRIVATE KEY-----\n..."
  },
  "scanIntervalHours": 6,
  "enabled": true
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | `string` | Yes | — | Display name (1-255 chars) |
| `type` | `string` | Yes | — | Scanner type (see below) |
| `connectionConfig` | `object` | Yes | — | Type-specific connection settings |
| `scanIntervalHours` | `number` | No | `6` | Hours between automatic scans (1-168) |
| `enabled` | `boolean` | No | `true` | Whether automatic scanning is active |

**Scanner types:** `ssh_linux`, `kubernetes`, `aws`, `vmware`, `docker`, `winrm`, `network_discovery`

**Response 201:**

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "name": "Production Web Servers",
  "type": "ssh_linux",
  "scanIntervalHours": 6,
  "lastScannedAt": null,
  "lastScanStatus": "pending",
  "enabled": true,
  "createdAt": "2025-01-15T10:00:00.000Z",
  "updatedAt": "2025-01-15T10:00:00.000Z"
}
```

### GET /api/v1/targets

List all scan targets.

**Response 200:**

```json
[
  {
    "id": "a1b2c3d4-...",
    "name": "Production Web Servers",
    "type": "ssh_linux",
    "scanIntervalHours": 6,
    "lastScannedAt": "2025-01-15T10:30:00.000Z",
    "lastScanStatus": "success",
    "enabled": true,
    "createdAt": "2025-01-15T10:00:00.000Z",
    "updatedAt": "2025-01-15T10:30:00.000Z"
  }
]
```

### GET /api/v1/targets/:id

Get a single scan target.

**Response 200:** Same shape as list item, plus `lastScanError` field (string or undefined).

**Response 404:** `{ "error": "Scan target not found" }`

### PATCH /api/v1/targets/:id

Update a scan target. All fields are optional.

**Request:**

```json
{
  "name": "Updated Name",
  "scanIntervalHours": 12,
  "enabled": false
}
```

**Response 200:** Updated scan target object.

### DELETE /api/v1/targets/:id

Delete a scan target. Cascades to scan logs. Hosts are preserved.

**Response 204:** No content.

### POST /api/v1/targets/:id/test

Test the connection to a scan target without performing a full scan.

**Response 200:**

```json
{
  "success": true,
  "message": "Successfully connected to ssh_linux target",
  "latencyMs": 245
}
```

Or on failure:

```json
{
  "success": false,
  "message": "Connection refused",
  "latencyMs": 5012
}
```

### POST /api/v1/targets/:id/scan

Trigger an immediate scan. The scan runs asynchronously.

**Response 202:**

```json
{
  "message": "Scan started",
  "scanLogId": "b2c3d4e5-..."
}
```

---

## Hosts

### GET /api/v1/hosts

List discovered hosts with filtering, sorting, and pagination.

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `status` | `string` | — | Filter: `active`, `stale`, `decommissioned` |
| `environment` | `string` | — | Filter by environment tag |
| `search` | `string` | — | Search hostname (case-insensitive) |
| `discoveryMethod` | `string` | — | Filter: `scanner`, `network_discovery` |
| `detectedPlatform` | `string` | — | Filter: `linux`, `windows`, `kubernetes`, etc. |
| `hasPort` | `number` | — | Filter hosts with this port open |
| `sortBy` | `string` | `hostname` | Sort: `hostname`, `lastSeenAt`, `packageCount` |
| `order` | `string` | `asc` | `asc` or `desc` |
| `page` | `number` | `1` | Page number |
| `limit` | `number` | `50` | Results per page (max 100) |

**Response 200:**

```json
{
  "data": [
    {
      "id": "c3d4e5f6-...",
      "hostname": "web-prod-01",
      "ip": "10.0.1.10",
      "os": "Ubuntu",
      "osVersion": "22.04.3 LTS",
      "arch": "x86_64",
      "environmentTag": "production",
      "lastSeenAt": "2025-01-15T10:30:00.000Z",
      "firstSeenAt": "2024-12-01T08:00:00.000Z",
      "status": "active",
      "scanTargetName": "Production Web Servers",
      "packageCount": 8,
      "openAlertCount": 3,
      "macAddress": null,
      "macVendor": null,
      "detectedPlatform": "linux",
      "discoveryMethod": "scanner",
      "openPorts": []
    }
  ],
  "total": 13,
  "page": 1,
  "totalPages": 1
}
```

### GET /api/v1/hosts/:id

Get detailed host information including packages, services, and recent alerts.

**Response 200:**

```json
{
  "id": "c3d4e5f6-...",
  "hostname": "web-prod-01",
  "ip": "10.0.1.10",
  "os": "Ubuntu",
  "osVersion": "22.04.3 LTS",
  "arch": "x86_64",
  "environmentTag": "production",
  "status": "active",
  "metadata": {},
  "scanTargetId": "a1b2c3d4-...",
  "packages": [
    {
      "id": "d4e5f6a7-...",
      "packageName": "nginx",
      "installedVersion": "1.24.0",
      "packageManager": "apt",
      "ecosystem": "debian",
      "firstDetectedAt": "2024-12-01T08:00:00.000Z",
      "lastDetectedAt": "2025-01-15T10:30:00.000Z",
      "updateAvailable": true
    }
  ],
  "services": [
    {
      "id": "e5f6a7b8-...",
      "serviceName": "nginx",
      "serviceType": "web_server",
      "version": "1.24.0",
      "port": 80,
      "status": "running",
      "detectedAt": "2024-12-01T08:00:00.000Z",
      "lastSeenAt": "2025-01-15T10:30:00.000Z"
    }
  ],
  "recentAlerts": [
    {
      "id": "f6a7b8c9-...",
      "packageName": "openssl",
      "severity": "critical",
      "currentVersion": "3.0.11",
      "availableVersion": "3.2.1",
      "acknowledged": false,
      "createdAt": "2025-01-14T06:00:00.000Z"
    }
  ]
}
```

### GET /api/v1/hosts/:id/packages

List packages for a host with filtering and pagination.

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `search` | `string` | — | Search package name |
| `ecosystem` | `string` | — | Filter by ecosystem |
| `hasUpdate` | `string` | — | `"true"` to show only updatable packages |
| `page` | `number` | `1` | Page number |
| `limit` | `number` | `50` | Results per page (max 100) |

**Response 200:** Paginated list of package objects.

### GET /api/v1/hosts/:id/history

Get scan history for a host's scan target (last 50 entries).

**Response 200:**

```json
{
  "data": [
    {
      "id": "a7b8c9d0-...",
      "scanTargetId": "a1b2c3d4-...",
      "startedAt": "2025-01-15T10:30:00.000Z",
      "completedAt": "2025-01-15T10:30:45.000Z",
      "status": "success",
      "hostsDiscovered": 2,
      "packagesDiscovered": 15,
      "errorMessage": null
    }
  ]
}
```

---

## Alerts

### GET /api/v1/alerts

List alerts with filtering, sorting, and pagination.

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `severity` | `string` | — | Comma-separated: `critical,high,medium,low,info` |
| `acknowledged` | `string` | — | `"true"` or `"false"` |
| `hostId` | `string` | — | Filter by host ID |
| `search` | `string` | — | Search package name |
| `sortBy` | `string` | `createdAt` | `createdAt` or `severity` |
| `order` | `string` | `desc` | `asc` or `desc` |
| `page` | `number` | `1` | Page number |
| `limit` | `number` | `50` | Results per page (max 100) |

**Response 200:**

```json
{
  "data": [
    {
      "id": "f6a7b8c9-...",
      "hostId": "c3d4e5f6-...",
      "hostname": "web-prod-01",
      "packageId": "d4e5f6a7-...",
      "packageName": "openssl",
      "currentVersion": "3.0.11",
      "availableVersion": "3.2.1",
      "severity": "critical",
      "acknowledged": false,
      "acknowledgedAt": null,
      "acknowledgedBy": null,
      "notes": null,
      "createdAt": "2025-01-14T06:00:00.000Z"
    }
  ],
  "total": 16,
  "page": 1,
  "totalPages": 1
}
```

### GET /api/v1/alerts/summary

Get alert count breakdown.

**Response 200:**

```json
{
  "total": 16,
  "critical": 3,
  "high": 5,
  "medium": 4,
  "low": 2,
  "info": 0,
  "unacknowledged": 14
}
```

### PATCH /api/v1/alerts/:id/acknowledge

Acknowledge a single alert.

**Request:**

```json
{
  "acknowledgedBy": "admin",
  "notes": "Will update in next maintenance window"
}
```

Both fields are optional.

**Response 200:** Updated alert object.

### PATCH /api/v1/alerts/bulk-acknowledge

Acknowledge multiple alerts at once.

**Request:**

```json
{
  "alertIds": ["f6a7b8c9-...", "a7b8c9d0-..."],
  "acknowledgedBy": "admin",
  "notes": "Batch acknowledged"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `alertIds` | `string[]` | Yes | Non-empty array of alert IDs |
| `acknowledgedBy` | `string` | No | Who acknowledged |
| `notes` | `string` | No | Acknowledgement notes |

**Response 200:**

```json
{
  "acknowledged": 2,
  "ids": ["f6a7b8c9-...", "a7b8c9d0-..."]
}
```

---

## Stats

### GET /api/v1/stats/overview

Get dashboard overview statistics.

**Response 200:**

```json
{
  "totalHosts": 13,
  "activeHosts": 12,
  "staleHosts": 1,
  "totalPackages": 42,
  "totalAlerts": 16,
  "criticalAlerts": 3,
  "scanTargets": 6,
  "lastScanAt": "2025-01-15T10:30:00.000Z",
  "networkDiscoveryHosts": 6,
  "autoPromotedTargets": 1
}
```

---

## Network Discovery

### GET /api/v1/discovery

List network discovery results.

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `scanTargetId` | `string` | — | Filter by scan target |
| `platform` | `string` | — | Filter by detected platform |
| `hasPort` | `number` | — | Filter by open port |
| `search` | `string` | — | Search IP or hostname |
| `autoPromoted` | `string` | — | `"true"` or `"false"` |
| `dismissed` | `string` | `"false"` | `"true"` or `"false"` |
| `page` | `number` | `1` | Page number |
| `limit` | `number` | `50` | Results per page (max 100) |

**Response 200:**

```json
{
  "data": [
    {
      "id": "b8c9d0e1-...",
      "scanTargetId": "a1b2c3d4-...",
      "scanLogId": "a7b8c9d0-...",
      "ipAddress": "192.168.1.20",
      "hostname": "nas-01.local",
      "macAddress": "AA:BB:CC:DD:EE:20",
      "macVendor": "Synology",
      "osMatch": "Linux 4.4",
      "osAccuracy": 88,
      "openPorts": [
        { "port": 22, "service": "ssh" },
        { "port": 80, "service": "http" },
        { "port": 443, "service": "https" }
      ],
      "detectedPlatform": "linux",
      "autoPromoted": false,
      "dismissed": false,
      "createdAt": "2025-01-15T08:00:00.000Z",
      "hostId": null,
      "hostHostname": null
    }
  ],
  "total": 6,
  "page": 1,
  "totalPages": 1
}
```

### GET /api/v1/discovery/:id

Get a single discovery result. Same shape as list item.

### POST /api/v1/discovery/:id/promote

Promote a discovered host to a full scan target.

**Request:**

```json
{
  "type": "ssh_linux",
  "templateTargetId": "a1b2c3d4-...",
  "name": "NAS Server"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `string` | Yes | `"ssh_linux"` or `"winrm"` |
| `templateTargetId` | `string` | Yes | Existing target to copy connection config from |
| `name` | `string` | No | Name for the new target (default: `"Auto: <ip>"`) |

The new target copies the template's connection config but replaces the host/IP with the discovered host's IP.

**Response 201:** Created scan target object.

### PATCH /api/v1/discovery/:id/dismiss

Dismiss a discovery result (hides it from default listing).

**Response 204:** No content.

---

## Error Responses

All errors follow this format:

```json
{
  "error": "Description of the error"
}
```

| Status | Meaning |
|--------|---------|
| 400 | Bad request (validation failed, missing fields) |
| 401 | Invalid or missing API key |
| 404 | Resource not found |
| 429 | Rate limit exceeded |
| 500 | Internal server error |

### Rate Limit Headers

When rate limited, responses include:

```
RateLimit-Policy: 100;w=60
RateLimit: limit=100, remaining=42, reset=30
```

### Validation Errors (400)

```json
{
  "error": "Validation failed",
  "details": [
    {
      "type": "field",
      "msg": "Name is required",
      "path": "name",
      "location": "body"
    }
  ]
}
```
