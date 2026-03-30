import { describe, it, expect } from "vitest";
import pino from "pino";
import type { ScanResult } from "@infrawatch/scanner";
import { getTestDb } from "./setup.js";
import { createTestScanTarget, createTestHost, createTestPackage, createTestService } from "./helpers.js";
import { DataIngestionService } from "../services/data-ingestion.js";

const logger = pino({ level: "silent" });

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

describe("DataIngestionService", () => {
  it("should ingest a new host with packages and services", async () => {
    const pool = getTestDb();
    const ingestion = new DataIngestionService(pool, logger);
    const target = await createTestScanTarget();

    const result = await ingestion.processResults(target.id, makeScanResult([
      makeHost({
        hostname: "web-01",
        packages: [
          { name: "nginx", installedVersion: "1.24.0", packageManager: "apt", ecosystem: "debian" },
          { name: "curl", installedVersion: "7.88.1", packageManager: "apt", ecosystem: "debian" },
          { name: "openssl", installedVersion: "3.0.11", packageManager: "apt", ecosystem: "debian" },
        ],
        services: [
          { name: "nginx", serviceType: "webserver", version: "1.24.0", port: 80, status: "running" },
          { name: "sshd", serviceType: "remote-access", port: 22, status: "running" },
        ],
      }),
    ]));

    expect(result.hostsUpserted).toBe(1);
    expect(result.packagesFound).toBe(3);
    expect(result.servicesFound).toBe(2);

    // Verify DB records
    const host = await pool.query("SELECT * FROM hosts WHERE hostname = 'web-01' AND scan_target_id = $1", [target.id]);
    expect(host.rows.length).toBe(1);
    expect(host.rows[0].status).toBe("active");
    expect(host.rows[0].first_seen_at).not.toBeNull();
    expect(host.rows[0].last_seen_at).not.toBeNull();

    const pkgs = await pool.query("SELECT * FROM discovered_packages WHERE host_id = $1 AND removed_at IS NULL", [host.rows[0].id]);
    expect(pkgs.rows.length).toBe(3);

    const svcs = await pool.query("SELECT * FROM services WHERE host_id = $1", [host.rows[0].id]);
    expect(svcs.rows.length).toBe(2);
  });

  it("should upsert existing host without creating duplicates", async () => {
    const pool = getTestDb();
    const ingestion = new DataIngestionService(pool, logger);
    const target = await createTestScanTarget();

    // First scan
    await ingestion.processResults(target.id, makeScanResult([
      makeHost({ hostname: "upsert-host", os: "Ubuntu", osVersion: "20.04" }),
    ]));

    // Second scan with updated OS
    await ingestion.processResults(target.id, makeScanResult([
      makeHost({ hostname: "upsert-host", os: "Ubuntu", osVersion: "22.04" }),
    ]));

    const hosts = await pool.query("SELECT * FROM hosts WHERE hostname = 'upsert-host' AND scan_target_id = $1", [target.id]);
    expect(hosts.rows.length).toBe(1);
    expect(hosts.rows[0].os_version).toBe("22.04");
  });

  it("should add new packages on subsequent scan", async () => {
    const pool = getTestDb();
    const ingestion = new DataIngestionService(pool, logger);
    const target = await createTestScanTarget();

    // First scan: packages A, B
    await ingestion.processResults(target.id, makeScanResult([
      makeHost({
        hostname: "pkg-add-host",
        packages: [
          { name: "A", installedVersion: "1.0", packageManager: "apt", ecosystem: "debian" },
          { name: "B", installedVersion: "1.0", packageManager: "apt", ecosystem: "debian" },
        ],
      }),
    ]));

    // Second scan: packages A, B, C
    await ingestion.processResults(target.id, makeScanResult([
      makeHost({
        hostname: "pkg-add-host",
        packages: [
          { name: "A", installedVersion: "1.0", packageManager: "apt", ecosystem: "debian" },
          { name: "B", installedVersion: "1.0", packageManager: "apt", ecosystem: "debian" },
          { name: "C", installedVersion: "2.0", packageManager: "apt", ecosystem: "debian" },
        ],
      }),
    ]));

    const host = await pool.query("SELECT id FROM hosts WHERE hostname = 'pkg-add-host' AND scan_target_id = $1", [target.id]);
    const pkgs = await pool.query("SELECT * FROM discovered_packages WHERE host_id = $1 AND removed_at IS NULL ORDER BY package_name", [host.rows[0].id]);
    expect(pkgs.rows.length).toBe(3);
    expect(pkgs.rows.map((r: any) => r.package_name)).toEqual(["A", "B", "C"]);
  });

  it("should soft-delete removed packages", async () => {
    const pool = getTestDb();
    const ingestion = new DataIngestionService(pool, logger);
    const target = await createTestScanTarget();

    // First scan: A, B, C
    await ingestion.processResults(target.id, makeScanResult([
      makeHost({
        hostname: "pkg-rm-host",
        packages: [
          { name: "A", installedVersion: "1.0", packageManager: "apt", ecosystem: "debian" },
          { name: "B", installedVersion: "1.0", packageManager: "apt", ecosystem: "debian" },
          { name: "C", installedVersion: "1.0", packageManager: "apt", ecosystem: "debian" },
        ],
      }),
    ]));

    // Second scan: A, B only (C removed)
    await ingestion.processResults(target.id, makeScanResult([
      makeHost({
        hostname: "pkg-rm-host",
        packages: [
          { name: "A", installedVersion: "1.0", packageManager: "apt", ecosystem: "debian" },
          { name: "B", installedVersion: "1.0", packageManager: "apt", ecosystem: "debian" },
        ],
      }),
    ]));

    const host = await pool.query("SELECT id FROM hosts WHERE hostname = 'pkg-rm-host' AND scan_target_id = $1", [target.id]);
    const hostId = host.rows[0].id;

    const active = await pool.query("SELECT * FROM discovered_packages WHERE host_id = $1 AND removed_at IS NULL", [hostId]);
    expect(active.rows.length).toBe(2);

    const removed = await pool.query("SELECT * FROM discovered_packages WHERE host_id = $1 AND removed_at IS NOT NULL", [hostId]);
    expect(removed.rows.length).toBe(1);
    expect(removed.rows[0].package_name).toBe("C");
  });

  it("should update package version without creating duplicates", async () => {
    const pool = getTestDb();
    const ingestion = new DataIngestionService(pool, logger);
    const target = await createTestScanTarget();

    // First scan: nginx 1.24.0
    await ingestion.processResults(target.id, makeScanResult([
      makeHost({
        hostname: "pkg-ver-host",
        packages: [
          { name: "nginx", installedVersion: "1.24.0", packageManager: "apt", ecosystem: "debian" },
        ],
      }),
    ]));

    // Second scan: nginx 1.25.3
    await ingestion.processResults(target.id, makeScanResult([
      makeHost({
        hostname: "pkg-ver-host",
        packages: [
          { name: "nginx", installedVersion: "1.25.3", packageManager: "apt", ecosystem: "debian" },
        ],
      }),
    ]));

    const host = await pool.query("SELECT id FROM hosts WHERE hostname = 'pkg-ver-host' AND scan_target_id = $1", [target.id]);
    const pkgs = await pool.query("SELECT * FROM discovered_packages WHERE host_id = $1 AND removed_at IS NULL", [host.rows[0].id]);
    expect(pkgs.rows.length).toBe(1);
    expect(pkgs.rows[0].installed_version).toBe("1.25.3");
  });

  it("should restore removed package when it reappears", async () => {
    const pool = getTestDb();
    const ingestion = new DataIngestionService(pool, logger);
    const target = await createTestScanTarget();

    // First scan: A present
    await ingestion.processResults(target.id, makeScanResult([
      makeHost({
        hostname: "pkg-restore-host",
        packages: [
          { name: "A", installedVersion: "1.0", packageManager: "apt", ecosystem: "debian" },
        ],
      }),
    ]));

    // Second scan: A removed
    await ingestion.processResults(target.id, makeScanResult([
      makeHost({ hostname: "pkg-restore-host", packages: [] }),
    ]));

    const host = await pool.query("SELECT id FROM hosts WHERE hostname = 'pkg-restore-host' AND scan_target_id = $1", [target.id]);
    const hostId = host.rows[0].id;

    // Verify it's removed
    let removed = await pool.query("SELECT * FROM discovered_packages WHERE host_id = $1 AND removed_at IS NOT NULL", [hostId]);
    expect(removed.rows.length).toBe(1);

    // Third scan: A reappears
    await ingestion.processResults(target.id, makeScanResult([
      makeHost({
        hostname: "pkg-restore-host",
        packages: [
          { name: "A", installedVersion: "1.0", packageManager: "apt", ecosystem: "debian" },
        ],
      }),
    ]));

    // Should be back to active with removed_at = null
    const active = await pool.query("SELECT * FROM discovered_packages WHERE host_id = $1 AND removed_at IS NULL", [hostId]);
    expect(active.rows.length).toBe(1);
    expect(active.rows[0].package_name).toBe("A");
  });

  it("should update service version without duplicating", async () => {
    const pool = getTestDb();
    const ingestion = new DataIngestionService(pool, logger);
    const target = await createTestScanTarget();

    // First scan
    await ingestion.processResults(target.id, makeScanResult([
      makeHost({
        hostname: "svc-host",
        services: [
          { name: "nginx", serviceType: "webserver", version: "1.24.0", port: 80, status: "running" },
        ],
      }),
    ]));

    // Second scan: version changed
    await ingestion.processResults(target.id, makeScanResult([
      makeHost({
        hostname: "svc-host",
        services: [
          { name: "nginx", serviceType: "webserver", version: "1.25.3", port: 80, status: "running" },
        ],
      }),
    ]));

    const host = await pool.query("SELECT id FROM hosts WHERE hostname = 'svc-host' AND scan_target_id = $1", [target.id]);
    const svcs = await pool.query("SELECT * FROM services WHERE host_id = $1", [host.rows[0].id]);
    expect(svcs.rows.length).toBe(1);
    expect(svcs.rows[0].version).toBe("1.25.3");
  });

  it("should handle empty scan result", async () => {
    const pool = getTestDb();
    const ingestion = new DataIngestionService(pool, logger);
    const target = await createTestScanTarget();

    const result = await ingestion.processResults(target.id, makeScanResult([]));

    expect(result.hostsUpserted).toBe(0);
    expect(result.packagesFound).toBe(0);
    expect(result.servicesFound).toBe(0);
  });

  it("should handle host with zero packages", async () => {
    const pool = getTestDb();
    const ingestion = new DataIngestionService(pool, logger);
    const target = await createTestScanTarget();

    const result = await ingestion.processResults(target.id, makeScanResult([
      makeHost({ hostname: "no-pkg-host", packages: [] }),
    ]));

    expect(result.hostsUpserted).toBe(1);
    expect(result.packagesFound).toBe(0);

    const host = await pool.query("SELECT id FROM hosts WHERE hostname = 'no-pkg-host' AND scan_target_id = $1", [target.id]);
    expect(host.rows.length).toBe(1);
  });

  it("should handle very long package name", async () => {
    const pool = getTestDb();
    const ingestion = new DataIngestionService(pool, logger);
    const target = await createTestScanTarget();

    const longName = "a".repeat(500);

    const result = await ingestion.processResults(target.id, makeScanResult([
      makeHost({
        hostname: "long-pkg-host",
        packages: [
          { name: longName, installedVersion: "1.0", packageManager: "npm", ecosystem: "npm" },
        ],
      }),
    ]));

    // Should succeed — discovered_packages.package_name is varchar(500)
    expect(result.hostsUpserted).toBe(1);
    expect(result.packagesFound).toBe(1);
  });

  it("should handle concurrent scans without duplicates or deadlocks", async () => {
    const pool = getTestDb();
    const ingestion = new DataIngestionService(pool, logger);
    const target = await createTestScanTarget();

    // Run two ingestions concurrently for the same target
    const [r1, r2] = await Promise.all([
      ingestion.processResults(target.id, makeScanResult([
        makeHost({ hostname: "concurrent-host", ip: "10.0.0.1" }),
      ])),
      ingestion.processResults(target.id, makeScanResult([
        makeHost({ hostname: "concurrent-host", ip: "10.0.0.2" }),
      ])),
    ]);

    // Both should succeed (one inserts, one updates via ON CONFLICT)
    expect(r1.hostsUpserted + r2.hostsUpserted).toBe(2);

    const hosts = await pool.query("SELECT * FROM hosts WHERE hostname = 'concurrent-host' AND scan_target_id = $1", [target.id]);
    expect(hosts.rows.length).toBe(1);
  });

  it("should rollback on error during ingestion", async () => {
    const pool = getTestDb();
    const ingestion = new DataIngestionService(pool, logger);
    const target = await createTestScanTarget();

    // Process a good host first
    await ingestion.processResults(target.id, makeScanResult([
      makeHost({ hostname: "good-host" }),
    ]));

    // Process with an invalid scan_target_id (FK violation triggers rollback)
    const badTargetId = "00000000-0000-0000-0000-000000000000";
    const result = await ingestion.processResults(badTargetId, makeScanResult([
      makeHost({ hostname: "bad-fk-host" }),
    ]));

    // The bad host should fail but not crash — hostsUpserted = 0 for that one
    expect(result.hostsUpserted).toBe(0);

    // Good host from before should still exist
    const hosts = await pool.query("SELECT * FROM hosts WHERE hostname = 'good-host' AND scan_target_id = $1", [target.id]);
    expect(hosts.rows.length).toBe(1);
  });
});
