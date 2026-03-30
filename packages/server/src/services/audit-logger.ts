import type pg from "pg";
import type { Logger } from "pino";

export interface AuditEntry {
  userId?: string | null;
  username: string;
  action: string;
  entityType?: string;
  entityId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string | null;
}

export class AuditLogger {
  constructor(
    private pool: pg.Pool,
    private logger: Logger,
  ) {}

  /**
   * Log an audit event. Fire-and-forget — never throws, never blocks callers.
   */
  log(entry: AuditEntry): void {
    this.pool
      .query(
        `INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          entry.userId ?? null,
          entry.username,
          entry.action,
          entry.entityType ?? null,
          entry.entityId ?? null,
          JSON.stringify(entry.details ?? {}),
          entry.ipAddress ?? null,
        ],
      )
      .catch((err) => {
        this.logger.error({ err, entry }, "Failed to write audit log");
      });
  }
}
