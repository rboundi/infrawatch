import { describe, it, expect, beforeEach } from "vitest";
import supertest from "supertest";
import { getTestDb } from "./setup.js";
import { getTestApp } from "./app.js";
import {
  createTestAdmin,
  getAuthToken,
  createTestScanTarget,
  createTestHost,
  createTestAlert,
} from "./helpers.js";

let token: string;
const h = () => ({ Authorization: `Bearer ${token}` });

beforeEach(async () => {
  await createTestAdmin({ username: "admin", password: "AdminPass1234" });
  token = await getAuthToken("admin", "AdminPass1234");
});

function api() {
  return supertest(getTestApp());
}

// ─────────────────────────────────────────────
// GET /api/v1/alerts (list)
// ─────────────────────────────────────────────
describe("GET /api/v1/alerts (list)", () => {
  it("should return correct shape with host hostname", async () => {
    const target = await createTestScanTarget();
    const host1 = await createTestHost(target.id, { hostname: "web-01" });
    const host2 = await createTestHost(target.id, { hostname: "db-01" });
    const host3 = await createTestHost(target.id, { hostname: "app-01" });

    await createTestAlert(host1.id, { severity: "critical", packageName: "openssl" });
    await createTestAlert(host2.id, { severity: "high", packageName: "nginx" });
    await createTestAlert(host3.id, { severity: "medium", packageName: "curl" });

    const res = await api().get("/api/v1/alerts").set(h()).expect(200);

    expect(res.body).toHaveProperty("data");
    expect(res.body).toHaveProperty("total");
    expect(res.body).toHaveProperty("page");
    expect(res.body).toHaveProperty("totalPages");
    expect(res.body.data.length).toBe(3);

    for (const alert of res.body.data) {
      expect(alert).toHaveProperty("id");
      expect(alert).toHaveProperty("hostId");
      expect(alert).toHaveProperty("hostname");
      expect(alert).toHaveProperty("packageName");
      expect(alert).toHaveProperty("severity");
      expect(alert).toHaveProperty("acknowledged");
      expect(alert.hostname).toBeTruthy();
    }
  });

  it("should filter by severity (comma-separated)", async () => {
    const target = await createTestScanTarget();
    const host = await createTestHost(target.id);

    await createTestAlert(host.id, { severity: "critical" });
    await createTestAlert(host.id, { severity: "critical", packageName: "pkg-c2" });
    await createTestAlert(host.id, { severity: "high", packageName: "pkg-h1" });
    await createTestAlert(host.id, { severity: "medium", packageName: "pkg-m1" });
    await createTestAlert(host.id, { severity: "medium", packageName: "pkg-m2" });
    await createTestAlert(host.id, { severity: "medium", packageName: "pkg-m3" });

    const res = await api()
      .get("/api/v1/alerts?severity=critical,high")
      .set(h())
      .expect(200);

    expect(res.body.total).toBe(3);
    for (const alert of res.body.data) {
      expect(["critical", "high"]).toContain(alert.severity);
    }
  });

  it("should filter by acknowledged status", async () => {
    const target = await createTestScanTarget();
    const host = await createTestHost(target.id);

    const a1 = await createTestAlert(host.id, { packageName: "pkg-1" });
    await createTestAlert(host.id, { packageName: "pkg-2" });
    await createTestAlert(host.id, { packageName: "pkg-3" });

    // Acknowledge one
    const pool = getTestDb();
    await pool.query("UPDATE alerts SET acknowledged = true, acknowledged_at = NOW() WHERE id = $1", [a1.id]);

    const unackRes = await api()
      .get("/api/v1/alerts?acknowledged=false")
      .set(h())
      .expect(200);
    expect(unackRes.body.total).toBe(2);

    const ackRes = await api()
      .get("/api/v1/alerts?acknowledged=true")
      .set(h())
      .expect(200);
    expect(ackRes.body.total).toBe(1);
  });
});

// ─────────────────────────────────────────────
// PATCH /api/v1/alerts/:id/acknowledge
// ─────────────────────────────────────────────
describe("PATCH /api/v1/alerts/:id/acknowledge", () => {
  it("should acknowledge a single alert", async () => {
    const target = await createTestScanTarget();
    const host = await createTestHost(target.id);
    const alert = await createTestAlert(host.id, { severity: "high", packageName: "openssl" });

    const res = await api()
      .patch(`/api/v1/alerts/${alert.id}/acknowledge`)
      .set(h())
      .send({ acknowledgedBy: "admin", notes: "patched" })
      .expect(200);

    expect(res.body.acknowledged).toBe(true);
    expect(res.body.acknowledgedAt).not.toBeNull();
    expect(res.body.acknowledgedBy).toBe("admin");
    expect(res.body.notes).toBe("patched");
  });

  it("should be idempotent when acknowledging already-acknowledged alert", async () => {
    const target = await createTestScanTarget();
    const host = await createTestHost(target.id);
    const alert = await createTestAlert(host.id);

    // Acknowledge twice
    await api()
      .patch(`/api/v1/alerts/${alert.id}/acknowledge`)
      .set(h())
      .send({ acknowledgedBy: "admin" })
      .expect(200);

    const res = await api()
      .patch(`/api/v1/alerts/${alert.id}/acknowledge`)
      .set(h())
      .send({ acknowledgedBy: "admin2" })
      .expect(200);

    // Should still be 200 (idempotent update)
    expect(res.body.acknowledged).toBe(true);
  });
});

