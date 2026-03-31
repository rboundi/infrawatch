import { describe, it, expect, beforeEach } from "vitest";
import supertest from "supertest";
import { getTestDb } from "./setup.js";
import { getTestApp } from "./app.js";
import {
  createTestAdmin,
  createTestUser,
  getAuthToken,
  createTestScanTarget,
  createTestHost,
  createTestPackage,
  createTestService,
} from "./helpers.js";

let authToken: string;
let pool: ReturnType<typeof getTestDb>;

function api() {
  return supertest(getTestApp());
}

function h() {
  return { Authorization: `Bearer ${authToken}` };
}

async function createAgentToken(opts: { name: string; scope?: string; environmentTag?: string; allowedHostnames?: string[] }) {
  const res = await api()
    .post("/api/v1/agent-tokens")
    .set(h())
    .send({
      name: opts.name,
      scope: opts.scope ?? "single",
      allowedHostnames: opts.allowedHostnames,
      environmentTag: opts.environmentTag,
    })
    .expect(201);

  return { id: res.body.id, token: res.body.token };
}

// ─── Realistic Linux agent payload ───
function linuxPayload(overrides: Record<string, unknown> = {}) {
  return {
    agentVersion: "1.0.0",
    hostname: "web-01.prod.example.com",
    ip: "10.0.1.10",
    os: "Ubuntu 22.04.3 LTS",
    osVersion: "22.04",
    arch: "x86_64",
    reportedAt: new Date().toISOString(),
    packages: [
      { name: "nginx", version: "1.24.0-1ubuntu1", manager: "apt", ecosystem: "debian" },
      { name: "openssl", version: "3.0.2-0ubuntu1.12", manager: "apt", ecosystem: "debian" },
      { name: "postgresql-15", version: "15.5-1.pgdg22.04+1", manager: "apt", ecosystem: "debian" },
      { name: "redis-server", version: "7.0.15-1", manager: "apt", ecosystem: "debian" },
      { name: "curl", version: "7.81.0-1ubuntu1.15", manager: "apt", ecosystem: "debian" },
    ],
    services: [
      { name: "nginx", type: "webserver", version: "1.24.0", port: 80, status: "running" },
      { name: "postgresql", type: "database", version: "15.5", port: 5432, status: "running" },
      { name: "redis-server", type: "cache", version: "7.0.15", port: 6379, status: "running" },
      { name: "sshd", type: "remote-access", version: "8.9p1", port: 22, status: "running" },
    ],
    connections: [],
    metadata: {
      uptime: "up 45 days, 3 hours",
      kernelVersion: "5.15.0-91-generic",
      totalMemoryMb: 8192,
      cpuCores: 4,
    },
    ...overrides,
  };
}

// ─── Realistic Windows agent payload ───
function windowsPayload(overrides: Record<string, unknown> = {}) {
  return {
    agentVersion: "1.0.0",
    hostname: "WIN-DB-01",
    ip: "10.0.2.20",
    os: "Microsoft Windows Server 2022 Standard",
    osVersion: "10.0.20348",
    arch: "AMD64",
    reportedAt: new Date().toISOString(),
    packages: [
      { name: "Microsoft SQL Server 2022", version: "16.0.4085.2", manager: "msi", ecosystem: "windows" },
      { name: "Microsoft Visual C++ 2022 Redistributable", version: "14.38.33130", manager: "msi", ecosystem: "windows" },
      { name: "7-Zip 23.01 (x64)", version: "23.01", manager: "msi", ecosystem: "windows" },
    ],
    services: [
      { name: "MSSQLSERVER", type: "database", version: "16.0.4085.2", port: 1433, status: "running" },
      { name: "W3SVC", type: "webserver", status: "running" },
      { name: "sshd", type: "remote-access", port: 22, status: "running" },
    ],
    connections: [],
    metadata: {
      uptime: "12d 6h 45m",
      kernelVersion: "10.0.20348.2113",
      totalMemoryMb: 16384,
      cpuCores: 8,
      powershellVersion: "5.1.20348.2113",
    },
    ...overrides,
  };
}

beforeEach(async () => {
  pool = getTestDb();
  const admin = await createTestAdmin();
  authToken = await getAuthToken(admin.username, admin.password);
});

// ─── Full round-trip Linux agent report ───

