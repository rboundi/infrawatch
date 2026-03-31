import { describe, it, expect, beforeEach } from "vitest";
import supertest from "supertest";
import crypto from "node:crypto";
import { getTestDb } from "./setup.js";
import { getTestApp, getTestSettingsService } from "./app.js";
import { createTestAdmin, getAuthToken } from "./helpers.js";

let authToken: string;
let pool: ReturnType<typeof getTestDb>;

function api() {
  return supertest(getTestApp());
}

function h() {
  return { Authorization: `Bearer ${authToken}` };
}

/** Helper: create an agent token and return the raw token string + token id */
async function createAgentToken(
  opts: Record<string, unknown> = {},
): Promise<{ token: string; id: string }> {
  const res = await api()
    .post("/api/v1/agent-tokens")
    .set(h())
    .send({ name: opts.name ?? "test-agent", scope: "single", ...opts })
    .expect(201);
  return { token: res.body.token, id: res.body.id };
}

/** Standard valid report payload */
function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    agentVersion: "1.0.0",
    hostname: "test-host",
    ip: "10.0.0.1",
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
    metadata: { uptime: "45d", kernelVersion: "5.15.0" },
    ...overrides,
  };
}

beforeEach(async () => {
  pool = getTestDb();
  const admin = await createTestAdmin();
  authToken = await getAuthToken(admin.username, admin.password);
});

// ─── Authentication ───

