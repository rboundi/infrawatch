import type pg from "pg";
import type { Logger } from "pino";
import type { SettingsService } from "./settings-service.js";

export class MaintenanceService {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private pool: pg.Pool,
    private logger: Logger,
    private settings: SettingsService,
  ) {}

  /** Schedule daily maintenance at 3:00 AM. */
  start(): void {
    const scheduleNext = () => {
      const now = new Date();
      const next = new Date(now);
      next.setHours(3, 0, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      const delay = next.getTime() - now.getTime();

      this.timer = setTimeout(() => {
        this.run().catch((err) =>
          this.logger.error({ err }, "Maintenance run failed"),
        );
        scheduleNext();
      }, delay);

      this.logger.info(
        { nextRun: next.toISOString() },
        "Maintenance scheduled",
      );
    };

    scheduleNext();
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.logger.info("Maintenance service stopped");
  }

  /** Run all cleanup tasks. */
  async run(): Promise<Record<string, number>> {
    this.logger.info("Maintenance run starting");
    const summary: Record<string, number> = {};

    summary.change_events = await this.deleteOlderThan(
      "change_events",
      "created_at",
      this.settings.get<number>("change_retention_days"),
    );

    summary.audit_log = await this.deleteOlderThan(
      "audit_log",
      "created_at",
      this.settings.get<number>("audit_log_retention_days"),
    );

    summary.notification_log = await this.deleteOlderThan(
      "notification_log",
      "created_at",
      this.settings.get<number>("notification_log_retention_days"),
    );

    summary.scan_logs = await this.deleteOlderThan(
      "scan_logs",
      "started_at",
      this.settings.get<number>("scan_log_retention_days"),
    );

    summary.expired_sessions = await this.deleteExpiredSessions();

    summary.removed_packages = await this.deleteRemovedPackages(
      this.settings.get<number>("removed_package_cleanup_days"),
    );

    summary.stale_connections = await this.deleteOlderThan(
      "host_connections",
      "last_seen_at",
      this.settings.get<number>("stale_connection_cleanup_days"),
    );

    summary.generated_reports = await this.deleteOlderThan(
      "generated_reports",
      "created_at",
      this.settings.get<number>("report_retention_days"),
    );

    this.logger.info({ summary }, "Maintenance run complete");
    return summary;
  }

  private async deleteOlderThan(
    table: string,
    column: string,
    days: number,
  ): Promise<number> {
    // table and column are hardcoded internal strings, not user input
    try {
      const result = await this.pool.query(
        `DELETE FROM ${table} WHERE ${column} < NOW() - $1::interval`,
        [`${days} days`],
      );
      return result.rowCount ?? 0;
    } catch (err) {
      this.logger.error({ err, table }, `Maintenance cleanup failed for ${table}`);
      return 0;
    }
  }

  private async deleteRemovedPackages(days: number): Promise<number> {
    try {
      const result = await this.pool.query(
        "DELETE FROM host_packages WHERE removed_at IS NOT NULL AND removed_at < NOW() - $1::interval",
        [`${days} days`],
      );
      return result.rowCount ?? 0;
    } catch (err) {
      this.logger.error({ err }, "Maintenance cleanup failed for host_packages");
      return 0;
    }
  }

  private async deleteExpiredSessions(): Promise<number> {
    try {
      const result = await this.pool.query(
        "DELETE FROM sessions WHERE expires_at < NOW()",
      );
      return result.rowCount ?? 0;
    } catch (err) {
      this.logger.error({ err }, "Maintenance cleanup failed for sessions");
      return 0;
    }
  }
}
