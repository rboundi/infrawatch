import { Router } from "express";
import type pg from "pg";
import type { Logger } from "pino";
import type { ImpactAnalyzer } from "../services/impact-analyzer.js";
import type { AuditLogger } from "../services/audit-logger.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_DIRECTIONS = ["outgoing", "incoming", "both"] as const;
const MAX_MAP_NODES = 500;
const MAX_MAP_EDGES = 2000;
const MAX_ANNOTATIONS = 500;

export function createDependencyRoutes(
  pool: pg.Pool,
  _logger: Logger,
  impactAnalyzer: ImpactAnalyzer,
  audit?: AuditLogger
): Router {
  const router = Router();

  // ─── GET /connections — List all observed connections ───
  router.get("/connections", async (req, res, next) => {
    try {
      const hostId = req.query.hostId as string | undefined;
      const directionRaw = (req.query.direction as string) ?? "both";
      const direction = VALID_DIRECTIONS.includes(directionRaw as typeof VALID_DIRECTIONS[number])
        ? directionRaw
        : "both";
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 100, 1), 500);
      const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

      if (hostId && !UUID_RE.test(hostId)) {
        res.status(400).json({ error: "hostId must be a valid UUID" });
        return;
      }

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
      if (!UUID_RE.test(req.params.hostId)) {
        res.status(400).json({ error: "hostId must be a valid UUID" });
        return;
      }
      const impact = await impactAnalyzer.analyzeImpact(req.params.hostId);
      res.json(impact);
    } catch (err) {
      next(err);
    }
  });

  // ─── GET /map — Full dependency map for graph visualization ───
  router.get("/map", async (req, res, next) => {
    try {
      const nodesResult = await pool.query(
        `SELECT DISTINCT h.id, h.hostname, h.ip_address, h.os, h.status
         FROM hosts h
         WHERE h.id IN (
           SELECT source_host_id FROM host_connections
           UNION
           SELECT target_host_id FROM host_connections WHERE target_host_id IS NOT NULL
         )
         LIMIT $1`,
        [MAX_MAP_NODES]
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
         WHERE target_host_id IS NOT NULL
         LIMIT $1`,
        [MAX_MAP_EDGES]
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

      if (hostId && !UUID_RE.test(hostId)) {
        res.status(400).json({ error: "hostId must be a valid UUID" });
        return;
      }

      let where = "";
      const params: (string | number)[] = [];
      let idx = 1;

      if (hostId) {
        where = `WHERE da.source_host_id = $${idx} OR da.target_host_id = $${idx}`;
        params.push(hostId);
        idx++;
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
         ORDER BY da.created_at DESC
         LIMIT $${idx}`,
        [...params, MAX_ANNOTATIONS]
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

      if (!UUID_RE.test(sourceHostId) || !UUID_RE.test(targetHostId)) {
        res.status(400).json({ error: "sourceHostId and targetHostId must be valid UUIDs" });
        return;
      }

      if (typeof label !== "string" || label.length > 255) {
        res.status(400).json({ error: "label must be a string of at most 255 characters" });
        return;
      }

      if (notes !== undefined && notes !== null && (typeof notes !== "string" || notes.length > 5000)) {
        res.status(400).json({ error: "notes must be a string of at most 5000 characters" });
        return;
      }

      if (createdBy !== undefined && createdBy !== null && (typeof createdBy !== "string" || createdBy.length > 255)) {
        res.status(400).json({ error: "createdBy must be a string of at most 255 characters" });
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
        [sourceHostId, targetHostId, label.trim(), notes ?? null, createdBy ?? null]
      );

      const row = result.rows[0];
      audit?.log({
        userId: req.user?.id,
        username: req.user?.username ?? "system",
        action: "dependency_annotation.created",
        entityType: "dependency_annotation",
        entityId: row.id,
        details: { sourceHostId, targetHostId, label: label.trim(), notes: notes ?? null, createdBy: createdBy ?? null },
        ipAddress: req.ip ?? null,
      });
      res.status(201).json(row);
    } catch (err) {
      next(err);
    }
  });

  // ─── DELETE /annotations/:id — Delete an annotation ───
  router.delete("/annotations/:id", async (req, res, next) => {
    try {
      if (!UUID_RE.test(req.params.id)) {
        res.status(400).json({ error: "id must be a valid UUID" });
        return;
      }
      await pool.query(`DELETE FROM dependency_annotations WHERE id = $1`, [req.params.id]);
      audit?.log({
        userId: req.user?.id,
        username: req.user?.username ?? "system",
        action: "dependency_annotation.deleted",
        entityType: "dependency_annotation",
        entityId: req.params.id,
        details: { id: req.params.id },
        ipAddress: req.ip ?? null,
      });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
