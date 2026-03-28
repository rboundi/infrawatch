import type pg from "pg";
import type { Logger } from "pino";
import { ChangeDetector } from "./change-detector.js";

interface StaleHostCheckerOptions {
  /** How often to check for stale hosts (ms). Default: 1 hour */
  checkIntervalMs?: number;
  /** Hosts not seen for longer than this are marked stale (hours). Default: 24 */
  staleThresholdHours?: number;
}

const DEFAULT_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_STALE_THRESHOLD_HOURS = 24;

export class StaleHostChecker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private checkIntervalMs: number;
  private staleThresholdHours: number;
  private changeDetector: ChangeDetector;

  constructor(
    private pool: pg.Pool,
    private logger: Logger,
    options?: StaleHostCheckerOptions
  ) {
    this.checkIntervalMs = options?.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;
    this.staleThresholdHours = options?.staleThresholdHours ?? DEFAULT_STALE_THRESHOLD_HOURS;
    this.changeDetector = new ChangeDetector(pool, logger);
  }

  start(): void {
    if (this.timer) return;

    this.logger.info(
      { checkIntervalMs: this.checkIntervalMs, staleThresholdHours: this.staleThresholdHours },
      "Stale host checker starting"
    );

    // Run immediately, then on interval
    this.check();
    this.timer = setInterval(() => this.check(), this.checkIntervalMs);
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
      const result = await this.pool.query<{ id: string; hostname: string; scan_target_id: string | null }>(
        `UPDATE hosts
         SET status = 'stale'
         WHERE status = 'active'
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

        // Emit host_disappeared change events
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
        }
      }
    } catch (err) {
      this.logger.error({ err }, "Stale host check failed");
    }
  }
}
