import { describe, it, expect, beforeEach } from "vitest";
import supertest from "supertest";
import pino from "pino";
import { getTestDb } from "./setup.js";
import { getTestApp } from "./app.js";
import { createTestAdmin, getAuthToken, createTestScanTarget, createTestHost } from "./helpers.js";
import { GroupAssignmentService } from "../services/group-assignment.js";

const logger = pino({ level: "silent" });

// ─── DB Helpers ───

async function createGroup(name: string, overrides: Record<string, unknown> = {}) {
  const pool = getTestDb();
  const result = await pool.query(
    `INSERT INTO host_groups (name, description, color, icon)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [name, overrides.description ?? null, overrides.color ?? null, overrides.icon ?? null],
  );
  return result.rows[0];
}

async function createRule(groupId: string, ruleType: string, ruleValue: string, priority = 0) {
  const pool = getTestDb();
  const result = await pool.query(
    `INSERT INTO host_group_rules (host_group_id, rule_type, rule_value, priority)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [groupId, ruleType, ruleValue, priority],
  );
  return result.rows[0];
}

async function getMemberships(hostId: string) {
  const pool = getTestDb();
  const result = await pool.query(
    `SELECT host_group_id, assigned_by, rule_id FROM host_group_members WHERE host_id = $1`,
    [hostId],
  );
  return result.rows;
}

async function addTag(hostId: string, key: string, value: string) {
  const pool = getTestDb();
  await pool.query(
    `INSERT INTO host_tags (host_id, tag_key, tag_value) VALUES ($1, $2, $3)
     ON CONFLICT (host_id, tag_key) DO UPDATE SET tag_value = $3`,
    [hostId, key, value],
  );
}

async function addManualMember(hostId: string, groupId: string) {
  const pool = getTestDb();
  await pool.query(
    `INSERT INTO host_group_members (host_id, host_group_id, assigned_by)
     VALUES ($1, $2, 'manual') ON CONFLICT DO NOTHING`,
    [hostId, groupId],
  );
}

// ──────────────────────────────────────────
// Individual Rule Type Tests
// ──────────────────────────────────────────

