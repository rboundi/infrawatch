import type pg from "pg";
import type { Logger } from "pino";

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

  constructor(
    private pool: pg.Pool,
    private logger: Logger,
    options?: StaleHostCheckerOptions
  ) {
    this.checkIntervalMs = options?.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;
    this.staleThresholdHours = options?.staleThresholdHours ?? DEFAULT_STALE_THRESHOLD_HOURS;
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
      const result = await this.pool.query(
        `UPDATE hosts
         SET status = 'stale'
         WHERE status = 'active'
           AND last_seen_at < NOW() - ($1 || ' hours')::interval
         RETURNING id, hostname`,
        [this.staleThresholdHours]
      );

      if (result.rowCount && result.rowCount > 0) {
        const hostnames = result.rows.map((r: { hostname: string }) => r.hostname);
        this.logger.info(
          { count: result.rowCount, hostnames },
          `Marked ${result.rowCount} host(s) as stale`
        );
      }
    } catch (err) {
      this.logger.error({ err }, "Stale host check failed");
    }
  }
}