// ─────────────────────────────────────────────
// PATCH /api/v1/alerts/bulk-acknowledge
// ─────────────────────────────────────────────
describe("PATCH /api/v1/alerts/bulk-acknowledge", () => {
  it("should acknowledge multiple alerts", async () => {
    const target = await createTestScanTarget();
    const host = await createTestHost(target.id);

    const alerts = [];
    for (let i = 0; i < 5; i++) {
      alerts.push(await createTestAlert(host.id, { packageName: `pkg-${i}` }));
    }

    const idsToAck = alerts.slice(0, 3).map((a) => a.id);

    const res = await api()
      .patch("/api/v1/alerts/bulk-acknowledge")
      .set(h())
      .send({ alertIds: idsToAck, acknowledgedBy: "admin" })
      .expect(200);

    expect(res.body.acknowledged).toBe(3);
    expect(res.body.ids.length).toBe(3);

    // Verify the other 2 are untouched
    const pool = getTestDb();
    const remaining = await pool.query(
      "SELECT * FROM alerts WHERE acknowledged = false",
    );
    expect(remaining.rows.length).toBe(2);
  });

  it("should handle mix of valid and invalid UUIDs without crashing", async () => {
    const target = await createTestScanTarget();
    const host = await createTestHost(target.id);
    const alert = await createTestAlert(host.id);

    const res = await api()
      .patch("/api/v1/alerts/bulk-acknowledge")
      .set(h())
      .send({
        alertIds: [alert.id, "not-a-uuid", "also-bad"],
        acknowledgedBy: "admin",
      })
      .expect(200);

    // The valid one should be acknowledged
    expect(res.body.acknowledged).toBe(1);
  });

  it("should return 400 for empty array", async () => {
    await api()
      .patch("/api/v1/alerts/bulk-acknowledge")
      .set(h())
      .send({ alertIds: [] })
      .expect(400);
  });

  it("should return 400 when all UUIDs are invalid", async () => {
    await api()
      .patch("/api/v1/alerts/bulk-acknowledge")
      .set(h())
      .send({ alertIds: ["not-a-uuid", "bad-id"] })
      .expect(400);
  });
});

// ─────────────────────────────────────────────
// GET /api/v1/alerts/summary
// ─────────────────────────────────────────────
describe("GET /api/v1/alerts/summary", () => {
  it("should return correct severity breakdown", async () => {
    const target = await createTestScanTarget();
    const host = await createTestHost(target.id);

    // 2 critical, 3 high, 5 medium, 1 low = 11 total
    for (let i = 0; i < 2; i++) await createTestAlert(host.id, { severity: "critical", packageName: `crit-${i}` });
    for (let i = 0; i < 3; i++) await createTestAlert(host.id, { severity: "high", packageName: `high-${i}` });
    for (let i = 0; i < 5; i++) await createTestAlert(host.id, { severity: "medium", packageName: `med-${i}` });
    await createTestAlert(host.id, { severity: "low", packageName: "low-0" });

    const res = await api().get("/api/v1/alerts/summary").set(h()).expect(200);

    expect(res.body.total).toBe(11);
    expect(res.body.critical).toBe(2);
    expect(res.body.high).toBe(3);
    expect(res.body.medium).toBe(5);
    expect(res.body.low).toBe(1);
    expect(res.body.info).toBe(0);
    expect(res.body.unacknowledged).toBe(11);
  });
});

// ─────────────────────────────────────────────
// Cascade delete
// ─────────────────────────────────────────────
describe("Alert cascade on host deletion", () => {
  it("should cascade-delete alerts when host is deleted", async () => {
    const target = await createTestScanTarget();
    const host = await createTestHost(target.id);
    const alert = await createTestAlert(host.id);

    const pool = getTestDb();

    // Verify alert exists
    const before = await pool.query("SELECT id FROM alerts WHERE id = $1", [alert.id]);
    expect(before.rows.length).toBe(1);

    // Delete host
    await pool.query("DELETE FROM hosts WHERE id = $1", [host.id]);

    // Alert should be cascade-deleted (ON DELETE CASCADE in schema)
    const after = await pool.query("SELECT id FROM alerts WHERE id = $1", [alert.id]);
    expect(after.rows.length).toBe(0);
  });
});
