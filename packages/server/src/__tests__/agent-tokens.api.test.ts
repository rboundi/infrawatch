import { describe, it, expect, beforeEach } from "vitest";
import supertest from "supertest";
import crypto from "node:crypto";
import { getTestDb } from "./setup.js";
import { getTestApp } from "./app.js";
import { createTestAdmin, createTestUser, getAuthToken } from "./helpers.js";

let authToken: string;

function api() {
  return supertest(getTestApp());
}

function h() {
  return { Authorization: `Bearer ${authToken}` };
}

beforeEach(async () => {
  const admin = await createTestAdmin();
  authToken = await getAuthToken(admin.username, admin.password);
});

// ─── Token Creation ───

describe("POST /api/v1/agent-tokens (create)", () => {
  it("should create a single-scope token with iw_ prefix and correct length", async () => {
    const res = await api()
      .post("/api/v1/agent-tokens")
      .set(h())
      .send({ name: "web-01 agent", scope: "single" })
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe("web-01 agent");
    expect(res.body.token).toBeDefined();
    expect(res.body.token).toMatch(/^iw_/);
    // 48 bytes = 96 hex chars + "iw_" prefix = 99 chars total
    expect(res.body.token.length).toBe(99);
    expect(res.body.scope).toBe("single");
    expect(res.body.message).toContain("cannot be retrieved");
  });

  it("should store SHA-256 hash, not the raw token", async () => {
    const res = await api()
      .post("/api/v1/agent-tokens")
      .set(h())
      .send({ name: "hash-verify" })
      .expect(201);

    const rawToken = res.body.token;
    const pool = getTestDb();
    const dbRow = await pool.query(
      "SELECT token_hash FROM agent_tokens WHERE id = $1",
      [res.body.id],
    );

    const hash = dbRow.rows[0].token_hash;
    // Hash must not be the raw token
    expect(hash).not.toBe(rawToken);
    expect(hash).not.toContain("iw_");
    // Verify it matches SHA-256 of the hex portion
    const expected = crypto
      .createHash("sha256")
      .update(rawToken.slice(3))
      .digest("hex");
    expect(hash).toBe(expected);
  });

  it("should create a fleet-scope token with allowed hostnames", async () => {
    const res = await api()
      .post("/api/v1/agent-tokens")
      .set(h())
      .send({
        name: "prod fleet",
        scope: "fleet",
        allowedHostnames: ["web-01", "web-02", "web-03"],
      })
      .expect(201);

    expect(res.body.scope).toBe("fleet");

    // Verify stored in DB
    const pool = getTestDb();
    const dbRow = await pool.query(
      "SELECT allowed_hostnames FROM agent_tokens WHERE id = $1",
      [res.body.id],
    );
    expect(dbRow.rows[0].allowed_hostnames).toEqual(["web-01", "web-02", "web-03"]);
  });

  it("should create token with environment tag and host group IDs", async () => {
    // Create a host group first
    const pool = getTestDb();
    const groupRes = await pool.query(
      "INSERT INTO host_groups (name) VALUES ('test-group') RETURNING id",
    );
    const groupId = groupRes.rows[0].id;

    const res = await api()
      .post("/api/v1/agent-tokens")
      .set(h())
      .send({
        name: "staging-token",
        scope: "fleet",
        environmentTag: "staging",
        hostGroupIds: [groupId],
      })
      .expect(201);

    // Verify stored
    const detail = await api()
      .get(`/api/v1/agent-tokens/${res.body.id}`)
      .set(h())
      .expect(200);

    expect(detail.body.environmentTag).toBe("staging");
    expect(detail.body.hostGroupIds).toContain(groupId);
  });

  it("should create token with expiry date", async () => {
    const expiresAt = "2026-12-31T00:00:00.000Z";
    const res = await api()
      .post("/api/v1/agent-tokens")
      .set(h())
      .send({ name: "expiring-token", expiresAt })
      .expect(201);

    const detail = await api()
      .get(`/api/v1/agent-tokens/${res.body.id}`)
      .set(h())
      .expect(200);

    expect(detail.body.expiresAt).toBe(expiresAt);
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
      .send({ name: "bad-scope", scope: "invalid" })
      .expect(400);
  });
});

// ─── Token Listing ───

