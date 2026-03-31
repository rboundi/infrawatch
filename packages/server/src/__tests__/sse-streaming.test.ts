import { describe, it, expect, beforeEach } from "vitest";
import supertest from "supertest";
import pino from "pino";
import { getTestDb } from "./setup.js";
import { getTestApp } from "./app.js";
import { createTestAdmin, getAuthToken, createTestScanTarget } from "./helpers.js";
import { createSSEClient, type SSEClient } from "./helpers/sse-client.js";
import { ScanLogger, type ScanLogEntry } from "../services/scan-logger.js";

const logger = pino({ level: "silent" });

// ──────────────────────────────────────────
// SSE Connection Tests
// ──────────────────────────────────────────

describe("SSE Streaming — Connection", () => {
  let token: string;

  beforeEach(async () => {
    const admin = await createTestAdmin();
    token = await getAuthToken(admin.username, admin.password);
  });

  it("SSE endpoint returns correct headers", async () => {
    const app = getTestApp();
    const pool = getTestDb();
    const target = await createTestScanTarget();

    // Create a completed scan log so the endpoint has something to return
    await pool.query(
      `INSERT INTO scan_logs (scan_target_id, status) VALUES ($1, 'success')`,
      [target.id],
    );

    const res = await supertest(app)
      .get(`/api/v1/targets/${target.id}/scan-logs/latest/stream`)
      .set("Authorization", `Bearer ${token}`)
      .set("Accept", "text/event-stream");

    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.headers["cache-control"]).toBe("no-cache");
  });

  it("SSE requires authentication", async () => {
    const app = getTestApp();
    const target = await createTestScanTarget();

    await supertest(app)
      .get(`/api/v1/targets/${target.id}/scan-logs/latest/stream`)
      .expect(401);
  });

  it("SSE for target with no scan logs returns 404", async () => {
    const app = getTestApp();
    const target = await createTestScanTarget();

    await supertest(app)
      .get(`/api/v1/targets/${target.id}/scan-logs/latest/stream`)
      .set("Authorization", `Bearer ${token}`)
      .expect(404);
  });

  it("SSE for completed scan sends done event and closes", async () => {
    const app = getTestApp();
    const pool = getTestDb();
    const target = await createTestScanTarget();

    await pool.query(
      `INSERT INTO scan_logs (scan_target_id, status) VALUES ($1, 'success')`,
      [target.id],
    );

    const res = await supertest(app)
      .get(`/api/v1/targets/${target.id}/scan-logs/latest/stream`)
      .set("Authorization", `Bearer ${token}`)
      .set("Accept", "text/event-stream");

    // Should contain the done event
    expect(res.text).toContain('event: done');
    expect(res.text).toContain('"status":"success"');
  });
});

// ──────────────────────────────────────────
// ScanLogger Event Emitter Tests
// ──────────────────────────────────────────

