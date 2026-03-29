import { Router, type Request, type Response } from "express";
import type pg from "pg";
import type { Logger } from "pino";
import { generateRemediation, generateHostRemediationPlan, type AlertContext } from "../services/remediation-generator.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createAlertRoutes(pool: pg.Pool, logger: Logger): Router {
  const router = Router();

  // ─── GET /api/v1/alerts ───
  router.get("/", async (req: Request, res: Response) => {
    try {
      const {
        severity,
        acknowledged,
        hostId,
        groupId,
        search,
        sortBy = "createdAt",
        order = "desc",
        page = "1",
        limit = "50",
      } = req.query as Record<string, string | undefined>;

      const pageNum = Math.max(1, parseInt(page ?? "1", 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit ?? "50", 10) || 50));
      const offset = (pageNum - 1) * limitNum;

      const conditions: string[] = [];
      const values: unknown[] = [];
      let paramIdx = 1;

      // Severity filter: comma-separated list
      if (severity) {
        const severities = severity.split(",").map((s) => s.trim()).filter(Boolean);
        if (severities.length > 0) {
          conditions.push(`a.severity = ANY($${paramIdx++})`);
          values.push(severities);
        }
      }

      if (acknowledged !== undefined) {
        conditions.push(`a.acknowledged = $${paramIdx++}`);
        values.push(acknowledged === "true");
      }

      if (hostId) {
        conditions.push(`a.host_id = $${paramIdx++}`);
        values.push(hostId);
      }

      if (search) {
        conditions.push(`a.package_name ILIKE $${paramIdx++}`);
        values.push(`%${search}%`);
      }

      if (groupId) {
        conditions.push(`EXISTS (SELECT 1 FROM host_group_members gm WHERE gm.host_id = a.host_id AND gm.host_group_id = $${paramIdx++})`);
        values.push(groupId);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      // Sort
      const sortColumns: Record<string, string> = {
        createdAt: "a.created_at",
        severity: `CASE a.severity
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
          WHEN 'info' THEN 5
          ELSE 6 END`,
      };
      const sortColumn = sortColumns[sortBy ?? "createdAt"] ?? "a.created_at";
      const sortOrder = order?.toLowerCase() === "asc" ? "ASC" : "DESC";

      // Count
      const countResult = await pool.query(
        `SELECT COUNT(*) FROM alerts a ${whereClause}`,
        values
      );
      const total = parseInt(countResult.rows[0].count, 10);

      // Data with host hostname
      const dataResult = await pool.query(
        `SELECT
           a.*,
           h.hostname
         FROM alerts a
         LEFT JOIN hosts h ON h.id = a.host_id
         ${whereClause}
         ORDER BY ${sortColumn} ${sortOrder}
         LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
        [...values, limitNum, offset]
      );

      res.json({
        data: dataResult.rows.map(formatAlertWithHost),
        total,
        page: pageNum,
        totalPages: Math.ceil(total / limitNum),
      });
    } catch (err) {
      logger.error({ err }, "Failed to list alerts");
      res.status(500).json({ error: "Failed to list alerts" });
    }
  });

  // ─── GET /api/v1/alerts/summary ───
  router.get("/summary", async (_req: Request, res: Response) => {
    try {
      const result = await pool.query(
        `SELECT
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE severity = 'critical') AS critical,
           COUNT(*) FILTER (WHERE severity = 'high') AS high,
           COUNT(*) FILTER (WHERE severity = 'medium') AS medium,
           COUNT(*) FILTER (WHERE severity = 'low') AS low,
           COUNT(*) FILTER (WHERE severity = 'info') AS info,
           COUNT(*) FILTER (WHERE acknowledged = false) AS unacknowledged
         FROM alerts`
      );

      const row = result.rows[0];
      res.json({
        total: parseInt(row.total, 10),
        critical: parseInt(row.critical, 10),
        high: parseInt(row.high, 10),
        medium: parseInt(row.medium, 10),
        low: parseInt(row.low, 10),
        info: parseInt(row.info, 10),
        unacknowledged: parseInt(row.unacknowledged, 10),
      });
    } catch (err) {
      logger.error({ err }, "Failed to get alert summary");
      res.status(500).json({ error: "Failed to get alert summary" });
    }
  });

  // ─── PATCH /api/v1/alerts/:id/acknowledge ───
  router.patch("/:id/acknowledge", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const { acknowledgedBy, notes } = req.body ?? {};

    try {
      const result = await pool.query(
        `UPDATE alerts
         SET acknowledged = true,
             acknowledged_at = NOW(),
             acknowledged_by = COALESCE($2, acknowledged_by),
             notes = COALESCE($3, notes)
         WHERE id = $1
         RETURNING *`,
        [id, acknowledgedBy ?? null, notes ?? null]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: "Alert not found" });
        return;
      }

      logger.info({ alertId: id }, "Alert acknowledged");
      res.json(formatAlertWithHost(result.rows[0]));
    } catch (err) {
      logger.error({ err }, "Failed to acknowledge alert");
      res.status(500).json({ error: "Failed to acknowledge alert" });
    }
  });

  // ─── PATCH /api/v1/alerts/bulk-acknowledge ───
  router.patch("/bulk-acknowledge", async (req: Request, res: Response) => {
    const { alertIds, acknowledgedBy, notes } = req.body ?? {};

    if (!Array.isArray(alertIds) || alertIds.length === 0) {
      res.status(400).json({ error: "alertIds must be a non-empty array" });
      return;
    }

    try {
      const result = await pool.query(
        `UPDATE alerts
         SET acknowledged = true,
             acknowledged_at = NOW(),
             acknowledged_by = COALESCE($2, acknowledged_by),
             notes = COALESCE($3, notes)
         WHERE id = ANY($1)
           AND acknowledged = false
         RETURNING id`,
        [alertIds, acknowledgedBy ?? null, notes ?? null]
      );

      logger.info(
        { count: result.rowCount, alertIds },
        "Bulk acknowledge completed"
      );

      res.json({
        acknowledged: result.rowCount,
        ids: result.rows.map((r: { id: string }) => r.id),
      });
    } catch (err) {
      logger.error({ err }, "Failed to bulk acknowledge alerts");
      res.status(500).json({ error: "Failed to bulk acknowledge alerts" });
    }
  });

  // ─── GET /api/v1/alerts/:id/remediation ───
  router.get("/:id/remediation", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid alert ID" }); return; }

    try {
      const alertResult = await pool.query(
        `SELECT a.*, h.hostname, h.os, h.os_version,
                dp.ecosystem, dp.package_manager
         FROM alerts a
         LEFT JOIN hosts h ON h.id = a.host_id
         LEFT JOIN discovered_packages dp ON dp.host_id = a.host_id AND dp.package_name = a.package_name AND dp.removed_at IS NULL
         WHERE a.id = $1`,
        [id]
      );

      if (alertResult.rows.length === 0) {
        res.status(404).json({ error: "Alert not found" });
        return;
      }

      const row = alertResult.rows[0];

      // Get services for this host
      const servicesResult = await pool.query<{ service_name: string; status: string }>(
        "SELECT service_name, status FROM services WHERE host_id = $1",
        [row.host_id]
      );

      const ctx: AlertContext = {
        alertId: row.id,
        hostId: row.host_id,
        hostname: row.hostname ?? "unknown",
        os: row.os,
        osVersion: row.os_version,
        packageName: row.package_name,
        currentVersion: row.current_version,
        availableVersion: row.available_version,
        ecosystem: row.ecosystem,
        packageManager: row.package_manager,
        services: servicesResult.rows.map((r) => ({ serviceName: r.service_name, status: r.status })),
      };

      const remediation = generateRemediation(ctx);
      res.json(remediation);
    } catch (err) {
      logger.error({ err }, "Failed to generate remediation");
      res.status(500).json({ error: "Failed to generate remediation" });
    }
  });

  // ─── POST /api/v1/alerts/bulk-remediation ───
  router.post("/bulk-remediation", async (req: Request, res: Response) => {
    const { alertIds } = req.body ?? {};
    if (!Array.isArray(alertIds) || alertIds.length === 0) {
      res.status(400).json({ error: "alertIds must be a non-empty array" });
      return;
    }

    if (alertIds.length > 100) {
      res.status(400).json({ error: "Maximum 100 alerts per bulk request" });
      return;
    }

    try {
      // Get all alerts with host context
      const alertsResult = await pool.query(
        `SELECT a.*, h.hostname, h.os, h.os_version, h.id AS h_id,
                dp.ecosystem, dp.package_manager
         FROM alerts a
         LEFT JOIN hosts h ON h.id = a.host_id
         LEFT JOIN discovered_packages dp ON dp.host_id = a.host_id AND dp.package_name = a.package_name AND dp.removed_at IS NULL
         WHERE a.id = ANY($1)`,
        [alertIds]
      );

      // Group by host
      const byHost = new Map<string, typeof alertsResult.rows>();
      for (const row of alertsResult.rows) {
        const hostId = row.host_id;
        if (!byHost.has(hostId)) byHost.set(hostId, []);
        byHost.get(hostId)!.push(row);
      }

      const plans: Array<{
        hostId: string; hostname: string;
        remediations: Array<{ alertId: string; packageName: string; remediation: ReturnType<typeof generateRemediation> }>;
      }> = [];

      for (const [hostId, alerts] of byHost) {
        // Get services once per host
        const servicesResult = await pool.query<{ service_name: string; status: string }>(
          "SELECT service_name, status FROM services WHERE host_id = $1",
          [hostId]
        );
        const services = servicesResult.rows.map((r) => ({ serviceName: r.service_name, status: r.status }));

        const remediations = alerts.map((row) => {
          const ctx: AlertContext = {
            alertId: row.id,
            hostId: row.host_id,
            hostname: row.hostname ?? "unknown",
            os: row.os,
            osVersion: row.os_version,
            packageName: row.package_name,
            currentVersion: row.current_version,
            availableVersion: row.available_version,
            ecosystem: row.ecosystem,
            packageManager: row.package_manager,
            services,
          };
          return { alertId: row.id, packageName: row.package_name, remediation: generateRemediation(ctx) };
        });

        plans.push({
          hostId,
          hostname: alerts[0].hostname ?? "unknown",
          remediations,
        });
      }

      res.json(plans);
    } catch (err) {
      logger.error({ err }, "Failed to generate bulk remediation");
      res.status(500).json({ error: "Failed to generate bulk remediation" });
    }
  });

  return router;
}

export function createStatsRoutes(pool: pg.Pool, logger: Logger): Router {
  const router = Router();

  // ─── GET /api/v1/stats/overview ───
  router.get("/overview", async (_req: Request, res: Response) => {
    try {
      const result = await pool.query(
        `SELECT
           (SELECT COUNT(*) FROM hosts) AS total_hosts,
           (SELECT COUNT(*) FROM hosts WHERE status = 'active') AS active_hosts,
           (SELECT COUNT(*) FROM hosts WHERE status = 'stale') AS stale_hosts,
           (SELECT COUNT(*) FROM discovered_packages WHERE removed_at IS NULL) AS total_packages,
           (SELECT COUNT(*) FROM alerts) AS total_alerts,
           (SELECT COUNT(*) FROM alerts WHERE severity = 'critical' AND acknowledged = false) AS critical_alerts,
           (SELECT COUNT(*) FROM scan_targets WHERE enabled = true) AS scan_targets,
           (SELECT MAX(last_scanned_at) FROM scan_targets) AS last_scan_at,
           (SELECT COUNT(*) FROM hosts WHERE discovery_method = 'nmap') AS network_discovery_hosts,
           (SELECT COUNT(*) FROM network_discovery_results WHERE auto_promoted = true) AS auto_promoted_targets`
      );

      const row = result.rows[0];

      // Group breakdown
      const groupsResult = await pool.query(`
        SELECT
          g.id, g.name, g.color, g.icon,
          (SELECT COUNT(*) FROM host_group_members m WHERE m.host_group_id = g.id)::int AS member_count,
          (SELECT COUNT(*) FROM alerts a
           JOIN host_group_members m ON m.host_id = a.host_id AND m.host_group_id = g.id
           WHERE a.acknowledged = false)::int AS open_alerts
        FROM host_groups g
        ORDER BY g.name ASC
      `);

      res.json({
        totalHosts: parseInt(row.total_hosts, 10),
        activeHosts: parseInt(row.active_hosts, 10),
        staleHosts: parseInt(row.stale_hosts, 10),
        totalPackages: parseInt(row.total_packages, 10),
        totalAlerts: parseInt(row.total_alerts, 10),
        criticalAlerts: parseInt(row.critical_alerts, 10),
        scanTargets: parseInt(row.scan_targets, 10),
        lastScanAt: row.last_scan_at,
        networkDiscoveryHosts: parseInt(row.network_discovery_hosts, 10),
        autoPromotedTargets: parseInt(row.auto_promoted_targets, 10),
        groups: groupsResult.rows.map((g: any) => ({
          id: g.id,
          name: g.name,
          color: g.color,
          icon: g.icon,
          memberCount: g.member_count,
          openAlerts: g.open_alerts,
        })),
      });
    } catch (err) {
      logger.error({ err }, "Failed to get stats overview");
      res.status(500).json({ error: "Failed to get stats overview" });
    }
  });

  return router;
}

// ─── Formatters ───

function formatAlertWithHost(row: Record<string, unknown>) {
  return {
    id: row.id,
    hostId: row.host_id,
    hostname: row.hostname ?? null,
    packageId: row.package_id,
    packageName: row.package_name,
    currentVersion: row.current_version,
    availableVersion: row.available_version,
    severity: row.severity,
    acknowledged: row.acknowledged,
    acknowledgedAt: row.acknowledged_at,
    acknowledgedBy: row.acknowledged_by,
    notes: row.notes,
    createdAt: row.created_at,
  };
}