describe("GroupAssignmentService — Rule Matching", () => {
  let service: GroupAssignmentService;
  let targetId: string;

  beforeEach(async () => {
    const pool = getTestDb();
    service = new GroupAssignmentService(pool, logger);
    const target = await createTestScanTarget();
    targetId = target.id;
  });

  // hostname_contains
  it("hostname_contains: matches substring", async () => {
    const host = await createTestHost(targetId, { hostname: "web-prod-01" });
    const group = await createGroup("prod-group");
    await createRule(group.id, "hostname_contains", "prod");

    const result = await service.evaluateHost(host.id);
    expect(result.added).toContain(group.id);
  });

  it("hostname_contains: no match", async () => {
    const host = await createTestHost(targetId, { hostname: "web-staging-01" });
    const group = await createGroup("prod-group");
    await createRule(group.id, "hostname_contains", "prod");

    const result = await service.evaluateHost(host.id);
    expect(result.added).toHaveLength(0);
  });

  it("hostname_contains: case insensitive", async () => {
    const host = await createTestHost(targetId, { hostname: "Web-PROD-01" });
    const group = await createGroup("prod-group");
    await createRule(group.id, "hostname_contains", "prod");

    const result = await service.evaluateHost(host.id);
    expect(result.added).toContain(group.id);
  });

  // hostname_prefix
  it("hostname_prefix: matches prefix", async () => {
    const host = await createTestHost(targetId, { hostname: "db-master-01" });
    const group = await createGroup("db-group");
    await createRule(group.id, "hostname_prefix", "db-");

    const result = await service.evaluateHost(host.id);
    expect(result.added).toContain(group.id);
  });

  it("hostname_prefix: no match when not prefix", async () => {
    const host = await createTestHost(targetId, { hostname: "web-db-01" });
    const group = await createGroup("db-group");
    await createRule(group.id, "hostname_prefix", "db-");

    const result = await service.evaluateHost(host.id);
    expect(result.added).toHaveLength(0);
  });

  // hostname_suffix
  it("hostname_suffix: matches suffix", async () => {
    const host = await createTestHost(targetId, { hostname: "app-server-prod" });
    const group = await createGroup("suffix-group");
    await createRule(group.id, "hostname_suffix", "-prod");

    const result = await service.evaluateHost(host.id);
    expect(result.added).toContain(group.id);
  });

  // hostname_regex
  it("hostname_regex: matches regex pattern", async () => {
    const host = await createTestHost(targetId, { hostname: "web-prod-03" });
    const group = await createGroup("regex-group");
    await createRule(group.id, "hostname_regex", "^web-prod-\\d+$");

    const result = await service.evaluateHost(host.id);
    expect(result.added).toContain(group.id);
  });

  it("hostname_regex: no match", async () => {
    const host = await createTestHost(targetId, { hostname: "web-staging-03" });
    const group = await createGroup("regex-group");
    await createRule(group.id, "hostname_regex", "^web-prod-\\d+$");

    const result = await service.evaluateHost(host.id);
    expect(result.added).toHaveLength(0);
  });

  it("hostname_regex: invalid regex does not crash", async () => {
    const host = await createTestHost(targetId, { hostname: "web-prod-01" });
    const group = await createGroup("bad-regex-group");
    await createRule(group.id, "hostname_regex", "[invalid(");

    const result = await service.evaluateHost(host.id);
    expect(result.added).toHaveLength(0);
  });

  // ip_range
  it("ip_range: CIDR /24 match", async () => {
    const host = await createTestHost(targetId, { hostname: "h1", ipAddress: "192.168.1.50" });
    const group = await createGroup("cidr-group");
    await createRule(group.id, "ip_range", "192.168.1.0/24");

    const result = await service.evaluateHost(host.id);
    expect(result.added).toContain(group.id);
  });

  it("ip_range: CIDR /24 no match", async () => {
    const host = await createTestHost(targetId, { hostname: "h2", ipAddress: "192.168.2.50" });
    const group = await createGroup("cidr-group");
    await createRule(group.id, "ip_range", "192.168.1.0/24");

    const result = await service.evaluateHost(host.id);
    expect(result.added).toHaveLength(0);
  });

  it("ip_range: /16 subnet", async () => {
    const host = await createTestHost(targetId, { hostname: "h3", ipAddress: "10.0.5.100" });
    const group = await createGroup("cidr16-group");
    await createRule(group.id, "ip_range", "10.0.0.0/16");

    const result = await service.evaluateHost(host.id);
    expect(result.added).toContain(group.id);
  });

  it("ip_range: /32 single IP match", async () => {
    const host = await createTestHost(targetId, { hostname: "h4", ipAddress: "192.168.1.1" });
    const group = await createGroup("exact-ip-group");
    await createRule(group.id, "ip_range", "192.168.1.1/32");

    const result = await service.evaluateHost(host.id);
    expect(result.added).toContain(group.id);
  });

  it("ip_range: null IP does not crash", async () => {
    const pool = getTestDb();
    const host = await createTestHost(targetId, { hostname: "no-ip-host" });
    await pool.query(`UPDATE hosts SET ip_address = NULL WHERE id = $1`, [host.id]);
    const group = await createGroup("ip-null-group");
    await createRule(group.id, "ip_range", "192.168.1.0/24");

    const result = await service.evaluateHost(host.id);
    expect(result.added).toHaveLength(0);
  });

  it("ip_range: invalid CIDR does not crash", async () => {
    const host = await createTestHost(targetId, { hostname: "h5", ipAddress: "10.0.0.1" });
    const group = await createGroup("bad-cidr-group");
    await createRule(group.id, "ip_range", "not-a-cidr");

    const result = await service.evaluateHost(host.id);
    expect(result.added).toHaveLength(0);
  });

  // environment_equals
  it("environment_equals: match", async () => {
    const host = await createTestHost(targetId, { hostname: "h6", environmentTag: "production" });
    const group = await createGroup("env-group");
    await createRule(group.id, "environment_equals", "production");

    const result = await service.evaluateHost(host.id);
    expect(result.added).toContain(group.id);
  });

  it("environment_equals: case insensitive", async () => {
    const host = await createTestHost(targetId, { hostname: "h7", environmentTag: "Production" });
    const group = await createGroup("env-ci-group");
    await createRule(group.id, "environment_equals", "production");

    const result = await service.evaluateHost(host.id);
    expect(result.added).toContain(group.id);
  });

  it("environment_equals: null tag does not crash", async () => {
    const pool = getTestDb();
    const host = await createTestHost(targetId, { hostname: "h8" });
    await pool.query(`UPDATE hosts SET environment_tag = NULL WHERE id = $1`, [host.id]);
    const group = await createGroup("env-null-group");
    await createRule(group.id, "environment_equals", "production");

    const result = await service.evaluateHost(host.id);
    expect(result.added).toHaveLength(0);
  });

  // os_contains
  it("os_contains: match", async () => {
    const host = await createTestHost(targetId, { hostname: "h9", os: "Ubuntu" });
    const group = await createGroup("os-group");
    await createRule(group.id, "os_contains", "Ubuntu");

    const result = await service.evaluateHost(host.id);
    expect(result.added).toContain(group.id);
  });

  it("os_contains: partial match", async () => {
    const host = await createTestHost(targetId, { hostname: "h10", os: "Red Hat Enterprise Linux" });
    const group = await createGroup("os-partial-group");
    await createRule(group.id, "os_contains", "Red Hat");

    const result = await service.evaluateHost(host.id);
    expect(result.added).toContain(group.id);
  });

  // scan_target_equals
  it("scan_target_equals: match", async () => {
    const host = await createTestHost(targetId, { hostname: "h11" });
    const group = await createGroup("target-group");
    await createRule(group.id, "scan_target_equals", targetId);

    const result = await service.evaluateHost(host.id);
    expect(result.added).toContain(group.id);
  });

  // tag_equals
  it("tag_equals: match", async () => {
    const host = await createTestHost(targetId, { hostname: "h12" });
    await addTag(host.id, "team", "payments");
    const group = await createGroup("tag-group");
    await createRule(group.id, "tag_equals", "team=payments");

    const result = await service.evaluateHost(host.id);
    expect(result.added).toContain(group.id);
  });

  it("tag_equals: wrong value", async () => {
    const host = await createTestHost(targetId, { hostname: "h13" });
    await addTag(host.id, "team", "platform");
    const group = await createGroup("tag-wrong-group");
    await createRule(group.id, "tag_equals", "team=payments");

    const result = await service.evaluateHost(host.id);
    expect(result.added).toHaveLength(0);
  });

  it("tag_equals: no tags does not crash", async () => {
    const host = await createTestHost(targetId, { hostname: "h14" });
    const group = await createGroup("tag-none-group");
    await createRule(group.id, "tag_equals", "team=payments");

    const result = await service.evaluateHost(host.id);
    expect(result.added).toHaveLength(0);
  });

  it("tag_equals: malformed rule (no =) does not crash", async () => {
    const host = await createTestHost(targetId, { hostname: "h15" });
    await addTag(host.id, "team", "payments");
    const group = await createGroup("tag-bad-group");
    await createRule(group.id, "tag_equals", "just-a-key");

    const result = await service.evaluateHost(host.id);
    // "just-a-key".split("=") => ["just-a-key"], rest=[], tagVal=""
    // So it looks for tag_key="just-a-key", tag_value="" — which won't match
    expect(result.added).toHaveLength(0);
  });

  // detected_platform_equals
  it("detected_platform_equals: match", async () => {
    const pool = getTestDb();
    const host = await createTestHost(targetId, { hostname: "h16" });
    await pool.query(`UPDATE hosts SET detected_platform = 'linux-server' WHERE id = $1`, [host.id]);
    const group = await createGroup("platform-group");
    await createRule(group.id, "detected_platform_equals", "linux-server");

    const result = await service.evaluateHost(host.id);
    expect(result.added).toContain(group.id);
  });
});