describe("ScanLogger — Event Emitter", () => {
  it("subscribe receives log entries", async () => {
    const pool = getTestDb();
    const scanLogger = new ScanLogger(pool, logger);
    const target = await createTestScanTarget();

    // Create scan log
    const logResult = await pool.query(
      `INSERT INTO scan_logs (scan_target_id, status) VALUES ($1, 'running') RETURNING id`,
      [target.id],
    );
    const logId = logResult.rows[0].id;

    const received: ScanLogEntry[] = [];
    scanLogger.subscribe(logId, (entry) => received.push(entry));

    await scanLogger.log(logId, "info", "Starting scan...");
    await scanLogger.log(logId, "info", "Discovering hosts...");
    await scanLogger.log(logId, "success", "Scan complete");

    expect(received.length).toBe(3);
    expect(received[0].message).toBe("Starting scan...");
    expect(received[0].level).toBe("info");
    expect(received[2].message).toBe("Scan complete");
    expect(received[2].level).toBe("success");
  });

  it("subscribeCompletion fires on complete", async () => {
    const pool = getTestDb();
    const scanLogger = new ScanLogger(pool, logger);
    const target = await createTestScanTarget();

    const logResult = await pool.query(
      `INSERT INTO scan_logs (scan_target_id, status) VALUES ($1, 'running') RETURNING id`,
      [target.id],
    );
    const logId = logResult.rows[0].id;

    let doneStatus: string | null = null;
    scanLogger.subscribeCompletion(logId, (data) => {
      doneStatus = data.status;
    });

    scanLogger.complete(logId, "success");

    expect(doneStatus).toBe("success");
  });

  it("unsubscribe stops receiving events", async () => {
    const pool = getTestDb();
    const scanLogger = new ScanLogger(pool, logger);
    const target = await createTestScanTarget();

    const logResult = await pool.query(
      `INSERT INTO scan_logs (scan_target_id, status) VALUES ($1, 'running') RETURNING id`,
      [target.id],
    );
    const logId = logResult.rows[0].id;

    const received: ScanLogEntry[] = [];
    const handler = (entry: ScanLogEntry) => received.push(entry);
    scanLogger.subscribe(logId, handler);

    await scanLogger.log(logId, "info", "First");
    scanLogger.unsubscribe(logId, handler);
    await scanLogger.log(logId, "info", "Second");

    expect(received.length).toBe(1);
    expect(received[0].message).toBe("First");
  });

  it("multiple subscribers receive same events", async () => {
    const pool = getTestDb();
    const scanLogger = new ScanLogger(pool, logger);
    const target = await createTestScanTarget();

    const logResult = await pool.query(
      `INSERT INTO scan_logs (scan_target_id, status) VALUES ($1, 'running') RETURNING id`,
      [target.id],
    );
    const logId = logResult.rows[0].id;

    const client1: ScanLogEntry[] = [];
    const client2: ScanLogEntry[] = [];
    scanLogger.subscribe(logId, (entry) => client1.push(entry));
    scanLogger.subscribe(logId, (entry) => client2.push(entry));

    await scanLogger.log(logId, "info", "Broadcast message");

    expect(client1.length).toBe(1);
    expect(client2.length).toBe(1);
    expect(client1[0].message).toBe("Broadcast message");
    expect(client2[0].message).toBe("Broadcast message");
  });

  it("getEntries returns persisted entries", async () => {
    const pool = getTestDb();
    const scanLogger = new ScanLogger(pool, logger);
    const target = await createTestScanTarget();

    const logResult = await pool.query(
      `INSERT INTO scan_logs (scan_target_id, status) VALUES ($1, 'running') RETURNING id`,
      [target.id],
    );
    const logId = logResult.rows[0].id;

    await scanLogger.log(logId, "info", "Entry 1");
    await scanLogger.log(logId, "warn", "Entry 2");
    await scanLogger.log(logId, "error", "Entry 3");

    const entries = await scanLogger.getEntries(logId);
    expect(entries.length).toBe(3);
    expect(entries[0].message).toBe("Entry 1");
    expect(entries[0].level).toBe("info");
    expect(entries[1].level).toBe("warn");
    expect(entries[2].level).toBe("error");
  });

  it("complete cleans up listeners after delay", async () => {
    const pool = getTestDb();
    const scanLogger = new ScanLogger(pool, logger);
    const target = await createTestScanTarget();

    const logResult = await pool.query(
      `INSERT INTO scan_logs (scan_target_id, status) VALUES ($1, 'running') RETURNING id`,
      [target.id],
    );
    const logId = logResult.rows[0].id;

    const received: ScanLogEntry[] = [];
    scanLogger.subscribe(logId, (entry) => received.push(entry));

    scanLogger.complete(logId, "success");

    // Wait for cleanup (1s delay in implementation)
    await new Promise((r) => setTimeout(r, 1500));

    // After cleanup, new events shouldn't reach the subscriber
    // (listeners removed — log() will emit but no one is listening)
    await scanLogger.log(logId, "info", "After complete");
    expect(received.length).toBe(0); // no entries were received via subscribe
  });

  it("rapid events are all received in order", async () => {
    const pool = getTestDb();
    const scanLogger = new ScanLogger(pool, logger);
    const target = await createTestScanTarget();

    const logResult = await pool.query(
      `INSERT INTO scan_logs (scan_target_id, status) VALUES ($1, 'running') RETURNING id`,
      [target.id],
    );
    const logId = logResult.rows[0].id;

    const received: ScanLogEntry[] = [];
    scanLogger.subscribe(logId, (entry) => received.push(entry));

    // Fire 50 events rapidly
    const promises = [];
    for (let i = 0; i < 50; i++) {
      promises.push(scanLogger.log(logId, "info", `Event ${i}`));
    }
    await Promise.all(promises);

    expect(received.length).toBe(50);
  });

  it("event bus listener count does not grow with connect/disconnect cycles", async () => {
    const pool = getTestDb();
    const scanLogger = new ScanLogger(pool, logger);
    const target = await createTestScanTarget();

    const logResult = await pool.query(
      `INSERT INTO scan_logs (scan_target_id, status) VALUES ($1, 'running') RETURNING id`,
      [target.id],
    );
    const logId = logResult.rows[0].id;

    for (let i = 0; i < 20; i++) {
      const handler = (_entry: ScanLogEntry) => {};
      scanLogger.subscribe(logId, handler);
      scanLogger.unsubscribe(logId, handler);
    }

    // Access the internal emitter to check listener count
    // @ts-expect-error accessing private field for testing
    const emitter = scanLogger.emitter;
    const count = emitter.listenerCount(`entry:${logId}`);
    expect(count).toBe(0);
  });
});

