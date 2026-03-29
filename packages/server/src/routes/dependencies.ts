import { Router } from "express";
import type pg from "pg";
import type { Logger } from "pino";
import type { ImpactAnalyzer } from "../services/impact-analyzer.js";

export function createDependencyRoutes(
  pool: pg.Pool,
  logger: Logger,
  impactAnalyzer: ImpactAnalyzer
): Router {
  const router = Router();

  // ─── GET /connections — List all observed connections ───
  router.get("/connections", async (req, res, next) => {
    try {
      const hostId = req.query.hostId as string | undefined;
      const direction = (req.query.direction as string) ?? "both"; // "outgoing", "incoming", "both"
      const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
      const offset = parseInt(req.query.offset as string) || 0;

      let where = "WHERE 1=1";
      const params: (string | number)[] = [];
      let idx = 1;

      if (hostId) {
        if (direction === "outgoing") {
          where += ` AND hc.source_host_id = $${idx++}`;
          params.push(hostId);
        } else if (direction === "incoming") {
          where += ` AND hc.target_host_id = $${idx++}`;
          params.push(hostId);
        } else {
          where += ` AND (hc.source_host_id = $${idx} OR hc.target_host_id = $${idx})`;
          params.push(hostId);
          idx++;
        }
      }

      const countResult = await pool.query(
        `SELECT COUNT(*) FROM host_connections hc ${where}`,
        params
      );
      const total = parseInt(countResult.rows[0].count, 10);

      const result = await pool.query(
        `SELECT
           hc.id,
           hc.source_host_id,
           sh.hostname AS source_hostname,
           sh.ip_address AS source_ip,
           hc.target_host_id,
           th.hostname AS target_hostname,
           hc.target_ip,
           hc.target_port,
           hc.source_process,
           hc.target_service,
           hc.connection_type,
           hc.first_seen_at,
           hc.last_seen_at
         FROM host_connections hc
         JOIN hosts sh ON sh.id = hc.source_host_id
         LEFT JOIN hosts th ON th.id = hc.target_host_id
         ${where}
         ORDER BY hc.last_seen_at DESC
         LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, limit, offset]
      );

      res.json({ data: result.rows, total, limit, offset });
    } catch (err) {
      next(err);
    }
  });

  // ─── GET /impact/:hostId — Impact analysis for a host ───
  router.get("/impact/:hostId", async (req, res, next) => {
    try {
      const impact = await impactAnalyzer.analyzeImpact(req.params.hostId);
      res.json(impact);
    } catch (err) {
      next(err);
    }
  });

  // ─── GET /map — Full dependency map for graph visualization ───
  router.get("/map", async (req, res, next) => {
    try {
      // Get all hosts that have connections
      const nodesResult = await pool.query(
        `SELECT DISTINCT h.id, h.hostname, h.ip_address, h.os, h.status
         FROM hosts h
         WHERE h.id IN (
           SELECT source_host_id FROM host_connections
           UNION
           SELECT target_host_id FROM host_connections WHERE target_host_id IS NOT NULL
         )`
      );

      const edgesResult = await pool.query(
        `SELECT DISTINCT
           source_host_id,
           target_host_id,
           target_ip,
           target_port,
           source_process,
           target_service,
           connection_type
         FROM host_connections
         WHERE target_host_id IS NOT NULL`
      );

      res.json({
        nodes: nodesResult.rows.map((r) => ({
          id: r.id,
          hostname: r.hostname,
          ip: r.ip_address,
          os: r.os,
          status: r.status,
        })),
        edges: edgesResult.rows.map((r) => ({
          source: r.source_host_id,
          target: r.target_host_id,
          targetIp: r.target_ip,
          targetPort: r.target_port,
          sourceProcess: r.source_process,
          targetService: r.target_service,
          connectionType: r.connection_type,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  // ─── GET /annotations — List dependency annotations ───
  router.get("/annotations", async (req, res, next) => {
    try {
      const hostId = req.query.hostId as string | undefined;

      let where = "";
      const params: string[] = [];

      if (hostId) {
        where = "WHERE da.source_host_id = $1 OR da.target_host_id = $1";
        params.push(hostId);
      }

      const result = await pool.query(
        `SELECT
           da.id,
           da.source_host_id,
           sh.hostname AS source_hostname,
           da.target_host_id,
           th.hostname AS target_hostname,
           da.label,
           da.notes,
           da.created_by,
           da.created_at
         FROM dependency_annotations da
         JOIN hosts sh ON sh.id = da.source_host_id
         JOIN hosts th ON th.id = da.target_host_id
         ${where}
         ORDER BY da.created_at DESC`,
        params
      );

      res.json(result.rows);
    } catch (err) {
      next(err);
    }
  });

  // ─── POST /annotations — Create a dependency annotation ───
  router.post("/annotations", async (req, res, next) => {
    try {
      const { sourceHostId, targetHostId, label, notes, createdBy } = req.body;

      if (!sourceHostId || !targetHostId || !label) {
        res.status(400).json({ error: "sourceHostId, targetHostId, and label are required" });
        return;
      }

      const result = await pool.query(
        `INSERT INTO dependency_annotations (source_host_id, target_host_id, label, notes, created_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (source_host_id, target_host_id) DO UPDATE SET
           label = EXCLUDED.label,
           notes = EXCLUDED.notes,
           created_by = EXCLUDED.created_by
         RETURNING *`,
        [sourceHostId, targetHostId, label, notes ?? null, createdBy ?? null]
      );

      res.status(201).json(result.rows[0]);
    } catch (err) {
      next(err);
    }
  });

  // ─── DELETE /annotations/:id — Delete an annotation ───
  router.delete("/annotations/:id", async (req, res, next) => {
    try {
      await pool.query(`DELETE FROM dependency_annotations WHERE id = $1`, [req.params.id]);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
