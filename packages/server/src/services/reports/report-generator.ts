import type pg from "pg";
import type { Logger } from "pino";
import cron from "node-cron";
import { join } from "path";
import { stat } from "fs/promises";
import nodemailer from "nodemailer";
import { config } from "../../config.js";
import {
  gatherWeeklySummaryData,
  gatherEolReportData,
  gatherAlertReportData,
  gatherHostInventoryData,
} from "./report-data.js";
import {
  renderWeeklySummary,
  renderEolReport,
  renderAlertReport,
  renderHostInventory,
} from "./report-templates.js";
import { renderToPdf } from "./report-renderer.js";

interface Schedule {
  id: string;
  name: string;
  reportType: string;
  scheduleCron: string;
  recipients: string[];
  filters: Record<string, unknown>;
  enabled: boolean;
}

const REPORT_TYPE_TITLES: Record<string, string> = {
  weekly_summary: "Weekly Infrastructure Summary",
  eol_report: "End-of-Life Report",
  alert_report: "Alert Report",
  host_inventory: "Host Inventory",
};

export class ReportGenerator {
  private tasks = new Map<string, cron.ScheduledTask>();
  private running = false;

  constructor(
    private pool: pg.Pool,
    private logger: Logger
  ) {}

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.logger.info("Report generator starting, loading schedules...");
    await this.loadSchedules();
  }

  stop(): void {
    for (const [id, task] of this.tasks) {
      task.stop();
      this.logger.debug({ scheduleId: id }, "Stopped cron schedule");
    }
    this.tasks.clear();
    this.running = false;
    this.logger.info("Report generator stopped");
  }

  /** Reload schedules from DB — called on start and when schedules change */
  async loadSchedules(): Promise<void> {
    // Stop existing
    for (const task of this.tasks.values()) task.stop();
    this.tasks.clear();

    const result = await this.pool.query<{
      id: string;
      name: string;
      report_type: string;
      schedule_cron: string;
      recipients: string[];
      filters: Record<string, unknown>;
      enabled: boolean;
    }>("SELECT id, name, report_type, schedule_cron, recipients, filters, enabled FROM report_schedules WHERE enabled = true");

    for (const row of result.rows) {
      const schedule: Schedule = {
        id: row.id,
        name: row.name,
        reportType: row.report_type,
        scheduleCron: row.schedule_cron,
        recipients: row.recipients ?? [],
        filters: row.filters ?? {},
        enabled: row.enabled,
      };

      if (!cron.validate(schedule.scheduleCron)) {
        this.logger.warn({ scheduleId: schedule.id, cron: schedule.scheduleCron }, "Invalid cron expression, skipping");
        continue;
      }

      const task = cron.schedule(schedule.scheduleCron, () => {
        this.executeSchedule(schedule).catch((err) => {
          this.logger.error({ err, scheduleId: schedule.id }, "Scheduled report generation failed");
        });
      });
      this.tasks.set(schedule.id, task);
      this.logger.debug({ scheduleId: schedule.id, cron: schedule.scheduleCron, name: schedule.name }, "Registered cron schedule");
    }

    this.logger.info({ count: this.tasks.size }, `Loaded ${this.tasks.size} report schedule(s)`);
  }

  /** Execute a scheduled report generation */
  async executeSchedule(schedule: Schedule): Promise<string> {
    this.logger.info({ scheduleId: schedule.id, type: schedule.reportType }, `Generating report: ${schedule.name}`);

    try {
      const reportId = await this.generateReport(schedule.reportType, schedule.filters, schedule.id);

      // Update schedule status
      await this.pool.query(
        `UPDATE report_schedules SET last_generated_at = NOW(), last_generation_status = 'success' WHERE id = $1`,
        [schedule.id]
      );

      // Email if recipients configured
      if (schedule.recipients.length > 0) {
        await this.emailReport(reportId, schedule.recipients);
      }

      return reportId;
    } catch (err) {
      await this.pool.query(
        `UPDATE report_schedules SET last_generated_at = NOW(), last_generation_status = 'failed' WHERE id = $1`,
        [schedule.id]
      );
      throw err;
    }
  }

  /** Generate a report (used by both scheduled and on-demand) */
  async generateReport(
    reportType: string,
    filters: Record<string, unknown> = {},
    scheduleId?: string
  ): Promise<string> {
    const now = new Date();
    const periodEnd = now;
    const periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // default: 7 days

    // Gather data
    let html: string;
    const title = REPORT_TYPE_TITLES[reportType] ?? reportType;

    switch (reportType) {
      case "weekly_summary": {
        const data = await gatherWeeklySummaryData(this.pool, periodStart, periodEnd, filters);
        html = renderWeeklySummary(data);
        break;
      }
      case "eol_report": {
        const data = await gatherEolReportData(this.pool, periodStart, periodEnd, filters);
        html = renderEolReport(data);
        break;
      }
      case "alert_report": {
        const data = await gatherAlertReportData(this.pool, periodStart, periodEnd, filters);
        html = renderAlertReport(data);
        break;
      }
      case "host_inventory": {
        const data = await gatherHostInventoryData(this.pool, filters);
        html = renderHostInventory(data);
        break;
      }
      default:
        throw new Error(`Unknown report type: ${reportType}`);
    }

    // Generate PDF
    const year = now.getFullYear().toString();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `${reportType}-${timestamp}.pdf`;
    const filePath = join(config.reportStoragePath, year, month, filename);

    await renderToPdf(html, filePath);

    // Get file size
    let fileSize = 0;
    try {
      const stats = await stat(filePath);
      fileSize = Number(stats.size);
    } catch {
      // file size unknown
    }

    // Store record
    const result = await this.pool.query(
      `INSERT INTO generated_reports (report_schedule_id, report_type, title, file_path, file_size_bytes, period_start, period_end, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [scheduleId ?? null, reportType, `${title} — ${timestamp}`, filePath, fileSize, periodStart, periodEnd, JSON.stringify(filters)]
    );

    this.logger.info({ reportId: result.rows[0].id, filePath, fileSize }, "Report generated successfully");
    return result.rows[0].id;
  }

  /** Generate HTML preview without creating PDF */
  async generatePreview(reportType: string, filters: Record<string, unknown> = {}): Promise<string> {
    const now = new Date();
    const periodEnd = now;
    const periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    switch (reportType) {
      case "weekly_summary":
        return renderWeeklySummary(await gatherWeeklySummaryData(this.pool, periodStart, periodEnd, filters));
      case "eol_report":
        return renderEolReport(await gatherEolReportData(this.pool, periodStart, periodEnd, filters));
      case "alert_report":
        return renderAlertReport(await gatherAlertReportData(this.pool, periodStart, periodEnd, filters));
      case "host_inventory":
        return renderHostInventory(await gatherHostInventoryData(this.pool, filters));
      default:
        throw new Error(`Unknown report type: ${reportType}`);
    }
  }

  private async emailReport(reportId: string, recipients: string[]): Promise<void> {
    if (!config.smtp.host || !config.smtp.user) {
      this.logger.debug("SMTP not configured, skipping email");
      return;
    }

    const report = await this.pool.query<{
      title: string;
      file_path: string;
      report_type: string;
    }>("SELECT title, file_path, report_type FROM generated_reports WHERE id = $1", [reportId]);

    if (report.rowCount === 0) return;
    const r = report.rows[0];

    const transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
    });

    try {
      await transporter.sendMail({
        from: `InfraWatch Reports <${config.smtp.user}>`,
        to: recipients.join(", "),
        subject: `[InfraWatch] ${r.title}`,
        text: `Your scheduled report "${r.title}" has been generated.\n\nPlease find the PDF attached.`,
        attachments: [{ filename: `${r.report_type}-report.pdf`, path: r.file_path }],
      });
      this.logger.info({ reportId, recipients }, "Report emailed successfully");
    } catch (err) {
      this.logger.error({ err, reportId }, "Failed to email report");
    }
  }
}
