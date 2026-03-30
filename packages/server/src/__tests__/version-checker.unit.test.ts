import { describe, it, expect } from "vitest";
import { getTestDb } from "./setup.js";
import pino from "pino";
import {
  createTestScanTarget,
  createTestHost,
  createTestPackage,
  createTestAlert,
} from "./helpers.js";
import { VersionChecker } from "../services/version-checker.js";

const logger = pino({ level: "silent" });

/**
 * Helper: insert a known_latest_versions row directly so we can trigger
 * generateAlerts() without needing external HTTP calls.
 */
async function insertKnownVersion(
  packageName: string,
  ecosystem: string,
  latestVersion: string,
  cveCount = 0,
  cveIds: string[] = [],
) {
  const pool = getTestDb();
  await pool.query(
    `INSERT INTO known_latest_versions (package_name, ecosystem, latest_version, latest_checked_at, cve_count, cve_ids)
     VALUES ($1, $2, $3, NOW(), $4, $5)
     ON CONFLICT (package_name, ecosystem)
     DO UPDATE SET latest_version = $3, cve_count = $4, cve_ids = $5, latest_checked_at = NOW()`,
    [packageName, ecosystem, latestVersion, cveCount, cveIds],
  );
}

/**
 * Expose determineSeverity for testing by constructing a VersionChecker and
 * calling the private method via bracket notation. This is acceptable for tests.
 */
function getSeverity(installed: string, latest: string, cveCount: number): string {
  const pool = getTestDb();
  const vc = new VersionChecker(pool, logger);
  return (vc as any).determineSeverity(installed, latest, cveCount);
}

// ─────────────────────────────────────────────
// Severity calculation (determineSeverity)
// ─────────────────────────────────────────────
describe("VersionChecker — severity calculation", () => {
  it("should return critical for 5+ CVEs", () => {
    expect(getSeverity("1.0.0", "2.0.0", 10)).toBe("critical");
  });

  it("should return high for 1-4 CVEs", () => {
    expect(getSeverity("1.0.0", "2.0.0", 3)).toBe("high");
  });

  it("should return high for major version behind (0 CVEs)", () => {
    expect(getSeverity("1.99.99", "2.0.0", 0)).toBe("high");
  });

  it("should return medium for minor version behind", () => {
    expect(getSeverity("1.24.0", "1.25.3", 0)).toBe("medium");
  });

  it("should return low for patch version behind", () => {
    expect(getSeverity("1.24.0", "1.24.1", 0)).toBe("low");
  });

  it("should return info for same version (no alert)", () => {
    expect(getSeverity("1.24.0", "1.24.0", 0)).toBe("info");
  });

  it("should return info when installed is newer than latest", () => {
    // installed > latest shouldn't create a meaningful alert
    expect(getSeverity("1.25.0", "1.24.0", 0)).toBe("info");
  });

  it("should handle numeric date-like versions via semver.coerce", () => {
    // semver.coerce("20240315") → 20240315.0.0, treats as major version diff → "high"
    expect(getSeverity("20240315", "20240401", 0)).toBe("high");
  });

  it("should return info for truly non-semver strings that coerce fails on", () => {
    expect(getSeverity("abc", "def", 0)).toBe("info");
  });
});

// ─────────────────────────────────────────────
// Version comparison — edge cases
// ─────────────────────────────────────────────
describe("VersionChecker — version edge cases", () => {
  it("should handle debian version suffixes via semver.coerce", () => {
    // "3.8.10-0ubuntu1" coerces to 3.8.10, "3.8.12-0ubuntu1" coerces to 3.8.12
    expect(getSeverity("3.8.10-0ubuntu1", "3.8.12-0ubuntu1", 0)).toBe("low");
  });

  it("should handle empty installed version (falls to info)", () => {
    expect(getSeverity("", "1.0.0", 0)).toBe("info");
  });

  it("should handle empty latest version", () => {
    expect(getSeverity("1.0.0", "", 0)).toBe("info");
  });
});

