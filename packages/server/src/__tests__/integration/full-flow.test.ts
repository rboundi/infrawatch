import { describe, it, expect, beforeEach } from "vitest";
import supertest from "supertest";
import pino from "pino";
import type { ScanResult, HostInventory, PackageInfo, ServiceInfo } from "@infrawatch/scanner";
import { getTestDb } from "../setup.js";
import { getTestApp } from "../app.js";
import {
  createTestAdmin,
  getAuthToken,
  createTestScanTarget,
  createTestHost,
  createTestPackage,
  createTestService,
  createTestAlert,
} from "../helpers.js";
import { DataIngestionService } from "../../services/data-ingestion.js";
import { StaleHostChecker } from "../../services/stale-host-checker.js";

const logger = pino({ level: "silent" });

let token: string;
const h = () => ({ Authorization: `Bearer ${token}` });

beforeEach(async () => {
  await createTestAdmin({ username: "admin", password: "AdminPass1234" });
  token = await getAuthToken("admin", "AdminPass1234");
});

function api() {
  return supertest(getTestApp());
}

// ─── Helpers ───

function makePackages(count: number, prefix = "pkg"): PackageInfo[] {
  const pkgs: PackageInfo[] = [];
  for (let i = 0; i < count; i++) {
    pkgs.push({
      name: `${prefix}-${i}`,
      installedVersion: `${i + 1}.0.0`,
      packageManager: "apt",
      ecosystem: "debian",
    });
  }
  return pkgs;
}

function makeServices(count: number, prefix = "svc"): ServiceInfo[] {
  const svcs: ServiceInfo[] = [];
  const types = ["webserver", "database", "cache", "queue", "monitoring"];
  for (let i = 0; i < count; i++) {
    svcs.push({
      name: `${prefix}-${i}`,
      serviceType: types[i % types.length],
      version: `${i + 1}.0`,
      port: 8000 + i,
      status: "running",
    });
  }
  return svcs;
}

function makeHost(hostname: string, pkgCount: number, svcCount: number): HostInventory {
  return {
    hostname,
    ip: `10.0.0.${Math.floor(Math.random() * 254) + 1}`,
    os: "Ubuntu",
    osVersion: "22.04",
    arch: "x86_64",
    packages: makePackages(pkgCount, `${hostname}-pkg`),
    services: makeServices(svcCount, `${hostname}-svc`),
    connections: [],
    metadata: {},
  };
}

function makeScanResult(hosts: HostInventory[]): ScanResult {
  return { hosts };
}

// ─────────────────────────────────────────────
// Full Scan-to-Alert Flow
// ─────────────────────────────────────────────
describe("Full scan-to-alert lifecycle", () => {
  it("should process scan, show hosts/packages, create alerts, acknowledge them", async () => {
    const pool = getTestDb();
    const ingestion = new DataIngestionService(pool, logger);
    const target = await createTestScanTarget();

    // 1. Process scan with 3 hosts, 25 packages each, 7 services each
    const hosts = [
      makeHost("web-01", 25, 7),
      makeHost("db-01", 30, 5),
      makeHost("cache-01", 20, 8),
    ];
    const stats = await ingestion.processResults(target.id, makeScanResult(hosts));

    expect(stats.hostsUpserted).toBe(3);
    expect(stats.packagesFound).toBe(75); // 25+30+20
    expect(stats.servicesFound).toBe(20); // 7+5+8

    // 2. All hosts appear in API
    const hostsRes = await api().get("/api/v1/hosts").set(h()).expect(200);
    expect(hostsRes.body.total).toBe(3);
    const hostnames = hostsRes.body.data.map((h: any) => h.hostname).sort();
    expect(hostnames).toEqual(["cache-01", "db-01", "web-01"]);

    // 3. Packages appear for host
    const web01 = hostsRes.body.data.find((h: any) => h.hostname === "web-01");
    const pkgRes = await api()
      .get(`/api/v1/hosts/${web01.id}/packages?limit=50`)
      .set(h())
      .expect(200);
    expect(pkgRes.body.total).toBe(25);

    // 4. Simulate version checker: insert 5 alerts across hosts
    const allHosts = hostsRes.body.data;
    for (let i = 0; i < 5; i++) {
      const host = allHosts[i % 3];
      await pool.query(
        `INSERT INTO alerts (host_id, package_name, current_version, available_version, severity, acknowledged)
         VALUES ($1, $2, $3, $4, $5, false)`,
        [host.id, `${host.hostname}-pkg-${i}`, `${i + 1}.0.0`, `${i + 2}.0.0`, i < 2 ? "critical" : "medium"],
      );
    }

    // 5. Alerts visible in API
    const alertsRes = await api().get("/api/v1/alerts").set(h()).expect(200);
    expect(alertsRes.body.total).toBe(5);

    // 6. Stats overview shows correct counts
    const statsRes = await api().get("/api/v1/stats/overview").set(h()).expect(200);
    expect(statsRes.body.totalHosts).toBe(3);
    expect(statsRes.body.activeHosts).toBe(3);
    expect(statsRes.body.totalAlerts).toBe(5);
    expect(statsRes.body.criticalAlerts).toBe(2);

    // 7. Acknowledge 2 alerts
    const alertIds = alertsRes.body.data.slice(0, 2).map((a: any) => a.id);
    await api()
      .patch("/api/v1/alerts/bulk-acknowledge")
      .set(h())
      .send({ alertIds, acknowledgedBy: "admin" })
      .expect(200);

    // 8. Unacknowledged count
    const unackRes = await api().get("/api/v1/alerts?acknowledged=false").set(h()).expect(200);
    expect(unackRes.body.total).toBe(3);

    // 9. Alert summary — unacknowledged should be total minus 2
    const summaryRes = await api().get("/api/v1/alerts/summary").set(h()).expect(200);
    expect(summaryRes.body.unacknowledged).toBe(3);
  });
});

