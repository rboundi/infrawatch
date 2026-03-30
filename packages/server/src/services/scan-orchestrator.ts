import type pg from "pg";
import type { Logger } from "pino";
import { createScanner } from "@infrawatch/scanner";
import { decrypt } from "../utils/crypto.js";
import { config } from "../config.js";
import { DataIngestionService } from "./data-ingestion.js";
import type { NotificationService } from "./notifications/notification-service.js";
import type { GroupAssignmentService } from "./group-assignment.js";
import type { ComplianceScorer } from "./compliance-scorer.js";
import type { SettingsService } from "./settings-service.js";
import type { ScanLogger } from "./scan-logger.js";

export class ScanOrchestrator {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private stopping = false;
  private ingestion: DataIngestionService;
  private notificationService?: NotificationService;
  private complianceScorer?: ComplianceScorer;
  private settings?: SettingsService;
  private scanLogger?: ScanLogger;

  constructor(
    private pool: pg.Pool,
    private logger: Logger,
  ) {
    this.ingestion = new DataIngestionService(pool, logger);
  }

  setSettings(settings: SettingsService): void {
    this.settings = settings;
  }

  private get checkIntervalMs(): number {
    return (this.settings?.get<number>("scan_check_interval_minutes") ?? 5) * 60 * 1000;
  }

  private get scanTimeoutMs(): number {
    return (this.settings?.get<number>("scan_timeout_minutes") ?? 5) * 60 * 1000;
  }

  setGroupAssignment(service: GroupAssignmentService): void {
    this.ingestion.setGroupAssignment(service);
  }

  setNotificationService(ns: NotificationService): void {
    this.notificationService = ns;
  }

  setComplianceScorer(scorer: ComplianceScorer): void {
    this.complianceScorer = scorer;
  }

  setScanLogger(sl: ScanLogger): void {
    this.scanLogger = sl;
  }

  /**
   * Start the orchestrator. Runs an immediate check, then checks on interval.
   */
  start(): void {
    if (this.timer) return;

    this.logger.info(
      { checkIntervalMs: this.checkIntervalMs, scanTimeoutMs: this.scanTimeoutMs },
      "Scan orchestrator starting"
    );

    // Run immediately, then on interval
    this.tick();
    this.timer = setInterval(() => this.tick(), this.checkIntervalMs);
  }

  /**
   * Stop the orchestrator gracefully. Waits for current scan to finish.
   */
  async stop(): Promise<void> {
    this.logger.info("Scan orchestrator stopping...");
    this.stopping = true;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    // Wait for any in-progress scan to finish (up to scanTimeoutMs + 5s buffer)
    const deadline = Date.now() + this.scanTimeoutMs + 5000;
    while (this.running && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
    }

    this.logger.info("Scan orchestrator stopped");
  }

  /**
   * Single tick: find due targets and scan them sequentially.
   */
  private async tick(): Promise<void> {
    if (this.running || this.stopping) return;
    this.running = true;

    try {
      const targets = await this.findDueTargets();

      if (targets.length > 0) {
        this.logger.info(
          { count: targets.length },
          `Found ${targets.length} target(s) due for scanning`
        );
      }

      for (const target of targets) {
        if (this.stopping) break;
        await this.scanTarget(target);
      }
    } catch (err) {
      this.logger.error({ err }, "Orchestrator tick failed");
    } finally {
      this.running = false;
    }
  }

  /**
   * Query for enabled targets that are due for scanning.
   */
  private async findDueTargets(): Promise<ScanTargetRow[]> {
    const result = await this.pool.query<ScanTargetRow>(
      `SELECT id, name, type, connection_config, scan_interval_hours
       FROM scan_targets
       WHERE enabled = true
         AND last_scan_status != 'running'
         AND (
           last_scanned_at IS NULL
           OR last_scanned_at + (scan_interval_hours || ' hours')::interval < NOW()
         )
       ORDER BY last_scanned_at ASC NULLS FIRST
       LIMIT 10`
    );
    return result.rows;
  }