// ─────────────────────────────────────────────
// Alert generation via generateAlerts()
// ─────────────────────────────────────────────
describe("VersionChecker — alert generation", () => {
  it("should create alerts for outdated packages", async () => {
    const pool = getTestDb();
    const target = await createTestScanTarget();
    const host = await createTestHost(target.id, { hostname: "alert-gen-host" });
    await createTestPackage(host.id, {
      packageName: "nginx",
      installedVersion: "1.24.0",
      ecosystem: "npm",
    });

    await insertKnownVersion("nginx", "npm", "1.25.3");

    const vc = new VersionChecker(pool, logger);
    const count = await (vc as any).generateAlerts();

    expect(count).toBe(1);

    const alerts = await pool.query(
      "SELECT * FROM alerts WHERE host_id = $1 AND package_name = 'nginx'",
      [host.id],
    );
    expect(alerts.rows.length).toBe(1);
    expect(alerts.rows[0].available_version).toBe("1.25.3");
    expect(alerts.rows[0].current_version).toBe("1.24.0");
  });

  it("should not create duplicate unacknowledged alerts (dedup)", async () => {
    const pool = getTestDb();
    const target = await createTestScanTarget();
    const host = await createTestHost(target.id, { hostname: "dedup-host" });
    await createTestPackage(host.id, {
      packageName: "express",
      installedVersion: "4.18.0",
      ecosystem: "npm",
    });

    await insertKnownVersion("express", "npm", "4.19.0");

    // Create existing unacknowledged alert for same version
    await createTestAlert(host.id, {
      packageName: "express",
      currentVersion: "4.18.0",
      availableVersion: "4.19.0",
      severity: "medium",
    });

    const vc = new VersionChecker(pool, logger);
    const count = await (vc as any).generateAlerts();

    // Should not create another alert (excluded by NOT EXISTS subquery)
    expect(count).toBe(0);

    const alerts = await pool.query(
      "SELECT * FROM alerts WHERE host_id = $1 AND package_name = 'express'",
      [host.id],
    );
    expect(alerts.rows.length).toBe(1);
  });

  it("should create new alert when acknowledged alert exists for different version", async () => {
    const pool = getTestDb();
    const target = await createTestScanTarget();
    const host = await createTestHost(target.id, { hostname: "new-ver-host" });
    await createTestPackage(host.id, {
      packageName: "nginx",
      installedVersion: "1.24.0",
      ecosystem: "npm",
    });

    // Acknowledged alert for older version
    await createTestAlert(host.id, {
      packageName: "nginx",
      currentVersion: "1.24.0",
      availableVersion: "1.25.3",
      severity: "medium",
      acknowledged: true,
    });

    // New latest version
    await insertKnownVersion("nginx", "npm", "1.26.0");

    const vc = new VersionChecker(pool, logger);
    const count = await (vc as any).generateAlerts();

    expect(count).toBe(1);

    const alerts = await pool.query(
      "SELECT * FROM alerts WHERE host_id = $1 AND package_name = 'nginx' AND acknowledged = false",
      [host.id],
    );
    expect(alerts.rows.length).toBe(1);
    expect(alerts.rows[0].available_version).toBe("1.26.0");
  });

  it("should not create alerts for removed packages", async () => {
    const pool = getTestDb();
    const target = await createTestScanTarget();
    const host = await createTestHost(target.id, { hostname: "removed-pkg-host" });
    const pkg = await createTestPackage(host.id, {
      packageName: "old-pkg",
      installedVersion: "1.0.0",
      ecosystem: "npm",
    });

    // Soft-delete the package (simulating removal)
    await pool.query("UPDATE discovered_packages SET removed_at = NOW() WHERE id = $1", [pkg.id]);

    await insertKnownVersion("old-pkg", "npm", "2.0.0");

    const vc = new VersionChecker(pool, logger);
    const count = await (vc as any).generateAlerts();

    // Should be 0 — removed packages are excluded by WHERE removed_at IS NULL
    expect(count).toBe(0);
  });

  it("should handle external API failures gracefully", async () => {
    const pool = getTestDb();
    const vc = new VersionChecker(pool, logger);

    // checkEcosystem internally calls fetchJson which will fail for npm since
    // we're not hitting real URLs. The method catches errors and continues.
    const results = await (vc as any).checkNpmPackages([
      { package_name: "this-package-does-not-exist-xyzzy", ecosystem: "npm" },
    ]);

    // Should return empty results (error caught), not throw
    expect(results.length).toBe(0);
  });
});
