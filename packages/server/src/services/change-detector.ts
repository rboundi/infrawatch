import type pg from "pg";
import type { Logger } from "pino";

export interface ChangeEvent {
  hostId: string | null;
  hostname: string;
  eventType: string;
  category: string;
  summary: string;
  details: Record<string, unknown>;
  scanTargetId: string | null;
}

export class ChangeDetector {
  constructor(
    private pool: pg.Pool,
    private logger: Logger
  ) {}

  /**
   * Record a change event inside an existing transaction.
   */
  async recordChange(
    client: pg.PoolClient,
    event: ChangeEvent
  ): Promise<void> {
    await client.query(
      `INSERT INTO change_events (host_id, hostname, event_type, category, summary, details, scan_target_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        event.hostId,
        event.hostname,
        event.eventType,
        event.category,
        event.summary,
        JSON.stringify(event.details),
        event.scanTargetId,
      ]
    );
  }

  /**
   * Record a change event using the pool directly (no existing transaction).
   */
  async recordChangeDirect(event: ChangeEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO change_events (host_id, hostname, event_type, category, summary, details, scan_target_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        event.hostId,
        event.hostname,
        event.eventType,
        event.category,
        event.summary,
        JSON.stringify(event.details),
        event.scanTargetId,
      ]
    );
  }

  /**
   * Take a daily snapshot of current infrastructure counts.
   */
  async takeSnapshot(): Promise<void> {
    try {
      const result = await this.pool.query(`
        SELECT
          (SELECT COUNT(*) FROM hosts)::int AS total_hosts,
          (SELECT COUNT(*) FROM hosts WHERE status = 'active')::int AS active_hosts,
          (SELECT COUNT(*) FROM discovered_packages WHERE removed_at IS NULL)::int AS total_packages,
          (SELECT COUNT(*) FROM services)::int AS total_services,
          (SELECT COUNT(*) FROM alerts WHERE acknowledged = false)::int AS total_alerts,
          (SELECT COUNT(*) FROM alerts WHERE acknowledged = false AND severity = 'critical')::int AS critical_alerts
      `);

      const row = result.rows[0];
      await this.pool.query(
        `INSERT INTO change_snapshots (snapshot_date, total_hosts, active_hosts, total_packages, total_services, total_alerts, critical_alerts)
         VALUES (CURRENT_DATE, $1, $2, $3, $4, $5, $6)
         ON CONFLICT (snapshot_date) DO UPDATE SET
           total_hosts = EXCLUDED.total_hosts,
           active_hosts = EXCLUDED.active_hosts,
           total_packages = EXCLUDED.total_packages,
           total_services = EXCLUDED.total_services,
           total_alerts = EXCLUDED.total_alerts,
           critical_alerts = EXCLUDED.critical_alerts`,
        [
          row.total_hosts,
          row.active_hosts,
          row.total_packages,
          row.total_services,
          row.total_alerts,
          row.critical_alerts,
        ]
      );

      this.logger.info("Daily change snapshot recorded");
    } catch (err) {
      this.logger.error({ err }, "Failed to take daily snapshot");
    }
  }
}
