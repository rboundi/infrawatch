import { describe, it, expect, beforeEach } from "vitest";
import supertest from "supertest";
import pino from "pino";
import type { ScanResult } from "@infrawatch/scanner";
import { getTestDb } from "./setup.js";
import { getTestApp } from "./app.js";
import {
  createTestAdmin,
  getAuthToken,
  createTestScanTarget,
  createTestHost,
  createTestPackage,
  createTestService,
} from "./helpers.js";
import { DataIngestionService } from "../services/data-ingestion.js";

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

function makeScanResult(hosts: ScanResult["hosts"]): ScanResult {
  return { hosts };
}

function makeHost(overrides: Partial<ScanResult["hosts"][0]> = {}): ScanResult["hosts"][0] {
  return {
    hostname: overrides.hostname ?? "web-01",
    ip: overrides.ip ?? "10.0.0.1",
    os: overrides.os ?? "Ubuntu",
    osVersion: overrides.osVersion ?? "22.04",
    arch: overrides.arch ?? "x86_64",
    packages: overrides.packages ?? [],
    services: overrides.services ?? [],
    connections: overrides.connections ?? [],
    metadata: overrides.metadata ?? {},
  };
}

// ─────────────────────────────────────────────
// Change event emission via data ingestion
// ─────────────────────────────────────────────
describe("Change detection via DataIngestionService", () => {
  it("should emit host_discovered event on new host", async () => {
    const pool = getTestDb();
    const ingestion = new DataIngestionService(pool, logger);
    const target = await createTestScanTarget();

    await ingestion.processResults(target.id, makeScanResult([
      makeHost({ hostname: "new-host" }),
    ]));

    const events = await pool.query(
      "SELECT * FROM change_events WHERE hostname = 'new-host' AND event_type = 'host_discovered'",
    );
    expect(events.rows.length).toBe(1);
    expect(events.rows[0].category).toBe("host");
  });

  it("should emit package_updated event on version change", async () => {
    const pool = getTestDb();
    const ingestion = new DataIngestionService(pool, logger);
    const target = await createTestScanTarget();

    // First scan: nginx 1.24.0
    await ingestion.processResults(target.id, makeScanResult([
      makeHost({
        hostname: "pkg-update-host",
        packages: [{ name: "nginx", installedVersion: "1.24.0", packageManager: "apt", ecosystem: "debian" }],
      }),
    ]));

    // Second scan: nginx 1.25.3
    await ingestion.processResults(target.id, makeScanResult([
      makeHost({
        hostname: "pkg-update-host",
        packages: [{ name: "nginx", installedVersion: "1.25.3", packageManager: "apt", ecosystem: "debian" }],
      }),
    ]));

    const events = await pool.query(
      "SELECT * FROM change_events WHERE hostname = 'pkg-update-host' AND event_type = 'package_updated'",
    );
    expect(events.rows.length).toBe(1);
    const details = typeof events.rows[0].details === "string"
      ? JSON.parse(events.rows[0].details)
      : events.rows[0].details;
    expect(details.oldVersion).toBe("1.24.0");
    expect(details.newVersion).toBe("1.25.3");
  });

  it("should emit service_removed event when service disappears", async () => {
    const pool = getTestDb();
    const ingestion = new DataIngestionService(pool, logger);
    const target = await createTestScanTarget();

    // First scan: nginx running
    await ingestion.processResults(target.id, makeScanResult([
      makeHost({
        hostname: "svc-rm-host",
        services: [{ name: "nginx", serviceType: "webserver", version: "1.24.0", port: 80, status: "running" }],
      }),
    ]));

    // Second scan: no services
    await ingestion.processResults(target.id, makeScanResult([
      makeHost({ hostname: "svc-rm-host", services: [] }),
    ]));

    const events = await pool.query(
      "SELECT * FROM change_events WHERE hostname = 'svc-rm-host' AND event_type = 'service_removed'",
    );
    expect(events.rows.length).toBe(1);
  });

  it("should emit multiple events in one scan", async () => {
    const pool = getTestDb();
    const ingestion = new DataIngestionService(pool, logger);
    const target = await createTestScanTarget();

    // First scan: packages A, B and service nginx
    await ingestion.processResults(target.id, makeScanResult([
      makeHost({
        hostname: "multi-event-host",
        packages: [
          { name: "A", installedVersion: "1.0", packageManager: "apt", ecosystem: "debian" },
          { name: "B", installedVersion: "1.0", packageManager: "apt", ecosystem: "debian" },
        ],
        services: [{ name: "nginx", serviceType: "webserver", port: 80, status: "running" }],
      }),
    ]));

    // Second scan: A upgraded, B removed, C added, service removed
    await ingestion.processResults(target.id, makeScanResult([
      makeHost({
        hostname: "multi-event-host",
        packages: [
          { name: "A", installedVersion: "2.0", packageManager: "apt", ecosystem: "debian" },
          { name: "C", installedVersion: "1.0", packageManager: "apt", ecosystem: "debian" },
        ],
        services: [],
      }),
    ]));

    const events = await pool.query(
      "SELECT * FROM change_events WHERE hostname = 'multi-event-host'",
    );
    // First scan: host_discovered + package_added(A) + package_added(B) + service_added(nginx) = 4
    // Second scan: package_updated(A) + package_removed(B) + package_added(C) + service_removed(nginx) = 4
    // Total = 8
    expect(events.rows.length).toBe(8);

    const types = events.rows.map((r: any) => r.event_type).sort();
    expect(types).toContain("host_discovered");
    expect(types).toContain("package_updated");
    expect(types).toContain("package_removed");
    expect(types).toContain("package_added");
    expect(types).toContain("service_added");
    expect(types).toContain("service_removed");
  });
});

