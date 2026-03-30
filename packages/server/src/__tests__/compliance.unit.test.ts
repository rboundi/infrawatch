import { describe, it, expect, beforeEach } from "vitest";
import pino from "pino";
import { getTestDb } from "./setup.js";
import {
  createTestScanTarget,
  createTestHost,
  createTestPackage,
  createTestService,
  createTestAlert,
} from "./helpers.js";
import { ComplianceScorer } from "../services/compliance-scorer.js";

const logger = pino({ level: "silent" });

describe("ComplianceScorer", () => {
  it("should score a healthy host near 100", async () => {
    const pool = getTestDb();
    const scorer = new ComplianceScorer(pool, logger);
    const target = await createTestScanTarget();

    // Host with recent scan, all services running, no alerts, no EOL
    const host = await createTestHost(target.id, { hostname: "perfect-host" });

    // Mark host as recently seen
    await pool.query("UPDATE hosts SET last_seen_at = NOW() WHERE id = $1", [host.id]);

    // Add packages (no alerts = full packageCurrency)
    await createTestPackage(host.id, { packageName: "nginx", installedVersion: "1.25.0" });
    await createTestPackage(host.id, { packageName: "openssl", installedVersion: "3.0.2" });

    // Add running services
    await createTestService(host.id, { serviceName: "nginx", status: "running" });
    await createTestService(host.id, { serviceName: "sshd", status: "running" });

    const score = await scorer.calculateHostScore(host.id);

    // packageCurrency: 35 (no alerts)
    // eolStatus: 25 (no EOL alerts)
    // alertResolution: 20 (no crit/high alerts)
    // scanFreshness: 10 (just scanned)
    // serviceHealth: 10 (all running)
    // Total: 100
    expect(score).toBe(100);

    // Verify stored in DB
    const stored = await pool.query(
      "SELECT * FROM compliance_scores WHERE entity_type = 'host' AND entity_id = $1",
      [host.id],
    );
    expect(stored.rows.length).toBe(1);
    expect(stored.rows[0].classification).toBe("excellent");
  });

  it("should score a problematic host low", async () => {
    const pool = getTestDb();
    const scorer = new ComplianceScorer(pool, logger);
    const target = await createTestScanTarget();

    const host = await createTestHost(target.id, { hostname: "bad-host" });

    // Make host appear stale (last_seen_at far in the past → scanFreshness = 0)
    await pool.query("UPDATE hosts SET last_seen_at = '2020-01-01' WHERE id = $1", [host.id]);

    // Add packages with unacknowledged alerts (kills packageCurrency)
    const pkg = await createTestPackage(host.id, { packageName: "openssl", installedVersion: "1.0.0" });
    await createTestAlert(host.id, {
      packageName: "openssl",
      currentVersion: "1.0.0",
      availableVersion: "3.0.0",
      severity: "critical",
      acknowledged: false,
    });

    // Add active EOL alert (eolStatus = 0 since days_past_eol > 0)
    const def = await pool.query(
      `INSERT INTO eol_definitions (product_name, product_category, version_pattern, eol_date)
       VALUES ('TestProduct', 'runtime', '1.0', '2023-01-01')
       RETURNING id`,
    );
    await pool.query(
      `INSERT INTO eol_alerts (host_id, eol_definition_id, product_name, installed_version, eol_date, days_past_eol, status)
       VALUES ($1, $2, 'TestProduct', '1.0', '2023-01-01', 365, 'active')`,
      [host.id, def.rows[0].id],
    );

    // One stopped service
    await createTestService(host.id, { serviceName: "nginx", status: "stopped" });

    const score = await scorer.calculateHostScore(host.id);

    // Verify score is very low (critical classification = below 30)
    expect(score).toBeLessThan(30);

    const stored = await pool.query(
      "SELECT * FROM compliance_scores WHERE entity_type = 'host' AND entity_id = $1",
      [host.id],
    );
    expect(stored.rows[0].classification).toBe("critical");

    // Verify breakdown shows the issues
    const breakdown = typeof stored.rows[0].breakdown === "string"
      ? JSON.parse(stored.rows[0].breakdown)
      : stored.rows[0].breakdown;
    expect(breakdown.eolStatus.score).toBe(0);
    expect(breakdown.eolStatus.activeEolAlerts).toBeGreaterThan(0);
    expect(breakdown.scanFreshness.score).toBe(0);
    expect(breakdown.alertResolution.score).toBe(0);
  });

  it("should return correct breakdown structure", async () => {
    const pool = getTestDb();
    const scorer = new ComplianceScorer(pool, logger);
    const target = await createTestScanTarget();
    const host = await createTestHost(target.id, { hostname: "breakdown-host" });

    await pool.query("UPDATE hosts SET last_seen_at = NOW() WHERE id = $1", [host.id]);
    await createTestPackage(host.id, { packageName: "pkg-a" });
    await createTestService(host.id, { serviceName: "svc-a", status: "running" });

    await scorer.calculateHostScore(host.id);

    const stored = await pool.query(
      "SELECT breakdown FROM compliance_scores WHERE entity_type = 'host' AND entity_id = $1",
      [host.id],
    );
    const breakdown = typeof stored.rows[0].breakdown === "string"
      ? JSON.parse(stored.rows[0].breakdown)
      : stored.rows[0].breakdown;

    expect(breakdown).toHaveProperty("packageCurrency");
    expect(breakdown).toHaveProperty("eolStatus");
    expect(breakdown).toHaveProperty("alertResolution");
    expect(breakdown).toHaveProperty("scanFreshness");
    expect(breakdown).toHaveProperty("serviceHealth");

    expect(breakdown.packageCurrency.maxScore).toBe(35);
    expect(breakdown.eolStatus.maxScore).toBe(25);
    expect(breakdown.alertResolution.maxScore).toBe(20);
    expect(breakdown.scanFreshness.maxScore).toBe(10);
    expect(breakdown.serviceHealth.maxScore).toBe(10);
  });

  it("should improve score when alert is acknowledged", async () => {
    const pool = getTestDb();
    const scorer = new ComplianceScorer(pool, logger);
    const target = await createTestScanTarget();
    const host = await createTestHost(target.id, { hostname: "ack-host" });

    await pool.query("UPDATE hosts SET last_seen_at = NOW() WHERE id = $1", [host.id]);

    // Add critical alert unacknowledged
    const alert = await createTestAlert(host.id, {
      packageName: "openssl",
      severity: "critical",
      acknowledged: false,
    });

    const scoreBefore = await scorer.calculateHostScore(host.id);

    // Acknowledge the alert
    await pool.query("UPDATE alerts SET acknowledged = true WHERE id = $1", [alert.id]);

    const scoreAfter = await scorer.calculateHostScore(host.id);

    // alertResolution goes from 0 → 20 when acknowledged
    expect(scoreAfter).toBeGreaterThan(scoreBefore);
    expect(scoreAfter - scoreBefore).toBe(20);
  });
});
