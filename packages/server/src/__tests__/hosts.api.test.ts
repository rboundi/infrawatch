import { describe, it, expect, beforeEach } from "vitest";
import supertest from "supertest";
import { getTestDb } from "./setup.js";
import { getTestApp } from "./app.js";
import {
  createTestAdmin,
  getAuthToken,
  createTestScanTarget,
  createTestHost,
  createTestPackage,
  createTestService,
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
// GET /api/v1/hosts (list)
// ─────────────────────────────────────────────
describe("GET /api/v1/hosts (list)", () => {
  it("should return paginated list with correct shape", async () => {
    const target = await createTestScanTarget();
    await createTestHost(target.id, { hostname: "shape-host" });

    const res = await api().get("/api/v1/hosts").set(h()).expect(200);

    expect(res.body).toHaveProperty("data");
    expect(res.body).toHaveProperty("total");
    expect(res.body).toHaveProperty("page");
    expect(res.body).toHaveProperty("totalPages");
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(1);

    const host = res.body.data[0];
    expect(host).toHaveProperty("id");
    expect(host).toHaveProperty("hostname");
    expect(host).toHaveProperty("ip");
    expect(host).toHaveProperty("os");
    expect(host).toHaveProperty("packageCount");
    expect(host).toHaveProperty("openAlertCount");
    expect(typeof host.packageCount).toBe("number");
    expect(typeof host.openAlertCount).toBe("number");
  });

  it("should paginate correctly", async () => {
    const target = await createTestScanTarget();
    for (let i = 0; i < 5; i++) {
      await createTestHost(target.id, { hostname: `page-host-${i}` });
    }

    const page1 = await api()
      .get("/api/v1/hosts?page=1&limit=2")
      .set(h())
      .expect(200);

    expect(page1.body.data.length).toBe(2);
    expect(page1.body.total).toBe(5);
    expect(page1.body.page).toBe(1);
    expect(page1.body.totalPages).toBe(3);

    const page3 = await api()
      .get("/api/v1/hosts?page=3&limit=2")
      .set(h())
      .expect(200);

    expect(page3.body.data.length).toBe(1);
    expect(page3.body.page).toBe(3);
  });

  it("should filter by status", async () => {
    const target = await createTestScanTarget();
    await createTestHost(target.id, { hostname: "active-host", status: "active" });
    await createTestHost(target.id, { hostname: "stale-host", status: "stale" });
    await createTestHost(target.id, { hostname: "active-host-2", status: "active" });

    const res = await api()
      .get("/api/v1/hosts?status=active")
      .set(h())
      .expect(200);

    expect(res.body.total).toBe(2);
    for (const host of res.body.data) {
      expect(host.status).toBe("active");
    }
  });

  it("should search by hostname", async () => {
    const target = await createTestScanTarget();
    await createTestHost(target.id, { hostname: "web-server-01" });
    await createTestHost(target.id, { hostname: "db-server-01" });
    await createTestHost(target.id, { hostname: "web-server-02" });

    const res = await api()
      .get("/api/v1/hosts?search=web")
      .set(h())
      .expect(200);

    expect(res.body.total).toBe(2);
    for (const host of res.body.data) {
      expect(host.hostname).toContain("web");
    }
  });

  it("should handle search with special characters (%, _) safely", async () => {
    const target = await createTestScanTarget();
    await createTestHost(target.id, { hostname: "normal-host" });
    await createTestHost(target.id, { hostname: "host_with_underscores" });
    await createTestHost(target.id, { hostname: "host%percent" });

    // Searching for "%" should not match all rows
    const pctRes = await api()
      .get("/api/v1/hosts?search=%25")
      .set(h())
      .expect(200);

    expect(pctRes.body.total).toBe(1);
    expect(pctRes.body.data[0].hostname).toBe("host%percent");

    // Searching for "_" should only match the underscore host, not single-char wildcards
    const underRes = await api()
      .get("/api/v1/hosts?search=_")
      .set(h())
      .expect(200);

    expect(underRes.body.total).toBe(1);
    expect(underRes.body.data[0].hostname).toBe("host_with_underscores");
  });

  it("should sort by hostname and packageCount", async () => {
    const target = await createTestScanTarget();
    const hostA = await createTestHost(target.id, { hostname: "aaa-host" });
    const hostZ = await createTestHost(target.id, { hostname: "zzz-host" });
    await createTestPackage(hostZ.id);
    await createTestPackage(hostZ.id, { packageName: "extra-pkg" });

    // Sort by hostname desc
    const descRes = await api()
      .get("/api/v1/hosts?sortBy=hostname&order=desc")
      .set(h())
      .expect(200);

    expect(descRes.body.data[0].hostname).toBe("zzz-host");
    expect(descRes.body.data[1].hostname).toBe("aaa-host");

    // Sort by packageCount desc
    const pkgRes = await api()
      .get("/api/v1/hosts?sortBy=packageCount&order=desc")
      .set(h())
      .expect(200);

    expect(pkgRes.body.data[0].hostname).toBe("zzz-host");
    expect(pkgRes.body.data[0].packageCount).toBe(2);
  });
});

// ─────────────────────────────────────────────
// GET /api/v1/hosts/:id (detail)
// ─────────────────────────────────────────────
describe("GET /api/v1/hosts/:id (detail)", () => {
  it("should return host detail with packages, services, and alerts", async () => {
    const target = await createTestScanTarget();
    const host = await createTestHost(target.id, { hostname: "detail-host" });
    await createTestPackage(host.id, { packageName: "nginx" });
    await createTestService(host.id, { serviceName: "sshd", port: 22 });
    await createTestAlert(host.id, { packageName: "nginx", severity: "high" });

    const res = await api()
      .get(`/api/v1/hosts/${host.id}`)
      .set(h())
      .expect(200);

    expect(res.body.hostname).toBe("detail-host");
    expect(res.body.packages.length).toBe(1);
    expect(res.body.packages[0].packageName).toBe("nginx");
    expect(res.body.services.length).toBe(1);
    expect(res.body.services[0].serviceName).toBe("sshd");
    expect(res.body.recentAlerts.length).toBe(1);
    expect(res.body.recentAlerts[0].severity).toBe("high");
    expect(res.body).toHaveProperty("scanTargetId");
    expect(res.body).toHaveProperty("metadata");
  });

  it("should return 404 for non-existent host", async () => {
    await api()
      .get("/api/v1/hosts/00000000-0000-0000-0000-000000000000")
      .set(h())
      .expect(404);
  });
});

// ─────────────────────────────────────────────
// GET /api/v1/hosts/:id/packages
// ─────────────────────────────────────────────
describe("GET /api/v1/hosts/:id/packages", () => {
  it("should list packages for a host with pagination", async () => {
    const target = await createTestScanTarget();
    const host = await createTestHost(target.id);

    for (let i = 0; i < 5; i++) {
      await createTestPackage(host.id, { packageName: `pkg-${String(i).padStart(2, "0")}` });
    }

    const res = await api()
      .get(`/api/v1/hosts/${host.id}/packages?limit=3&page=1`)
      .set(h())
      .expect(200);

    expect(res.body.data.length).toBe(3);
    expect(res.body.total).toBe(5);
    expect(res.body.totalPages).toBe(2);
  });

  it("should filter packages by ecosystem", async () => {
    const target = await createTestScanTarget();
    const host = await createTestHost(target.id);

    await createTestPackage(host.id, { packageName: "nginx", ecosystem: "debian" });
    await createTestPackage(host.id, { packageName: "express", ecosystem: "npm" });
    await createTestPackage(host.id, { packageName: "curl", ecosystem: "debian" });

    const res = await api()
      .get(`/api/v1/hosts/${host.id}/packages?ecosystem=npm`)
      .set(h())
      .expect(200);

    expect(res.body.total).toBe(1);
    expect(res.body.data[0].packageName).toBe("express");
  });
});