describe("Full round-trip: Linux agent report", () => {
  it("should create host, packages, and services from agent report", async () => {
    const { token } = await createAgentToken({ name: "linux-integration" });

    // Send Linux agent report
    const reportRes = await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${token}` })
      .send(linuxPayload())
      .expect(200);

    expect(reportRes.body.received).toBe(true);
    expect(reportRes.body.hostname).toBe("web-01.prod.example.com");
    expect(reportRes.body.packagesCount).toBe(5);
    expect(reportRes.body.servicesCount).toBe(4);

    // Verify host appears in GET /api/v1/hosts
    const hostsRes = await api()
      .get("/api/v1/hosts")
      .set(h())
      .expect(200);

    const host = hostsRes.body.data.find((h: { hostname: string }) => h.hostname === "web-01.prod.example.com");
    expect(host).toBeDefined();
    expect(host.os).toBe("Ubuntu 22.04.3 LTS");
    expect(host.osVersion).toBe("22.04");
    expect(host.reportingMethod).toBe("agent");
    expect(host.agentVersion).toBe("1.0.0");

    // Verify packages appear on host detail
    const detailRes = await api()
      .get(`/api/v1/hosts/${host.id}`)
      .set(h())
      .expect(200);

    expect(detailRes.body.packages.length).toBe(5);
    const nginxPkg = detailRes.body.packages.find((p: { packageName: string }) => p.packageName === "nginx");
    expect(nginxPkg).toBeDefined();
    expect(nginxPkg.installedVersion).toBe("1.24.0-1ubuntu1");
    expect(nginxPkg.packageManager).toBe("apt");
    expect(nginxPkg.ecosystem).toBe("debian");

    // Verify services appear on host detail
    expect(detailRes.body.services.length).toBe(4);
    const nginxSvc = detailRes.body.services.find((s: { serviceName: string }) => s.serviceName === "nginx");
    expect(nginxSvc).toBeDefined();
    expect(nginxSvc.serviceType).toBe("webserver");
    expect(nginxSvc.version).toBe("1.24.0");
    expect(nginxSvc.port).toBe(80);
    expect(nginxSvc.status).toBe("running");

    // Verify reporting method
    expect(detailRes.body.reportingMethod).toBe("agent");
  });
});

// ─── Full round-trip Windows agent report ───

describe("Full round-trip: Windows agent report", () => {
  it("should create host, packages, and services from Windows agent report", async () => {
    const { token } = await createAgentToken({ name: "windows-integration", scope: "single" });

    const reportRes = await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${token}` })
      .send(windowsPayload())
      .expect(200);

    expect(reportRes.body.received).toBe(true);
    expect(reportRes.body.hostname).toBe("WIN-DB-01");
    expect(reportRes.body.packagesCount).toBe(3);
    expect(reportRes.body.servicesCount).toBe(3);

    // Verify host detail
    const hostsRes = await api()
      .get("/api/v1/hosts")
      .set(h())
      .expect(200);

    const host = hostsRes.body.data.find((h: { hostname: string }) => h.hostname === "WIN-DB-01");
    expect(host).toBeDefined();
    expect(host.os).toBe("Microsoft Windows Server 2022 Standard");
    expect(host.osVersion).toBe("10.0.20348");
    expect(host.reportingMethod).toBe("agent");

    // Verify packages
    const detailRes = await api()
      .get(`/api/v1/hosts/${host.id}`)
      .set(h())
      .expect(200);

    expect(detailRes.body.packages.length).toBe(3);
    const sqlPkg = detailRes.body.packages.find((p: { packageName: string }) => p.packageName === "Microsoft SQL Server 2022");
    expect(sqlPkg).toBeDefined();
    expect(sqlPkg.installedVersion).toBe("16.0.4085.2");
    expect(sqlPkg.packageManager).toBe("msi");
    expect(sqlPkg.ecosystem).toBe("windows");

    // Verify services
    expect(detailRes.body.services.length).toBe(3);
    const mssqlSvc = detailRes.body.services.find((s: { serviceName: string }) => s.serviceName === "MSSQLSERVER");
    expect(mssqlSvc).toBeDefined();
    expect(mssqlSvc.serviceType).toBe("database");
    expect(mssqlSvc.port).toBe(1433);
  });
});

// ─── Agent-reported host appears in compliance scoring ───