// ──────────────────────────────────────────
// Multi-Rule and Multi-Group Tests
// ──────────────────────────────────────────

describe("Multi-Rule and Multi-Group", () => {
  let service: GroupAssignmentService;
  let targetId: string;

  beforeEach(async () => {
    const pool = getTestDb();
    service = new GroupAssignmentService(pool, logger);
    const target = await createTestScanTarget();
    targetId = target.id;
  });

  it("host matching multiple rules in same group is assigned once", async () => {
    const host = await createTestHost(targetId, { hostname: "web-prod-01", environmentTag: "production" });
    const group = await createGroup("multi-rule-group");
    await createRule(group.id, "hostname_contains", "prod", 10);
    await createRule(group.id, "environment_equals", "production", 5);

    await service.evaluateHost(host.id);
    const memberships = await getMemberships(host.id);
    const groupMembers = memberships.filter((m) => m.host_group_id === group.id);
    expect(groupMembers).toHaveLength(1);
  });

  it("host matches rules in different groups — member of both", async () => {
    const host = await createTestHost(targetId, { hostname: "web-prod-01", environmentTag: "production" });
    const groupA = await createGroup("web-group");
    const groupB = await createGroup("prod-env-group");
    await createRule(groupA.id, "hostname_contains", "web");
    await createRule(groupB.id, "environment_equals", "production");

    await service.evaluateHost(host.id);
    const memberships = await getMemberships(host.id);
    const groupIds = memberships.map((m) => m.host_group_id);
    expect(groupIds).toContain(groupA.id);
    expect(groupIds).toContain(groupB.id);
  });

  it("higher priority rule wins per group", async () => {
    const host = await createTestHost(targetId, { hostname: "web-prod-01" });
    const group = await createGroup("priority-group");
    const highRule = await createRule(group.id, "hostname_contains", "web", 100);
    await createRule(group.id, "hostname_contains", "prod", 50);

    await service.evaluateHost(host.id);
    const memberships = await getMemberships(host.id);
    // Should be assigned by the higher priority rule
    expect(memberships[0].rule_id).toBe(highRule.id);
  });

  it("rule stops matching after host update — removes membership", async () => {
    const pool = getTestDb();
    const host = await createTestHost(targetId, { hostname: "web-prod-01" });
    const group = await createGroup("update-group");
    await createRule(group.id, "hostname_contains", "prod");

    await service.evaluateHost(host.id);
    let memberships = await getMemberships(host.id);
    expect(memberships.length).toBe(1);

    // Update hostname to no longer match
    await pool.query(`UPDATE hosts SET hostname = 'web-staging-01' WHERE id = $1`, [host.id]);
    const result = await service.evaluateHost(host.id);
    expect(result.removed).toContain(group.id);

    memberships = await getMemberships(host.id);
    expect(memberships.length).toBe(0);
  });

  it("manual membership preserved during rule re-evaluation", async () => {
    const host = await createTestHost(targetId, { hostname: "manual-host" });
    const group = await createGroup("manual-group");
    // No rules match this host
    await createRule(group.id, "hostname_contains", "nonexistent");

    // Add manually
    await addManualMember(host.id, group.id);

    // Re-evaluate — manual membership should survive
    await service.evaluateHost(host.id);
    const memberships = await getMemberships(host.id);
    expect(memberships.length).toBe(1);
    expect(memberships[0].assigned_by).toBe("manual");
  });

  it("rule-based membership removed when rule deleted", async () => {
    const pool = getTestDb();
    const host = await createTestHost(targetId, { hostname: "web-prod-01" });
    const group = await createGroup("rule-delete-group");
    const rule = await createRule(group.id, "hostname_contains", "prod");

    await service.evaluateHost(host.id);
    let memberships = await getMemberships(host.id);
    expect(memberships.length).toBe(1);

    // Delete the rule
    await pool.query(`DELETE FROM host_group_rules WHERE id = $1`, [rule.id]);

    // Re-evaluate group
    await service.evaluateGroup(group.id);
    memberships = await getMemberships(host.id);
    expect(memberships.length).toBe(0);
  });
});

