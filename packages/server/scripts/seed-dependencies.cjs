#!/usr/bin/env node

/**
 * Seed script: inserts demo hosts, services, connections, and annotations
 * to exercise the dependency mapping feature.
 *
 * Usage:
 *   node packages/server/scripts/seed-dependencies.cjs
 *
 * Reads DB config from env vars (or .env at project root via dotenv).
 */

const pg = require("pg");
const path = require("path");

// Load .env from project root
try {
  require("dotenv").config({ path: path.resolve(__dirname, "../../../.env") });
} catch {
  // dotenv may not be installed — fall back to env vars
}

const pool = new pg.Pool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5433", 10),
  database: process.env.DB_NAME || "infrawatch",
  user: process.env.DB_USER || "infrawatch",
  password: process.env.DB_PASSWORD || "infrawatch_dev",
});

// ─── Demo topology ───
//
//  [load-balancer] ──▶ [web-01] ──▶ [api-01] ──▶ [postgres-primary]
//                  ──▶ [web-02] ──▶ [api-01]      ▲
//                                  ──▶ [api-02] ──▶ [postgres-primary]
//                                                 ──▶ [redis-cache]
//                                                 ──▶ [postgres-primary]
//  [monitoring]   ──▶ [web-01], [web-02], [api-01], [api-02], [postgres-primary], [redis-cache]
//  [worker-01]    ──▶ [redis-cache], [postgres-primary]

const HOSTS = [
  { hostname: "lb-prod-01",        ip: "10.0.1.10",  os: "Ubuntu 22.04 LTS",       osVersion: "22.04", arch: "x86_64", env: "production" },
  { hostname: "web-prod-01",       ip: "10.0.2.11",  os: "Ubuntu 22.04 LTS",       osVersion: "22.04", arch: "x86_64", env: "production" },
  { hostname: "web-prod-02",       ip: "10.0.2.12",  os: "Ubuntu 22.04 LTS",       osVersion: "22.04", arch: "x86_64", env: "production" },
  { hostname: "api-prod-01",       ip: "10.0.3.21",  os: "Debian 12 (Bookworm)",   osVersion: "12",    arch: "x86_64", env: "production" },
  { hostname: "api-prod-02",       ip: "10.0.3.22",  os: "Debian 12 (Bookworm)",   osVersion: "12",    arch: "x86_64", env: "production" },
  { hostname: "postgres-prod-01",  ip: "10.0.4.31",  os: "Ubuntu 22.04 LTS",       osVersion: "22.04", arch: "x86_64", env: "production" },
  { hostname: "redis-prod-01",     ip: "10.0.4.32",  os: "Alpine Linux 3.19",      osVersion: "3.19",  arch: "x86_64", env: "production" },
  { hostname: "monitoring-01",     ip: "10.0.5.50",  os: "Ubuntu 24.04 LTS",       osVersion: "24.04", arch: "x86_64", env: "production" },
  { hostname: "worker-prod-01",    ip: "10.0.3.41",  os: "Debian 12 (Bookworm)",   osVersion: "12",    arch: "x86_64", env: "production" },
  { hostname: "staging-web-01",    ip: "10.1.2.11",  os: "Ubuntu 22.04 LTS",       osVersion: "22.04", arch: "x86_64", env: "staging" },
  { hostname: "staging-db-01",     ip: "10.1.4.31",  os: "Ubuntu 22.04 LTS",       osVersion: "22.04", arch: "x86_64", env: "staging" },
];

