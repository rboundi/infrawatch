import type pg from "pg";
import type { Logger } from "pino";
import { ChangeDetector } from "./change-detector.js";
import type { NotificationService } from "./notifications/notification-service.js";
import type { SettingsService } from "./settings-service.js";

export class StaleHostChecker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private changeDetector: ChangeDetector;
  private notificationService?: NotificationService;
  private settings?: SettingsService;

  constructor(
    private pool: pg.Pool,
    private logger: Logger,
  ) {
    this.changeDetector = new ChangeDetector(pool, logger);
  }

  setSettings(settings: SettingsService): void {
    this.settings = settings;
  }

  private get staleThresholdHours(): number {
    return this.settings?.get<number>("stale_host_threshold_hours") ?? 24;
  }

  setNotificationService(ns: NotificationService): void {
    this.notificationService = ns;
  }

  start(): void {
    if (this.timer) return;

    const intervalMs = 60 * 60 * 1000; // check hourly
    this.logger.info(
      { checkIntervalMs: intervalMs, staleThresholdHours: this.staleThresholdHours },
      "Stale host checker starting"
    );

    // Run immediately, then on interval
    this.check();
    this.timer = setInterval(() => this.check(), intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.logger.info("Stale host checker stopped");
  }

  private async check(): Promise<void> {
    try {
      // Exclude agent-reported hosts — those are handled by AgentHealthChecker
      // with a separate (typically shorter) threshold.
      const result = await this.pool.query<{ id: string; hostname: string; scan_target_id: string | null }>(
        `UPDATE hosts
         SET status = 'stale'
         WHERE status = 'active'
           AND (reporting_method IS NULL OR reporting_method != 'agent')
           AND last_seen_at < NOW() - ($1 || ' hours')::interval
         RETURNING id, hostname, scan_target_id`,
        [this.staleThresholdHours]
      );

      if (result.rowCount && result.rowCount > 0) {
        const hostnames = result.rows.map((r) => r.hostname);
        this.logger.info(
          { count: result.rowCount, hostnames },
          `Marked ${result.rowCount} host(s) as stale`
        );

        // Emit host_disappeared change events and notifications
        for (const row of result.rows) {
          try {
            await this.changeDetector.recordChangeDirect({
              hostId: row.id,
              hostname: row.hostname,
              eventType: "host_disappeared",
              category: "host",
              summary: `Host went stale: ${row.hostname} (not seen in ${this.staleThresholdHours}h)`,
              details: { thresholdHours: this.staleThresholdHours },
              scanTargetId: row.scan_target_id,
            });
          } catch (changeErr) {
            this.logger.error({ err: changeErr, hostname: row.hostname }, "Failed to record host_disappeared event");
          }

          // Send notification
          if (this.notificationService) {
            this.notificationService.notify({
              eventType: "host_disappeared",
              severity: "high",
              title: `Host Disappeared: ${row.hostname}`,
              summary: `Host ${row.hostname} has not been seen in ${this.staleThresholdHours} hours and was marked stale.`,
              details: {
                hostname: row.hostname,
                hostId: row.id,
                lastSeenAt: new Date().toISOString(),
              },
            }).catch((err) => this.logger.error({ err }, "Failed to send host_disappeared notification"));
          }
        }
      }
    } catch (err) {
      this.logger.error({ err }, "Stale host check failed");
    }
  }
}