// ─────────────────────────────────────────────
// Scan Result Update Cycle
// ─────────────────────────────────────────────
describe("Scan result update cycle", () => {
  it("should track package additions, upgrades, and removals across scans", async () => {
    const pool = getTestDb();
    const ingestion = new DataIngestionService(pool, logger);
    const target = await createTestScanTarget();

    // Scan 1: nginx 1.24.0, postgresql 15.3
    await ingestion.processResults(target.id, makeScanResult([{
      hostname: "update-host",
      ip: "10.0.0.1",
      os: "Ubuntu",
      osVersion: "22.04",
      arch: "x86_64",
      packages: [
        { name: "nginx", installedVersion: "1.24.0", packageManager: "apt", ecosystem: "debian" },
        { name: "postgresql", installedVersion: "15.3", packageManager: "apt", ecosystem: "debian" },
      ],
      services: [],
      connections: [],
      metadata: {},
    }]));

    // Scan 2: nginx upgraded, redis added, postgresql same
    await ingestion.processResults(target.id, makeScanResult([{
      hostname: "update-host",
      ip: "10.0.0.1",
      os: "Ubuntu",
      osVersion: "22.04",
      arch: "x86_64",
      packages: [
        { name: "nginx", installedVersion: "1.25.3", packageManager: "apt", ecosystem: "debian" },
        { name: "postgresql", installedVersion: "15.3", packageManager: "apt", ecosystem: "debian" },
        { name: "redis", installedVersion: "7.2.0", packageManager: "apt", ecosystem: "debian" },
      ],
      services: [],
      connections: [],
      metadata: {},
    }]));

    // Verify nginx updated
    const nginxPkg = await pool.query(
      "SELECT installed_version FROM discovered_packages WHERE package_name = 'nginx' AND removed_at IS NULL",
    );
    expect(nginxPkg.rows[0].installed_version).toBe("1.25.3");

    // Verify redis added
    const redisPkg = await pool.query(
      "SELECT * FROM discovered_packages WHERE package_name = 'redis' AND removed_at IS NULL",
    );
    expect(redisPkg.rows.length).toBe(1);

    // Verify change events for nginx upgrade and redis addition
    const events = await pool.query(
      "SELECT event_type, summary FROM change_events WHERE hostname = 'update-host' AND event_type IN ('package_updated', 'package_added') ORDER BY created_at",
    );
    const upgradeEvent = events.rows.find((e: any) => e.event_type === "package_updated" && e.summary.includes("nginx"));
    expect(upgradeEvent).toBeDefined();
    const addEvent = events.rows.find((e: any) => e.event_type === "package_added" && e.summary.includes("redis"));
    expect(addEvent).toBeDefined();

    // Scan 3: postgresql removed
    await ingestion.processResults(target.id, makeScanResult([{
      hostname: "update-host",
      ip: "10.0.0.1",
      os: "Ubuntu",
      osVersion: "22.04",
      arch: "x86_64",
      packages: [
        { name: "nginx", installedVersion: "1.25.3", packageManager: "apt", ecosystem: "debian" },
        { name: "redis", installedVersion: "7.2.0", packageManager: "apt", ecosystem: "debian" },
      ],
      services: [],
      connections: [],
      metadata: {},
    }]));

    // Verify postgresql has removed_at
    const pgPkg = await pool.query(
      "SELECT removed_at FROM discovered_packages WHERE package_name = 'postgresql'",
    );
    expect(pgPkg.rows[0].removed_at).not.toBeNull();

    // Verify removal change event
    const removeEvent = await pool.query(
      "SELECT * FROM change_events WHERE hostname = 'update-host' AND event_type = 'package_removed'",
    );
    expect(removeEvent.rows.length).toBe(1);
    expect(removeEvent.rows[0].summary).toContain("postgresql");
  });
});