const SERVICES = [
  { hostname: "lb-prod-01",        services: [{ name: "nginx", type: "web-server", version: "1.24.0", port: 80 }, { name: "nginx", type: "web-server", version: "1.24.0", port: 443 }] },
  { hostname: "web-prod-01",       services: [{ name: "nginx", type: "web-server", version: "1.24.0", port: 80 }, { name: "node", type: "runtime", version: "20.11.0", port: 3000 }] },
  { hostname: "web-prod-02",       services: [{ name: "nginx", type: "web-server", version: "1.24.0", port: 80 }, { name: "node", type: "runtime", version: "20.11.0", port: 3000 }] },
  { hostname: "api-prod-01",       services: [{ name: "node", type: "runtime", version: "20.11.0", port: 4000 }] },
  { hostname: "api-prod-02",       services: [{ name: "node", type: "runtime", version: "20.11.0", port: 4000 }] },
  { hostname: "postgres-prod-01",  services: [{ name: "postgresql", type: "database", version: "16.2", port: 5432 }] },
  { hostname: "redis-prod-01",     services: [{ name: "redis-server", type: "cache", version: "7.2.4", port: 6379 }] },
  { hostname: "monitoring-01",     services: [{ name: "prometheus", type: "monitoring", version: "2.50.0", port: 9090 }, { name: "grafana", type: "monitoring", version: "10.3.1", port: 3000 }] },
  { hostname: "worker-prod-01",    services: [{ name: "node", type: "runtime", version: "20.11.0", port: null }] },
  { hostname: "staging-web-01",    services: [{ name: "nginx", type: "web-server", version: "1.24.0", port: 80 }, { name: "node", type: "runtime", version: "20.11.0", port: 3000 }] },
  { hostname: "staging-db-01",     services: [{ name: "postgresql", type: "database", version: "16.2", port: 5432 }] },
];

// Connections: [source_hostname, target_hostname, target_port, source_process, target_service]
const CONNECTIONS = [
  // LB → web servers
  ["lb-prod-01",       "web-prod-01",      80,   "nginx",     "nginx"],
  ["lb-prod-01",       "web-prod-02",      80,   "nginx",     "nginx"],
  // Web servers → API servers
  ["web-prod-01",      "api-prod-01",      4000, "node",      "node"],
  ["web-prod-02",      "api-prod-01",      4000, "node",      "node"],
  ["web-prod-02",      "api-prod-02",      4000, "node",      "node"],
  // API servers → database + cache
  ["api-prod-01",      "postgres-prod-01", 5432, "node",      "postgresql"],
  ["api-prod-01",      "redis-prod-01",    6379, "node",      "redis-server"],
  ["api-prod-02",      "postgres-prod-01", 5432, "node",      "postgresql"],
  ["api-prod-02",      "redis-prod-01",    6379, "node",      "redis-server"],
  // Worker → database + cache
  ["worker-prod-01",   "postgres-prod-01", 5432, "node",      "postgresql"],
  ["worker-prod-01",   "redis-prod-01",    6379, "node",      "redis-server"],
  // Monitoring → everything
  ["monitoring-01",    "lb-prod-01",       80,   "prometheus", "nginx"],
  ["monitoring-01",    "web-prod-01",      3000, "prometheus", "node"],
  ["monitoring-01",    "web-prod-02",      3000, "prometheus", "node"],
  ["monitoring-01",    "api-prod-01",      4000, "prometheus", "node"],
  ["monitoring-01",    "api-prod-02",      4000, "prometheus", "node"],
  ["monitoring-01",    "postgres-prod-01", 5432, "prometheus", "postgresql"],
  ["monitoring-01",    "redis-prod-01",    6379, "prometheus", "redis-server"],
  // Staging
  ["staging-web-01",   "staging-db-01",    5432, "node",      "postgresql"],
];

const ANNOTATIONS = [
  ["api-prod-01", "postgres-prod-01", "Primary DB",       "Main application database. Do not restart without DBA approval."],
  ["api-prod-01", "redis-prod-01",    "Session Cache",    "Used for session storage and rate limiting."],
  ["lb-prod-01",  "web-prod-01",      "Primary backend",  "Round-robin load balancing."],
  ["lb-prod-01",  "web-prod-02",      "Secondary backend","Round-robin load balancing."],
];

