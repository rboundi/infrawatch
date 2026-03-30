import { describe, it, expect, beforeEach } from "vitest";
import { join } from "path";
import { readFile, stat, rm, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import supertest from "supertest";
import pino from "pino";
import { getTestDb } from "./setup.js";
import { getTestApp } from "./app.js";
import { createTestAdmin, getAuthToken, createTestScanTarget, createTestHost, createTestAlert, createTestPackage, createTestService } from "./helpers.js";
import {
  gatherWeeklySummaryData,
  gatherEolReportData,
  gatherAlertReportData,
  gatherHostInventoryData,
} from "../services/reports/report-data.js";
import {
  renderWeeklySummary,
  renderEolReport,
  renderAlertReport,
  renderHostInventory,
} from "../services/reports/report-templates.js";
import { renderToPdf } from "../services/reports/report-renderer.js";
import { ReportGenerator } from "../services/reports/report-generator.js";

const logger = pino({ level: "silent" });

// ─── Test data factories ───

async function createPopulatedDb() {
  const pool = getTestDb();
  const target = await createTestScanTarget();

  // 8 active + 2 stale hosts
  const hosts = [];
  for (let i = 0; i < 8; i++) {
    hosts.push(await createTestHost(target.id, {
      hostname: `active-host-${i}`,
      status: "active",
      environmentTag: i < 4 ? "production" : "staging",
    }));
  }
  for (let i = 0; i < 2; i++) {
    const h = await createTestHost(target.id, { hostname: `stale-host-${i}`, status: "stale" });
    await pool.query(`UPDATE hosts SET last_seen_at = NOW() - INTERVAL '30 days' WHERE id = $1`, [h.id]);
    hosts.push(h);
  }

  // Packages (20 per host = 200 total)
  for (const host of hosts) {
    for (let i = 0; i < 20; i++) {
      await createTestPackage(host.id, { packageName: `pkg-${i}` });
    }
  }

  // 15 alerts: 3 critical, 5 high, 4 medium, 3 low
  const severities = [
    ...Array(3).fill("critical"),
    ...Array(5).fill("high"),
    ...Array(4).fill("medium"),
    ...Array(3).fill("low"),
  ];
  for (let i = 0; i < severities.length; i++) {
    await createTestAlert(hosts[i % 8].id, {
      severity: severities[i],
      packageName: `alert-pkg-${i}`,
    });
  }

  // 5 change events
  for (let i = 0; i < 5; i++) {
    await pool.query(
      `INSERT INTO change_events (host_id, hostname, event_type, category, summary)
       VALUES ($1, $2, $3, $4, $5)`,
      [hosts[i].id, hosts[i].hostname, "package_updated", "package", `Updated pkg-${i}`],
    );
  }

  return { target, hosts };
}

// ──────────────────────────────────────────
// Report Data Gathering
// ──────────────────────────────────────────

describe("Report Data Gathering", () => {
  describe("gatherWeeklySummaryData", () => {
    it("should return correct counts with populated data", async () => {
      await createPopulatedDb();
      const pool = getTestDb();
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const data = await gatherWeeklySummaryData(pool, weekAgo, now);

      expect(data.overview.totalHosts).toBe(10);
      expect(data.overview.activeHosts).toBe(8);
      expect(data.overview.staleHosts).toBe(2);
      expect(data.overview.totalPackages).toBe(200);
      expect(data.alerts.newBySeverity.critical).toBe(3);
      expect(data.alerts.newBySeverity.high).toBe(5);
      expect(data.alerts.newBySeverity.medium).toBe(4);
      expect(data.alerts.newBySeverity.low).toBe(3);
      expect(data.staleHosts.length).toBe(2);
      expect(data.staleHosts.every((h) => h.hostname.startsWith("stale-host-"))).toBe(true);
      expect(data.changes.total).toBeGreaterThanOrEqual(5);

      // No undefined values in overview
      for (const val of Object.values(data.overview)) {
        expect(val).toBeDefined();
        expect(val).not.toBeNull();
      }

      // Period should be set
      expect(data.period.start).toBeDefined();
      expect(data.period.end).toBeDefined();
    });

    it("should return valid zero structure with empty database", async () => {
      const pool = getTestDb();
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const data = await gatherWeeklySummaryData(pool, weekAgo, now);

      expect(data.overview.totalHosts).toBe(0);
      expect(data.overview.activeHosts).toBe(0);
      expect(data.overview.staleHosts).toBe(0);
      expect(data.overview.totalPackages).toBe(0);
      expect(data.alerts.topPackages).toEqual([]);
      expect(data.staleHosts).toEqual([]);
      expect(data.changes.total).toBe(0);
      expect(data.topOutdatedPackages).toEqual([]);
      expect(data.hostsByEnvironment).toEqual([]);
    });

    it("should filter alerts by date range", async () => {
      const pool = getTestDb();
      const target = await createTestScanTarget();
      const host = await createTestHost(target.id);

      // 3 recent alerts
      for (let i = 0; i < 3; i++) {
        await createTestAlert(host.id, { severity: "high", packageName: `recent-${i}` });
      }
      // 2 old alerts (last month)
      for (let i = 0; i < 2; i++) {
        const alert = await createTestAlert(host.id, { severity: "medium", packageName: `old-${i}` });
        await pool.query(
          `UPDATE alerts SET created_at = NOW() - INTERVAL '35 days' WHERE id = $1`,
          [alert.id],
        );
      }

      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const data = await gatherWeeklySummaryData(pool, weekAgo, now);

      const totalNew = Object.values(data.alerts.newBySeverity).reduce((a, b) => a + b, 0);
      expect(totalNew).toBe(3);
    });

    it("should rank topOutdatedPackages by host count descending", async () => {
      const pool = getTestDb();
      const target = await createTestScanTarget();

      // Create hosts and alerts: openssl on 8 hosts, nginx on 5, curl on 2
      const hosts = [];
      for (let i = 0; i < 8; i++) {
        hosts.push(await createTestHost(target.id, { hostname: `rank-host-${i}` }));
      }

      for (let i = 0; i < 8; i++) {
        await createTestAlert(hosts[i].id, { severity: "critical", packageName: "openssl", currentVersion: "1.0", availableVersion: "3.0" });
      }
      for (let i = 0; i < 5; i++) {
        await createTestAlert(hosts[i].id, { severity: "high", packageName: "nginx", currentVersion: "1.18", availableVersion: "1.25" });
      }
      for (let i = 0; i < 2; i++) {
        await createTestAlert(hosts[i].id, { severity: "critical", packageName: "curl", currentVersion: "7.0", availableVersion: "8.0" });
      }

      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const data = await gatherWeeklySummaryData(pool, weekAgo, now);

      expect(data.topOutdatedPackages.length).toBeGreaterThanOrEqual(3);
      expect(data.topOutdatedPackages[0].packageName).toBe("openssl");
      expect(data.topOutdatedPackages[0].hostCount).toBe(8);
      // nginx and curl are both critical/high, check they appear
      const names = data.topOutdatedPackages.map((p) => p.packageName);
      expect(names).toContain("nginx");
      expect(names).toContain("curl");
    });
  });

  describe("gatherAlertReportData", () => {
    it("should return correct alert breakdown", async () => {
      await createPopulatedDb();
      const pool = getTestDb();
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const data = await gatherAlertReportData(pool, weekAgo, now);

      expect(data.summary.total).toBe(15);
      expect(data.summary.critical).toBe(3);
      expect(data.summary.high).toBe(5);
      expect(data.summary.medium).toBe(4);
      expect(data.summary.low).toBe(3);
      expect(data.newAlerts.length).toBe(15);
      expect(data.topVulnerable.length).toBeGreaterThan(0);
    });
  });

  describe("gatherHostInventoryData", () => {
    it("should return all hosts with counts", async () => {
      await createPopulatedDb();
      const pool = getTestDb();

      const data = await gatherHostInventoryData(pool);

      expect(data.summary.totalHosts).toBe(10);
      expect(data.summary.active).toBe(8);
      expect(data.summary.stale).toBe(2);
      expect(data.hosts.length).toBe(10);
      // Each host should have packageCount and serviceCount
      for (const h of data.hosts) {
        expect(h.packageCount).toBeDefined();
        expect(typeof h.packageCount).toBe("number");
      }
    });
  });

  describe("gatherEolReportData", () => {
    it("should return valid structure with empty DB", async () => {
      const pool = getTestDb();
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const data = await gatherEolReportData(pool, weekAgo, now);

      expect(data.summary.pastEol).toBe(0);
      expect(data.summary.upcomingEol).toBe(0);
      expect(data.summary.totalActive).toBe(0);
      expect(data.alerts).toEqual([]);
      expect(data.mostAffectedHosts).toEqual([]);
    });
  });
});

// ──────────────────────────────────────────
// HTML Template Rendering
// ──────────────────────────────────────────

describe("HTML Template Rendering", () => {
  describe("renderWeeklySummary", () => {
    it("should produce valid HTML with correct structure", async () => {
      await createPopulatedDb();
      const pool = getTestDb();
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const data = await gatherWeeklySummaryData(pool, weekAgo, now);

      const html = renderWeeklySummary(data);

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<html>");
      expect(html).toContain("</html>");
      expect(html).toContain("Weekly Infrastructure Report");
      // Contains summary numbers
      expect(html).toContain(String(data.overview.activeHosts));
      expect(html).toContain(String(data.changes.total));
    });

    it("should handle zero alerts gracefully", async () => {
      const pool = getTestDb();
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const data = await gatherWeeklySummaryData(pool, weekAgo, now);

      const html = renderWeeklySummary(data);

      // Should not crash and should produce valid HTML
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("0");
    });

    it("should handle very long package names without crashing", async () => {
      const pool = getTestDb();
      const target = await createTestScanTarget();
      const host = await createTestHost(target.id);
      const longName = "a".repeat(200);
      await createTestAlert(host.id, { packageName: longName, severity: "critical" });

      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const data = await gatherWeeklySummaryData(pool, weekAgo, now);
      const html = renderWeeklySummary(data);

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain(longName);
    });

    it("should HTML-escape special characters to prevent XSS", async () => {
      const pool = getTestDb();
      const target = await createTestScanTarget();
      const xssHostname = "<script>alert('xss')</script>";
      await createTestHost(target.id, { hostname: xssHostname, status: "stale" });
      await pool.query(
        `UPDATE hosts SET last_seen_at = NOW() - INTERVAL '30 days' WHERE hostname = $1`,
        [xssHostname],
      );

      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const data = await gatherWeeklySummaryData(pool, weekAgo, now);
      const html = renderWeeklySummary(data);

      // Should be escaped
      expect(html).toContain("&lt;script&gt;");
      expect(html).not.toContain("<script>alert");
    });

    it("should contain severity-appropriate colors", async () => {
      await createPopulatedDb();
      const pool = getTestDb();
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const data = await gatherWeeklySummaryData(pool, weekAgo, now);
      const html = renderWeeklySummary(data);

      // Critical red, EOL warning colors
      expect(html).toContain("#DC2626");
    });

    it("should produce bar chart elements", async () => {
      await createPopulatedDb();
      const pool = getTestDb();
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const data = await gatherWeeklySummaryData(pool, weekAgo, now);
      const html = renderWeeklySummary(data);

      expect(html).toContain("bar-chart");
      expect(html).toContain("bar-value");
    });
  });

  describe("renderAlertReport", () => {
    it("should produce valid HTML with alert tables", async () => {
      await createPopulatedDb();
      const pool = getTestDb();
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const data = await gatherAlertReportData(pool, weekAgo, now);
      const html = renderAlertReport(data);

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("Alert Report");
      expect(html).toContain("severity-badge");
      // severity colors present
      expect(html).toContain("#DC2626"); // critical
      expect(html).toContain("#EA580C"); // high
    });
  });

  describe("renderHostInventory", () => {
    it("should produce valid HTML with host table", async () => {
      await createPopulatedDb();
      const pool = getTestDb();
      const data = await gatherHostInventoryData(pool);
      const html = renderHostInventory(data);

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("Host Inventory Report");
      expect(html).toContain("active-host-0");
      expect(html).toContain("stale-host-0");
    });

    it("should handle null environmentTag without crashing", async () => {
      const pool = getTestDb();
      const target = await createTestScanTarget();
      await createTestHost(target.id, { hostname: "null-env-host" });
      // environment_tag defaults to 'test' in our helper, let's set it null directly
      await pool.query(`UPDATE hosts SET environment_tag = NULL WHERE hostname = 'null-env-host'`);

      const data = await gatherHostInventoryData(pool);
      const html = renderHostInventory(data);

      expect(html).toContain("<!DOCTYPE html>");
      // Should render "—" for null environment
      expect(html).toContain("null-env-host");
    });
  });

  describe("renderEolReport", () => {
    it("should produce valid HTML for empty EOL data", async () => {
      const pool = getTestDb();
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const data = await gatherEolReportData(pool, weekAgo, now);
      const html = renderEolReport(data);

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("End-of-Life Report");
    });
  });
});

// ──────────────────────────────────────────
// PDF Generation
// ──────────────────────────────────────────

describe("PDF Generation", () => {
  const tempDir = join(tmpdir(), "infrawatch-test-reports");

  beforeEach(async () => {
    await mkdir(tempDir, { recursive: true });
  });

  it("should convert HTML to valid PDF", async () => {
    const pool = getTestDb();
    const data = await gatherHostInventoryData(pool);
    const html = renderHostInventory(data);

    const outputPath = join(tempDir, `test-${randomUUID()}.pdf`);
    await renderToPdf(html, outputPath);

    const fileStats = await stat(outputPath);
    expect(fileStats.size).toBeGreaterThan(1000);
    expect(fileStats.size).toBeLessThan(10 * 1024 * 1024);

    // Check PDF magic bytes
    const buffer = await readFile(outputPath);
    expect(buffer.slice(0, 5).toString()).toBe("%PDF-");

    await rm(outputPath).catch(() => {});
  }, 30_000);

  it("should generate PDF with large data set", async () => {
    await createPopulatedDb();
    const pool = getTestDb();
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const data = await gatherWeeklySummaryData(pool, weekAgo, now);
    const html = renderWeeklySummary(data);

    const outputPath = join(tempDir, `large-${randomUUID()}.pdf`);
    await renderToPdf(html, outputPath);

    const fileStats = await stat(outputPath);
    expect(fileStats.size).toBeGreaterThan(1000);

    const buffer = await readFile(outputPath);
    expect(buffer.slice(0, 5).toString()).toBe("%PDF-");

    await rm(outputPath).catch(() => {});
  }, 30_000);

  it("should generate PDF from minimal HTML", async () => {
    const html = "<html><body><h1>Test</h1></body></html>";
    const outputPath = join(tempDir, `minimal-${randomUUID()}.pdf`);

    await renderToPdf(html, outputPath);

    const buffer = await readFile(outputPath);
    expect(buffer.slice(0, 5).toString()).toBe("%PDF-");

    await rm(outputPath).catch(() => {});
  }, 30_000);

  it("should create output directory if it does not exist", async () => {
    const html = "<html><body><h1>Dir Test</h1></body></html>";
    const nestedDir = join(tempDir, `nested-${randomUUID()}`, "sub", "dir");
    const outputPath = join(nestedDir, "report.pdf");

    await renderToPdf(html, outputPath);

    const fileStats = await stat(outputPath);
    expect(fileStats.size).toBeGreaterThan(0);

    await rm(nestedDir, { recursive: true }).catch(() => {});
  }, 30_000);

  it("should clean up browser instance (no crash on sequential generation)", async () => {
    const html = "<html><body><h1>Cleanup Test</h1></body></html>";

    for (let i = 0; i < 3; i++) {
      const outputPath = join(tempDir, `seq-${i}-${randomUUID()}.pdf`);
      await renderToPdf(html, outputPath);
      const buffer = await readFile(outputPath);
      expect(buffer.slice(0, 5).toString()).toBe("%PDF-");
      await rm(outputPath).catch(() => {});
    }
  }, 60_000);

  it("should have try/finally in renderer for browser cleanup", async () => {
    // Verify the renderer source has proper cleanup pattern
    const rendererSource = await readFile(
      join(import.meta.dirname, "../services/reports/report-renderer.ts"),
      "utf-8",
    );
    expect(rendererSource).toContain("finally");
    expect(rendererSource).toContain("browser.close()");
  });
});

// ──────────────────────────────────────────
// Report API Routes
// ──────────────────────────────────────────

describe("Report API Routes", () => {
  let token: string;

  beforeEach(async () => {
    const admin = await createTestAdmin();
    token = await getAuthToken(admin.username, admin.password);
  });

  describe("Schedule CRUD", () => {
    it("should create, list, update, and delete a schedule", async () => {
      const app = getTestApp();

      // Create
      const createRes = await supertest(app)
        .post("/api/v1/reports/schedules")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Weekly Test",
          reportType: "weekly_summary",
          scheduleCron: "0 8 * * 1",
          recipients: ["admin@test.local"],
        })
        .expect(201);

      expect(createRes.body.name).toBe("Weekly Test");
      expect(createRes.body.reportType).toBe("weekly_summary");
      expect(createRes.body.enabled).toBe(true);
      const id = createRes.body.id;

      // List
      const listRes = await supertest(app)
        .get("/api/v1/reports/schedules")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(listRes.body.length).toBeGreaterThanOrEqual(1);
      expect(listRes.body.some((s: Record<string, unknown>) => s.id === id)).toBe(true);

      // Update
      const updateRes = await supertest(app)
        .patch(`/api/v1/reports/schedules/${id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Updated Schedule", enabled: false })
        .expect(200);

      expect(updateRes.body.name).toBe("Updated Schedule");
      expect(updateRes.body.enabled).toBe(false);

      // Delete
      await supertest(app)
        .delete(`/api/v1/reports/schedules/${id}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(204);

      // Verify deleted
      const afterDelete = await supertest(app)
        .get("/api/v1/reports/schedules")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
      expect(afterDelete.body.some((s: Record<string, unknown>) => s.id === id)).toBe(false);
    });

    it("should reject invalid report type", async () => {
      const app = getTestApp();
      const res = await supertest(app)
        .post("/api/v1/reports/schedules")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Bad", reportType: "invalid_type" })
        .expect(400);

      expect(res.body.error).toContain("reportType");
    });

    it("should reject missing name", async () => {
      const app = getTestApp();
      await supertest(app)
        .post("/api/v1/reports/schedules")
        .set("Authorization", `Bearer ${token}`)
        .send({ reportType: "weekly_summary" })
        .expect(400);
    });

    it("should reject more than 50 recipients", async () => {
      const app = getTestApp();
      const tooMany = Array.from({ length: 51 }, (_, i) => `user${i}@test.local`);
      const res = await supertest(app)
        .post("/api/v1/reports/schedules")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Too Many", reportType: "weekly_summary", recipients: tooMany })
        .expect(400);

      expect(res.body.error).toContain("50");
    });
  });

  describe("Preview endpoint", () => {
    it("should return HTML for weekly_summary preview", async () => {
      const app = getTestApp();
      const res = await supertest(app)
        .post("/api/v1/reports/generate-preview")
        .set("Authorization", `Bearer ${token}`)
        .send({ reportType: "weekly_summary" })
        .expect(200);

      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.text).toContain("<!DOCTYPE html>");
      expect(res.text).toContain("Weekly Infrastructure Report");
    });

    it("should return HTML for alert_report preview", async () => {
      const app = getTestApp();
      const res = await supertest(app)
        .post("/api/v1/reports/generate-preview")
        .set("Authorization", `Bearer ${token}`)
        .send({ reportType: "alert_report" })
        .expect(200);

      expect(res.text).toContain("Alert Report");
    });

    it("should return HTML for host_inventory preview", async () => {
      const app = getTestApp();
      const res = await supertest(app)
        .post("/api/v1/reports/generate-preview")
        .set("Authorization", `Bearer ${token}`)
        .send({ reportType: "host_inventory" })
        .expect(200);

      expect(res.text).toContain("Host Inventory Report");
    });

    it("should return HTML for eol_report preview", async () => {
      const app = getTestApp();
      const res = await supertest(app)
        .post("/api/v1/reports/generate-preview")
        .set("Authorization", `Bearer ${token}`)
        .send({ reportType: "eol_report" })
        .expect(200);

      expect(res.text).toContain("End-of-Life Report");
    });

    it("should reject invalid report type for preview", async () => {
      const app = getTestApp();
      await supertest(app)
        .post("/api/v1/reports/generate-preview")
        .set("Authorization", `Bearer ${token}`)
        .send({ reportType: "bad_type" })
        .expect(400);
    });
  });

  describe("Report history", () => {
    it("should return paginated history", async () => {
      const app = getTestApp();
      const res = await supertest(app)
        .get("/api/v1/reports/history")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body).toHaveProperty("data");
      expect(res.body).toHaveProperty("total");
      expect(res.body).toHaveProperty("page");
      expect(res.body).toHaveProperty("totalPages");
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe("Report download", () => {
    it("should return 404 for non-existent report", async () => {
      const app = getTestApp();
      await supertest(app)
        .get("/api/v1/reports/00000000-0000-0000-0000-000000000000/download")
        .set("Authorization", `Bearer ${token}`)
        .expect(404);
    });

    it("should return 400 for invalid report ID", async () => {
      const app = getTestApp();
      await supertest(app)
        .get("/api/v1/reports/not-a-uuid/download")
        .set("Authorization", `Bearer ${token}`)
        .expect(400);
    });
  });
});

// ──────────────────────────────────────────
// Report Generator (unit)
// ──────────────────────────────────────────

describe("ReportGenerator", () => {
  it("should generate a report and store record in DB", async () => {
    const pool = getTestDb();
    const generator = new ReportGenerator(pool, logger);

    const reportId = await generator.generateReport("weekly_summary");

    // Check DB record exists
    const result = await pool.query(
      "SELECT * FROM generated_reports WHERE id = $1",
      [reportId],
    );
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].report_type).toBe("weekly_summary");
    expect(result.rows[0].title).toContain("Weekly Infrastructure Summary");
    expect(result.rows[0].file_path).toContain("weekly_summary");
    expect(Number(result.rows[0].file_size_bytes)).toBeGreaterThan(0);

    // Clean up the generated file
    await rm(result.rows[0].file_path).catch(() => {});
  }, 30_000);

  it("should generate preview without creating a PDF file or DB record", async () => {
    const pool = getTestDb();
    const generator = new ReportGenerator(pool, logger);

    const countBefore = await pool.query("SELECT COUNT(*)::int AS c FROM generated_reports");

    const html = await generator.generatePreview("weekly_summary");

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Weekly Infrastructure Report");

    const countAfter = await pool.query("SELECT COUNT(*)::int AS c FROM generated_reports");
    expect(countAfter.rows[0].c).toBe(countBefore.rows[0].c);
  });

  it("should throw for unknown report type", async () => {
    const pool = getTestDb();
    const generator = new ReportGenerator(pool, logger);

    await expect(generator.generateReport("nonexistent")).rejects.toThrow("Unknown report type");
  });

  it("should store correct file path structure", async () => {
    const pool = getTestDb();
    const generator = new ReportGenerator(pool, logger);

    const reportId = await generator.generateReport("host_inventory");

    const result = await pool.query("SELECT file_path FROM generated_reports WHERE id = $1", [reportId]);
    const filePath = result.rows[0].file_path;

    // Should contain year/month structure
    const now = new Date();
    const year = now.getFullYear().toString();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    expect(filePath).toContain(year);
    expect(filePath).toContain(month);
    expect(filePath).toContain("host_inventory");
    expect(filePath.endsWith(".pdf")).toBe(true);

    await rm(filePath).catch(() => {});
  }, 30_000);
});

// ──────────────────────────────────────────
// Maintenance / Retention Cleanup
// ──────────────────────────────────────────

describe("Report retention cleanup", () => {
  it("should delete old generated_reports records", async () => {
    const pool = getTestDb();

    // Insert a report with old created_at
    await pool.query(
      `INSERT INTO generated_reports (report_type, title, file_path, created_at)
       VALUES ('weekly_summary', 'Old Report', '/tmp/old.pdf', NOW() - INTERVAL '100 days')`,
    );

    // Insert a recent report
    await pool.query(
      `INSERT INTO generated_reports (report_type, title, file_path, created_at)
       VALUES ('weekly_summary', 'Recent Report', '/tmp/recent.pdf', NOW())`,
    );

    // Run cleanup for reports older than 90 days
    const result = await pool.query(
      `DELETE FROM generated_reports WHERE created_at < NOW() - '90 days'::interval`,
    );
    expect(result.rowCount).toBe(1);

    // Recent report should survive
    const remaining = await pool.query("SELECT title FROM generated_reports");
    expect(remaining.rows.some((r) => r.title === "Recent Report")).toBe(true);
    expect(remaining.rows.some((r) => r.title === "Old Report")).toBe(false);
  });
});
