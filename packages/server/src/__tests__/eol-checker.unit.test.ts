import { describe, it, expect, beforeEach } from "vitest";
import pino from "pino";
import { getTestDb } from "./setup.js";
import {
  createTestScanTarget,
  createTestHost,
  createTestPackage,
  createTestService,
} from "./helpers.js";
import { EolChecker } from "../services/eol-checker.js";

const logger = pino({ level: "silent" });

// Helper to insert an EOL definition directly
async function insertEolDefinition(overrides: {
  productName: string;
  productCategory: string;
  versionPattern: string;
  eolDate: string;
  successorVersion?: string;
}) {
  const pool = getTestDb();
  const result = await pool.query(
    `INSERT INTO eol_definitions (product_name, product_category, version_pattern, eol_date, successor_version)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      overrides.productName,
      overrides.productCategory,
      overrides.versionPattern,
      overrides.eolDate,
      overrides.successorVersion ?? null,
    ],
  );
  return result.rows[0];
}

describe("EolChecker", () => {
  it("should create alert for Ubuntu 18.04 past EOL", async () => {
    const pool = getTestDb();
    const checker = new EolChecker(pool, logger);
    const target = await createTestScanTarget();
    const host = await createTestHost(target.id, {
      hostname: "ubuntu-1804",
      os: "Ubuntu",
      osVersion: "18.04.6",
    });

    await insertEolDefinition({
      productName: "Ubuntu",
      productCategory: "os",
      versionPattern: "18.04",
      eolDate: "2023-04-01",
      successorVersion: "20.04",
    });

    await checker.check();

    const alerts = await pool.query(
      "SELECT * FROM eol_alerts WHERE host_id = $1",
      [host.id],
    );
    expect(alerts.rows.length).toBe(1);
    expect(alerts.rows[0].product_name).toBe("Ubuntu");
    expect(alerts.rows[0].installed_version).toBe("18.04");
    expect(alerts.rows[0].days_past_eol).toBeGreaterThan(0);
    expect(alerts.rows[0].status).toBe("active");
  });

  it("should NOT create alert for Ubuntu 22.04 still supported", async () => {
    const pool = getTestDb();
    const checker = new EolChecker(pool, logger);
    const target = await createTestScanTarget();
    await createTestHost(target.id, {
      hostname: "ubuntu-2204",
      os: "Ubuntu",
      osVersion: "22.04",
    });

    await insertEolDefinition({
      productName: "Ubuntu",
      productCategory: "os",
      versionPattern: "22.04",
      eolDate: "2027-04-01", // far in the future
    });

    await checker.check();

    const alerts = await pool.query(
      "SELECT * FROM eol_alerts WHERE product_name = 'Ubuntu' AND installed_version = '22.04'",
    );
    expect(alerts.rows.length).toBe(0);
  });

  it("should create alert for upcoming EOL within window", async () => {
    const pool = getTestDb();
    const checker = new EolChecker(pool, logger);
    const target = await createTestScanTarget();
    await createTestHost(target.id, {
      hostname: "ubuntu-upcoming",
      os: "Ubuntu",
      osVersion: "20.04",
    });

    // Set EOL 30 days from now (within the 90-day window)
    const soonDate = new Date();
    soonDate.setDate(soonDate.getDate() + 30);
    const eolDateStr = soonDate.toISOString().split("T")[0];

    await insertEolDefinition({
      productName: "Ubuntu",
      productCategory: "os",
      versionPattern: "20.04",
      eolDate: eolDateStr,
    });

    await checker.check();

    const alerts = await pool.query(
      "SELECT * FROM eol_alerts WHERE product_name = 'Ubuntu' AND installed_version = '20.04'",
    );
    expect(alerts.rows.length).toBe(1);
    expect(alerts.rows[0].days_past_eol).toBeLessThan(0); // negative = not yet expired
  });

  it("should match packages by name (postgresql)", async () => {
    const pool = getTestDb();
    const checker = new EolChecker(pool, logger);
    const target = await createTestScanTarget();
    const host = await createTestHost(target.id, { hostname: "pg-host" });

    await createTestPackage(host.id, {
      packageName: "postgresql-14",
      installedVersion: "14.10-1ubuntu1",
    });

    await insertEolDefinition({
      productName: "PostgreSQL",
      productCategory: "database",
      versionPattern: "14",
      eolDate: "2026-11-01", // within 90-day window soon enough
    });

    // Use a date that would make this within window
    // Since the default window is 90 days, if EOL is within 90 days it should match
    // Let's insert a past EOL to be sure
    await pool.query(
      "UPDATE eol_definitions SET eol_date = '2024-01-01' WHERE version_pattern = '14' AND product_name = 'PostgreSQL'",
    );

    await checker.check();

    const alerts = await pool.query(
      "SELECT * FROM eol_alerts WHERE host_id = $1 AND product_name = 'PostgreSQL'",
      [host.id],
    );
    expect(alerts.rows.length).toBe(1);
    expect(alerts.rows[0].installed_version).toBe("14");
  });

  it("should match services by name (redis)", async () => {
    const pool = getTestDb();
    const checker = new EolChecker(pool, logger);
    const target = await createTestScanTarget();
    const host = await createTestHost(target.id, { hostname: "redis-host" });

    await createTestService(host.id, {
      serviceName: "redis-server",
      version: "6.2.14",
    });

    await insertEolDefinition({
      productName: "Redis",
      productCategory: "database",
      versionPattern: "6.2",
      eolDate: "2024-01-01",
    });

    await checker.check();

    const alerts = await pool.query(
      "SELECT * FROM eol_alerts WHERE host_id = $1 AND product_name = 'Redis'",
      [host.id],
    );
    expect(alerts.rows.length).toBe(1);
    expect(alerts.rows[0].installed_version).toBe("6.2");
  });

  it("should resolve alert when software is removed", async () => {
    const pool = getTestDb();
    const checker = new EolChecker(pool, logger);
    const target = await createTestScanTarget();
    const host = await createTestHost(target.id, { hostname: "resolve-host" });

    // Create package and matching definition
    const pkg = await createTestPackage(host.id, {
      packageName: "nodejs",
      installedVersion: "16.20.0",
    });

    const def = await insertEolDefinition({
      productName: "Node.js",
      productCategory: "runtime",
      versionPattern: "16",
      eolDate: "2023-09-11",
    });

    // First check creates alert
    await checker.check();

    let alerts = await pool.query(
      "SELECT * FROM eol_alerts WHERE host_id = $1 AND status = 'active'",
      [host.id],
    );
    expect(alerts.rows.length).toBe(1);

    // Remove the package (soft delete)
    await pool.query(
      "UPDATE discovered_packages SET removed_at = NOW() WHERE id = $1",
      [pkg.id],
    );

    // Second check should resolve the alert
    await checker.check();

    alerts = await pool.query(
      "SELECT * FROM eol_alerts WHERE host_id = $1",
      [host.id],
    );
    expect(alerts.rows[0].status).toBe("resolved");
  });

  it("should not duplicate alert on repeated check", async () => {
    const pool = getTestDb();
    const checker = new EolChecker(pool, logger);
    const target = await createTestScanTarget();
    await createTestHost(target.id, {
      hostname: "dedup-host",
      os: "Ubuntu",
      osVersion: "18.04",
    });

    await insertEolDefinition({
      productName: "Ubuntu",
      productCategory: "os",
      versionPattern: "18.04",
      eolDate: "2023-04-01",
    });

    // Run check twice
    await checker.check();
    await checker.check();

    const alerts = await pool.query(
      "SELECT * FROM eol_alerts WHERE product_name = 'Ubuntu' AND installed_version = '18.04'",
    );
    // Should have exactly 1 alert (upsert prevents duplicates)
    expect(alerts.rows.length).toBe(1);
  });
});