// Some sample packages per host pattern
const SAMPLE_PACKAGES = {
  ubuntu: [
    { name: "openssl", version: "3.0.2-0ubuntu1.14", manager: "apt", ecosystem: "deb" },
    { name: "curl", version: "7.81.0-1ubuntu1.16", manager: "apt", ecosystem: "deb" },
    { name: "nginx", version: "1.24.0-1", manager: "apt", ecosystem: "deb" },
    { name: "libc6", version: "2.35-0ubuntu3.6", manager: "apt", ecosystem: "deb" },
  ],
  debian: [
    { name: "openssl", version: "3.0.11-1~deb12u2", manager: "apt", ecosystem: "deb" },
    { name: "curl", version: "7.88.1-10+deb12u5", manager: "apt", ecosystem: "deb" },
    { name: "libc6", version: "2.36-9+deb12u4", manager: "apt", ecosystem: "deb" },
  ],
  alpine: [
    { name: "openssl", version: "3.1.4-r5", manager: "apk", ecosystem: "apk" },
    { name: "redis", version: "7.2.4-r0", manager: "apk", ecosystem: "apk" },
    { name: "musl", version: "1.2.4_git20230717-r4", manager: "apk", ecosystem: "apk" },
  ],
};

async function seed() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Create a dummy scan target for these hosts
    const stResult = await client.query(
      `INSERT INTO scan_targets (name, type, connection_config, scan_interval_hours, last_scan_status, last_scanned_at, enabled)
       VALUES ('Demo SSH Target', 'ssh_linux', '{}', 6, 'success', NOW(), true)
       ON CONFLICT DO NOTHING
       RETURNING id`
    );

    let scanTargetId;
    if (stResult.rows.length > 0) {
      scanTargetId = stResult.rows[0].id;
    } else {
      const existing = await client.query(`SELECT id FROM scan_targets WHERE name = 'Demo SSH Target' LIMIT 1`);
      scanTargetId = existing.rows[0].id;
    }

    console.log(`Scan target: ${scanTargetId}`);

    // 2. Insert hosts
    const hostIdMap = new Map();
    for (const h of HOSTS) {
      const res = await client.query(
        `INSERT INTO hosts (scan_target_id, hostname, ip_address, os, os_version, architecture, environment_tag, status, last_seen_at, first_seen_at, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', NOW(), NOW() - INTERVAL '30 days', '{}')
         ON CONFLICT (hostname, scan_target_id) DO UPDATE SET
           ip_address = EXCLUDED.ip_address,
           os = EXCLUDED.os,
           os_version = EXCLUDED.os_version,
           status = 'active',
           last_seen_at = NOW()
         RETURNING id`,
        [scanTargetId, h.hostname, h.ip, h.os, h.osVersion, h.arch, h.env]
      );
      hostIdMap.set(h.hostname, res.rows[0].id);
      console.log(`  Host: ${h.hostname} → ${res.rows[0].id}`);
    }

    // 3. Insert services
    for (const entry of SERVICES) {
      const hostId = hostIdMap.get(entry.hostname);
      if (!hostId) continue;

      for (const svc of entry.services) {
        const svcName = svc.port ? `${svc.name}` : svc.name;
        await client.query(
          `INSERT INTO services (host_id, service_name, service_type, version, port, status, last_seen_at)
           VALUES ($1, $2, $3, $4, $5, 'running', NOW())
           ON CONFLICT (host_id, service_name) DO UPDATE SET
             version = EXCLUDED.version,
             port = EXCLUDED.port,
             status = 'running',
             last_seen_at = NOW()`,
          [hostId, svcName, svc.type, svc.version, svc.port]
        );
      }
    }
    console.log("  Services inserted");

    // 4. Insert packages
    for (const h of HOSTS) {
      const hostId = hostIdMap.get(h.hostname);
      if (!hostId) continue;

      let pkgs;
      if (h.os.toLowerCase().includes("alpine")) {
        pkgs = SAMPLE_PACKAGES.alpine;
      } else if (h.os.toLowerCase().includes("debian")) {
        pkgs = SAMPLE_PACKAGES.debian;
      } else {
        pkgs = SAMPLE_PACKAGES.ubuntu;
      }

      for (const pkg of pkgs) {
        await client.query(
          `INSERT INTO discovered_packages (host_id, package_name, installed_version, package_manager, ecosystem, first_detected_at, last_detected_at)
           VALUES ($1, $2, $3, $4, $5, NOW() - INTERVAL '30 days', NOW())
           ON CONFLICT (host_id, package_name, package_manager) WHERE removed_at IS NULL
           DO UPDATE SET last_detected_at = NOW()`,
          [hostId, pkg.name, pkg.version, pkg.manager, pkg.ecosystem]
        );
      }
    }
    console.log("  Packages inserted");

    // 5. Insert connections
    for (const [srcHost, tgtHost, port, process, service] of CONNECTIONS) {
      const srcId = hostIdMap.get(srcHost);
      const tgtId = hostIdMap.get(tgtHost);
      const tgtIp = HOSTS.find((h) => h.hostname === tgtHost)?.ip;
      if (!srcId || !tgtIp) continue;

      await client.query(
        `INSERT INTO host_connections (source_host_id, target_host_id, target_ip, target_port, source_process, target_service, connection_type, first_seen_at, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'observed', NOW() - INTERVAL '7 days', NOW())
         ON CONFLICT (source_host_id, target_ip, target_port, source_process)
         DO UPDATE SET
           target_host_id = EXCLUDED.target_host_id,
           target_service = EXCLUDED.target_service,
           last_seen_at = NOW()`,
        [srcId, tgtId || null, tgtIp, port, process, service]
      );
    }
    console.log(`  ${CONNECTIONS.length} connections inserted`);

    // 6. Insert annotations
    for (const [srcHost, tgtHost, label, notes] of ANNOTATIONS) {
      const srcId = hostIdMap.get(srcHost);
      const tgtId = hostIdMap.get(tgtHost);
      if (!srcId || !tgtId) continue;

      await client.query(
        `INSERT INTO dependency_annotations (source_host_id, target_host_id, label, notes, created_by)
         VALUES ($1, $2, $3, $4, 'seed-script')
         ON CONFLICT (source_host_id, target_host_id)
         DO UPDATE SET label = EXCLUDED.label, notes = EXCLUDED.notes`,
        [srcId, tgtId, label, notes]
      );
    }
    console.log(`  ${ANNOTATIONS.length} annotations inserted`);

    // 7. Insert a few alerts for realism
    const alertPkgs = [
      { host: "web-prod-01", pkg: "openssl", curr: "3.0.2-0ubuntu1.14", avail: "3.0.2-0ubuntu1.15", severity: "high" },
      { host: "web-prod-02", pkg: "openssl", curr: "3.0.2-0ubuntu1.14", avail: "3.0.2-0ubuntu1.15", severity: "high" },
      { host: "api-prod-01", pkg: "curl", curr: "7.88.1-10+deb12u5", avail: "7.88.1-10+deb12u7", severity: "critical" },
      { host: "postgres-prod-01", pkg: "openssl", curr: "3.0.2-0ubuntu1.14", avail: "3.0.2-0ubuntu1.15", severity: "medium" },
    ];

    for (const a of alertPkgs) {
      const hostId = hostIdMap.get(a.host);
      if (!hostId) continue;
      await client.query(
        `INSERT INTO alerts (host_id, package_name, current_version, available_version, severity, acknowledged, created_at)
         VALUES ($1, $2, $3, $4, $5, false, NOW() - INTERVAL '2 days')
         ON CONFLICT DO NOTHING`,
        [hostId, a.pkg, a.curr, a.avail, a.severity]
      );
    }
    console.log("  Alerts inserted");

    await client.query("COMMIT");
    console.log("\nSeed complete! You can now view the dependency map at /dependencies");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seed failed:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
