import { Router } from "express";
import type pg from "pg";
import type { Logger } from "pino";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, "\\$&");
}

export function createChangeRoutes(pool: pg.Pool, _logger: Logger): Router {
  const router = Router();

  // GET /changes — list change events with filtering and pagination
  router.get("/", async (req, res, next) => {
    try {
      const {
        eventType,
        category,
        hostId,
        groupId,
        search,
        since,
        until,
        sortBy = "createdAt",
        order = "desc",
        page = "1",
        limit = "50",
      } = req.query as Record<string, string | undefined>;

      const pageNum = Math.max(1, parseInt(page ?? "1", 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit ?? "50", 10) || 50));
      const offset = (pageNum - 1) * limitNum;

      const conditions: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;

      if (eventType) {
        const types = eventType.split(",");
        conditions.push(`ce.event_type = ANY($${paramIdx}::text[])`);
        params.push(types);
        paramIdx++;
      }

      if (category) {
        const cats = category.split(",");
        conditions.push(`ce.category = ANY($${paramIdx}::text[])`);
        params.push(cats);
        paramIdx++;
      }

      if (hostId) {
        if (!UUID_RE.test(hostId)) {
          return res.status(400).json({ error: "Invalid hostId format" });
        }
        conditions.push(`ce.host_id = $${paramIdx}`);
        params.push(hostId);
        paramIdx++;
      }

      if (search) {
        conditions.push(`(ce.hostname ILIKE $${paramIdx} OR ce.summary ILIKE $${paramIdx})`);
        params.push(`%${escapeLike(search)}%`);
        paramIdx++;
      }

      if (since) {
        conditions.push(`ce.created_at >= $${paramIdx}`);
        params.push(since);
        paramIdx++;
      }

      if (until) {
        conditions.push(`ce.created_at <= $${paramIdx}`);
        params.push(until);
        paramIdx++;
      }

      if (groupId) {
        conditions.push(`EXISTS (SELECT 1 FROM host_group_members gm WHERE gm.host_id = ce.host_id AND gm.host_group_id = $${paramIdx})`);
        params.push(groupId);
        paramIdx++;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const sortColumn = sortBy === "eventType" ? "ce.event_type" : "ce.created_at";
      const sortOrder = order === "asc" ? "ASC" : "DESC";

      const countResult = await pool.query(
        `SELECT COUNT(*) FROM change_events ce ${whereClause}`,
        params
      );
      const total = parseInt(countResult.rows[0].count, 10);

      const dataParams = [...params, limitNum, offset];
      const dataResult = await pool.query(
        `SELECT ce.id, ce.host_id, ce.hostname, ce.event_type, ce.category,
                ce.summary, ce.details, ce.scan_target_id, ce.created_at
         FROM change_events ce
         ${whereClause}
         ORDER BY ${sortColumn} ${sortOrder}
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        dataParams
      );

      const data = dataResult.rows.map((row) => ({
        id: row.id,
        hostId: row.host_id,
        hostname: row.hostname,
        eventType: row.event_type,
        category: row.category,
        summary: row.summary,
        details: row.details,
        scanTargetId: row.scan_target_id,
        createdAt: row.created_at,
      }));

      res.json({
        data,
        total,
        page: pageNum,
        totalPages: Math.ceil(total / limitNum),
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /changes/summary — event count breakdown
  router.get("/summary", async (_req, res, next) => {
    try {
      const result = await pool.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS last_24h,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS last_7d,
          COUNT(*) FILTER (WHERE category = 'host')::int AS host_events,
          COUNT(*) FILTER (WHERE category = 'package')::int AS package_events,
          COUNT(*) FILTER (WHERE category = 'service')::int AS service_events,
          COUNT(*) FILTER (WHERE category = 'config')::int AS config_events
        FROM change_events
      `);

      const row = result.rows[0];
      res.json({
        total: row.total,
        last24h: row.last_24h,
        last7d: row.last_7d,
        byCategory: {
          host: row.host_events,
          package: row.package_events,
          service: row.service_events,
          config: row.config_events,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /changes/trends — daily counts for the last 30 days
  router.get("/trends", async (_req, res, next) => {
    try {
      const result = await pool.query(`
        SELECT
          d::date AS date,
          COALESCE(c.count, 0)::int AS count
        FROM generate_series(
          CURRENT_DATE - INTERVAL '29 days',
          CURRENT_DATE,
          '1 day'
        ) AS d
        LEFT JOIN (
          SELECT created_at::date AS day, COUNT(*) AS count
          FROM change_events
          WHERE created_at >= CURRENT_DATE - INTERVAL '29 days'
          GROUP BY created_at::date
        ) c ON c.day = d::date
        ORDER BY d ASC
      `);

      const trends = result.rows.map((row) => ({
        date: row.date,
        count: row.count,
      }));

      // Also get snapshots for the same period
      const snapResult = await pool.query(`
        SELECT snapshot_date, total_hosts, active_hosts, total_packages, total_services, total_alerts, critical_alerts
        FROM change_snapshots
        WHERE snapshot_date >= CURRENT_DATE - INTERVAL '29 days'
        ORDER BY snapshot_date ASC
      `);

      const snapshots = snapResult.rows.map((row) => ({
        date: row.snapshot_date,
        totalHosts: row.total_hosts,
        activeHosts: row.active_hosts,
        totalPackages: row.total_packages,
        totalServices: row.total_services,
        totalAlerts: row.total_alerts,
        criticalAlerts: row.critical_alerts,
      }));

      res.json({ trends, snapshots });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