describe("Agent-reported host in compliance scoring", () => {
  it("should produce a compliance score for agent-reported host", async () => {
    const { token } = await createAgentToken({ name: "compliance-test" });

    // Send report
    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${token}` })
      .send(linuxPayload({ hostname: "compliance-host" }))
      .expect(200);

    // Get host ID
    const hostsRes = await api()
      .get("/api/v1/hosts")
      .set(h())
      .expect(200);
    const host = hostsRes.body.data.find((h: { hostname: string }) => h.hostname === "compliance-host");
    expect(host).toBeDefined();

    // Trigger compliance recalculation and wait for it to complete
    await api()
      .post("/api/v1/compliance/recalculate")
      .set(h())
      .expect(200);

    // The recalculation runs in the background. Wait briefly for it to finish.
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Request compliance score for this host
    const compRes = await api()
      .get(`/api/v1/compliance/hosts/${host.id}`)
      .set(h())
      .expect(200);

    expect(compRes.body.score).toBeDefined();
    expect(typeof compRes.body.score).toBe("number");
    expect(compRes.body.score).toBeGreaterThanOrEqual(0);
    expect(compRes.body.score).toBeLessThanOrEqual(100);
    expect(compRes.body.classification).toBeDefined();
    expect(compRes.body.breakdown).toBeDefined();
  });
});

// ─── Agent-reported host shows in change detection ───

describe("Agent-reported host in change detection", () => {
  it("should create change event when package version changes", async () => {
    const { token } = await createAgentToken({ name: "change-detect-test" });

    // First report: nginx 1.24.0
    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${token}` })
      .send(linuxPayload({
        hostname: "change-host",
        packages: [
          { name: "nginx", version: "1.24.0", manager: "apt", ecosystem: "debian" },
        ],
        services: [],
      }))
      .expect(200);

    // Second report: nginx upgraded to 1.25.3
    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${token}` })
      .send(linuxPayload({
        hostname: "change-host",
        packages: [
          { name: "nginx", version: "1.25.3", manager: "apt", ecosystem: "debian" },
        ],
        services: [],
      }))
      .expect(200);

    // Check change events
    const changesRes = await api()
      .get("/api/v1/changes")
      .set(h())
      .query({ search: "change-host" })
      .expect(200);

    const changes = changesRes.body.data;
    expect(changes.length).toBeGreaterThan(0);

    // Look for package upgrade event
    const upgradeEvent = changes.find(
      (c: { eventType: string; summary: string }) =>
        c.eventType === "package_upgraded" || c.summary.includes("nginx"),
    );
    expect(upgradeEvent).toBeDefined();
  });
});

// ─── Mixed environment: scanner and agent hosts coexist ───

describe("Mixed environment: scanner and agent hosts coexist", () => {
  it("should list both scanner and agent hosts with correct reporting methods", async () => {
    // Create 3 scanner-discovered hosts
    const scanTarget = await createTestScanTarget({ name: "ssh-scanner-1" });
    const scanHost1 = await createTestHost(scanTarget.id, { hostname: "scan-host-1", ipAddress: "10.0.0.1" });
    const scanHost2 = await createTestHost(scanTarget.id, { hostname: "scan-host-2", ipAddress: "10.0.0.2" });
    const scanHost3 = await createTestHost(scanTarget.id, { hostname: "scan-host-3", ipAddress: "10.0.0.3" });

    // Add packages and services to scanner hosts so they show up properly
    await createTestPackage(scanHost1.id, { packageName: "nginx", installedVersion: "1.24.0" });
    await createTestPackage(scanHost2.id, { packageName: "apache2", installedVersion: "2.4.57" });
    await createTestPackage(scanHost3.id, { packageName: "redis", installedVersion: "7.0.15" });

    // Create 2 agent-reported hosts
    const { token } = await createAgentToken({ name: "mixed-fleet", scope: "fleet" });

    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${token}` })
      .send(linuxPayload({ hostname: "agent-host-1", ip: "10.0.1.1" }))
      .expect(200);

    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${token}` })
      .send(windowsPayload({ hostname: "agent-host-2", ip: "10.0.1.2" }))
      .expect(200);

    // GET /api/v1/hosts should return all 5
    const hostsRes = await api()
      .get("/api/v1/hosts")
      .set(h())
      .expect(200);

    expect(hostsRes.body.total).toBe(5);

    const hostnames = hostsRes.body.data.map((h: { hostname: string }) => h.hostname).sort();
    expect(hostnames).toContain("scan-host-1");
    expect(hostnames).toContain("scan-host-2");
    expect(hostnames).toContain("scan-host-3");
    expect(hostnames).toContain("agent-host-1");
    expect(hostnames).toContain("agent-host-2");

    // Verify reporting methods
    const agentHost = hostsRes.body.data.find((h: { hostname: string }) => h.hostname === "agent-host-1");
    expect(agentHost.reportingMethod).toBe("agent");

    const scannerHost = hostsRes.body.data.find((h: { hostname: string }) => h.hostname === "scan-host-1");
    // Scanner hosts don't have reportingMethod set (it's null or 'scanner')
    expect(scannerHost.reportingMethod).not.toBe("agent");

    // GET /api/v1/stats/overview should count all 5
    const statsRes = await api()
      .get("/api/v1/stats/overview")
      .set(h())
      .expect(200);

    expect(statsRes.body.totalHosts).toBeGreaterThanOrEqual(5);
    expect(statsRes.body.activeHosts).toBeGreaterThanOrEqual(5);
  });
});

// ─── Agent-reported host gets alerts from version checking ───

describe("Agent-reported host alert generation", () => {
  it("should allow alerts to be created for agent-reported hosts", async () => {
    const { token } = await createAgentToken({ name: "alert-test" });

    // Report host with nginx package
    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${token}` })
      .send(linuxPayload({
        hostname: "alert-host",
        packages: [
          { name: "nginx", version: "1.24.0", manager: "apt", ecosystem: "debian" },
        ],
        services: [],
      }))
      .expect(200);

    // Get the host ID
    const hostsRes = await api()
      .get("/api/v1/hosts")
      .set(h())
      .expect(200);
    const host = hostsRes.body.data.find((h: { hostname: string }) => h.hostname === "alert-host");
    expect(host).toBeDefined();

    // Manually create an alert for this host (simulating what version checker would do)
    const alertResult = await pool.query(
      `INSERT INTO alerts (host_id, package_name, current_version, available_version, severity)
       VALUES ($1, 'nginx', '1.24.0', '1.25.3', 'high')
       RETURNING id`,
      [host.id],
    );
    expect(alertResult.rows.length).toBe(1);

    // Verify alert appears in host detail
    const detailRes = await api()
      .get(`/api/v1/hosts/${host.id}`)
      .set(h())
      .expect(200);

    expect(detailRes.body.recentAlerts.length).toBe(1);
    expect(detailRes.body.recentAlerts[0].packageName).toBe("nginx");
    expect(detailRes.body.recentAlerts[0].severity).toBe("high");

    // Verify alert appears in alerts endpoint
    const alertsRes = await api()
      .get("/api/v1/alerts")
      .set(h())
      .query({ hostId: host.id })
      .expect(200);

    expect(alertsRes.body.data.length).toBe(1);
    expect(alertsRes.body.data[0].hostname).toBe("alert-host");
  });
});

