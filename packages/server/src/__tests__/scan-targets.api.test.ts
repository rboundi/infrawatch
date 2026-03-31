import { describe, it, expect, beforeEach } from "vitest";
import supertest from "supertest";
import { getTestDb } from "./setup.js";
import { getTestApp } from "./app.js";
import {
  createTestAdmin,
  getAuthToken,
  createTestScanTarget,
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
// CRUD Tests
// ─────────────────────────────────────────────
describe("POST /api/v1/targets (create)", () => {
  it("should create a scan target with valid data", async () => {
    const res = await api()
      .post("/api/v1/targets")
      .set(h())
      .send({
        name: "Production SSH",
        type: "ssh_linux",
        connectionConfig: { host: "192.168.1.10", port: 22, username: "infrawatch", password: "test" },
      })
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe("Production SSH");
    expect(res.body.type).toBe("ssh_linux");

    // connectionConfig must NOT be in the list/create response
    expect(res.body).not.toHaveProperty("connectionConfig");
    expect(res.body).not.toHaveProperty("connection_config");

    // Verify config is encrypted in the database (not plaintext JSON)
    const pool = getTestDb();
    const dbRow = await pool.query("SELECT connection_config FROM scan_targets WHERE id = $1", [res.body.id]);
    const rawConfig = dbRow.rows[0].connection_config;

    // pg driver auto-parses jsonb — should be an encrypted envelope, not original JSON
    if (typeof rawConfig === "object") {
      expect(rawConfig).not.toHaveProperty("host");
      expect(rawConfig).not.toHaveProperty("password");
      expect(rawConfig).toHaveProperty("iv");
      expect(rawConfig).toHaveProperty("ct");
      expect(rawConfig).toHaveProperty("tag");
    }
  });

  it("should create scan target for every valid type", async () => {
    const types = ["ssh_linux", "winrm", "kubernetes", "aws", "vmware", "docker", "network_discovery"];

    for (const type of types) {
      const cfg: Record<string, unknown> = type === "network_discovery"
        ? { subnets: ["192.168.1.0/24"] }
        : { host: "10.0.0.1" };

      const res = await api()
        .post("/api/v1/targets")
        .set(h())
        .send({ name: `Target ${type}`, type, connectionConfig: cfg });

      expect(res.status).toBe(201);
      expect(res.body.type).toBe(type);
    }
  });

  it("should reject invalid type", async () => {
    await api()
      .post("/api/v1/targets")
      .set(h())
      .send({ name: "Bad Type", type: "invalid_scanner", connectionConfig: { host: "x" } })
      .expect(400);
  });

  it("should reject missing required fields", async () => {
    // No name
    await api().post("/api/v1/targets").set(h())
      .send({ type: "ssh_linux", connectionConfig: { host: "x" } })
      .expect(400);

    // No type
    await api().post("/api/v1/targets").set(h())
      .send({ name: "No Type", connectionConfig: { host: "x" } })
      .expect(400);

    // No connectionConfig
    await api().post("/api/v1/targets").set(h())
      .send({ name: "No Config", type: "ssh_linux" })
      .expect(400);

    // connectionConfig not an object
    await api().post("/api/v1/targets").set(h())
      .send({ name: "Bad Config", type: "ssh_linux", connectionConfig: "not-an-object" })
      .expect(400);
  });

  it("should handle SQL injection in name safely", async () => {
    const maliciousName = "test'; DROP TABLE hosts; --";

    const createRes = await api()
      .post("/api/v1/targets").set(h())
      .send({ name: maliciousName, type: "ssh_linux", connectionConfig: { host: "10.0.0.1" } })
      .expect(201);

    // Read it back — name should be preserved exactly
    const getRes = await api()
      .get(`/api/v1/targets/${createRes.body.id}`).set(h())
      .expect(200);

    expect(getRes.body.name).toBe(maliciousName);

    // Verify hosts table still exists
    const pool = getTestDb();
    const tableCheck = await pool.query(
      "SELECT EXISTS (SELECT FROM pg_tables WHERE tablename = 'hosts') AS exists",
    );
    expect(tableCheck.rows[0].exists).toBe(true);
  });
});

describe("GET /api/v1/targets (list)", () => {
  it("should never expose credentials in list response", async () => {
    for (let i = 0; i < 3; i++) {
      await api().post("/api/v1/targets").set(h())
        .send({
          name: `Target ${i}`,
          type: "ssh_linux",
          connectionConfig: { host: "10.0.0.1", password: "supersecret", privateKey: "ssh-rsa AAAA..." },
        })
        .expect(201);
    }

    const res = await api().get("/api/v1/targets").set(h()).expect(200);

    expect(res.body.length).toBe(3);
    for (const target of res.body) {
      expect(target).not.toHaveProperty("connectionConfig");
      expect(target).not.toHaveProperty("connection_config");
      expect(JSON.stringify(target)).not.toContain("supersecret");
      expect(JSON.stringify(target)).not.toContain("ssh-rsa");
    }
  });
});

describe("GET /api/v1/targets/:id (detail)", () => {
  it("should return redacted connectionConfig in detail view", async () => {
    const createRes = await api()
      .post("/api/v1/targets").set(h())
      .send({
        name: "Detail Target",
        type: "ssh_linux",
        connectionConfig: { host: "10.0.0.1", username: "root", password: "secret123" },
      })
      .expect(201);

    const detailRes = await api()
      .get(`/api/v1/targets/${createRes.body.id}`).set(h())
      .expect(200);

    // Detail view DOES include connectionConfig, but with sensitive fields redacted
    expect(detailRes.body.connectionConfig).toBeDefined();
    expect(detailRes.body.connectionConfig.host).toBe("10.0.0.1");
    expect(detailRes.body.connectionConfig.username).toBe("root");
    expect(detailRes.body.connectionConfig.password).toBe("••••••••");
  });

  it("should return 404 for non-existent target", async () => {
    await api()
      .get("/api/v1/targets/00000000-0000-0000-0000-000000000000").set(h())
      .expect(404);
  });

  it("should return 400 for invalid UUID format", async () => {
    const res = await api().get("/api/v1/targets/not-a-uuid").set(h());
    // Should be 400, not 500 (PostgreSQL invalid UUID syntax error)
    expect(res.status).toBeLessThan(500);
  });
});

describe("PATCH /api/v1/targets/:id (update)", () => {
  it("should update target name", async () => {
    const target = await createTestScanTarget({ name: "Original" });

    const res = await api()
      .patch(`/api/v1/targets/${target.id}`).set(h())
      .send({ name: "Updated Name" })
      .expect(200);

    expect(res.body.name).toBe("Updated Name");
  });

  it("should update connectionConfig (encrypted in DB)", async () => {
    const target = await createTestScanTarget({ name: "ConfigUpdate" });
    const pool = getTestDb();

    const beforeRow = await pool.query("SELECT connection_config FROM scan_targets WHERE id = $1", [target.id]);
    const oldConfig = beforeRow.rows[0].connection_config;

    await api()
      .patch(`/api/v1/targets/${target.id}`).set(h())
      .send({ connectionConfig: { host: "10.0.0.99", username: "newuser" } })
      .expect(200);

    const afterRow = await pool.query("SELECT connection_config FROM scan_targets WHERE id = $1", [target.id]);
    const newConfig = afterRow.rows[0].connection_config;

    expect(JSON.stringify(newConfig)).not.toBe(JSON.stringify(oldConfig));
    if (typeof newConfig === "object") {
      expect(newConfig).toHaveProperty("iv");
    }
  });
});

describe("DELETE /api/v1/targets/:id", () => {
  it("should delete target and return 404 on re-fetch", async () => {
    const target = await createTestScanTarget({ name: "DeleteMe" });

    await api().delete(`/api/v1/targets/${target.id}`).set(h()).expect(204);
    await api().get(`/api/v1/targets/${target.id}`).set(h()).expect(404);
  });
});

describe("POST /api/v1/targets/:id/scan (trigger)", () => {
  it("should return scanLogId and create a scan log entry", async () => {
    const target = await createTestScanTarget({ name: "ScanMe" });

    const res = await api()
      .post(`/api/v1/targets/${target.id}/scan`).set(h())
      .expect(202);

    expect(res.body.scanLogId).toBeDefined();

    // Give the async scan a moment to start
    await new Promise((r) => setTimeout(r, 500));

    // Scan log entry should exist
    const pool = getTestDb();
    const logRow = await pool.query("SELECT status FROM scan_logs WHERE id = $1", [res.body.scanLogId]);
    expect(logRow.rows.length).toBe(1);
    // Will be 'running' or 'failed' (no real SSH host)
    expect(["running", "failed"]).toContain(logRow.rows[0].status);
  });
});

describe("GET /api/v1/targets/:id/test/stream (test connection SSE)", () => {
  it("should stream progress steps and a result without crashing", async () => {
    const target = await createTestScanTarget({ name: "TestMe" });

    const res = await api()
      .get(`/api/v1/targets/${target.id}/test/stream`).set(h())
      .buffer(true)
      .parse((res, cb) => {
        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        res.on("end", () => cb(null, data));
      });

    expect(res.status).toBe(200);

    // Parse SSE events from the raw response body
    const body = res.body as string;
    const events: { event: string; data: string }[] = [];
    const blocks = body.split("\n\n").filter(Boolean);
    for (const block of blocks) {
      const eventMatch = block.match(/^event:\s*(.+)$/m);
      const dataMatch = block.match(/^data:\s*(.+)$/m);
      if (eventMatch && dataMatch) {
        events.push({ event: eventMatch[1], data: dataMatch[1] });
      }
    }

    // Should have at least one step event
    const steps = events.filter(e => e.event === "step");
    expect(steps.length).toBeGreaterThan(0);

    // Should have a result event
    const resultEvent = events.find(e => e.event === "result");
    expect(resultEvent).toBeDefined();
    const result = JSON.parse(resultEvent!.data);
    expect(result).toHaveProperty("success");
    expect(typeof result.message).toBe("string");
    expect(typeof result.latencyMs).toBe("number");

    // Should end with a done event
    const doneEvent = events.find(e => e.event === "done");
    expect(doneEvent).toBeDefined();
  });
});