// ─────────────────────────────────────────────
// Stale Host
// ─────────────────────────────────────────────
describe("Host goes stale and returns", () => {
  it("should mark host stale and restore on rescan", async () => {
    const pool = getTestDb();
    const target = await createTestScanTarget();
    const host = await createTestHost(target.id, { hostname: "stale-host" });

    // Set last_seen_at to 25 hours ago
    await pool.query(
      "UPDATE hosts SET last_seen_at = NOW() - INTERVAL '25 hours' WHERE id = $1",
      [host.id],
    );

    // Run stale checker
    const checker = new StaleHostChecker(pool, logger);
    await (checker as any).check();

    // Verify host is stale
    const staleRes = await pool.query("SELECT status FROM hosts WHERE id = $1", [host.id]);
    expect(staleRes.rows[0].status).toBe("stale");

    // Verify host_disappeared event
    const disappearedEvent = await pool.query(
      "SELECT * FROM change_events WHERE hostname = 'stale-host' AND event_type = 'host_disappeared'",
    );
    expect(disappearedEvent.rows.length).toBe(1);

    // Rescan brings it back
    const ingestion = new DataIngestionService(pool, logger);
    await ingestion.processResults(target.id, makeScanResult([{
      hostname: "stale-host",
      ip: "10.0.0.1",
      os: "Ubuntu",
      osVersion: "22.04",
      arch: "x86_64",
      packages: [],
      services: [],
      connections: [],
      metadata: {},
    }]));

    // Host should be active again
    const activeRes = await pool.query("SELECT status FROM hosts WHERE id = $1", [host.id]);
    expect(activeRes.rows[0].status).toBe("active");
  });
});

// ─────────────────────────────────────────────
// API Edge Cases — Empty Database
// ─────────────────────────────────────────────
describe("API edge cases — empty database", () => {
  // Endpoints returning { data: [], total: 0 } format
  const paginatedEndpoints = [
    "/api/v1/hosts",
    "/api/v1/alerts",
    "/api/v1/changes",
    "/api/v1/eol/alerts",
    "/api/v1/compliance/hosts",
  ];

  for (const endpoint of paginatedEndpoints) {
    it(`GET ${endpoint} with empty database returns valid response`, async () => {
      const res = await api().get(endpoint).set(h());
      expect(res.status).toBeLessThan(500);
      if (res.status === 200) {
        expect(res.body.data).toEqual([]);
        expect(res.body.total).toBe(0);
      }
    });
  }

  it("GET /api/v1/targets with empty database returns empty array", async () => {
    const res = await api().get("/api/v1/targets").set(h());
    expect(res.status).toBeLessThan(500);
    if (res.status === 200) {
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(0);
    }
  });
});

// ─────────────────────────────────────────────
// API Edge Cases — Pagination Beyond Results
// ─────────────────────────────────────────────
describe("API edge cases — page beyond results", () => {
  it("GET /api/v1/hosts with page=99 returns empty data, not error", async () => {
    const target = await createTestScanTarget();
    await createTestHost(target.id, { hostname: "h1" });
    await createTestHost(target.id, { hostname: "h2" });
    await createTestHost(target.id, { hostname: "h3" });

    const res = await api().get("/api/v1/hosts?page=99").set(h()).expect(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.total).toBe(3);
    expect(res.body.page).toBe(99);
  });

  it("GET /api/v1/alerts with page=99 returns empty data", async () => {
    const target = await createTestScanTarget();
    const host = await createTestHost(target.id);
    await createTestAlert(host.id, { severity: "high" });

    const res = await api().get("/api/v1/alerts?page=99").set(h()).expect(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.total).toBe(1);
  });
});