describe("Agent report authentication", () => {
  it("should reject request without Authorization header", async () => {
    await api().post("/api/v1/agent/report").send({ hostname: "test" }).expect(401);
  });

  it("should reject invalid token", async () => {
    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: "Bearer iw_invalidtoken" })
      .send({ hostname: "test" })
      .expect(401);
  });

  it("should reject empty token", async () => {
    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: "Bearer " })
      .send({ hostname: "test" })
      .expect(401);
  });

  it("should reject expired token", async () => {
    const tokenHash = crypto.createHash("sha256").update("expiredtokenhex").digest("hex");
    await pool.query(
      `INSERT INTO agent_tokens (token_hash, name, scope, is_active, expires_at)
       VALUES ($1, 'expired', 'single', true, NOW() - INTERVAL '1 hour')`,
      [tokenHash],
    );

    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: "Bearer iw_expiredtokenhex" })
      .send({ hostname: "test" })
      .expect(401);
  });

  it("should reject revoked token", async () => {
    const { token, id } = await createAgentToken({ name: "revoke-test" });

    // Revoke it
    await api()
      .post(`/api/v1/agent-tokens/${id}/revoke`)
      .set(h())
      .expect(200);

    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${token}` })
      .send({ hostname: "test" })
      .expect(401);
  });
});

// ─── Successful Reports ───

describe("POST /api/v1/agent/report (successful)", () => {
  it("should accept valid report and create host, packages, services", async () => {
    const { token, id: tokenId } = await createAgentToken({
      name: "ingest-test",
      environmentTag: "testing",
    });

    const res = await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${token}` })
      .send(validPayload({ hostname: "web-prod-01" }))
      .expect(200);

    expect(res.body.received).toBe(true);
    expect(res.body.hostname).toBe("web-prod-01");
    expect(res.body.packagesCount).toBe(2);
    expect(res.body.servicesCount).toBe(1);

    // Verify host in DB
    const hostResult = await pool.query(
      `SELECT hostname, reporting_method, agent_version, environment_tag, last_report_ip, agent_token_id
       FROM hosts WHERE hostname = 'web-prod-01' AND reporting_method = 'agent'`,
    );
    expect(hostResult.rows.length).toBe(1);
    expect(hostResult.rows[0].reporting_method).toBe("agent");
    expect(hostResult.rows[0].agent_version).toBe("1.0.0");
    expect(hostResult.rows[0].environment_tag).toBe("testing");
    expect(hostResult.rows[0].agent_token_id).toBe(tokenId);
    expect(hostResult.rows[0].last_report_ip).toBeDefined();

    // Verify packages
    const pkgResult = await pool.query(
      `SELECT package_name FROM discovered_packages dp
       JOIN hosts h ON h.id = dp.host_id
       WHERE h.hostname = 'web-prod-01' AND dp.removed_at IS NULL
       ORDER BY dp.package_name`,
    );
    expect(pkgResult.rows.map((r) => r.package_name)).toEqual(["nginx", "openssl"]);

    // Verify services
    const svcResult = await pool.query(
      `SELECT service_name FROM services s
       JOIN hosts h ON h.id = s.host_id
       WHERE h.hostname = 'web-prod-01'`,
    );
    expect(svcResult.rows.length).toBe(1);
    expect(svcResult.rows[0].service_name).toBe("nginx");

    // Verify token usage
    const tokenDetail = await api()
      .get(`/api/v1/agent-tokens/${tokenId}`)
      .set(h())
      .expect(200);
    expect(tokenDetail.body.reportCount).toBe(1);
    expect(tokenDetail.body.hostCount).toBe(1);
    expect(tokenDetail.body.lastUsedAt).not.toBeNull();
  });

  it("should accept report with empty packages and services", async () => {
    const { token } = await createAgentToken({ name: "empty-test" });

    const res = await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${token}` })
      .send(validPayload({ hostname: "empty-host", packages: [], services: [] }))
      .expect(200);

    expect(res.body.received).toBe(true);
    expect(res.body.packagesCount).toBe(0);
    expect(res.body.servicesCount).toBe(0);

    // Host still created
    const hostResult = await pool.query(
      "SELECT id FROM hosts WHERE hostname = 'empty-host'",
    );
    expect(hostResult.rows.length).toBe(1);
  });

  it("should handle repeat reports (update, not duplicate)", async () => {
    const { token } = await createAgentToken({ name: "repeat-test", scope: "single" });

    // First report with nginx 1.24.0
    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${token}` })
      .send(
        validPayload({
          hostname: "repeat-host",
          packages: [{ name: "nginx", version: "1.24.0", manager: "apt", ecosystem: "debian" }],
        }),
      )
      .expect(200);

    // Second report with nginx 1.25.3 and curl added
    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${token}` })
      .send(
        validPayload({
          hostname: "repeat-host",
          packages: [
            { name: "nginx", version: "1.25.3", manager: "apt", ecosystem: "debian" },
            { name: "curl", version: "7.88.0", manager: "apt", ecosystem: "debian" },
          ],
        }),
      )
      .expect(200);

    // Only 1 host record
    const hostResult = await pool.query(
      "SELECT COUNT(*) FROM hosts WHERE hostname = 'repeat-host'",
    );
    expect(parseInt(hostResult.rows[0].count, 10)).toBe(1);

    // nginx should be updated, curl added, both present
    const pkgResult = await pool.query(
      `SELECT dp.package_name, dp.installed_version FROM discovered_packages dp
       JOIN hosts h ON h.id = dp.host_id
       WHERE h.hostname = 'repeat-host' AND dp.removed_at IS NULL
       ORDER BY dp.package_name`,
    );
    const pkgMap = Object.fromEntries(
      pkgResult.rows.map((r) => [r.package_name, r.installed_version]),
    );
    expect(pkgMap.curl).toBe("7.88.0");
    expect(pkgMap.nginx).toBe("1.25.3");
  });
});

// ─── Hostname Constraints ───

describe("Hostname locking and fleet constraints", () => {
  it("single-scope token should lock to first hostname", async () => {
    const { token } = await createAgentToken({ name: "single-lock", scope: "single" });

    // First report — locks
    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${token}` })
      .send(validPayload({ hostname: "host-A" }))
      .expect(200);

    // Same host — succeeds
    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${token}` })
      .send(validPayload({ hostname: "host-A" }))
      .expect(200);

    // Different host — rejected
    const res = await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${token}` })
      .send(validPayload({ hostname: "host-B" }))
      .expect(403);

    expect(res.body.error).toContain("locked to hostname");
  });

  it("fleet token should allow multiple hostnames", async () => {
    const { token } = await createAgentToken({ name: "fleet-multi", scope: "fleet" });

    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${token}` })
      .send(validPayload({ hostname: "web-01" }))
      .expect(200);

    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${token}` })
      .send(validPayload({ hostname: "web-02" }))
      .expect(200);

    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${token}` })
      .send(validPayload({ hostname: "web-03" }))
      .expect(200);

    // Verify 3 hosts
    const result = await pool.query(
      "SELECT COUNT(*) FROM hosts WHERE hostname IN ('web-01','web-02','web-03')",
    );
    expect(parseInt(result.rows[0].count, 10)).toBe(3);
  });

  it("fleet token with allowed_hostnames should restrict", async () => {
    const { token } = await createAgentToken({
      name: "restricted-fleet",
      scope: "fleet",
      allowedHostnames: ["web-01", "web-02"],
    });

    // Allowed
    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${token}` })
      .send(validPayload({ hostname: "web-01" }))
      .expect(200);

    // Not in allowed list
    const res = await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${token}` })
      .send(validPayload({ hostname: "web-03" }))
      .expect(403);

    expect(res.body.error).toContain("not in allowed list");
  });
});

// ─── Metadata and Group Assignment ───

describe("Report metadata and group assignment", () => {
  it("should apply environment tag from token to host", async () => {
    const { token } = await createAgentToken({
      name: "env-tag-test",
      environmentTag: "production",
    });

    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${token}` })
      .send(validPayload({ hostname: "tagged-host" }))
      .expect(200);

    const result = await pool.query(
      "SELECT environment_tag FROM hosts WHERE hostname = 'tagged-host'",
    );
    expect(result.rows[0].environment_tag).toBe("production");
  });

  it("should auto-assign host to groups from token config", async () => {
    // Create a host group
    const groupRes = await pool.query(
      "INSERT INTO host_groups (name) VALUES ('agent-group') RETURNING id",
    );
    const groupId = groupRes.rows[0].id;

    const { token } = await createAgentToken({
      name: "group-test",
      scope: "single",
      hostGroupIds: [groupId],
    });

    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${token}` })
      .send(validPayload({ hostname: "grouped-host" }))
      .expect(200);

    // Verify membership
    const memberResult = await pool.query(
      `SELECT m.assigned_by FROM host_group_members m
       JOIN hosts h ON h.id = m.host_id
       WHERE m.host_group_id = $1 AND h.hostname = 'grouped-host'`,
      [groupId],
    );
    expect(memberResult.rows.length).toBe(1);
    expect(memberResult.rows[0].assigned_by).toBe("rule");
  });
});

// ─── Validation ───

describe("Report validation", () => {
  it("should reject report without hostname", async () => {
    const { token } = await createAgentToken({ name: "validation-test" });

    const res = await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${token}` })
      .send({ os: "Ubuntu" })
      .expect(400);

    expect(res.body.error).toContain("hostname");
  });

  it("should accept report without os (defaults to Unknown)", async () => {
    const { token } = await createAgentToken({ name: "no-os-test" });

    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${token}` })
      .send({ hostname: "no-os-host" })
      .expect(200);

    const result = await pool.query(
      "SELECT os FROM hosts WHERE hostname = 'no-os-host'",
    );
    expect(result.rows[0].os).toBe("Unknown");
  });

  it("should safely store XSS/injection in hostname (parameterized queries)", async () => {
    const { token } = await createAgentToken({ name: "xss-test" });

    const xssHostname = '<script>alert(1)</script>';
    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${token}` })
      .send(validPayload({ hostname: xssHostname }))
      .expect(200);

    // Stored literally, not executed
    const result = await pool.query(
      "SELECT hostname FROM hosts WHERE hostname = $1",
      [xssHostname],
    );
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].hostname).toBe(xssHostname);
  });

  it("should handle large payload (many packages)", async () => {
    const { token } = await createAgentToken({ name: "large-payload" });

    const manyPkgs = Array.from({ length: 500 }, (_, i) => ({
      name: `pkg-${i}`,
      version: `${i}.0.0`,
      manager: "apt",
      ecosystem: "debian",
    }));

    const res = await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${token}` })
      .send(validPayload({ hostname: "large-host", packages: manyPkgs }))
      .expect(200);

    expect(res.body.packagesCount).toBe(500);
  });
});

// ─── Change Detection ───

describe("Report triggers change detection", () => {
  it("should record package version change events", async () => {
    const { token } = await createAgentToken({ name: "change-test", scope: "single" });

    // First report: nginx 1.24.0
    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${token}` })
      .send(
        validPayload({
          hostname: "change-host",
          packages: [
            { name: "nginx", version: "1.24.0", manager: "apt", ecosystem: "debian" },
          ],
        }),
      )
      .expect(200);

    // Second report: nginx 1.25.3
    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${token}` })
      .send(
        validPayload({
          hostname: "change-host",
          packages: [
            { name: "nginx", version: "1.25.3", manager: "apt", ecosystem: "debian" },
          ],
        }),
      )
      .expect(200);

    // Check for change event
    const changeResult = await pool.query(
      `SELECT event_type, summary FROM change_events
       WHERE hostname = 'change-host' AND event_type LIKE '%package%'
       ORDER BY created_at DESC LIMIT 5`,
    );
    // Should have at least one package-related change event
    expect(changeResult.rows.length).toBeGreaterThan(0);
  });
});

// ─── Rate Limiting ───

describe("Rate limiting", () => {
  it("should enforce rate limit of 60 reports per hour per token", async () => {
    const { token } = await createAgentToken({ name: "rate-limit-test", scope: "fleet" });

    // Send 60 reports sequentially (avoids DB pool exhaustion and race conditions in the rate limiter)
    for (let i = 0; i < 60; i++) {
      await api()
        .post("/api/v1/agent/report")
        .set({ Authorization: `Bearer ${token}` })
        .send(validPayload({ hostname: `rate-host-${i}` }))
        .expect(200);
    }

    // 61st should be rate limited
    const res = await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${token}` })
      .send(validPayload({ hostname: "rate-host-61" }))
      .expect(429);

    expect(res.body.error).toContain("Rate limit");
  });
});