// ─────────────────────────────────────────────
// Change events API
// ─────────────────────────────────────────────
describe("GET /api/v1/changes (list)", () => {
  it("should filter by eventType", async () => {
    const pool = getTestDb();
    const target = await createTestScanTarget();
    const host = await createTestHost(target.id, { hostname: "filter-host" });

    // Insert events directly (category must match check constraint: host, package, service, config)
    const testEvents = [
      { type: "host_discovered", category: "host" },
      { type: "package_added", category: "package" },
      { type: "package_added", category: "package" },
      { type: "service_added", category: "service" },
    ];
    for (const { type, category } of testEvents) {
      await pool.query(
        "INSERT INTO change_events (host_id, hostname, event_type, category, summary, details) VALUES ($1, $2, $3, $4, $5, $6)",
        [host.id, "filter-host", type, category, `${type} event`, JSON.stringify({})],
      );
    }

    const res = await api()
      .get("/api/v1/changes?eventType=package_added")
      .set(h())
      .expect(200);

    expect(res.body.total).toBe(2);
    for (const event of res.body.data) {
      expect(event.eventType).toBe("package_added");
    }
  });

  it("should filter by hostId", async () => {
    const pool = getTestDb();
    const target = await createTestScanTarget();
    const host1 = await createTestHost(target.id, { hostname: "host-a" });
    const host2 = await createTestHost(target.id, { hostname: "host-b" });

    await pool.query(
      "INSERT INTO change_events (host_id, hostname, event_type, category, summary, details) VALUES ($1, $2, $3, $4, $5, $6)",
      [host1.id, "host-a", "host_discovered", "host", "test", JSON.stringify({})],
    );
    await pool.query(
      "INSERT INTO change_events (host_id, hostname, event_type, category, summary, details) VALUES ($1, $2, $3, $4, $5, $6)",
      [host2.id, "host-b", "host_discovered", "host", "test", JSON.stringify({})],
    );

    const res = await api()
      .get(`/api/v1/changes?hostId=${host1.id}`)
      .set(h())
      .expect(200);

    expect(res.body.total).toBe(1);
    expect(res.body.data[0].hostname).toBe("host-a");
  });
});

describe("GET /api/v1/changes/summary", () => {
  it("should return correct event counts", async () => {
    const pool = getTestDb();
    const target = await createTestScanTarget();
    const host = await createTestHost(target.id, { hostname: "summary-host" });

    const summaryEvents = [
      { type: "host_discovered", category: "host" },
      { type: "package_added", category: "package" },
      { type: "package_added", category: "package" },
      { type: "service_added", category: "service" },
      { type: "package_removed", category: "package" },
    ];
    for (const { type, category } of summaryEvents) {
      await pool.query(
        "INSERT INTO change_events (host_id, hostname, event_type, category, summary, details) VALUES ($1, $2, $3, $4, $5, $6)",
        [host.id, "summary-host", type, category, `${type} event`, JSON.stringify({})],
      );
    }

    const res = await api().get("/api/v1/changes/summary").set(h()).expect(200);

    expect(res.body.total).toBe(5);
    expect(res.body.last24h).toBe(5);
  });
});