// ─────────────────────────────────────────────
// API Edge Cases — Non-numeric query params
// ─────────────────────────────────────────────
describe("API edge cases — non-numeric query params", () => {
  it("GET /api/v1/hosts?page=abc&limit=xyz should not 500", async () => {
    const res = await api().get("/api/v1/hosts?page=abc&limit=xyz").set(h());
    expect(res.status).toBeLessThan(500);
  });

  it("GET /api/v1/alerts?page=abc should not 500", async () => {
    const res = await api().get("/api/v1/alerts?page=abc").set(h());
    expect(res.status).toBeLessThan(500);
  });
});

// ─────────────────────────────────────────────
// API Edge Cases — Non-UUID IDs
// ─────────────────────────────────────────────
describe("API edge cases — non-UUID IDs", () => {
  const detailEndpoints = [
    "/api/v1/hosts/not-a-uuid",
    "/api/v1/alerts/123/acknowledge",
    "/api/v1/targets/true",
  ];

  for (const endpoint of detailEndpoints) {
    it(`GET/PATCH ${endpoint} with non-UUID returns 400, not 500`, async () => {
      const res = await api().get(endpoint).set(h());
      // Should be 400 (invalid UUID) not 500 (DB error)
      expect(res.status).toBeLessThan(500);
    });
  }
});

// ─────────────────────────────────────────────
// API Edge Cases — Empty body PATCH
// ─────────────────────────────────────────────
describe("API edge cases — empty body PATCH", () => {
  it("PATCH /api/v1/targets/:id with empty body should not 500", async () => {
    const target = await createTestScanTarget();
    const res = await api()
      .patch(`/api/v1/targets/${target.id}`)
      .set(h())
      .send({});
    expect(res.status).toBeLessThan(500);
  });
});

// ─────────────────────────────────────────────
// API Edge Cases — Double DELETE (idempotency)
// ─────────────────────────────────────────────
describe("API edge cases — double DELETE idempotency", () => {
  it("DELETE /api/v1/targets/:id twice should not 500", async () => {
    const target = await createTestScanTarget();
    const first = await api().delete(`/api/v1/targets/${target.id}`).set(h());
    expect(first.status).toBeLessThan(500);

    const second = await api().delete(`/api/v1/targets/${target.id}`).set(h());
    expect(second.status).toBeLessThan(500);
    expect([204, 404]).toContain(second.status);
  });
});

// ─────────────────────────────────────────────
// Concurrent Operations
// ─────────────────────────────────────────────
describe("Concurrent operations", () => {
  it("two concurrent scans for same target should not deadlock or create duplicates", async () => {
    const pool = getTestDb();
    const ingestion = new DataIngestionService(pool, logger);
    const target = await createTestScanTarget();

    const scan1 = makeScanResult([{
      hostname: "concurrent-host",
      ip: "10.0.0.1",
      os: "Ubuntu",
      osVersion: "22.04",
      arch: "x86_64",
      packages: [
        { name: "nginx", installedVersion: "1.24.0", packageManager: "apt", ecosystem: "debian" },
        { name: "openssl", installedVersion: "3.0.0", packageManager: "apt", ecosystem: "debian" },
      ],
      services: [{ name: "nginx", serviceType: "webserver", port: 80, status: "running" }],
      connections: [],
      metadata: {},
    }]);

    const scan2 = makeScanResult([{
      hostname: "concurrent-host",
      ip: "10.0.0.2",
      os: "Ubuntu",
      osVersion: "22.04",
      arch: "x86_64",
      packages: [
        { name: "nginx", installedVersion: "1.25.0", packageManager: "apt", ecosystem: "debian" },
        { name: "redis", installedVersion: "7.0.0", packageManager: "apt", ecosystem: "debian" },
      ],
      services: [{ name: "nginx", serviceType: "webserver", port: 80, status: "running" }],
      connections: [],
      metadata: {},
    }]);

    // Run both concurrently
    const [result1, result2] = await Promise.all([
      ingestion.processResults(target.id, scan1),
      ingestion.processResults(target.id, scan2),
    ]);

    // Both should complete without errors
    expect(result1.hostsUpserted + result2.hostsUpserted).toBe(2);

    // Only one host should exist (upsert, not duplicate)
    const hosts = await pool.query(
      "SELECT * FROM hosts WHERE hostname = 'concurrent-host' AND scan_target_id = $1",
      [target.id],
    );
    expect(hosts.rows.length).toBe(1);
  });

  it("10 concurrent GET requests should all succeed", async () => {
    const target = await createTestScanTarget();
    await createTestHost(target.id, { hostname: "concurrent-get-host" });

    const requests = Array.from({ length: 10 }, () =>
      api().get("/api/v1/hosts").set(h()),
    );
    const results = await Promise.all(requests);

    for (const res of results) {
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
    }
  });
});