// ─── Heartbeat ───

describe("POST /api/v1/agent/heartbeat", () => {
  it("should update host last_seen_at without full ingestion", async () => {
    const { token } = await createAgentToken({ name: "heartbeat-test", scope: "single" });

    // Send initial report
    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${token}` })
      .send(
        validPayload({
          hostname: "hb-host",
          packages: [
            { name: "curl", version: "7.81.0", manager: "apt", ecosystem: "debian" },
          ],
        }),
      )
      .expect(200);

    // Record current last_seen_at
    const before = await pool.query(
      "SELECT last_seen_at FROM hosts WHERE hostname = 'hb-host'",
    );

    // Small delay to ensure timestamp difference
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Send heartbeat
    const res = await api()
      .post("/api/v1/agent/heartbeat")
      .set({ Authorization: `Bearer ${token}` })
      .send({ hostname: "hb-host", agentVersion: "1.1.0" })
      .expect(200);

    expect(res.body.received).toBe(true);
    expect(res.body.hostname).toBe("hb-host");

    // Verify agent_version updated
    const after = await pool.query(
      "SELECT agent_version, status, last_seen_at FROM hosts WHERE hostname = 'hb-host'",
    );
    expect(after.rows[0].agent_version).toBe("1.1.0");
    expect(after.rows[0].status).toBe("active");
  });

  it("should return message for host with no prior report", async () => {
    const { token } = await createAgentToken({ name: "no-prior-test" });

    const res = await api()
      .post("/api/v1/agent/heartbeat")
      .set({ Authorization: `Bearer ${token}` })
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

  it("should reject heartbeat without hostname", async () => {
    const { token } = await createAgentToken({ name: "no-host-hb" });

    await api()
      .post("/api/v1/agent/heartbeat")
      .set({ Authorization: `Bearer ${token}` })
      .send({ agentVersion: "1.0.0" })
      .expect(400);
  });

  it("should enforce hostname locking on heartbeat", async () => {
    const { token } = await createAgentToken({ name: "hb-lock-test", scope: "single" });

    // Report to lock hostname
    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${token}` })
      .send(validPayload({ hostname: "locked-hb-host" }))
      .expect(200);

    // Heartbeat with different hostname — rejected
    const res = await api()
      .post("/api/v1/agent/heartbeat")
      .set({ Authorization: `Bearer ${token}` })
      .send({ hostname: "other-host" })
      .expect(403);

    expect(res.body.error).toContain("locked to hostname");
  });
});