// ──────────────────────────────────────────
// evaluateAllHosts() Tests
// ──────────────────────────────────────────

describe("evaluateAllHosts()", () => {
  let service: GroupAssignmentService;

  beforeEach(async () => {
    const pool = getTestDb();
    service = new GroupAssignmentService(pool, logger);
  });

  it("bulk evaluation with many hosts and rules", async () => {
    const target = await createTestScanTarget();
    const groups = [];
    // Create 5 groups with different rules
    for (let i = 0; i < 5; i++) {
      const group = await createGroup(`bulk-group-${i}`);
      await createRule(group.id, "hostname_contains", `bulk-${i}`);
      groups.push(group);
    }

    // Create 10 hosts per group (50 total)
    for (let g = 0; g < 5; g++) {
      for (let h = 0; h < 10; h++) {
        await createTestHost(target.id, { hostname: `bulk-${g}-host-${h}` });
      }
    }

    const start = Date.now();
    const result = await service.evaluateAllHosts();
    const duration = Date.now() - start;

    expect(result.added).toBe(50);
    expect(duration).toBeLessThan(10000);
  });

  it("re-evaluation is idempotent", async () => {
    const target = await createTestScanTarget();
    const group = await createGroup("idempotent-group");
    await createRule(group.id, "hostname_contains", "idem");

    for (let i = 0; i < 5; i++) {
      await createTestHost(target.id, { hostname: `idem-host-${i}` });
    }

    const first = await service.evaluateAllHosts();
    expect(first.added).toBe(5);

    // Second run — no changes
    const second = await service.evaluateAllHosts();
    expect(second.added).toBe(0);
    expect(second.removed).toBe(0);
  });
});

