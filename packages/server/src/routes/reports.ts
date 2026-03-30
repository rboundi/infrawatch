import { Router } from "express";
import type pg from "pg";
import type { Logger } from "pino";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { basename } from "path";
import { ReportGenerator } from "../services/reports/report-generator.js";
import type { AuditLogger } from "../services/audit-logger.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_REPORT_TYPES = ["weekly_summary", "eol_report", "alert_report", "host_inventory"];

export function createReportRoutes(pool: pg.Pool, logger: Logger, reportGenerator: ReportGenerator, audit?: AuditLogger): Router {
  const router = Router();

  // GET /reports/schedules
  router.get("/schedules", async (_req, res, next) => {
    try {
      const result = await pool.query(
        `SELECT id, name, report_type, schedule_cron, recipients, filters, enabled,
                last_generated_at, last_generation_status, created_at
         FROM report_schedules ORDER BY created_at DESC`
      );
      res.json(result.rows.map(formatSchedule));
    } catch (err) {
      next(err);
    }
  });

  // POST /reports/schedules
  router.post("/schedules", async (req, res, next) => {
    try {
      const { name, reportType, scheduleCron, recipients, filters, enabled } = req.body;

      if (!name || !reportType) {
        return res.status(400).json({ error: "name and reportType are required" });
      }
      if (!VALID_REPORT_TYPES.includes(reportType)) {
        return res.status(400).json({ error: `Invalid reportType. Must be one of: ${VALID_REPORT_TYPES.join(", ")}` });
      }
      if (recipients && !Array.isArray(recipients)) {
        return res.status(400).json({ error: "recipients must be an array of email addresses" });
      }
      if (recipients && recipients.length > 50) {
        return res.status(400).json({ error: "Maximum 50 recipients allowed" });
      }

      const result = await pool.query(
        `INSERT INTO report_schedules (name, report_type, schedule_cron, recipients, filters, enabled)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          name,
          reportType,
          scheduleCron ?? "0 8 * * 1",
          recipients ?? [],
          JSON.stringify(filters ?? {}),
          enabled ?? true,
        ]
      );

      // Reload cron schedules
      await reportGenerator.loadSchedules();

      const created = result.rows[0];
      audit?.log({
        userId: req.user?.id,
        username: req.user?.username ?? "system",
        action: "report_schedule.created",
        entityType: "report_schedule",
        entityId: created.id,
        details: { name, reportType, scheduleCron: scheduleCron ?? "0 8 * * 1", enabled: enabled ?? true },
        ipAddress: req.ip ?? null,
      });

      res.status(201).json(formatSchedule(created));
    } catch (err) {
      next(err);
    }
  });

  // PATCH /reports/schedules/:id
  router.patch("/schedules/:id", async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!UUID_RE.test(id)) {
        return res.status(400).json({ error: "Invalid schedule ID format" });
      }

      const { name, reportType, scheduleCron, recipients, filters, enabled } = req.body;

      if (reportType && !VALID_REPORT_TYPES.includes(reportType)) {
        return res.status(400).json({ error: `Invalid reportType. Must be one of: ${VALID_REPORT_TYPES.join(", ")}` });
      }

      const result = await pool.query(
        `UPDATE report_schedules SET
           name = COALESCE($1, name),
           report_type = COALESCE($2, report_type),
           schedule_cron = COALESCE($3, schedule_cron),
           recipients = COALESCE($4, recipients),
           filters = COALESCE($5, filters),
           enabled = COALESCE($6, enabled)
         WHERE id = $7
         RETURNING *`,
        [
          name ?? null,
          reportType ?? null,
          scheduleCron ?? null,
          recipients ?? null,
          filters ? JSON.stringify(filters) : null,
          enabled ?? null,
          id,
        ]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: "Schedule not found" });
      }

      // Reload cron schedules
      await reportGenerator.loadSchedules();

      audit?.log({
        userId: req.user?.id,
        username: req.user?.username ?? "system",
        action: "report_schedule.updated",
        entityType: "report_schedule",
        entityId: id,
        details: { name, reportType, scheduleCron, recipients, filters, enabled },
        ipAddress: req.ip ?? null,
      });

      res.json(formatSchedule(result.rows[0]));
    } catch (err) {
      next(err);
    }
  });

  // DELETE /reports/schedules/:id
  router.delete("/schedules/:id", async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!UUID_RE.test(id)) {
        return res.status(400).json({ error: "Invalid schedule ID format" });
      }

      const result = await pool.query("DELETE FROM report_schedules WHERE id = $1 RETURNING id", [id]);
      if (result.rowCount === 0) {
        return res.status(404).json({ error: "Schedule not found" });
      }

      await reportGenerator.loadSchedules();

      audit?.log({
        userId: req.user?.id,
        username: req.user?.username ?? "system",
        action: "report_schedule.deleted",
        entityType: "report_schedule",
        entityId: id,
        details: {},
        ipAddress: req.ip ?? null,
      });

      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // POST /reports/schedules/:id/generate — trigger immediate generation
  router.post("/schedules/:id/generate", async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!UUID_RE.test(id)) {
        return res.status(400).json({ error: "Invalid schedule ID format" });
      }

      const scheduleResult = await pool.query(
        "SELECT id, name, report_type, schedule_cron, recipients, filters, enabled FROM report_schedules WHERE id = $1",
        [id]
      );
      if (scheduleResult.rowCount === 0) {
        return res.status(404).json({ error: "Schedule not found" });
      }

      const row = scheduleResult.rows[0];
      const reportId = await reportGenerator.executeSchedule({
        id: row.id,
        name: row.name,
        reportType: row.report_type,
        scheduleCron: row.schedule_cron,
        recipients: row.recipients ?? [],
        filters: row.filters ?? {},
        enabled: row.enabled,
      });

      audit?.log({
        userId: req.user?.id,
        username: req.user?.username ?? "system",
        action: "report.generated",
        entityType: "report_schedule",
        entityId: id,
        details: { reportId, reportType: row.report_type, scheduleName: row.name },
        ipAddress: req.ip ?? null,
      });

      res.json({ message: "Report generated", reportId });
    } catch (err) {
      next(err);
    }
  });

  // POST /reports/generate-preview — returns HTML for browser preview
  router.post("/generate-preview", async (req, res, next) => {
    try {
      const { reportType, filters } = req.body;
      if (!reportType || !VALID_REPORT_TYPES.includes(reportType)) {
        return res.status(400).json({ error: `Invalid reportType. Must be one of: ${VALID_REPORT_TYPES.join(", ")}` });
      }

      const html = await reportGenerator.generatePreview(reportType, filters ?? {});

      audit?.log({
        userId: req.user?.id,
        username: req.user?.username ?? "system",
        action: "report.preview_generated",
        entityType: "report",
        entityId: null,
        details: { reportType, filters: filters ?? {} },
        ipAddress: req.ip ?? null,
      });

      res.type("html").send(html);
    } catch (err) {
      next(err);
    }
  });

  // GET /reports/history — paginated list
  router.get("/history", async (req, res, next) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string ?? "1", 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string ?? "20", 10) || 20));
      const offset = (page - 1) * limit;

      const countResult = await pool.query("SELECT COUNT(*)::int AS total FROM generated_reports");
      const total = countResult.rows[0].total;

      const result = await pool.query(
        `SELECT gr.id, gr.report_schedule_id, gr.report_type, gr.title, gr.file_path,
                gr.file_size_bytes, gr.period_start, gr.period_end, gr.metadata, gr.created_at,
                rs.name AS schedule_name
         FROM generated_reports gr
         LEFT JOIN report_schedules rs ON rs.id = gr.report_schedule_id
         ORDER BY gr.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );

      res.json({
        data: result.rows.map((r) => ({
          id: r.id,
          reportScheduleId: r.report_schedule_id,
          scheduleName: r.schedule_name,
          reportType: r.report_type,
          title: r.title,
          fileSizeBytes: Number(r.file_size_bytes),
          periodStart: r.period_start,
          periodEnd: r.period_end,
          metadata: r.metadata,
          createdAt: r.created_at,
        })),
        total,
        page,
        totalPages: Math.ceil(total / limit),
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /reports/:id/download — returns PDF file
  router.get("/:id/download", async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!UUID_RE.test(id)) {
        return res.status(400).json({ error: "Invalid report ID format" });
      }

      const result = await pool.query(
        "SELECT file_path, title, report_type FROM generated_reports WHERE id = $1",
        [id]
      );
      if (result.rowCount === 0) {
        return res.status(404).json({ error: "Report not found" });
      }

      const { file_path, title, report_type } = result.rows[0];

      // Verify file exists
      try {
        await stat(file_path);
      } catch {
        return res.status(404).json({ error: "Report file not found on disk" });
      }

      const filename = `${report_type}-${basename(file_path)}`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

      const stream = createReadStream(file_path);
      stream.pipe(res);
      stream.on("error", (err) => {
        logger.error({ err, reportId: id }, "Error streaming report file");
        if (!res.headersSent) {
          res.status(500).json({ error: "Error reading report file" });
        }
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function formatSchedule(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    reportType: row.report_type,
    scheduleCron: row.schedule_cron,
    recipients: row.recipients,
    filters: row.filters,
    enabled: row.enabled,
    lastGeneratedAt: row.last_generated_at,
    lastGenerationStatus: row.last_generation_status,
    createdAt: row.created_at,
  };
}