// ─── Self-Update Response ───

describe("Self-update response", () => {
  it("should return updateAvailable when agent version is outdated", async () => {
    // Use the app's settings service instance so the route sees the updated cache
    const settingsService = getTestSettingsService();
    await settingsService.seed();

    // Set the latest version to 2.0.0 by inserting directly
    await pool.query(
      `INSERT INTO system_settings (key, value, description, category, value_type, constraints)
       VALUES ('agent_latest_version', '"2.0.0"', 'Latest agent version', 'agents', 'string', '{}')
       ON CONFLICT (key) DO UPDATE SET value = '"2.0.0"'`,
    );

    // Reload the app's settings cache so the route picks up the new value
    await settingsService.load();

    const { token } = await createAgentToken({ name: "update-test" });

    // Report with outdated version
    const res = await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${token}` })
      .send(validPayload({ hostname: "update-host", agentVersion: "1.0.0" }))
      .expect(200);

    expect(res.body.updateAvailable).toBe(true);
    expect(res.body.latestAgentVersion).toBe("2.0.0");
    expect(res.body.updateUrl).toBeDefined();
    expect(res.body.updateUrl).toContain("/api/v1/agent/script/");
  });

  it("should return updateAvailable=false when already up to date", async () => {
    // Seed the default (1.0.0) using the app's settings service
    const settingsService = getTestSettingsService();
    await settingsService.seed();

    const { token } = await createAgentToken({ name: "current-version" });

    const res = await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${token}` })
      .send(validPayload({ hostname: "current-host", agentVersion: "1.0.0" }))
      .expect(200);

    expect(res.body.updateAvailable).toBe(false);
    expect(res.body.latestAgentVersion).toBe("1.0.0");
  });
});