// ──────────────────────────────────────────
// API Integration Tests
// ──────────────────────────────────────────

describe("Group API Integration", () => {
  let token: string;

  beforeEach(async () => {
    const admin = await createTestAdmin();
    token = await getAuthToken(admin.username, admin.password);
  });

  it("POST /groups/:id/rules triggers re-evaluation", async () => {
    const app = getTestApp();
    const target = await createTestScanTarget();

    // Create 5 hosts with "web" in hostname
    for (let i = 0; i < 5; i++) {
      await createTestHost(target.id, { hostname: `web-server-${i}` });
    }

    // Create group via API
    const groupRes = await supertest(app)
      .post("/api/v1/groups")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "API Web Group" })
      .expect(201);
    const groupId = groupRes.body.id;

    // Add rule via API — should trigger re-evaluation
    const ruleRes = await supertest(app)
      .post(`/api/v1/groups/${groupId}/rules`)
      .set("Authorization", `Bearer ${token}`)
      .send({ ruleType: "hostname_contains", ruleValue: "web" })
      .expect(201);

    expect(ruleRes.body.evaluation.added).toBe(5);

    // Verify members
    const detailRes = await supertest(app)
      .get(`/api/v1/groups/${groupId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(detailRes.body.members.length).toBe(5);
  });

  it("DELETE /groups/:id/rules/:ruleId cleans up memberships", async () => {
    const app = getTestApp();
    const target = await createTestScanTarget();

    for (let i = 0; i < 3; i++) {
      await createTestHost(target.id, { hostname: `cleanup-host-${i}` });
    }

    // Create group and rule
    const groupRes = await supertest(app)
      .post("/api/v1/groups")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Cleanup Group" })
      .expect(201);
    const groupId = groupRes.body.id;

    const ruleRes = await supertest(app)
      .post(`/api/v1/groups/${groupId}/rules`)
      .set("Authorization", `Bearer ${token}`)
      .send({ ruleType: "hostname_contains", ruleValue: "cleanup" })
      .expect(201);
    const ruleId = ruleRes.body.rule.id;

    // Delete rule — should remove memberships
    const deleteRes = await supertest(app)
      .delete(`/api/v1/groups/${groupId}/rules/${ruleId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(deleteRes.body.evaluation.removed).toBe(3);
  });

  it("POST /groups/:id/evaluate returns correct counts", async () => {
    const app = getTestApp();
    const pool = getTestDb();
    const target = await createTestScanTarget();
    const service = new GroupAssignmentService(pool, logger);

    const group = await createGroup("eval-api-group");
    await createRule(group.id, "hostname_contains", "eval");

    for (let i = 0; i < 3; i++) {
      await createTestHost(target.id, { hostname: `eval-host-${i}` });
    }

    const res = await supertest(app)
      .post(`/api/v1/groups/${group.id}/evaluate`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(res.body.added).toBe(3);
    expect(res.body.removed).toBe(0);
  });

  it("POST /groups/preview-rule returns match count", async () => {
    const app = getTestApp();
    const target = await createTestScanTarget();

    for (let i = 0; i < 4; i++) {
      await createTestHost(target.id, { hostname: `preview-host-${i}` });
    }
    await createTestHost(target.id, { hostname: "other-host" });

    const res = await supertest(app)
      .post("/api/v1/groups/preview-rule")
      .set("Authorization", `Bearer ${token}`)
      .send({ ruleType: "hostname_contains", ruleValue: "preview" })
      .expect(200);

    expect(res.body.matchCount).toBe(4);
  });

  it("Group CRUD: create, update, delete", async () => {
    const app = getTestApp();

    // Create
    const createRes = await supertest(app)
      .post("/api/v1/groups")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "CRUD Group", description: "Test", color: "#FF0000" })
      .expect(201);

    expect(createRes.body.name).toBe("CRUD Group");
    const id = createRes.body.id;

    // Update
    const updateRes = await supertest(app)
      .patch(`/api/v1/groups/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Updated CRUD Group" })
      .expect(200);
    expect(updateRes.body.name).toBe("Updated CRUD Group");

    // Delete
    await supertest(app)
      .delete(`/api/v1/groups/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(204);
  });

  it("rejects duplicate group name", async () => {
    const app = getTestApp();

    await supertest(app)
      .post("/api/v1/groups")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Unique Group" })
      .expect(201);

    await supertest(app)
      .post("/api/v1/groups")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Unique Group" })
      .expect(409);
  });

  it("manual members not removed by rule evaluation", async () => {
    const app = getTestApp();
    const target = await createTestScanTarget();
    const host = await createTestHost(target.id, { hostname: "manual-api-host" });

    const groupRes = await supertest(app)
      .post("/api/v1/groups")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Manual API Group" })
      .expect(201);
    const groupId = groupRes.body.id;

    // Add manually
    await supertest(app)
      .post(`/api/v1/groups/${groupId}/members`)
      .set("Authorization", `Bearer ${token}`)
      .send({ hostIds: [host.id] })
      .expect(200);

    // Add rule that doesn't match this host
    await supertest(app)
      .post(`/api/v1/groups/${groupId}/rules`)
      .set("Authorization", `Bearer ${token}`)
      .send({ ruleType: "hostname_contains", ruleValue: "nonexistent" })
      .expect(201);

    // Verify manual member still present
    const detailRes = await supertest(app)
      .get(`/api/v1/groups/${groupId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(detailRes.body.members.length).toBe(1);
    expect(detailRes.body.members[0].assignedBy).toBe("manual");
  });
});