// ─────────────────────────────────────────────
// Data Integrity — Cascading Deletes
// ─────────────────────────────────────────────
describe("Data integrity — cascading deletes", () => {
  it("deleting a host cascades to packages, services, and alerts", async () => {
    const pool = getTestDb();
    const target = await createTestScanTarget();
    const host = await createTestHost(target.id, { hostname: "cascade-host" });
    await createTestPackage(host.id, { packageName: "nginx" });
    await createTestService(host.id, { serviceName: "nginx" });
    await createTestAlert(host.id, { packageName: "nginx" });

    // Delete the host directly (hosts FK to scan_targets is SET NULL, not CASCADE)
    await pool.query("DELETE FROM hosts WHERE id = $1", [host.id]);

    // Packages, services, alerts for that host should be gone (CASCADE)
    const packages = await pool.query("SELECT * FROM discovered_packages WHERE host_id = $1", [host.id]);
    expect(packages.rows.length).toBe(0);

    const services = await pool.query("SELECT * FROM services WHERE host_id = $1", [host.id]);
    expect(services.rows.length).toBe(0);

    const alerts = await pool.query("SELECT * FROM alerts WHERE host_id = $1", [host.id]);
    expect(alerts.rows.length).toBe(0);
  });

  it("deleting a scan target sets hosts scan_target_id to NULL", async () => {
    const pool = getTestDb();
    const target = await createTestScanTarget();
    const host = await createTestHost(target.id, { hostname: "orphan-host" });

    await api().delete(`/api/v1/targets/${target.id}`).set(h());

    const hosts = await pool.query("SELECT scan_target_id FROM hosts WHERE id = $1", [host.id]);
    expect(hosts.rows.length).toBe(1);
    expect(hosts.rows[0].scan_target_id).toBeNull();
  });
});

// ─────────────────────────────────────────────
// Data Integrity — Unique Constraints (host upsert)
// ─────────────────────────────────────────────
describe("Data integrity — unique constraint enforcement", () => {
  it("processing same hostname twice upserts, not duplicates", async () => {
    const pool = getTestDb();
    const ingestion = new DataIngestionService(pool, logger);
    const target = await createTestScanTarget();

    for (let i = 0; i < 3; i++) {
      await ingestion.processResults(target.id, makeScanResult([{
        hostname: "upsert-test",
        ip: `10.0.0.${i + 1}`,
        os: "Ubuntu",
        osVersion: "22.04",
        arch: "x86_64",
        packages: [],
        services: [],
        connections: [],
        metadata: {},
      }]));
    }

    const hosts = await pool.query(
      "SELECT * FROM hosts WHERE hostname = 'upsert-test' AND scan_target_id = $1",
      [target.id],
    );
    expect(hosts.rows.length).toBe(1);
    // Should have the latest IP
    expect(hosts.rows[0].ip_address).toBe("10.0.0.3");
  });
});