describe("GET /api/v1/agent-tokens (list)", () => {
  it("should list tokens without ever returning the raw token", async () => {
    await api().post("/api/v1/agent-tokens").set(h()).send({ name: "tok-1" });
    await api().post("/api/v1/agent-tokens").set(h()).send({ name: "tok-2" });
    await api().post("/api/v1/agent-tokens").set(h()).send({ name: "tok-3" });

    const res = await api().get("/api/v1/agent-tokens").set(h()).expect(200);

    expect(res.body.length).toBe(3);
    for (const t of res.body) {
      expect(t.token).toBeUndefined();
      expect(t.tokenHash).toBeUndefined();
      expect(t.id).toBeDefined();
      expect(t.name).toBeDefined();
      expect(t.scope).toBeDefined();
      expect(typeof t.isActive).toBe("boolean");
      expect(t.reportCount).toBeDefined();
    }
  });
});

// ─── Token Detail ───

describe("GET /api/v1/agent-tokens/:id (detail)", () => {
  it("should return detail with host count", async () => {
    const res = await api()
      .post("/api/v1/agent-tokens")
      .set(h())
      .send({ name: "detail-test" })
      .expect(201);

    const detail = await api()
      .get(`/api/v1/agent-tokens/${res.body.id}`)
      .set(h())
      .expect(200);

    expect(detail.body.name).toBe("detail-test");
    expect(detail.body.hostCount).toBe(0);
    expect(detail.body.lastUsedIp).toBeNull();
    expect(detail.body.token).toBeUndefined();
  });

  it("should return 404 for non-existent token", async () => {
    await api()
      .get("/api/v1/agent-tokens/00000000-0000-0000-0000-000000000000")
      .set(h())
      .expect(404);
  });
});

// ─── Token Update ───

describe("PATCH /api/v1/agent-tokens/:id (update)", () => {
  it("should update name and environmentTag", async () => {
    const createRes = await api()
      .post("/api/v1/agent-tokens")
      .set(h())
      .send({ name: "old-name", scope: "single" })
      .expect(201);

    const res = await api()
      .patch(`/api/v1/agent-tokens/${createRes.body.id}`)
      .set(h())
      .send({ name: "renamed", environmentTag: "production" })
      .expect(200);

    expect(res.body.name).toBe("renamed");
    expect(res.body.environmentTag).toBe("production");
    // Scope should remain unchanged
    expect(res.body.scope).toBe("single");
  });

  it("should return 404 for non-existent token", async () => {
    await api()
      .patch("/api/v1/agent-tokens/00000000-0000-0000-0000-000000000000")
      .set(h())
      .send({ name: "nope" })
      .expect(404);
  });
});

// ─── Token Rotation ───

describe("POST /api/v1/agent-tokens/:id/rotate", () => {
  it("should generate new token, deactivate old, preserve settings", async () => {
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

    // Old token deactivated
    const oldDetail = await api()
      .get(`/api/v1/agent-tokens/${oldId}`)
      .set(h())
      .expect(200);
    expect(oldDetail.body.isActive).toBe(false);

    // Old token no longer works for reports
    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${oldToken}` })
      .send({ hostname: "test", os: "Ubuntu" })
      .expect(401);

    // New token works
    const reportRes = await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${rotateRes.body.token}` })
      .send({ hostname: "test-host", os: "Ubuntu", osVersion: "22.04" })
      .expect(200);
    expect(reportRes.body.received).toBe(true);
  });

  it("should return 404 for non-existent token", async () => {
    await api()
      .post("/api/v1/agent-tokens/00000000-0000-0000-0000-000000000000/rotate")
      .set(h())
      .expect(404);
  });
});

// ─── Token Revocation ───

describe("POST /api/v1/agent-tokens/:id/revoke", () => {
  it("should immediately deactivate and reject future reports", async () => {
    const createRes = await api()
      .post("/api/v1/agent-tokens")
      .set(h())
      .send({ name: "revoke-me" })
      .expect(201);

    await api()
      .post(`/api/v1/agent-tokens/${createRes.body.id}/revoke`)
      .set(h())
      .expect(200);

    // Token deactivated
    const detail = await api()
      .get(`/api/v1/agent-tokens/${createRes.body.id}`)
      .set(h())
      .expect(200);
    expect(detail.body.isActive).toBe(false);

    // Reports rejected
    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${createRes.body.token}` })
      .send({ hostname: "test-host" })
      .expect(401);
  });
});

// ─── Token Deletion ───

describe("DELETE /api/v1/agent-tokens/:id (soft delete)", () => {
  it("should deactivate token but hosts remain", async () => {
    const createRes = await api()
      .post("/api/v1/agent-tokens")
      .set(h())
      .send({ name: "delete-test", scope: "single" })
      .expect(201);

    const agentToken = createRes.body.token;

    // Report a host
    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${agentToken}` })
      .send({ hostname: "orphan-host", os: "Ubuntu", osVersion: "22.04" })
      .expect(200);

    // Soft-delete the token
    await api()
      .delete(`/api/v1/agent-tokens/${createRes.body.id}`)
      .set(h())
      .expect(200);

    // Host should still exist
    const pool = getTestDb();
    const hostResult = await pool.query(
      "SELECT id, hostname, agent_token_id FROM hosts WHERE hostname = 'orphan-host'",
    );
    expect(hostResult.rows.length).toBe(1);
    expect(hostResult.rows[0].hostname).toBe("orphan-host");
    // agent_token_id should still reference the soft-deleted token (it's deactivated, not hard-deleted)
    expect(hostResult.rows[0].agent_token_id).toBe(createRes.body.id);
  });
});

