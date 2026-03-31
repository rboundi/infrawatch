import type pg from "pg";
import type { Logger } from "pino";
import { ChangeDetector } from "./change-detector.js";
import type { NotificationService } from "./notifications/notification-service.js";
import type { SettingsService } from "./settings-service.js";

/**
 * Monitors agent-reported hosts for health issues.
 * Runs every 30 minutes.
 *
 * - Marks agent hosts as stale if they haven't reported within the agent_stale_threshold_hours.
 * - Sends notifications for agent hosts that haven't reported within agent_offline_alert_hours.
 */
export class AgentHealthChecker {
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

  setNotificationService(ns: NotificationService): void {
    this.notificationService = ns;
  }

  private get staleThresholdHours(): number {
    return this.settings?.get<number>("agent_stale_threshold_hours") ?? 12;
  }

  private get offlineAlertHours(): number {
    return this.settings?.get<number>("agent_offline_alert_hours") ?? 48;
  }

  start(): void {
    if (this.timer) return;

    const intervalMs = 30 * 60 * 1000; // 30 minutes
    this.logger.info(
      {
        checkIntervalMs: intervalMs,
        staleThresholdHours: this.staleThresholdHours,
        offlineAlertHours: this.offlineAlertHours,
      },
      "Agent health checker starting",
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
    this.logger.info("Agent health checker stopped");
  }

  private async check(): Promise<void> {
    try {
      await this.markStaleAgents();
      await this.alertOfflineAgents();
    } catch (err) {
      this.logger.error({ err }, "Agent health check failed");
    }
  }

  /**
   * Mark agent-reported hosts as stale if they haven't been seen
   * within agent_stale_threshold_hours.
   */
  private async markStaleAgents(): Promise<void> {
    const result = await this.pool.query<{
      id: string;
      hostname: string;
      scan_target_id: string | null;
    }>(
      `UPDATE hosts
       SET status = 'stale'
       WHERE status = 'active'
         AND reporting_method = 'agent'
         AND last_seen_at < NOW() - ($1 || ' hours')::interval
       RETURNING id, hostname, scan_target_id`,
      [this.staleThresholdHours],
    );

    if (result.rowCount && result.rowCount > 0) {
      const hostnames = result.rows.map((r) => r.hostname);
      this.logger.info(
        { count: result.rowCount, hostnames },
        `Marked ${result.rowCount} agent host(s) as stale`,
      );

      for (const row of result.rows) {
        try {
          await this.changeDetector.recordChangeDirect({
            hostId: row.id,
            hostname: row.hostname,
            eventType: "host_disappeared",
            category: "host",
            summary: `Agent host went stale: ${row.hostname} (no report in ${this.staleThresholdHours}h)`,
            details: {
              thresholdHours: this.staleThresholdHours,
              reportingMethod: "agent",
            },
            scanTargetId: row.scan_target_id,
          });
        } catch (changeErr) {
          this.logger.error(
            { err: changeErr, hostname: row.hostname },
            "Failed to record agent host_disappeared event",
          );
        }

        if (this.notificationService) {
          this.notificationService
            .notify({
              eventType: "host_disappeared",
              severity: "high",
              title: `Agent Host Stale: ${row.hostname}`,
              summary: `Agent host ${row.hostname} has not reported in ${this.staleThresholdHours} hours.`,
              details: {
                hostname: row.hostname,
                hostId: row.id,
                reportingMethod: "agent",
              },
            })
            .catch((err) =>
              this.logger.error({ err }, "Failed to send agent stale notification"),
            );
        }
      }
    }
  }

  /**
   * Send notification for agent hosts that are offline beyond the alert threshold.
   * Only alerts once per host (uses a tracking column or checks last notification).
   */
  private async alertOfflineAgents(): Promise<void> {
    // Find agent hosts that are stale AND last seen more than offlineAlertHours ago,
    // but haven't had an offline notification recently (check change_events).
    const result = await this.pool.query<{
      id: string;
      hostname: string;
      last_seen_at: string;
      scan_target_id: string | null;
    }>(
      `SELECT h.id, h.hostname, h.last_seen_at, h.scan_target_id
       FROM hosts h
       WHERE h.reporting_method = 'agent'
         AND h.status = 'stale'
         AND h.last_seen_at < NOW() - ($1 || ' hours')::interval
         AND NOT EXISTS (
           SELECT 1 FROM change_events ce
           WHERE ce.host_id = h.id
             AND ce.event_type = 'agent_offline'
             AND ce.created_at > NOW() - INTERVAL '7 days'
         )`,
      [this.offlineAlertHours],
    );

    if (result.rows.length === 0) return;

    this.logger.warn(
      { count: result.rows.length, hostnames: result.rows.map((r) => r.hostname) },
      `${result.rows.length} agent host(s) offline beyond ${this.offlineAlertHours}h threshold`,
    );

    for (const row of result.rows) {
      try {
        await this.changeDetector.recordChangeDirect({
          hostId: row.id,
          hostname: row.hostname,
          eventType: "agent_offline",
          category: "host",
          summary: `Agent offline: ${row.hostname} (no report in ${this.offlineAlertHours}h)`,
          details: {
            offlineAlertHours: this.offlineAlertHours,
            lastSeenAt: row.last_seen_at,
            reportingMethod: "agent",
          },
          scanTargetId: row.scan_target_id,
        });
      } catch (changeErr) {
        this.logger.error(
          { err: changeErr, hostname: row.hostname },
          "Failed to record agent_offline event",
        );
      }

      if (this.notificationService) {
        this.notificationService
          .notify({
            eventType: "host_disappeared",
            severity: "critical",
            title: `Agent Offline: ${row.hostname}`,
            summary: `Agent host ${row.hostname} has been offline for over ${this.offlineAlertHours} hours. Last report: ${row.last_seen_at}.`,
            details: {
              hostname: row.hostname,
              hostId: row.id,
              lastSeenAt: row.last_seen_at,
              reportingMethod: "agent",
            },
          })
          .catch((err) =>
            this.logger.error({ err }, "Failed to send agent offline notification"),
          );
      }
    }
  }
}
