import { Router, type Request, type Response } from "express";
import type pg from "pg";
import type { Logger } from "pino";
import { generateHostRemediationPlan } from "../services/remediation-generator.js";
import type { AuditLogger } from "../services/audit-logger.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function escapeIlike(str: string): string {
  return str.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export function createHostRoutes(pool: pg.Pool, logger: Logger, audit?: AuditLogger): Router {
  const router = Router();

  // ─── GET /api/v1/hosts ───
  router.get("/", async (req: Request, res: Response) => {
    try {
      const {
        status,
        environment,
        search,
        discoveryMethod,
        detectedPlatform,
        hasPort,
        groupId,
        sortBy = "hostname",
        order = "asc",
        page = "1",
        limit = "50",
      } = req.query as Record<string, string | undefined>;

      const pageNum = Math.max(1, parseInt(page ?? "1", 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit ?? "50", 10) || 50));
      const offset = (pageNum - 1) * limitNum;

      // Build WHERE clauses
      const conditions: string[] = [];
      const values: unknown[] = [];
      let paramIdx = 1;

      if (status) {
        conditions.push(`h.status = $${paramIdx++}`);
        values.push(status);
      }
      if (environment) {
        conditions.push(`h.environment_tag = $${paramIdx++}`);
        values.push(environment);
      }
      if (search) {
        conditions.push(`h.hostname ILIKE $${paramIdx++}`);
        values.push(`%${escapeIlike(search)}%`);
      }
      if (discoveryMethod) {
        conditions.push(`h.discovery_method = $${paramIdx++}`);
        values.push(discoveryMethod);
      }
      if (detectedPlatform) {
        conditions.push(`h.detected_platform = $${paramIdx++}`);
        values.push(detectedPlatform);
      }
      if (hasPort) {
        conditions.push(`$${paramIdx++}::integer = ANY(h.open_ports)`);
        values.push(parseInt(hasPort, 10));
      }
      if (groupId && UUID_RE.test(groupId)) {
        conditions.push(`EXISTS (SELECT 1 FROM host_group_members gm WHERE gm.host_id = h.id AND gm.host_group_id = $${paramIdx++})`);
        values.push(groupId);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      // Validate sortBy
      const sortColumns: Record<string, string> = {
        hostname: "h.hostname",
        lastSeenAt: "h.last_seen_at",
        packageCount: "package_count",
        compliance: "compliance_score",
      };
      const sortColumn = sortColumns[sortBy ?? "hostname"] ?? "h.hostname";
      const sortOrder = order?.toLowerCase() === "desc" ? "DESC" : "ASC";

      // Count query
      const countResult = await pool.query(
        `SELECT COUNT(*) FROM hosts h ${whereClause}`,
        values
      );
      const total = parseInt(countResult.rows[0].count, 10);

      // Data query with subqueries for counts
      const dataResult = await pool.query(
        `SELECT
           h.id,
           h.hostname,
           h.ip_address,
           h.os,
           h.os_version,
           h.architecture,
           h.environment_tag,
           h.last_seen_at,
           h.first_seen_at,
           h.status,
           h.reporting_method,
           h.agent_version,
           st.name AS scan_target_name,
           (SELECT COUNT(*) FROM discovered_packages dp WHERE dp.host_id = h.id AND dp.removed_at IS NULL) AS package_count,
           (SELECT COUNT(*) FROM alerts a WHERE a.host_id = h.id AND a.acknowledged = false) AS open_alert_count,
           (SELECT cs.score FROM compliance_host_scores cs WHERE cs.host_id = h.id ORDER BY cs.calculated_at DESC LIMIT 1) AS compliance_score
         FROM hosts h
         LEFT JOIN scan_targets st ON st.id = h.scan_target_id
         ${whereClause}
         ORDER BY ${sortColumn} ${sortOrder} NULLS LAST
         LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
        [...values, limitNum, offset]
      );

      res.json({
        data: dataResult.rows.map(formatHostSummary),
        total,
        page: pageNum,
        totalPages: Math.ceil(total / limitNum),
      });
    } catch (err) {
      logger.error({ err }, "Failed to list hosts");
      res.status(500).json({ error: "Failed to list hosts" });
    }
  });

  // ─── GET /api/v1/hosts/:id ───
  router.get("/:id", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid host ID" }); return; }
    try {
      // Host detail
      const hostResult = await pool.query(
        `SELECT
           h.*,
           st.name AS scan_target_name,
           (SELECT COUNT(*) FROM discovered_packages dp WHERE dp.host_id = h.id AND dp.removed_at IS NULL) AS package_count,
           (SELECT COUNT(*) FROM alerts a WHERE a.host_id = h.id AND a.acknowledged = false) AS open_alert_count,
           (SELECT cs.score FROM compliance_host_scores cs WHERE cs.host_id = h.id ORDER BY cs.calculated_at DESC LIMIT 1) AS compliance_score
         FROM hosts h
         LEFT JOIN scan_targets st ON st.id = h.scan_target_id
         WHERE h.id = $1`,
        [id]
      );

      if (hostResult.rows.length === 0) {
        res.status(404).json({ error: "Host not found" });
        return;
      }

      const host = hostResult.rows[0];

      // Packages (non-removed), with updateAvailable flag
      const packagesResult = await pool.query(
        `SELECT
           dp.*,
           CASE WHEN EXISTS (
             SELECT 1 FROM alerts a
             WHERE a.host_id = dp.host_id
               AND a.package_name = dp.package_name
               AND a.acknowledged = false
           ) THEN true ELSE false END AS update_available
         FROM discovered_packages dp
         WHERE dp.host_id = $1 AND dp.removed_at IS NULL
         ORDER BY dp.package_name ASC`,
        [id]
      );

      // Services
      const servicesResult = await pool.query(
        `SELECT * FROM services WHERE host_id = $1 ORDER BY service_name ASC`,
        [id]
      );

      // Recent alerts (last 10)
      const alertsResult = await pool.query(
        `SELECT * FROM alerts
         WHERE host_id = $1
         ORDER BY created_at DESC
         LIMIT 10`,
        [id]
      );

      // Groups
      const groupsResult = await pool.query(
        `SELECT g.id, g.name, g.color, g.icon, m.assigned_by
         FROM host_group_members m
         JOIN host_groups g ON g.id = m.host_group_id
         WHERE m.host_id = $1
         ORDER BY g.name ASC`,
        [id]
      );

      // Tags
      const tagsResult = await pool.query(
        `SELECT id, tag_key, tag_value FROM host_tags WHERE host_id = $1 ORDER BY tag_key ASC`,
        [id]
      );

      res.json({
        ...formatHostDetail(host),
        packages: packagesResult.rows.map(formatPackage),
        services: servicesResult.rows.map(formatService),
        recentAlerts: alertsResult.rows.map(formatAlert),
        groups: groupsResult.rows.map((r: any) => ({
          id: r.id,
          name: r.name,
          color: r.color,
          icon: r.icon,
          assignedBy: r.assigned_by,
        })),
        tags: tagsResult.rows.map((r: any) => ({
          id: r.id,
          key: r.tag_key,
          value: r.tag_value,
        })),
      });
    } catch (err) {
      logger.error({ err }, "Failed to get host");
      res.status(500).json({ error: "Failed to get host" });
    }
  });

  // ─── GET /api/v1/hosts/:id/packages ───
  router.get("/:id/packages", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid host ID" }); return; }
    try {
      const {
        search,
        ecosystem,
        hasUpdate,
        page = "1",
        limit = "50",
      } = req.query as Record<string, string | undefined>;

      const pageNum = Math.max(1, parseInt(page ?? "1", 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit ?? "50", 10) || 50));
      const offset = (pageNum - 1) * limitNum;

      const conditions: string[] = ["dp.host_id = $1", "dp.removed_at IS NULL"];
      const values: unknown[] = [id];
      let paramIdx = 2;

      if (search) {
        conditions.push(`dp.package_name ILIKE $${paramIdx++}`);
        values.push(`%${escapeIlike(search)}%`);
      }
      if (ecosystem) {
        conditions.push(`dp.ecosystem = $${paramIdx++}`);
        values.push(ecosystem);
      }

      let havingClause = "";
      if (hasUpdate === "true") {
        havingClause = "HAVING EXISTS (SELECT 1 FROM alerts a WHERE a.host_id = dp.host_id AND a.package_name = dp.package_name AND a.acknowledged = false)";
      } else if (hasUpdate === "false") {
        havingClause = "HAVING NOT EXISTS (SELECT 1 FROM alerts a WHERE a.host_id = dp.host_id AND a.package_name = dp.package_name AND a.acknowledged = false)";
      }

      const whereClause = `WHERE ${conditions.join(" AND ")}`;

      // For hasUpdate filter we use a subquery approach
      const baseQuery = havingClause
        ? `SELECT dp.*,
             CASE WHEN EXISTS (
               SELECT 1 FROM alerts a WHERE a.host_id = dp.host_id AND a.package_name = dp.package_name AND a.acknowledged = false
             ) THEN true ELSE false END AS update_available
           FROM discovered_packages dp
           ${whereClause}
           GROUP BY dp.id
           ${havingClause}`
        : `SELECT dp.*,
             CASE WHEN EXISTS (
               SELECT 1 FROM alerts a WHERE a.host_id = dp.host_id AND a.package_name = dp.package_name AND a.acknowledged = false
             ) THEN true ELSE false END AS update_available
           FROM discovered_packages dp
           ${whereClause}`;

      // Count
      const countResult = await pool.query(
        `SELECT COUNT(*) FROM (${baseQuery}) sub`,
        values
      );
      const total = parseInt(countResult.rows[0].count, 10);

      // Data
      const dataResult = await pool.query(
        `${baseQuery} ORDER BY dp.package_name ASC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
        [...values, limitNum, offset]
      );

      res.json({
        data: dataResult.rows.map(formatPackage),
        total,
        page: pageNum,
        totalPages: Math.ceil(total / limitNum),
      });
    } catch (err) {
      logger.error({ err }, "Failed to list packages for host");
      res.status(500).json({ error: "Failed to list packages" });
    }
  });

  // ─── GET /api/v1/hosts/:id/history ───
  router.get("/:id/history", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid host ID" }); return; }
    try {
      // Get host's scan_target_id
      const hostResult = await pool.query(
        `SELECT scan_target_id FROM hosts WHERE id = $1`,
        [id]
      );

      if (hostResult.rows.length === 0) {
        res.status(404).json({ error: "Host not found" });
        return;
      }

      const scanTargetId = hostResult.rows[0].scan_target_id;

      if (!scanTargetId) {
        res.json({ data: [] });
        return;
      }

      const result = await pool.query(
        `SELECT id, scan_target_id, started_at, completed_at, status,
                hosts_discovered, packages_discovered, error_message
         FROM scan_logs
         WHERE scan_target_id = $1
         ORDER BY started_at DESC
         LIMIT 50`,
        [scanTargetId]
      );

      res.json({
        data: result.rows.map(formatScanLog),
      });
    } catch (err) {
      logger.error({ err }, "Failed to get host history");
      res.status(500).json({ error: "Failed to get host history" });
    }
  });

  // ─── GET /api/v1/hosts/:id/tags ───
  router.get("/:id/tags", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid host ID" }); return; }
    try {
      const result = await pool.query(
        `SELECT id, tag_key, tag_value FROM host_tags WHERE host_id = $1 ORDER BY tag_key ASC`,
        [id]
      );
      res.json({ data: result.rows.map((r: any) => ({ id: r.id, key: r.tag_key, value: r.tag_value })) });
    } catch (err) {
      logger.error({ err }, "Failed to get tags");
      res.status(500).json({ error: "Failed to get tags" });
    }
  });

  // ─── POST /api/v1/hosts/:id/tags ───
  router.post("/:id/tags", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid host ID" }); return; }
    try {
      const { key, value } = req.body;
      if (!key || typeof key !== "string") {
        res.status(400).json({ error: "key is required" });
        return;
      }
      const tagKey = key.trim();
      const tagValue = value ?? null;
      const result = await pool.query(
        `INSERT INTO host_tags (host_id, tag_key, tag_value)
         VALUES ($1, $2, $3)
         ON CONFLICT (host_id, tag_key) DO UPDATE SET tag_value = $3
         RETURNING id, tag_key, tag_value`,
        [id, tagKey, tagValue]
      );
      audit?.log({ userId: req.user?.id, username: req.user?.username ?? "system", action: "host.tags_added", entityType: "host", entityId: id, details: { tagKey, tagValue }, ipAddress: req.ip ?? null });
      res.status(201).json({ id: result.rows[0].id, key: result.rows[0].tag_key, value: result.rows[0].tag_value });
    } catch (err) {
      logger.error({ err }, "Failed to create tag");
      res.status(500).json({ error: "Failed to create tag" });
    }
  });

  // ─── DELETE /api/v1/hosts/:id/tags/:tagKey ───
  router.delete("/:id/tags/:tagKey", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const tagKey = req.params.tagKey as string;
    if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid host ID" }); return; }
    try {
      const result = await pool.query(
        `DELETE FROM host_tags WHERE host_id = $1 AND tag_key = $2 RETURNING id`,
        [id, tagKey]
      );
      if (result.rows.length === 0) {
        res.status(404).json({ error: "Tag not found" });
        return;
      }
      audit?.log({ userId: req.user?.id, username: req.user?.username ?? "system", action: "host.tags_removed", entityType: "host", entityId: id, details: { tagKey }, ipAddress: req.ip ?? null });
      res.status(204).end();
    } catch (err) {
      logger.error({ err }, "Failed to delete tag");
      res.status(500).json({ error: "Failed to delete tag" });
    }
  });

  // ─── GET /api/v1/hosts/:id/remediation ───
  router.get("/:id/remediation", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid host ID" }); return; }

    try {
      const plan = await generateHostRemediationPlan(pool, id);
      if (!plan) {
        res.status(404).json({ error: "Host not found or no open alerts" });
        return;
      }
      res.json(plan);
    } catch (err) {
      logger.error({ err }, "Failed to generate host remediation plan");
      res.status(500).json({ error: "Failed to generate host remediation plan" });
    }
  });

  return router;
}

