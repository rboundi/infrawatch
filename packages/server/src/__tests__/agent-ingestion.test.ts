import { describe, it, expect, beforeEach } from "vitest";
import supertest from "supertest";
import crypto from "node:crypto";
import { getTestDb } from "./setup.js";
import { getTestApp } from "./app.js";
import { createTestAdmin, getAuthToken } from "./helpers.js";

let authToken: string;

function api() {
  return supertest(getTestApp());
}

function h() {
  return { Authorization: `Bearer ${authToken}` };
}

beforeEach(async () => {
  const pool = getTestDb();
  await pool.query("DELETE FROM host_group_members");
  await pool.query("DELETE FROM host_connections");
  await pool.query("DELETE FROM services");
  await pool.query("DELETE FROM discovered_packages");
  await pool.query("DELETE FROM hosts WHERE reporting_method = 'agent'");
  await pool.query("DELETE FROM scan_targets WHERE type = 'agent'");
  await pool.query("DELETE FROM agent_tokens");

  const admin = await createTestAdmin();
  authToken = await getAuthToken(admin.username, admin.password);
});

// ─── Token Management API ───

describe("POST /api/v1/agent-tokens (create token)", () => {
  it("should create a token and return the raw value once", async () => {
    const res = await api()
      .post("/api/v1/agent-tokens")
      .set(h())
      .send({ name: "web-prod-01 agent", scope: "single" })
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe("web-prod-01 agent");
    expect(res.body.token).toMatch(/^iw_[a-f0-9]{96}$/);
    expect(res.body.scope).toBe("single");
    expect(res.body.message).toContain("cannot be retrieved");
  });

  it("should create a fleet token with allowed hostnames", async () => {
    const res = await api()
      .post("/api/v1/agent-tokens")
      .set(h())
      .send({
        name: "production fleet",
        scope: "fleet",
        allowedHostnames: ["web-01", "web-02", "web-03"],
        environmentTag: "production",
      })
      .expect(201);

    expect(res.body.scope).toBe("fleet");
  });

  it("should reject missing name", async () => {
    await api()
      .post("/api/v1/agent-tokens")
      .set(h())
      .send({ scope: "single" })
      .expect(400);
  });

  it("should reject invalid scope", async () => {
    await api()
      .post("/api/v1/agent-tokens")
      .set(h())
      .send({ name: "test", scope: "invalid" })
      .expect(400);
  });
});

describe("GET /api/v1/agent-tokens (list)", () => {
  it("should list tokens without exposing raw token value", async () => {
    // Create two tokens
    await api().post("/api/v1/agent-tokens").set(h()).send({ name: "token-1" });
    await api().post("/api/v1/agent-tokens").set(h()).send({ name: "token-2" });

    const res = await api().get("/api/v1/agent-tokens").set(h()).expect(200);

    expect(res.body.length).toBeGreaterThanOrEqual(2);
    // Verify no raw token values in the list
    for (const t of res.body) {
      expect(t.token).toBeUndefined();
      expect(t.tokenHash).toBeUndefined();
    }
  });
});

describe("GET /api/v1/agent-tokens/:id (detail)", () => {
  it("should return token detail with host count", async () => {
    const createRes = await api()
      .post("/api/v1/agent-tokens")
      .set(h())
      .send({ name: "detail-test" })
      .expect(201);

    const res = await api()
      .get(`/api/v1/agent-tokens/${createRes.body.id}`)
      .set(h())
      .expect(200);

    expect(res.body.name).toBe("detail-test");
    expect(res.body.hostCount).toBe(0);
    expect(res.body.lastUsedIp).toBeNull();
  });

  it("should return 404 for non-existent token", async () => {
    await api()
      .get("/api/v1/agent-tokens/00000000-0000-0000-0000-000000000000")
      .set(h())
      .expect(404);
  });
});

describe("PATCH /api/v1/agent-tokens/:id (update)", () => {
  it("should update token name and environmentTag", async () => {
    const createRes = await api()
      .post("/api/v1/agent-tokens")
      .set(h())
      .send({ name: "old-name" })
      .expect(201);

    const res = await api()
      .patch(`/api/v1/agent-tokens/${createRes.body.id}`)
      .set(h())
      .send({ name: "new-name", environmentTag: "staging" })
      .expect(200);

    expect(res.body.name).toBe("new-name");
    expect(res.body.environmentTag).toBe("staging");
  });
});

describe("DELETE /api/v1/agent-tokens/:id (deactivate)", () => {
  it("should deactivate token (soft delete)", async () => {
    const createRes = await api()
      .post("/api/v1/agent-tokens")
      .set(h())
      .send({ name: "to-delete" })
      .expect(201);

    await api()
      .delete(`/api/v1/agent-tokens/${createRes.body.id}`)
      .set(h())
      .expect(200);

    // Token should now be inactive
    const detail = await api()
      .get(`/api/v1/agent-tokens/${createRes.body.id}`)
      .set(h())
      .expect(200);

    expect(detail.body.isActive).toBe(false);
  });
});