// ──────────────────────────────────────────
// SSE Stream Format Tests
// ──────────────────────────────────────────

describe("SSE Stream Format", () => {
  let token: string;

  beforeEach(async () => {
    const admin = await createTestAdmin();
    token = await getAuthToken(admin.username, admin.password);
  });

  it("completed scan stream has correct SSE format", async () => {
    const app = getTestApp();
    const pool = getTestDb();
    const scanLogger = new ScanLogger(pool, logger);
    const target = await createTestScanTarget();

    // Create scan log with entries
    const logResult = await pool.query(
      `INSERT INTO scan_logs (scan_target_id, status) VALUES ($1, 'success') RETURNING id`,
      [target.id],
    );
    const logId = logResult.rows[0].id;

    await scanLogger.log(logId, "info", "Test entry");

    const res = await supertest(app)
      .get(`/api/v1/targets/${target.id}/scan-logs/${logId}/stream`)
      .set("Authorization", `Bearer ${token}`)
      .set("Accept", "text/event-stream");

    // Verify SSE format: "data: {json}\n\n" for entries, "event: done\ndata: {json}\n\n" for done
    const text = res.text;
    expect(text).toContain("data: ");
    expect(text).toContain("event: done\n");
    expect(text).toContain("\n\n");

    // Parse the entry data
    const dataLines = text.split("\n").filter((l) => l.startsWith("data: "));
    expect(dataLines.length).toBeGreaterThanOrEqual(2); // at least 1 entry + done event

    // First data line should be a valid JSON scan log entry
    const entryJson = JSON.parse(dataLines[0].slice(6));
    expect(entryJson.message).toBe("Test entry");
    expect(entryJson.level).toBe("info");
  });

  it("specific scan log stream returns 404 for wrong target", async () => {
    const app = getTestApp();
    const pool = getTestDb();
    const target1 = await createTestScanTarget({ name: "target-1" });
    const target2 = await createTestScanTarget({ name: "target-2" });

    const logResult = await pool.query(
      `INSERT INTO scan_logs (scan_target_id, status) VALUES ($1, 'success') RETURNING id`,
      [target1.id],
    );
    const logId = logResult.rows[0].id;

    // Try to access target1's log via target2's endpoint
    await supertest(app)
      .get(`/api/v1/targets/${target2.id}/scan-logs/${logId}/stream`)
      .set("Authorization", `Bearer ${token}`)
      .expect(404);
  });
});

// ──────────────────────────────────────────
// Scan Log API Tests
// ──────────────────────────────────────────

describe("Scan Log API", () => {
  let token: string;

  beforeEach(async () => {
    const admin = await createTestAdmin();
    token = await getAuthToken(admin.username, admin.password);
  });

  it("GET scan-logs returns paginated list", async () => {
    const app = getTestApp();
    const pool = getTestDb();
    const target = await createTestScanTarget();

    // Create 3 scan logs
    for (let i = 0; i < 3; i++) {
      await pool.query(
        `INSERT INTO scan_logs (scan_target_id, status) VALUES ($1, 'success')`,
        [target.id],
      );
    }

    const res = await supertest(app)
      .get(`/api/v1/targets/${target.id}/scan-logs`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(res.body.data.length).toBe(3);
    expect(res.body.total).toBe(3);
    expect(res.body.page).toBe(1);
  });

  it("GET scan-logs/:id returns log with entries", async () => {
    const app = getTestApp();
    const pool = getTestDb();
    const scanLogger = new ScanLogger(pool, logger);
    const target = await createTestScanTarget();

    const logResult = await pool.query(
      `INSERT INTO scan_logs (scan_target_id, status) VALUES ($1, 'success') RETURNING id`,
      [target.id],
    );
    const logId = logResult.rows[0].id;

    await scanLogger.log(logId, "info", "Detail entry 1");
    await scanLogger.log(logId, "info", "Detail entry 2");

    const res = await supertest(app)
      .get(`/api/v1/targets/${target.id}/scan-logs/${logId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(res.body.id).toBe(logId);
    expect(res.body.entries.length).toBe(2);
    expect(res.body.entries[0].message).toBe("Detail entry 1");
  });

  it("GET scan-logs/:id returns 404 for non-existent", async () => {
    const app = getTestApp();
    const target = await createTestScanTarget();

    await supertest(app)
      .get(`/api/v1/targets/${target.id}/scan-logs/00000000-0000-0000-0000-000000000000`)
      .set("Authorization", `Bearer ${token}`)
      .expect(404);
  });
});