// ─── Operator Access Control ───

describe("Operator cannot manage tokens", () => {
  let operatorToken: string;

  beforeEach(async () => {
    const op = await createTestUser({ role: "operator" });
    operatorToken = await getAuthToken(op.username, op.password);
  });

  it("operator should be rejected from creating tokens (403)", async () => {
    const res = await api()
      .post("/api/v1/agent-tokens")
      .set({ Authorization: `Bearer ${operatorToken}` })
      .send({ name: "nope" });

    expect(res.status).toBe(403);
  });

  it("operator should be rejected from listing tokens (403)", async () => {
    const res = await api()
      .get("/api/v1/agent-tokens")
      .set({ Authorization: `Bearer ${operatorToken}` });

    expect(res.status).toBe(403);
  });

  it("operator should be rejected from updating tokens (403)", async () => {
    // Create a token as admin first
    const createRes = await api()
      .post("/api/v1/agent-tokens")
      .set(h())
      .send({ name: "admin-token" })
      .expect(201);

    const res = await api()
      .patch(`/api/v1/agent-tokens/${createRes.body.id}`)
      .set({ Authorization: `Bearer ${operatorToken}` })
      .send({ name: "hacked" });

    expect(res.status).toBe(403);
  });

  it("operator should be rejected from rotating tokens (403)", async () => {
    const createRes = await api()
      .post("/api/v1/agent-tokens")
      .set(h())
      .send({ name: "admin-token" })
      .expect(201);

    const res = await api()
      .post(`/api/v1/agent-tokens/${createRes.body.id}/rotate`)
      .set({ Authorization: `Bearer ${operatorToken}` });

    expect(res.status).toBe(403);
  });

  it("operator should be rejected from revoking tokens (403)", async () => {
    const createRes = await api()
      .post("/api/v1/agent-tokens")
      .set(h())
      .send({ name: "admin-token" })
      .expect(201);

    const res = await api()
      .post(`/api/v1/agent-tokens/${createRes.body.id}/revoke`)
      .set({ Authorization: `Bearer ${operatorToken}` });

    expect(res.status).toBe(403);
  });
});

// ─── Agent Health Endpoint ───

describe("GET /api/v1/agent-tokens/health/hosts", () => {
  it("should return health data for agent-reported hosts", async () => {
    // Create a token and report a host
    const tokenRes = await api()
      .post("/api/v1/agent-tokens")
      .set(h())
      .send({ name: "health-test" })
      .expect(201);

    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${tokenRes.body.token}` })
      .send({ hostname: "health-host", os: "Ubuntu", osVersion: "22.04", agentVersion: "1.0.0" })
      .expect(200);

    const res = await api()
      .get("/api/v1/agent-tokens/health/hosts")
      .set(h())
      .expect(200);

    expect(res.body.hosts).toBeDefined();
    expect(res.body.summary).toBeDefined();
    expect(res.body.thresholds).toBeDefined();
    expect(res.body.summary.total).toBeGreaterThanOrEqual(1);

    const host = res.body.hosts.find((h: { hostname: string }) => h.hostname === "health-host");
    expect(host).toBeDefined();
    expect(host.healthStatus).toBe("healthy");
    expect(host.agentVersion).toBe("1.0.0");
    expect(host.tokenName).toBe("health-test");
  });

  it("should return empty when no agent hosts exist", async () => {
    const res = await api()
      .get("/api/v1/agent-tokens/health/hosts")
      .set(h())
      .expect(200);

    expect(res.body.summary.total).toBe(0);
    expect(res.body.hosts).toHaveLength(0);
  });
});