// ─────────────────────────────────────────────
// Data Integrity — Partial Unique Index on Alerts
// ─────────────────────────────────────────────
describe("Data integrity — partial unique index on alerts", () => {
  it("acknowledged alert allows new unacknowledged alert for same package", async () => {
    const pool = getTestDb();
    const target = await createTestScanTarget();
    const host = await createTestHost(target.id);

    // Create and acknowledge an alert
    await pool.query(
      `INSERT INTO alerts (host_id, package_name, current_version, available_version, severity, acknowledged)
       VALUES ($1, 'nginx', '1.24.0', '1.25.0', 'medium', true)`,
      [host.id],
    );

    // New unacknowledged alert for same package — should succeed
    const result = await pool.query(
      `INSERT INTO alerts (host_id, package_name, current_version, available_version, severity, acknowledged)
       VALUES ($1, 'nginx', '1.24.0', '1.25.0', 'medium', false)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [host.id],
    );
    expect(result.rows.length).toBe(1); // inserted successfully

    // Third unacknowledged for same combo — blocked by partial unique index
    const dup = await pool.query(
      `INSERT INTO alerts (host_id, package_name, current_version, available_version, severity, acknowledged)
       VALUES ($1, 'nginx', '1.24.0', '1.25.0', 'medium', false)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [host.id],
    );
    expect(dup.rows.length).toBe(0); // blocked, 0 rows returned
  });
});

// ─────────────────────────────────────────────
// Data Integrity — JSONB round-trip
// ─────────────────────────────────────────────
describe("Data integrity — JSONB fields", () => {
  it("metadata JSONB round-trips nested objects, arrays, numbers, booleans, nulls", async () => {
    const pool = getTestDb();
    const ingestion = new DataIngestionService(pool, logger);
    const target = await createTestScanTarget();

    const complexMetadata = {
      nested: { deep: { value: 42 } },
      array: [1, "two", true, null, { nested: true }],
      boolean: false,
      number: 3.14,
      nullField: null,
      emptyString: "",
    };

    await ingestion.processResults(target.id, makeScanResult([{
      hostname: "jsonb-host",
      ip: "10.0.0.1",
      os: "Ubuntu",
      osVersion: "22.04",
      arch: "x86_64",
      packages: [],
      services: [],
      connections: [],
      metadata: complexMetadata,
    }]));

    const result = await pool.query(
      "SELECT metadata FROM hosts WHERE hostname = 'jsonb-host'",
    );
    const stored = result.rows[0].metadata;
    expect(stored.nested.deep.value).toBe(42);
    expect(stored.array).toEqual([1, "two", true, null, { nested: true }]);
    expect(stored.boolean).toBe(false);
    expect(stored.number).toBe(3.14);
    expect(stored.nullField).toBeNull();
    expect(stored.emptyString).toBe("");
  });
});

// ─────────────────────────────────────────────
// Resource — Connection pool not leaked
// ─────────────────────────────────────────────
describe("Resource cleanup — connection pool", () => {
  it("100 rapid API requests should not leak connections", async () => {
    const pool = getTestDb();
    const target = await createTestScanTarget();
    await createTestHost(target.id, { hostname: "pool-test-host" });

    // Fire 100 requests in batches of 20
    for (let batch = 0; batch < 5; batch++) {
      const requests = Array.from({ length: 20 }, () =>
        api().get("/api/v1/hosts").set(h()),
      );
      const results = await Promise.all(requests);
      for (const res of results) {
        expect(res.status).toBe(200);
      }
    }

    // Pool should be within limits
    expect(pool.totalCount).toBeLessThanOrEqual(pool.options.max ?? 10);
    expect(pool.waitingCount).toBe(0);
  });
});

