import { Router, type Request, type Response } from "express";
import type pg from "pg";
import type { Logger } from "pino";

export function createDiscoveryRoutes(pool: pg.Pool, logger: Logger): Router {
  const router = Router();

  // ─── GET /api/v1/discovery ───
  router.get("/", async (req: Request, res: Response) => {
    try {
      const {
        scanTargetId,
        platform,
        hasPort,
        search,
        autoPromoted,
        dismissed = "false",
        page = "1",
        limit = "50",
      } = req.query as Record<string, string | undefined>;

      const pageNum = Math.max(1, parseInt(page ?? "1", 10) || 1);
      const limitNum = Math.min(
        100,
        Math.max(1, parseInt(limit ?? "50", 10) || 50)
      );
      const offset = (pageNum - 1) * limitNum;

      const conditions: string[] = [];
      const values: unknown[] = [];
      let paramIdx = 1;

      if (scanTargetId) {
        conditions.push(`d.scan_target_id = $${paramIdx++}`);
        values.push(scanTargetId);
      }

      if (platform) {
        conditions.push(`d.detected_platform = $${paramIdx++}`);
        values.push(platform);
      }

      if (hasPort) {
        conditions.push(
          `d.open_ports @> $${paramIdx++}::jsonb`
        );
        const portNum = parseInt(hasPort, 10);
        values.push(JSON.stringify([{ port: portNum }]));
      }

      if (search) {
        conditions.push(
          `(d.ip_address ILIKE $${paramIdx} OR d.hostname ILIKE $${paramIdx})`
        );
        values.push(`%${search}%`);
        paramIdx++;
      }

      if (autoPromoted !== undefined) {
        conditions.push(`d.auto_promoted = $${paramIdx++}`);
        values.push(autoPromoted === "true");
      }

      if (dismissed !== undefined) {
        conditions.push(`d.dismissed = $${paramIdx++}`);
        values.push(dismissed === "true");
      }

      const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      // Count
      const countResult = await pool.query(
        `SELECT COUNT(*) FROM network_discovery_results d ${whereClause}`,
        values
      );
      const total = parseInt(countResult.rows[0].count, 10);

      // Data
      const dataResult = await pool.query(
        `SELECT
           d.*,
           h.id AS host_id,
           h.hostname AS host_hostname
         FROM network_discovery_results d
         LEFT JOIN hosts h ON h.ip_address = d.ip_address
         ${whereClause}
         ORDER BY d.created_at DESC
         LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
        [...values, limitNum, offset]
      );

      res.json({
        data: dataResult.rows.map(formatDiscoveryResult),
        total,
        page: pageNum,
        totalPages: Math.ceil(total / limitNum),
      });
    } catch (err) {
      logger.error({ err }, "Failed to list discovery results");
      res.status(500).json({ error: "Failed to list discovery results" });
    }
  });

  // ─── GET /api/v1/discovery/:id ───
  router.get("/:id", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    try {
      const result = await pool.query(
        `SELECT
           d.*,
           h.id AS host_id,
           h.hostname AS host_hostname
         FROM network_discovery_results d
         LEFT JOIN hosts h ON h.ip_address = d.ip_address
         WHERE d.id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: "Discovery result not found" });
        return;
      }

      res.json(formatDiscoveryResult(result.rows[0]));
    } catch (err) {
      logger.error({ err }, "Failed to get discovery result");
      res.status(500).json({ error: "Failed to get discovery result" });
    }
  });

  // ─── POST /api/v1/discovery/:id/promote ───
  router.post("/:id/promote", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { type, templateTargetId, name } = req.body ?? {};

    if (!type || !templateTargetId) {
      res
        .status(400)
        .json({ error: "type and templateTargetId are required" });
      return;
    }

    if (type !== "ssh_linux" && type !== "winrm") {
      res
        .status(400)
        .json({ error: "type must be 'ssh_linux' or 'winrm'" });
      return;
    }

    try {
      // Get the discovery result
      const discoveryResult = await pool.query(
        `SELECT * FROM network_discovery_results WHERE id = $1`,
        [id]
      );

      if (discoveryResult.rows.length === 0) {
        res.status(404).json({ error: "Discovery result not found" });
        return;
      }

      const discovery = discoveryResult.rows[0];

      // Get the template target's connection_config
      const templateResult = await pool.query(
        `SELECT connection_config FROM scan_targets WHERE id = $1`,
        [templateTargetId]
      );

      if (templateResult.rows.length === 0) {
        res.status(404).json({ error: "Template scan target not found" });
        return;
      }

      const templateConfig = templateResult.rows[0].connection_config;
      const newConfig = { ...templateConfig, host: discovery.ip_address };
      const targetName = name || `Auto: ${discovery.ip_address}`;

      // Create new scan target
      const createResult = await pool.query(
        `INSERT INTO scan_targets (name, type, connection_config, enabled, scan_interval_hours)
         VALUES ($1, $2, $3, false, 6)
         RETURNING *`,
        [targetName, type, JSON.stringify(newConfig)]
      );

      // Mark as promoted
      await pool.query(
        `UPDATE network_discovery_results SET auto_promoted = true WHERE id = $1`,
        [id]
      );

      const created = createResult.rows[0];
      logger.info(
        { discoveryId: id, scanTargetId: created.id },
        "Discovery result promoted to scan target"
      );

      res.status(201).json({
        id: created.id,
        name: created.name,
        type: created.type,
        connectionConfig: created.connection_config,
        enabled: created.enabled,
        scanIntervalHours: created.scan_interval_hours,
        createdAt: created.created_at,
      });
    } catch (err) {
      logger.error({ err }, "Failed to promote discovery result");
      res.status(500).json({ error: "Failed to promote discovery result" });
    }
  });

  // ─── PATCH /api/v1/discovery/:id/dismiss ───
  router.patch("/:id/dismiss", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    try {
      const result = await pool.query(
        `UPDATE network_discovery_results SET dismissed = true WHERE id = $1 RETURNING id`,
        [id]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: "Discovery result not found" });
        return;
      }

      logger.info({ discoveryId: id }, "Discovery result dismissed");
      res.status(204).send();
    } catch (err) {
      logger.error({ err }, "Failed to dismiss discovery result");
      res.status(500).json({ error: "Failed to dismiss discovery result" });
    }
  });

  return router;
}

// ─── Formatters ───

function formatDiscoveryResult(row: Record<string, unknown>) {
  return {
    id: row.id,
    scanTargetId: row.scan_target_id,
    scanLogId: row.scan_log_id,
    ipAddress: row.ip_address,
    hostname: row.hostname,
    macAddress: row.mac_address,
    macVendor: row.mac_vendor,
    osMatch: row.os_match,
    osAccuracy: row.os_accuracy,
    openPorts: row.open_ports,
    detectedPlatform: row.detected_platform,
    autoPromoted: row.auto_promoted,
    dismissed: row.dismissed,
    createdAt: row.created_at,
    hostId: row.host_id ?? null,
    hostHostname: row.host_hostname ?? null,
  };
}
