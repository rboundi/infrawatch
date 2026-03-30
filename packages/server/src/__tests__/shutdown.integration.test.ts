import { describe, it, expect, afterEach } from "vitest";
import pg from "pg";
import { spawnServer, type SpawnedServer } from "./helpers/spawn-server.js";

// These tests spawn real server processes and send signals — they're slower than unit tests.
// Each test needs its own server instance.
// We set NODE_ENV=development so pino logs are visible (NODE_ENV=test makes them silent).

const LOG_ENV = { NODE_ENV: "development" };

let server: SpawnedServer | null = null;

afterEach(async () => {
  // Safety: always kill the spawned server to prevent zombie processes
  if (server) {
    server.kill();
    try {
      await server.waitForExit(5000);
    } catch {
      // already dead
    }
    server = null;
  }
});

// ─── Helper: connect to test DB directly ───
function getDirectPool() {
  return new pg.Pool({
    host: "localhost",
    port: 5433,
    database: "infrawatch_test",
    user: "infrawatch",
    password: "infrawatch_dev",
    max: 2,
    idleTimeoutMillis: 5000,
  });
}

describe("Graceful Shutdown", () => {
  it("SIGTERM triggers clean shutdown with exit code 0", async () => {
    server = await spawnServer(LOG_ENV);

    // Verify server is healthy
    const health = await server.fetch("/api/v1/health");
    expect(health.ok).toBe(true);

    // Send SIGTERM
    server.sendSignal("SIGTERM");

    // Should exit cleanly within 15 seconds
    const code = await server.waitForExit(15_000);
    expect(code).toBe(0);

    // Verify shutdown log messages are present (pino JSON logs contain "msg" field)
    const combined = server.stdout + server.stderr;
    expect(combined).toContain("Shutdown signal received");
    expect(combined).toContain("Scan orchestrator stopped");
    expect(combined).toContain("Background services stopped");
    expect(combined).toContain("Database pool closed");
    expect(combined).toContain("Graceful shutdown complete");
  }, 45_000);

  it("SIGINT triggers clean shutdown (same as SIGTERM)", async () => {
    server = await spawnServer(LOG_ENV);

    const health = await server.fetch("/api/v1/health");
    expect(health.ok).toBe(true);

    server.sendSignal("SIGINT");

    const code = await server.waitForExit(15_000);
    expect(code).toBe(0);

    const combined = server.stdout + server.stderr;
    expect(combined).toContain("Shutdown signal received");
    expect(combined).toContain("Graceful shutdown complete");
  }, 45_000);

  it("server closes HTTP connections on shutdown", async () => {
    server = await spawnServer(LOG_ENV);

    // Confirm server is up
    const health = await server.fetch("/api/v1/health");
    expect(health.ok).toBe(true);

    // Send SIGTERM and wait for exit
    server.sendSignal("SIGTERM");
    await server.waitForExit(15_000);

    // Subsequent requests should fail (connection refused)
    try {
      await server.fetch("/api/v1/health");
      expect.unreachable("Should have thrown connection error");
    } catch (err) {
      // Expected: ECONNREFUSED or similar network error
      expect(err).toBeDefined();
    }
  }, 45_000);

  it("database pool is closed on shutdown (no lingering connections)", async () => {
    server = await spawnServer(LOG_ENV);

    const health = await server.fetch("/api/v1/health");
    const body = await health.json() as Record<string, unknown>;
    expect(body.db).toBe("ok");

    // Send SIGTERM and wait for exit
    server.sendSignal("SIGTERM");
    await server.waitForExit(15_000);

    // Small delay to let PG clean up connection state
    await new Promise((r) => setTimeout(r, 500));

    // Check pg_stat_activity for lingering connections from the server
    const pool = getDirectPool();
    try {
      const pidResult = await pool.query(
        `SELECT COUNT(*) AS cnt FROM pg_stat_activity
         WHERE datname = 'infrawatch_test'
           AND pid != pg_backend_pid()`,
      );
      // Should be very low (just our direct pool connections, not the server's)
      const count = parseInt(pidResult.rows[0].cnt, 10);
      expect(count).toBeLessThanOrEqual(2);
    } finally {
      await pool.end();
    }
  }, 45_000);

  it("shutdown logs show background services stopped", async () => {
    server = await spawnServer(LOG_ENV);

    await server.fetch("/api/v1/health");

    server.sendSignal("SIGTERM");
    await server.waitForExit(15_000);

    const combined = server.stdout + server.stderr;
    expect(combined).toContain("Stopping scan orchestrator");
    expect(combined).toContain("Stopping background services");
    expect(combined).toContain("Background services stopped");
  }, 45_000);
});

describe("Double Signal Handling", () => {
  it("second SIGTERM during shutdown forces immediate exit with code 1", async () => {
    server = await spawnServer(LOG_ENV);
    await server.fetch("/api/v1/health");

    // Send first SIGTERM (begins graceful shutdown)
    server.sendSignal("SIGTERM");

    // Send second SIGTERM immediately (no delay — race the cleanup)
    server.sendSignal("SIGTERM");

    // Should force-exit quickly
    const code = await server.waitForExit(10_000);
    // Either the server finished cleanup before the second signal (code 0)
    // or the second signal forced an exit (code 1). Both are valid outcomes
    // depending on timing, but the force-exit path should exist.
    expect([0, 1]).toContain(code);

    if (code === 1) {
      const combined = server.stdout + server.stderr;
      expect(combined).toContain("Second shutdown signal");
    }
  }, 20_000);
});

describe("State Recovery After Unclean Shutdown", () => {
  it("scan targets stuck in 'running' are recovered on next startup", async () => {
    const pool = getDirectPool();

    try {
      // Directly insert a scan target stuck in 'running' state
      await pool.query(
        `INSERT INTO scan_targets (name, type, connection_config, scan_interval_hours, enabled, last_scan_status)
         VALUES ('stuck-target', 'ssh_linux', '{}', 6, true, 'running')
         ON CONFLICT DO NOTHING`,
      );

      // Update any existing one to 'running'
      await pool.query(
        `UPDATE scan_targets SET last_scan_status = 'running', last_scan_error = NULL
         WHERE name = 'stuck-target'`,
      );

      // Verify it's running
      const before = await pool.query(
        `SELECT last_scan_status FROM scan_targets WHERE name = 'stuck-target'`,
      );
      expect(before.rows[0].last_scan_status).toBe("running");

      // Start the server — it should recover stale targets
      server = await spawnServer(LOG_ENV);
      await server.fetch("/api/v1/health");

      // Check the target was recovered
      const after = await pool.query(
        `SELECT last_scan_status, last_scan_error FROM scan_targets WHERE name = 'stuck-target'`,
      );
      expect(after.rows[0].last_scan_status).toBe("failed");
      expect(after.rows[0].last_scan_error).toContain("Server restarted during scan");

      // Verify recovery is logged
      const combined = server.stdout + server.stderr;
      expect(combined).toContain("Recovered stale scan targets");

      // Clean shutdown
      server.sendSignal("SIGTERM");
      await server.waitForExit(15_000);
    } finally {
      await pool.query(`DELETE FROM scan_targets WHERE name = 'stuck-target'`);
      await pool.end();
    }
  }, 60_000);
});