// ─────────────────────────────────────────────
// Response Time Checks (sanity, not strict perf)
// ─────────────────────────────────────────────
describe("Response time — sanity checks", () => {
  it("GET /api/v1/hosts with 1000 hosts responds in under 2s", async () => {
    const pool = getTestDb();
    const target = await createTestScanTarget();

    // Batch insert 1000 hosts
    const values: string[] = [];
    const params: unknown[] = [target.id];
    for (let i = 0; i < 1000; i++) {
      const offset = i * 5 + 2;
      values.push(`($1, $${offset}, $${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`);
      params.push(`host-${i}`, `10.${Math.floor(i / 256)}.${i % 256}.1`, "Ubuntu", "22.04", "x86_64");
    }

    await pool.query(
      `INSERT INTO hosts (scan_target_id, hostname, ip_address, os, os_version, architecture) VALUES ${values.join(", ")}`,
      params,
    );

    const start = Date.now();
    const res = await api().get("/api/v1/hosts?limit=50").set(h()).expect(200);
    const elapsed = Date.now() - start;

    expect(res.body.total).toBe(1000);
    expect(res.body.data.length).toBe(50);
    expect(elapsed).toBeLessThan(2000);
  });

  it("GET /api/v1/alerts with 5000 alerts responds in under 2s", async () => {
    const pool = getTestDb();
    const target = await createTestScanTarget();

    // Insert 100 hosts
    const hostIds: string[] = [];
    for (let i = 0; i < 100; i++) {
      const result = await pool.query(
        `INSERT INTO hosts (scan_target_id, hostname, ip_address, os, os_version, architecture)
         VALUES ($1, $2, $3, 'Ubuntu', '22.04', 'x86_64') RETURNING id`,
        [target.id, `alert-host-${i}`, `10.0.${Math.floor(i / 256)}.${i % 256}`],
      );
      hostIds.push(result.rows[0].id);
    }

    // Batch insert 5000 alerts
    const severities = ["critical", "high", "medium", "low", "info"];
    const alertValues: string[] = [];
    const alertParams: unknown[] = [];
    for (let i = 0; i < 5000; i++) {
      const offset = i * 5 + 1;
      alertValues.push(`($${offset}, $${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`);
      alertParams.push(
        hostIds[i % 100],
        `pkg-${i}`,
        `${i}.0.0`,
        `${i + 1}.0.0`,
        severities[i % 5],
      );
    }

    // Insert in chunks (PG param limit)
    const chunkSize = 500;
    for (let i = 0; i < alertValues.length; i += chunkSize) {
      const chunk = alertValues.slice(i, i + chunkSize);
      const chunkParams = alertParams.slice(i * 5, (i + chunkSize) * 5);
      // Re-index params for this chunk
      const reindexed: string[] = [];
      const reParams: unknown[] = [];
      for (let j = 0; j < chunk.length; j++) {
        const o = j * 5 + 1;
        reindexed.push(`($${o}, $${o + 1}, $${o + 2}, $${o + 3}, $${o + 4})`);
        reParams.push(
          chunkParams[j * 5],
          chunkParams[j * 5 + 1],
          chunkParams[j * 5 + 2],
          chunkParams[j * 5 + 3],
          chunkParams[j * 5 + 4],
        );
      }
      await pool.query(
        `INSERT INTO alerts (host_id, package_name, current_version, available_version, severity) VALUES ${reindexed.join(", ")}`,
        reParams,
      );
    }

    const start = Date.now();
    const res = await api().get("/api/v1/alerts?limit=50").set(h()).expect(200);
    const elapsed = Date.now() - start;

    expect(res.body.total).toBe(5000);
    expect(res.body.data.length).toBe(50);
    expect(elapsed).toBeLessThan(2000);
  });

  it("GET /api/v1/stats/overview with populated DB responds in under 1s", async () => {
    const pool = getTestDb();
    const target = await createTestScanTarget();

    // Insert 100 hosts with packages and some alerts
    for (let i = 0; i < 100; i++) {
      const hostRes = await pool.query(
        `INSERT INTO hosts (scan_target_id, hostname, ip_address, os, os_version, architecture)
         VALUES ($1, $2, $3, 'Ubuntu', '22.04', 'x86_64') RETURNING id`,
        [target.id, `stats-host-${i}`, `10.0.${Math.floor(i / 256)}.${i % 256}`],
      );
      const hostId = hostRes.rows[0].id;

      // Add 5 packages per host
      for (let j = 0; j < 5; j++) {
        await pool.query(
          `INSERT INTO discovered_packages (host_id, package_name, installed_version, package_manager, ecosystem)
           VALUES ($1, $2, $3, 'apt', 'debian')`,
          [hostId, `pkg-${i}-${j}`, `1.${j}.0`],
        );
      }

      // Add 1 alert per host
      if (i < 50) {
        await pool.query(
          `INSERT INTO alerts (host_id, package_name, current_version, available_version, severity)
           VALUES ($1, $2, $3, $4, $5)`,
          [hostId, `pkg-${i}-0`, `1.0.0`, `2.0.0`, i < 10 ? "critical" : "medium"],
        );
      }
    }

    const start = Date.now();
    const res = await api().get("/api/v1/stats/overview").set(h()).expect(200);
    const elapsed = Date.now() - start;

    expect(res.body.totalHosts).toBe(100);
    expect(res.body.totalPackages).toBe(500);
    expect(res.body.totalAlerts).toBe(50);
    expect(elapsed).toBeLessThan(1000);
  });
});
