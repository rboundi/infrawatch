import { describe, it, expect } from "vitest";
import pino from "pino";
import { getTestDb } from "./setup.js";
import { createTestScanTarget } from "./helpers.js";
import { ScanOrchestrator } from "../services/scan-orchestrator.js";
import { SettingsService } from "../services/settings-service.js";

const logger = pino({ level: "silent" });

function createOrchestrator() {
  const pool = getTestDb();
  const orchestrator = new ScanOrchestrator(pool, logger);
  const settings = new SettingsService(pool, logger);
  orchestrator.setSettings(settings);
  return orchestrator;
}

/**
 * Trigger the orchestrator's internal tick cycle via the public interface.
 * We start the orchestrator (which calls tick immediately), then stop it
 * so the timer doesn't keep running. We wait a bit for the async scan to settle.
 */
async function runTickCycle(orchestrator: ScanOrchestrator): Promise<void> {
  orchestrator.start();
  // Give the tick and any async scan time to run
  await new Promise((r) => setTimeout(r, 2000));
  await orchestrator.stop();
}

describe("ScanOrchestrator", () => {
  it("should pick up targets due for scanning", async () => {
    const pool = getTestDb();
    const target = await createTestScanTarget({ name: "Due Target" });

    // Set last_scanned_at to 7 hours ago (interval is 6 hours)
    await pool.query(
      `UPDATE scan_targets SET last_scanned_at = NOW() - INTERVAL '7 hours' WHERE id = $1`,
      [target.id],
    );

    const orchestrator = createOrchestrator();
    await runTickCycle(orchestrator);

    // Target should have been picked up — status should have changed from 'pending'
    const row = await pool.query(
      "SELECT last_scan_status, last_scanned_at FROM scan_targets WHERE id = $1",
      [target.id],
    );

    // It will fail (no real SSH host) but should have attempted — status is 'running' or 'failed'
    expect(["running", "failed"]).toContain(row.rows[0].last_scan_status);
    // last_scanned_at should be updated (more recent than 7 hours ago)
    expect(row.rows[0].last_scanned_at).not.toBeNull();
  });

  it("should skip disabled targets", async () => {
    const pool = getTestDb();
    const target = await createTestScanTarget({ name: "Disabled", enabled: false });

    // Make it due
    await pool.query(
      `UPDATE scan_targets SET last_scanned_at = NOW() - INTERVAL '7 hours' WHERE id = $1`,
      [target.id],
    );

    const orchestrator = createOrchestrator();
    await runTickCycle(orchestrator);

    // Should not have been touched
    const row = await pool.query(
      "SELECT last_scan_status FROM scan_targets WHERE id = $1",
      [target.id],
    );
    expect(row.rows[0].last_scan_status).toBe("pending");
  });

  it("should skip targets not yet due", async () => {
    const pool = getTestDb();
    const target = await createTestScanTarget({ name: "Not Due" });

    // last_scanned_at 1 hour ago, interval 6 hours — not due
    await pool.query(
      `UPDATE scan_targets SET
         last_scanned_at = NOW() - INTERVAL '1 hour',
         last_scan_status = 'success'
       WHERE id = $1`,
      [target.id],
    );

    const orchestrator = createOrchestrator();
    await runTickCycle(orchestrator);

    // Status should remain 'success' (unchanged)
    const row = await pool.query(
      "SELECT last_scan_status FROM scan_targets WHERE id = $1",
      [target.id],
    );
    expect(row.rows[0].last_scan_status).toBe("success");
  });

  it("should handle scan failure gracefully", async () => {
    const pool = getTestDb();
    const target = await createTestScanTarget({ name: "Will Fail" });

    // Make it due (never scanned)
    const orchestrator = createOrchestrator();
    await runTickCycle(orchestrator);

    // Check target status
    const targetRow = await pool.query(
      "SELECT last_scan_status, last_scan_error, last_scanned_at FROM scan_targets WHERE id = $1",
      [target.id],
    );
    expect(targetRow.rows[0].last_scan_status).toBe("failed");
    expect(targetRow.rows[0].last_scan_error).toBeTruthy();
    expect(targetRow.rows[0].last_scanned_at).not.toBeNull();

    // Scan log should exist with 'failed' status
    const logRow = await pool.query(
      "SELECT status, error_message FROM scan_logs WHERE scan_target_id = $1",
      [target.id],
    );
    expect(logRow.rows.length).toBeGreaterThan(0);
    expect(logRow.rows[0].status).toBe("failed");
    expect(logRow.rows[0].error_message).toBeTruthy();
  });

  it("should not run duplicate scans on already-running targets", async () => {
    const pool = getTestDb();
    const target = await createTestScanTarget({
      name: "Already Running",
      lastScanStatus: "running",
    });

    // Make it "due" but already running
    await pool.query(
      `UPDATE scan_targets SET last_scanned_at = NOW() - INTERVAL '7 hours' WHERE id = $1`,
      [target.id],
    );

    const orchestrator = createOrchestrator();
    await runTickCycle(orchestrator);

    // Should still be 'running' (not overwritten), no new scan logs
    const row = await pool.query(
      "SELECT last_scan_status FROM scan_targets WHERE id = $1",
      [target.id],
    );
    expect(row.rows[0].last_scan_status).toBe("running");

    // No scan logs created (orchestrator should have skipped it)
    const logs = await pool.query(
      "SELECT id FROM scan_logs WHERE scan_target_id = $1",
      [target.id],
    );
    expect(logs.rows.length).toBe(0);
  });

  it("should not crash when one scan fails — other targets still processed", async () => {
    const pool = getTestDb();

    // Create two targets, both due
    const target1 = await createTestScanTarget({ name: "First Target" });
    const target2 = await createTestScanTarget({ name: "Second Target" });

    const orchestrator = createOrchestrator();
    await runTickCycle(orchestrator);

    // Both targets should have been attempted (both will fail, but both should have logs)
    const logs1 = await pool.query("SELECT id FROM scan_logs WHERE scan_target_id = $1", [target1.id]);
    const logs2 = await pool.query("SELECT id FROM scan_logs WHERE scan_target_id = $1", [target2.id]);

    expect(logs1.rows.length).toBeGreaterThan(0);
    expect(logs2.rows.length).toBeGreaterThan(0);
  });
});