  /**
   * Run a scan for a single target with timeout.
   */
  private async scanTarget(target: ScanTargetRow): Promise<void> {
    const startTime = Date.now();
    let scanLogId: string | undefined;

    this.logger.info(
      { targetId: target.id, name: target.name, type: target.type },
      `Starting scan for "${target.name}"`
    );

    try {
      // Create scan log
      const logResult = await this.pool.query(
        `INSERT INTO scan_logs (scan_target_id, status) VALUES ($1, 'running') RETURNING id`,
        [target.id]
      );
      scanLogId = logResult.rows[0].id as string;
      const sl = this.scanLogger;
      const logId = scanLogId;

      // Mark target as running
      await this.pool.query(
        `UPDATE scan_targets SET last_scan_status = 'running', updated_at = NOW() WHERE id = $1`,
        [target.id]
      );

      await sl?.log(logId, "info", `Starting scan for "${target.name}" (${target.type})`);

      // Decrypt credentials
      if (!config.masterKey) {
        throw new Error("MASTER_KEY not configured");
      }
      const connectionConfig = decrypt(
        target.connection_config as string,
        config.masterKey
      ) as Record<string, unknown>;

      await sl?.log(logId, "info", "Connecting to target...");

      // Create scanner and run with timeout
      const scanner = createScanner(target.type);
      const scanPromise = scanner.scan({
        type: target.type,
        connectionConfig,
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`Scan timed out after ${this.scanTimeoutMs}ms`)),
          this.scanTimeoutMs
        );
      });

      await sl?.log(logId, "info", "Scanning target — discovering hosts, packages, and services...");

      const results = await Promise.race([scanPromise, timeoutPromise]);

      const hostCount = results.hosts?.length ?? 0;
      const pkgCount = results.hosts?.reduce((sum, h) => sum + (h.packages?.length ?? 0), 0) ?? 0;
      await sl?.log(logId, "info", `Scan returned ${hostCount} host(s) with ${pkgCount} package(s)`);

      // Process results via data ingestion service
      await sl?.log(logId, "info", "Processing and ingesting scan results...");
      const { hostsUpserted, packagesFound } =
        await this.ingestion.processResults(target.id, results);

      // Update scan log as success
      await this.pool.query(
        `UPDATE scan_logs
         SET status = 'success', completed_at = NOW(),
             hosts_discovered = $1, packages_discovered = $2
         WHERE id = $3`,
        [hostsUpserted, packagesFound, logId]
      );

      // Update target status
      await this.pool.query(
        `UPDATE scan_targets
         SET last_scan_status = 'success', last_scanned_at = NOW(),
             last_scan_error = NULL, updated_at = NOW()
         WHERE id = $1`,
        [target.id]
      );

      // Recalculate compliance scores for scanned hosts
      if (this.complianceScorer && hostsUpserted > 0) {
        await sl?.log(logId, "info", "Recalculating compliance scores...");
        const hostIds = await this.pool.query<{ id: string }>(
          `SELECT id FROM hosts WHERE scan_target_id = $1`,
          [target.id]
        );
        for (const row of hostIds.rows) {
          this.complianceScorer.recalculateHost(row.id).catch(() => {});
        }
      }

      const durationMs = Date.now() - startTime;
      await sl?.log(logId, "success", `Scan completed — ${hostsUpserted} host(s), ${packagesFound} package(s) in ${(durationMs / 1000).toFixed(1)}s`);
      sl?.complete(logId, "success");

      this.logger.info(
        { targetId: target.id, scanLogId, hosts: hostsUpserted, packages: packagesFound, durationMs },
        `Scan completed for "${target.name}"`
      );
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);

      this.logger.error(
        { err, targetId: target.id, scanLogId, durationMs },
        `Scan failed for "${target.name}"`
      );

      if (scanLogId) {
        await this.scanLogger?.log(scanLogId, "error", `Scan failed: ${errorMessage}`);
        this.scanLogger?.complete(scanLogId, "failed");
      }

      // Update scan log
      if (scanLogId) {
        await this.pool.query(
          `UPDATE scan_logs SET status = 'failed', completed_at = NOW(), error_message = $1 WHERE id = $2`,
          [errorMessage, scanLogId]
        ).catch(() => {});
      }

      // Update target status
      await this.pool.query(
        `UPDATE scan_targets
         SET last_scan_status = 'failed', last_scanned_at = NOW(),
             last_scan_error = $1, updated_at = NOW()
         WHERE id = $2`,
        [errorMessage, target.id]
      ).catch(() => {});

      // Send scan_failed notification
      if (this.notificationService) {
        this.notificationService.notify({
          eventType: "scan_failed",
          severity: "high",
          title: `Scan Failed: ${target.name}`,
          summary: `Scan target "${target.name}" (${target.type}) failed: ${errorMessage}`,
          details: {
            targetName: target.name,
            errorMessage,
          },
        }).catch(() => {});
      }
    }
  }
}

interface ScanTargetRow {
  id: string;
  name: string;
  type: string;
  connection_config: unknown;
  scan_interval_hours: number;
}
