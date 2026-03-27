import nodemailer from "nodemailer";
import type pg from "pg";
import type { Logger } from "pino";
import { config } from "../config.js";

interface EmailNotifierOptions {
  /** Hour of day (0-23) to send digest. Default: from config (8) */
  digestHour?: number;
  /** Check interval for scheduling (ms). Default: 15 minutes */
  checkIntervalMs?: number;
}

export class EmailNotifier {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastDigestDate: string | null = null;
  private digestHour: number;
  private checkIntervalMs: number;

  constructor(
    private pool: pg.Pool,
    private logger: Logger,
    options?: EmailNotifierOptions
  ) {
    this.digestHour = options?.digestHour ?? config.alertDigestHour;
    this.checkIntervalMs = options?.checkIntervalMs ?? 15 * 60 * 1000;
  }

  start(): void {
    if (this.timer) return;

    if (!this.isSmtpConfigured()) {
      this.logger.warn(
        "SMTP not configured — email notifications disabled. Set SMTP_HOST, SMTP_USER, SMTP_PASS, and ALERT_EMAIL to enable."
      );
      return;
    }

    this.logger.info(
      { digestHour: this.digestHour, checkIntervalMs: this.checkIntervalMs },
      "Email notifier started"
    );

    // Check periodically if it's time to send the digest
    this.timer = setInterval(() => this.checkSchedule(), this.checkIntervalMs);
    // Also check immediately in case we're past the hour
    this.checkSchedule();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.logger.info("Email notifier stopped");
  }

  private isSmtpConfigured(): boolean {
    return !!(config.smtp.host && config.alertEmail);
  }

  private async checkSchedule(): Promise<void> {
    const now = new Date();
    const currentHour = now.getHours();
    const todayDate = now.toISOString().slice(0, 10); // YYYY-MM-DD

    // Send digest if current hour matches and we haven't sent today
    if (currentHour === this.digestHour && this.lastDigestDate !== todayDate) {
      this.lastDigestDate = todayDate;
      try {
        await this.sendAlertDigest();
      } catch (err) {
        this.logger.error({ err }, "Failed to send alert digest");
      }
    }
  }

  /**
   * Query critical/high alerts from the last 24 hours and send a digest email.
   */
  async sendAlertDigest(): Promise<void> {
    if (!this.isSmtpConfigured()) {
      this.logger.warn("SMTP not configured — skipping alert digest");
      return;
    }

    // Query recent critical/high alerts
    const result = await this.pool.query<{
      id: string;
      package_name: string;
      current_version: string;
      available_version: string;
      severity: string;
      created_at: Date;
      hostname: string;
    }>(
      `SELECT
         a.id,
         a.package_name,
         a.current_version,
         a.available_version,
         a.severity,
         a.created_at,
         h.hostname
       FROM alerts a
       JOIN hosts h ON h.id = a.host_id
       WHERE a.severity IN ('critical', 'high')
         AND a.created_at >= NOW() - INTERVAL '24 hours'
         AND a.acknowledged = false
       ORDER BY
         CASE a.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 END,
         a.created_at DESC`
    );

    if (result.rows.length === 0) {
      this.logger.info("No critical/high alerts in last 24 hours — skipping digest email");
      return;
    }

    const alerts = result.rows;
    const criticalCount = alerts.filter((a) => a.severity === "critical").length;
    const highCount = alerts.filter((a) => a.severity === "high").length;

    const html = this.buildDigestHtml(alerts, criticalCount, highCount);

    const transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth:
        config.smtp.user && config.smtp.pass
          ? { user: config.smtp.user, pass: config.smtp.pass }
          : undefined,
    });

    const subject = `[InfraWatch] ${criticalCount + highCount} alert(s) — ${criticalCount} critical, ${highCount} high`;

    await transporter.sendMail({
      from: config.smtp.user || "infrawatch@localhost",
      to: config.alertEmail,
      subject,
      html,
    });

    this.logger.info(
      { to: config.alertEmail, critical: criticalCount, high: highCount },
      "Alert digest email sent"
    );
  }

  private buildDigestHtml(
    alerts: Array<{
      id: string;
      package_name: string;
      current_version: string;
      available_version: string;
      severity: string;
      created_at: Date;
      hostname: string;
    }>,
    criticalCount: number,
    highCount: number
  ): string {
    const rows = alerts
      .map(
        (a) => `
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 8px 12px;">
          <span style="
            display: inline-block;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 600;
            color: white;
            background-color: ${a.severity === "critical" ? "#dc2626" : "#f59e0b"};
          ">${a.severity.toUpperCase()}</span>
        </td>
        <td style="padding: 8px 12px;">${escapeHtml(a.hostname)}</td>
        <td style="padding: 8px 12px;">${escapeHtml(a.package_name)}</td>
        <td style="padding: 8px 12px;"><code>${escapeHtml(a.current_version)}</code></td>
        <td style="padding: 8px 12px;"><code>${escapeHtml(a.available_version)}</code></td>
        <td style="padding: 8px 12px; font-size: 12px; color: #64748b;">${new Date(a.created_at).toLocaleString()}</td>
      </tr>`
      )
      .join("\n");

    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1e293b; max-width: 800px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 12px;">
    InfraWatch Alert Digest
  </h2>

  <p style="font-size: 15px; color: #475569;">
    <strong>${criticalCount + highCount}</strong> unacknowledged alert(s) in the last 24 hours:
    ${criticalCount > 0 ? `<span style="color: #dc2626; font-weight: 600;">${criticalCount} critical</span>` : ""}
    ${criticalCount > 0 && highCount > 0 ? " &middot; " : ""}
    ${highCount > 0 ? `<span style="color: #f59e0b; font-weight: 600;">${highCount} high</span>` : ""}
  </p>

  <table style="width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 14px;">
    <thead>
      <tr style="background-color: #f8fafc; border-bottom: 2px solid #e2e8f0;">
        <th style="padding: 8px 12px; text-align: left;">Severity</th>
        <th style="padding: 8px 12px; text-align: left;">Host</th>
        <th style="padding: 8px 12px; text-align: left;">Package</th>
        <th style="padding: 8px 12px; text-align: left;">Installed</th>
        <th style="padding: 8px 12px; text-align: left;">Available</th>
        <th style="padding: 8px 12px; text-align: left;">Detected</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>

  <p style="margin-top: 24px; font-size: 12px; color: #94a3b8;">
    This is an automated alert digest from InfraWatch. Review and acknowledge alerts in the dashboard.
  </p>
</body>
</html>`;
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
