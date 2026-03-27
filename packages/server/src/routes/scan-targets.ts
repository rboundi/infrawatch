import { Router, type Request, type Response } from "express";
import { validationResult } from "express-validator";
import type pg from "pg";
import type { Logger } from "pino";
import { createScanner } from "@infrawatch/scanner";
import { validateScanTarget } from "../utils/validation.js";
import { encrypt, decrypt } from "../utils/crypto.js";
import { config } from "../config.js";
import { DataIngestionService } from "../services/data-ingestion.js";

export function createScanTargetRoutes(pool: pg.Pool, logger: Logger): Router {
  const router = Router();

  // ─── POST /api/v1/targets ───
  router.post("/", ...validateScanTarget, async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ error: "Validation failed", details: errors.array() });
      return;
    }

    const { name, type, connectionConfig, scanIntervalHours, enabled } = req.body;

    if (!config.masterKey) {
      res.status(500).json({ error: "MASTER_KEY not configured on server" });
      return;
    }

    const encryptedConfig = encrypt(connectionConfig, config.masterKey);

    try {
      const result = await pool.query(
        `INSERT INTO scan_targets (name, type, connection_config, scan_interval_hours, enabled)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, type, scan_interval_hours, last_scanned_at, last_scan_status, enabled, created_at, updated_at`,
        [
          name,
          type,
          JSON.stringify(encryptedConfig),
          scanIntervalHours ?? 6,
          enabled ?? true,
        ]
      );

      logger.info({ targetId: result.rows[0].id, name, type }, "Scan target created");
      res.status(201).json(formatTarget(result.rows[0]));
    } catch (err) {
      logger.error({ err }, "Failed to create scan target");
      res.status(500).json({ error: "Failed to create scan target" });
    }
  });

  // ─── GET /api/v1/targets ───
  router.get("/", async (_req: Request, res: Response) => {
    try {
      const result = await pool.query(
        `SELECT id, name, type, scan_interval_hours, last_scanned_at, last_scan_status, enabled, created_at, updated_at
         FROM scan_targets
         ORDER BY created_at DESC`
      );
      res.json(result.rows.map(formatTarget));
    } catch (err) {
      logger.error({ err }, "Failed to list scan targets");
      res.status(500).json({ error: "Failed to list scan targets" });
    }
  });

  // ─── GET /api/v1/targets/:id ───
  router.get("/:id", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    try {
      const result = await pool.query(
        `SELECT id, name, type, scan_interval_hours, last_scanned_at, last_scan_status, last_scan_error, enabled, created_at, updated_at
         FROM scan_targets
         WHERE id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: "Scan target not found" });
        return;
      }

      res.json(formatTarget(result.rows[0]));
    } catch (err) {
      logger.error({ err }, "Failed to get scan target");
      res.status(500).json({ error: "Failed to get scan target" });
    }
  });

  // ─── PATCH /api/v1/targets/:id ───
  router.patch("/:id", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { name, type, connectionConfig, scanIntervalHours, enabled } = req.body;

    // Build dynamic SET clause
    const sets: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (name !== undefined) {
      sets.push(`name = $${paramIdx++}`);
      values.push(name);
    }
    if (type !== undefined) {
      sets.push(`type = $${paramIdx++}`);
      values.push(type);
    }
    if (connectionConfig !== undefined) {
      if (!config.masterKey) {
        res.status(500).json({ error: "MASTER_KEY not configured on server" });
        return;
      }
      const encryptedConfig = encrypt(connectionConfig, config.masterKey);
      sets.push(`connection_config = $${paramIdx++}`);
      values.push(JSON.stringify(encryptedConfig));
    }
    if (scanIntervalHours !== undefined) {
      sets.push(`scan_interval_hours = $${paramIdx++}`);
      values.push(scanIntervalHours);
    }
    if (enabled !== undefined) {
      sets.push(`enabled = $${paramIdx++}`);
      values.push(enabled);
    }

    if (sets.length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    sets.push(`updated_at = NOW()`);
    values.push(id);

    try {
      const result = await pool.query(
        `UPDATE scan_targets SET ${sets.join(", ")} WHERE id = $${paramIdx}
         RETURNING id, name, type, scan_interval_hours, last_scanned_at, last_scan_status, enabled, created_at, updated_at`,
        values
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: "Scan target not found" });
        return;
      }

      logger.info({ targetId: id }, "Scan target updated");
      res.json(formatTarget(result.rows[0]));
    } catch (err) {
      logger.error({ err }, "Failed to update scan target");
      res.status(500).json({ error: "Failed to update scan target" });
    }
  });

  // ─── DELETE /api/v1/targets/:id ───
  // Hard delete: removes the target and cascades to scan_logs.
  // Hosts are preserved (FK ON DELETE SET NULL) so historical data isn't lost.
  router.delete("/:id", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    try {
      const result = await pool.query(
        `DELETE FROM scan_targets WHERE id = $1 RETURNING id`,
        [id]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: "Scan target not found" });
        return;
      }

      logger.info({ targetId: id }, "Scan target deleted");
      res.status(204).send();
    } catch (err) {
      logger.error({ err }, "Failed to delete scan target");
      res.status(500).json({ error: "Failed to delete scan target" });
    }
  });

  // ─── POST /api/v1/targets/:id/test ───
  router.post("/:id/test", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    try {
      const target = await getTargetWithConfig(pool, id);
      if (!target) {
        res.status(404).json({ error: "Scan target not found" });
        return;
      }

      const scanner = createScanner(target.type);

      const start = performance.now();
      try {
        await scanner.scan({
          type: target.type,
          connectionConfig: target.connectionConfig,
        });
        const latencyMs = Math.round(performance.now() - start);

        res.json({
          success: true,
          message: `Successfully connected to ${target.type} target`,
          latencyMs,
        });
      } catch (scanErr) {
        const latencyMs = Math.round(performance.now() - start);
        const message =
          scanErr instanceof Error ? scanErr.message : "Connection failed";

        res.json({
          success: false,
          message,
          latencyMs,
        });
      }
    } catch (err) {
      logger.error({ err }, "Failed to test scan target");
      res.status(500).json({ error: "Failed to test scan target" });
    }
  });

  // ─── POST /api/v1/targets/:id/scan ───
  router.post("/:id/scan", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    try {
      const target = await getTargetWithConfig(pool, id);
      if (!target) {
        res.status(404).json({ error: "Scan target not found" });
        return;
      }

      // Create scan log entry
      const logResult = await pool.query(
        `INSERT INTO scan_logs (scan_target_id, status)
         VALUES ($1, 'running')
         RETURNING id`,
        [id]
      );
      const scanLogId = logResult.rows[0].id;

      // Mark target as running
      await pool.query(
        `UPDATE scan_targets SET last_scan_status = 'running', updated_at = NOW() WHERE id = $1`,
        [id]
      );

      // Run scan asynchronously — don't await
      runScanAsync(pool, logger, target, scanLogId).catch((err) => {
        logger.error({ err, scanLogId }, "Async scan failed unexpectedly");
      });

      res.status(202).json({ message: "Scan started", scanLogId });
    } catch (err) {
      logger.error({ err }, "Failed to trigger scan");
      res.status(500).json({ error: "Failed to trigger scan" });
    }
  });

  return router;
}

// ─── Helpers ───

interface TargetWithConfig {
  id: string;
  name: string;
  type: string;
  connectionConfig: Record<string, unknown>;
}

async function getTargetWithConfig(
  pool: pg.Pool,
  targetId: string
): Promise<TargetWithConfig | null> {
  const result = await pool.query(
    `SELECT id, name, type, connection_config FROM scan_targets WHERE id = $1`,
    [targetId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];

  if (!config.masterKey) {
    throw new Error("MASTER_KEY not configured");
  }

  // JSONB column auto-parsed by pg driver — already the encrypted base64 string
  const connectionConfig = decrypt(
    row.connection_config as string,
    config.masterKey
  ) as Record<string, unknown>;

  return {
    id: row.id,
    name: row.name,
    type: row.type,
    connectionConfig,
  };
}

async function runScanAsync(
  pool: pg.Pool,
  logger: Logger,
  target: TargetWithConfig,
  scanLogId: string
): Promise<void> {
  const startTime = Date.now();
  const ingestion = new DataIngestionService(pool, logger);

  try {
    const scanner = createScanner(target.type);

    const result = await scanner.scan({
      type: target.type,
      connectionConfig: target.connectionConfig,
    });

    const { hostsUpserted, packagesFound } =
      await ingestion.processResults(target.id, result);

    // Update scan log as success
    await pool.query(
      `UPDATE scan_logs SET status = 'success', completed_at = NOW(), hosts_discovered = $1, packages_discovered = $2
       WHERE id = $3`,
      [hostsUpserted, packagesFound, scanLogId]
    );

    // Update target status
    await pool.query(
      `UPDATE scan_targets SET last_scan_status = 'success', last_scanned_at = NOW(), last_scan_error = NULL, updated_at = NOW()
       WHERE id = $1`,
      [target.id]
    );

    logger.info(
      { targetId: target.id, scanLogId, hosts: hostsUpserted, packages: packagesFound, durationMs: Date.now() - startTime },
      "Scan completed successfully"
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    await pool.query(
      `UPDATE scan_logs SET status = 'failed', completed_at = NOW(), error_message = $1 WHERE id = $2`,
      [errorMessage, scanLogId]
    ).catch(() => {});

    await pool.query(
      `UPDATE scan_targets SET last_scan_status = 'failed', last_scanned_at = NOW(), last_scan_error = $1, updated_at = NOW()
       WHERE id = $2`,
      [errorMessage, target.id]
    ).catch(() => {});

    logger.error(
      { err, targetId: target.id, scanLogId, durationMs: Date.now() - startTime },
      "Scan failed"
    );
  }
}

function formatTarget(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    scanIntervalHours: row.scan_interval_hours,
    lastScannedAt: row.last_scanned_at,
    lastScanStatus: row.last_scan_status,
    lastScanError: row.last_scan_error ?? undefined,
    enabled: row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
