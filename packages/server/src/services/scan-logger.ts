import { EventEmitter } from "events";
import type pg from "pg";
import type { Logger } from "pino";

export interface ScanLogEntry {
  id: string;
  scanLogId: string;
  timestamp: string;
  level: "info" | "warn" | "error" | "success";
  message: string;
}

/**
 * ScanLogger persists granular log entries to scan_log_entries and
 * pushes them in real-time to SSE subscribers via an in-memory EventEmitter.
 */
export class ScanLogger {
  private emitter = new EventEmitter();

  constructor(
    private pool: pg.Pool,
    private logger: Logger,
  ) {
    // Allow many concurrent SSE listeners per scan
    this.emitter.setMaxListeners(100);
  }

  /**
   * Log a message for a scan. Persists to DB and emits to subscribers.
   */
  async log(
    scanLogId: string,
    level: ScanLogEntry["level"],
    message: string,
  ): Promise<void> {
    try {
      const result = await this.pool.query<{ id: string; timestamp: string }>(
        `INSERT INTO scan_log_entries (scan_log_id, level, message)
         VALUES ($1, $2, $3)
         RETURNING id, timestamp`,
        [scanLogId, level, message],
      );

      const entry: ScanLogEntry = {
        id: result.rows[0].id,
        scanLogId,
        timestamp: result.rows[0].timestamp,
        level,
        message,
      };

      this.emitter.emit(`entry:${scanLogId}`, entry);
    } catch (err) {
      // Fire-and-forget — never block the scan
      this.logger.error({ err, scanLogId }, "Failed to write scan log entry");
    }
  }

  /**
   * Signal that a scan has completed. Emits done event and cleans up listeners.
   */
  complete(scanLogId: string, status: "success" | "failed"): void {
    this.emitter.emit(`done:${scanLogId}`, { status });
    // Clean up all listeners for this scan after a short delay
    setTimeout(() => {
      this.emitter.removeAllListeners(`entry:${scanLogId}`);
      this.emitter.removeAllListeners(`done:${scanLogId}`);
    }, 1000);
  }

  /**
   * Get all entries for a scan log (for initial SSE burst / historical view).
   */
  async getEntries(scanLogId: string): Promise<ScanLogEntry[]> {
    const result = await this.pool.query<{
      id: string;
      scan_log_id: string;
      timestamp: string;
      level: ScanLogEntry["level"];
      message: string;
    }>(
      `SELECT id, scan_log_id, timestamp, level, message
       FROM scan_log_entries
       WHERE scan_log_id = $1
       ORDER BY timestamp ASC`,
      [scanLogId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      scanLogId: row.scan_log_id,
      timestamp: row.timestamp,
      level: row.level,
      message: row.message,
    }));
  }

  /**
   * Subscribe to live log entries for a scan.
   */
  subscribe(
    scanLogId: string,
    onEntry: (entry: ScanLogEntry) => void,
  ): void {
    this.emitter.on(`entry:${scanLogId}`, onEntry);
  }

  /**
   * Unsubscribe from live log entries.
   */
  unsubscribe(
    scanLogId: string,
    onEntry: (entry: ScanLogEntry) => void,
  ): void {
    this.emitter.off(`entry:${scanLogId}`, onEntry);
  }

  /**
   * Subscribe to scan completion event.
   */
  subscribeCompletion(
    scanLogId: string,
    onDone: (data: { status: string }) => void,
  ): void {
    this.emitter.on(`done:${scanLogId}`, onDone);
  }

  /**
   * Unsubscribe from scan completion event.
   */
  unsubscribeCompletion(
    scanLogId: string,
    onDone: (data: { status: string }) => void,
  ): void {
    this.emitter.off(`done:${scanLogId}`, onDone);
  }
}