describe("POST /api/v1/agent-tokens/:id/rotate", () => {
  it("should generate a new token and deactivate the old one", async () => {
    const createRes = await api()
      .post("/api/v1/agent-tokens")
      .set(h())
      .send({ name: "rotate-me", scope: "fleet", environmentTag: "prod" })
      .expect(201);

    const oldId = createRes.body.id;
    const oldToken = createRes.body.token;

    const rotateRes = await api()
      .post(`/api/v1/agent-tokens/${oldId}/rotate`)
      .set(h())
      .expect(200);

    // New token returned
    expect(rotateRes.body.token).toMatch(/^iw_/);
    expect(rotateRes.body.token).not.toBe(oldToken);
    expect(rotateRes.body.name).toBe("rotate-me");
    expect(rotateRes.body.id).not.toBe(oldId);

    // Old token should be deactivated
    const oldDetail = await api()
      .get(`/api/v1/agent-tokens/${oldId}`)
      .set(h())
      .expect(200);

    expect(oldDetail.body.isActive).toBe(false);
  });
});

describe("POST /api/v1/agent-tokens/:id/revoke", () => {
  it("should immediately deactivate the token", async () => {
    const createRes = await api()
      .post("/api/v1/agent-tokens")
      .set(h())
      .send({ name: "revoke-me" })
      .expect(201);

    await api()
      .post(`/api/v1/agent-tokens/${createRes.body.id}/revoke`)
      .set(h())
      .expect(200);

    // Reports with revoked token should be rejected
    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${createRes.body.token}` })
      .send({ hostname: "test-host" })
      .expect(401);
  });
});

// ─── Agent Report Endpoint ───

describe("POST /api/v1/agent/report", () => {
  it("should reject requests without Authorization header", async () => {
    await api()
      .post("/api/v1/agent/report")
      .send({ hostname: "test" })
      .expect(401);
  });

  it("should reject invalid token", async () => {
    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: "Bearer iw_invalidtoken" })
      .send({ hostname: "test" })
      .expect(401);
  });

  it("should accept a valid agent report and ingest data", async () => {
    // Create token
    const tokenRes = await api()
      .post("/api/v1/agent-tokens")
      .set(h())
      .send({ name: "test-agent", scope: "single", environmentTag: "testing" })
      .expect(201);

    const agentToken = tokenRes.body.token;

    // Submit report
    const res = await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${agentToken}` })
      .send({
        agentVersion: "1.0.0",
        hostname: "web-prod-01",
        ip: "192.168.1.10",
        os: "Ubuntu",
        osVersion: "22.04",
        arch: "x86_64",
        packages: [
          { name: "nginx", version: "1.24.0", manager: "apt", ecosystem: "debian" },
          { name: "openssl", version: "3.0.2", manager: "apt", ecosystem: "debian" },
        ],
        services: [
          { name: "nginx", type: "webserver", version: "1.24.0", port: 80, status: "running" },
        ],
        metadata: {
          uptime: "45 days",
          kernelVersion: "5.15.0-91-generic",
        },
      })
      .expect(200);

    expect(res.body.received).toBe(true);
    expect(res.body.hostname).toBe("web-prod-01");
    expect(res.body.packagesCount).toBe(2);
    expect(res.body.servicesCount).toBe(1);

    // Verify host was created with agent fields
    const pool = getTestDb();
    const hostResult = await pool.query(
      `SELECT hostname, reporting_method, agent_version, environment_tag
       FROM hosts WHERE hostname = 'web-prod-01' AND reporting_method = 'agent'`
    );

    expect(hostResult.rows.length).toBe(1);
    expect(hostResult.rows[0].reporting_method).toBe("agent");
    expect(hostResult.rows[0].agent_version).toBe("1.0.0");
    expect(hostResult.rows[0].environment_tag).toBe("testing");

    // Verify token usage was recorded
    const tokenDetail = await api()
      .get(`/api/v1/agent-tokens/${tokenRes.body.id}`)
      .set(h())
      .expect(200);

    expect(tokenDetail.body.reportCount).toBe(1);
    expect(tokenDetail.body.hostCount).toBe(1);
  });

  it("should lock single-scope token to first hostname", async () => {
    const tokenRes = await api()
      .post("/api/v1/agent-tokens")
      .set(h())
      .send({ name: "single-lock", scope: "single" })
      .expect(201);

    const agentToken = tokenRes.body.token;

    // First report — locks hostname
    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${agentToken}` })
      .send({ hostname: "host-A", os: "Ubuntu", osVersion: "22.04" })
      .expect(200);

    // Second report from different hostname — rejected
    const res = await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${agentToken}` })
      .send({ hostname: "host-B", os: "Ubuntu", osVersion: "22.04" })
      .expect(403);

    expect(res.body.error).toContain("locked to hostname");
  });

  it("should allow fleet token for any hostname", async () => {
    const tokenRes = await api()
      .post("/api/v1/agent-tokens")
      .set(h())
      .send({ name: "fleet-token", scope: "fleet" })
      .expect(201);

    const agentToken = tokenRes.body.token;

    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${agentToken}` })
      .send({ hostname: "host-A", os: "Ubuntu", osVersion: "22.04" })
      .expect(200);

    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${agentToken}` })
      .send({ hostname: "host-B", os: "CentOS", osVersion: "9" })
      .expect(200);
  });

  it("should enforce fleet token allowed_hostnames", async () => {
    const tokenRes = await api()
      .post("/api/v1/agent-tokens")
      .set(h())
      .send({
        name: "restricted-fleet",
        scope: "fleet",
        allowedHostnames: ["web-01", "web-02"],
      })
      .expect(201);

    const agentToken = tokenRes.body.token;

    // Allowed hostname
    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${agentToken}` })
      .send({ hostname: "web-01", os: "Ubuntu", osVersion: "22.04" })
      .expect(200);

    // Not in allowed list
    const res = await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${agentToken}` })
      .send({ hostname: "db-01", os: "Ubuntu", osVersion: "22.04" })
      .expect(403);

    expect(res.body.error).toContain("not in allowed list");
  });

  it("should reject expired token", async () => {
    const pool = getTestDb();

    // Create token with already-expired date
    const tokenHash = crypto.createHash("sha256").update("expiredtoken").digest("hex");
    await pool.query(
      `INSERT INTO agent_tokens (token_hash, name, scope, is_active, expires_at)
       VALUES ($1, 'expired', 'single', true, NOW() - INTERVAL '1 hour')`,
      [tokenHash],
    );

    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: "Bearer iw_expiredtoken" })
      .send({ hostname: "test" })
      .expect(401);
  });

  it("should require hostname in body", async () => {
    const tokenRes = await api()
      .post("/api/v1/agent-tokens")
      .set(h())
      .send({ name: "no-host-test" })
      .expect(201);

    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${tokenRes.body.token}` })
      .send({ os: "Ubuntu" })
      .expect(400);
  });
});

// ─── Agent Heartbeat Endpoint ───

describe("POST /api/v1/agent/heartbeat", () => {
  it("should update host last_seen_at without full ingestion", async () => {
    const tokenRes = await api()
      .post("/api/v1/agent-tokens")
      .set(h())
      .send({ name: "heartbeat-test", scope: "single" })
      .expect(201);

    const agentToken = tokenRes.body.token;

    // Send initial report to create host
    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${agentToken}` })
      .send({
        hostname: "heartbeat-host",
        os: "Ubuntu",
        osVersion: "22.04",
        packages: [{ name: "curl", version: "7.81.0", manager: "apt", ecosystem: "debian" }],
      })
      .expect(200);

    // Send heartbeat
    const res = await api()
      .post("/api/v1/agent/heartbeat")
      .set({ Authorization: `Bearer ${agentToken}` })
      .send({ hostname: "heartbeat-host", agentVersion: "1.1.0" })
      .expect(200);

    expect(res.body.received).toBe(true);
    expect(res.body.hostname).toBe("heartbeat-host");

    // Verify agent_version was updated
    const pool = getTestDb();
    const hostResult = await pool.query(
      `SELECT agent_version, status FROM hosts WHERE hostname = 'heartbeat-host' AND reporting_method = 'agent'`
    );

    expect(hostResult.rows[0].agent_version).toBe("1.1.0");
    expect(hostResult.rows[0].status).toBe("active");
  });

  it("should reject heartbeat without prior report", async () => {
    const tokenRes = await api()
      .post("/api/v1/agent-tokens")
      .set(h())
      .send({ name: "no-report-test" })
      .expect(201);

    const res = await api()
      .post("/api/v1/agent/heartbeat")
      .set({ Authorization: `Bearer ${tokenRes.body.token}` })
      .send({ hostname: "unknown-host" })
      .expect(200);

    expect(res.body.message).toContain("full report first");
  });

  it("should reject heartbeat with invalid token", async () => {
    await api()
      .post("/api/v1/agent/heartbeat")
      .set({ Authorization: "Bearer iw_bogus" })
      .send({ hostname: "test" })
      .expect(401);
  });
});

// ─── Token Hashing ───

describe("Token security", () => {
  it("should store only the hash, never the raw token", async () => {
    const createRes = await api()
      .post("/api/v1/agent-tokens")
      .set(h())
      .send({ name: "hash-test" })
      .expect(201);

    const rawToken = createRes.body.token;
    const pool = getTestDb();

    const dbRow = await pool.query(
      `SELECT token_hash FROM agent_tokens WHERE id = $1`,
      [createRes.body.id],
    );

    // Hash in DB should not equal the raw token
    expect(dbRow.rows[0].token_hash).not.toBe(rawToken);
    expect(dbRow.rows[0].token_hash).not.toContain("iw_");

    // It should be the SHA-256 of the raw hex (without prefix)
    const expectedHash = crypto
      .createHash("sha256")
      .update(rawToken.slice(3)) // strip "iw_"
      .digest("hex");

    expect(dbRow.rows[0].token_hash).toBe(expectedHash);
  });
});