// ─── Formatters ───

function formatHostSummary(row: Record<string, unknown>) {
  return {
    id: row.id,
    hostname: row.hostname,
    ip: row.ip_address,
    os: row.os,
    osVersion: row.os_version,
    arch: row.architecture,
    environmentTag: row.environment_tag,
    lastSeenAt: row.last_seen_at,
    firstSeenAt: row.first_seen_at,
    status: row.status,
    scanTargetName: row.scan_target_name ?? null,
    packageCount: parseInt(row.package_count as string, 10) || 0,
    openAlertCount: parseInt(row.open_alert_count as string, 10) || 0,
    macAddress: row.mac_address,
    macVendor: row.mac_vendor,
    detectedPlatform: row.detected_platform,
    discoveryMethod: row.discovery_method,
    openPorts: row.open_ports,
    reportingMethod: row.reporting_method ?? "scanner",
    agentVersion: row.agent_version ?? null,
    complianceScore: row.compliance_score != null ? parseInt(row.compliance_score as string, 10) : null,
  };
}

function formatHostDetail(row: Record<string, unknown>) {
  return {
    ...formatHostSummary(row),
    metadata: row.metadata,
    scanTargetId: row.scan_target_id,
  };
}

function formatPackage(row: Record<string, unknown>) {
  return {
    id: row.id,
    packageName: row.package_name,
    installedVersion: row.installed_version,
    packageManager: row.package_manager,
    ecosystem: row.ecosystem,
    firstDetectedAt: row.first_detected_at,
    lastDetectedAt: row.last_detected_at,
    updateAvailable: row.update_available === true || row.update_available === "true",
  };
}

function formatService(row: Record<string, unknown>) {
  return {
    id: row.id,
    serviceName: row.service_name,
    serviceType: row.service_type,
    version: row.version,
    port: row.port,
    status: row.status,
    detectedAt: row.detected_at,
    lastSeenAt: row.last_seen_at,
  };
}

function formatAlert(row: Record<string, unknown>) {
  return {
    id: row.id,
    hostId: row.host_id,
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

function formatScanLog(row: Record<string, unknown>) {
  return {
    id: row.id,
    scanTargetId: row.scan_target_id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    status: row.status,
    hostsDiscovered: row.hosts_discovered,
    packagesDiscovered: row.packages_discovered,
    errorMessage: row.error_message,
  };
}