// ─── Multiple reports update host (don't create duplicates) ───

describe("Multiple agent reports update, not duplicate", () => {
  it("should update existing host on repeated reports", async () => {
    const { token } = await createAgentToken({ name: "repeat-test" });

    // First report
    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${token}` })
      .send(linuxPayload({
        hostname: "repeat-host",
        packages: [
          { name: "nginx", version: "1.24.0", manager: "apt", ecosystem: "debian" },
        ],
        services: [
          { name: "nginx", type: "webserver", version: "1.24.0", port: 80, status: "running" },
        ],
      }))
      .expect(200);

    // Second report with updated package version
    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${token}` })
      .send(linuxPayload({
        hostname: "repeat-host",
        packages: [
          { name: "nginx", version: "1.25.3", manager: "apt", ecosystem: "debian" },
          { name: "curl", version: "7.81.0", manager: "apt", ecosystem: "debian" },
        ],
        services: [
          { name: "nginx", type: "webserver", version: "1.25.3", port: 80, status: "running" },
        ],
      }))
      .expect(200);

    // Only 1 host should exist
    const hostsRes = await api()
      .get("/api/v1/hosts")
      .set(h())
      .expect(200);

    const matchingHosts = hostsRes.body.data.filter(
      (h: { hostname: string }) => h.hostname === "repeat-host",
    );
    expect(matchingHosts.length).toBe(1);

    // Packages should reflect the second report
    const detailRes = await api()
      .get(`/api/v1/hosts/${matchingHosts[0].id}`)
      .set(h())
      .expect(200);

    // Should have 2 packages from second report (nginx updated + curl added)
    const activePackages = detailRes.body.packages;
    expect(activePackages.length).toBe(2);

    const nginxPkg = activePackages.find((p: { packageName: string }) => p.packageName === "nginx");
    expect(nginxPkg.installedVersion).toBe("1.25.3");
  });
});

// ─── Environment tag from token propagates to host ───

describe("Environment tag propagation", () => {
  it("should set environment tag on host from token config", async () => {
    const { token } = await createAgentToken({
      name: "env-tag-test",
      environmentTag: "production",
    });

    await api()
      .post("/api/v1/agent/report")
      .set({ Authorization: `Bearer ${token}` })
      .send(linuxPayload({ hostname: "env-host" }))
      .expect(200);

    // Check host has environment tag
    const hostsRes = await api()
      .get("/api/v1/hosts")
      .set(h())
      .expect(200);

    const host = hostsRes.body.data.find((h: { hostname: string }) => h.hostname === "env-host");
    expect(host).toBeDefined();
    expect(host.environmentTag).toBe("production");
  });
});
