import { Router } from "express";
import type pg from "pg";
import type { Logger } from "pino";
import { requireAdmin } from "../middleware/auth.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createAuditRoutes(pool: pg.Pool, _logger: Logger): Router {
  const router = Router();

  router.use(requireAdmin);

  // ─── GET / — Paginated audit log ───
  router.get("/", async (req, res) => {
    try {
      const page = Math.max(parseInt(req.query.page as string) || 1, 1);
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 100, 1), 500);
      const offset = (page - 1) * limit;

      const userId = req.query.userId as string | undefined;
      const action = req.query.action as string | undefined;
      const entityType = req.query.entityType as string | undefined;
      const since = req.query.since as string | undefined;
      const until = req.query.until as string | undefined;

      const conditions: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      if (userId) {
        if (!UUID_RE.test(userId)) {
          res.status(400).json({ error: "Invalid userId" });
          return;
        }
        conditions.push(`a.user_id = $${idx++}`);
        params.push(userId);
      }

      if (action) {
        conditions.push(`a.action = $${idx++}`);
        params.push(action.slice(0, 100));
      }

      if (entityType) {
        conditions.push(`a.entity_type = $${idx++}`);
        params.push(entityType.slice(0, 50));
      }

      if (since) {
        const sinceDate = new Date(since);
        if (!isNaN(sinceDate.getTime())) {
          conditions.push(`a.created_at >= $${idx++}`);
          params.push(sinceDate.toISOString());
        }
      }

      if (until) {
        const untilDate = new Date(until);
        if (!isNaN(untilDate.getTime())) {
          conditions.push(`a.created_at <= $${idx++}`);
          params.push(untilDate.toISOString());
        }
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const [countResult, dataResult] = await Promise.all([
        pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM audit_log a ${where}`, params),
        pool.query(
          `SELECT a.id, a.user_id, a.username, a.action, a.entity_type, a.entity_id,
                  a.details, a.ip_address, a.created_at,
                  u.display_name AS user_display_name
           FROM audit_log a
           LEFT JOIN users u ON u.id = a.user_id
           ${where}
           ORDER BY a.created_at DESC
           LIMIT $${idx} OFFSET $${idx + 1}`,
          [...params, limit, offset],
        ),
      ]);

      const total = parseInt(countResult.rows[0].count, 10);

      res.json({
        data: dataResult.rows.map((r) => ({
          id: r.id,
          userId: r.user_id,
          username: r.username,
          userDisplayName: r.user_display_name,
          action: r.action,
          entityType: r.entity_type,
          entityId: r.entity_id,
          details: r.details,
          ipAddress: r.ip_address,
          createdAt: r.created_at,
        })),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
