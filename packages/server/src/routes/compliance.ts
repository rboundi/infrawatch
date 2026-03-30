import { Router } from "express";
import type pg from "pg";
import type { Logger } from "pino";
import type { ComplianceScorer } from "../services/compliance-scorer.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createComplianceRoutes(
  pool: pg.Pool,
  _logger: Logger,
  complianceScorer: ComplianceScorer
): Router {
  const router = Router();

  // ─── GET /fleet — Fleet-level compliance overview ───
  router.get("/fleet", async (_req, res, next) => {
    try {
      // Fleet score
      const fleetResult = await pool.query(
        `SELECT score, classification, calculated_at FROM compliance_scores
         WHERE entity_type = 'fleet' LIMIT 1`
      );
      const fleet = fleetResult.rows[0] ?? { score: 0, classification: "critical", calculated_at: null };

      // Host distribution
      const distResult = await pool.query<{ classification: string; count: string }>(
        `SELECT classification, COUNT(*) AS count FROM compliance_scores
         WHERE entity_type = 'host' GROUP BY classification`
      );
      const distribution: Record<string, number> = { excellent: 0, good: 0, fair: 0, poor: 0, critical: 0 };
      for (const row of distResult.rows) {
        distribution[row.classification] = parseInt(row.count, 10);
      }

      // 30-day trend
      const trendResult = await pool.query(
        `SELECT snapshot_date, score FROM compliance_score_history
         WHERE entity_type = 'fleet' AND entity_name = 'fleet'
           AND snapshot_date >= CURRENT_DATE - INTERVAL '30 days'
         ORDER BY snapshot_date ASC`
      );

      res.json({
        score: fleet.score,
        classification: fleet.classification,
        calculatedAt: fleet.calculated_at,
        trend: trendResult.rows.map((r) => ({ date: r.snapshot_date, score: r.score })),
        hostDistribution: distribution,
      });
    } catch (err) {
      next(err);
    }
  });

  // ─── GET /hosts — Paginated host scores ───
  router.get("/hosts", async (req, res, next) => {
    try {
      const page = Math.max(parseInt(req.query.page as string) || 1, 1);
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);
      const offset = (page - 1) * limit;
      const classificationFilter = req.query.classification as string | undefined;
      const groupId = req.query.groupId as string | undefined;
      const environment = req.query.environment as string | undefined;

      if (groupId && !UUID_RE.test(groupId)) {
        res.status(400).json({ error: "groupId must be a valid UUID" });
        return;
      }

      let where = "WHERE cs.entity_type = 'host'";
      const params: (string | number)[] = [];
      let idx = 1;

      if (classificationFilter) {
        where += ` AND cs.classification = $${idx++}`;
        params.push(classificationFilter);
      }

      if (groupId) {
        where += ` AND EXISTS (SELECT 1 FROM host_group_members hgm WHERE hgm.host_id = cs.entity_id AND hgm.host_group_id = $${idx++})`;
        params.push(groupId);
      }

      if (environment) {
        where += ` AND EXISTS (SELECT 1 FROM host_tags ht WHERE ht.host_id = cs.entity_id AND ht.tag_key = 'environment' AND ht.tag_value = $${idx++})`;
        params.push(environment);
      }

      const countResult = await pool.query(
        `SELECT COUNT(*) FROM compliance_scores cs ${where}`, params
      );
      const total = parseInt(countResult.rows[0].count, 10);

      const result = await pool.query(
        `SELECT cs.entity_id AS host_id, cs.entity_name AS hostname, cs.score, cs.classification,
                cs.breakdown, cs.calculated_at
         FROM compliance_scores cs
         ${where}
         ORDER BY cs.score ASC
         LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, limit, offset]
      );

      res.json({
        data: result.rows.map((r) => ({
          hostId: r.host_id,
          hostname: r.hostname,
          score: r.score,
          classification: r.classification,
          breakdown: r.breakdown,
          calculatedAt: r.calculated_at,
        })),
        total,
        page,
        totalPages: Math.ceil(total / limit),
      });
    } catch (err) {
      next(err);
    }
  });

  // ─── GET /hosts/:id — Detailed host score ───
  router.get("/hosts/:id", async (req, res, next) => {
    try {
      if (!UUID_RE.test(req.params.id)) {
        res.status(400).json({ error: "id must be a valid UUID" });
        return;
      }

      const result = await pool.query(
        `SELECT cs.entity_id AS host_id, cs.entity_name AS hostname, cs.score, cs.classification,
                cs.breakdown, cs.calculated_at
         FROM compliance_scores cs
         WHERE cs.entity_type = 'host' AND cs.entity_id = $1`,
        [req.params.id]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: "Compliance score not found for this host" });
        return;
      }

      const row = result.rows[0];
      res.json({
        hostId: row.host_id,
        hostname: row.hostname,
        score: row.score,
        classification: row.classification,
        breakdown: row.breakdown,
        calculatedAt: row.calculated_at,
      });
    } catch (err) {
      next(err);
    }
  });

  // ─── GET /groups — Group compliance scores ───
  router.get("/groups", async (_req, res, next) => {
    try {
      const result = await pool.query(
        `SELECT cs.entity_id AS group_id, cs.entity_name AS name, cs.score, cs.classification, cs.calculated_at,
                (SELECT COUNT(*) FROM host_group_members hgm WHERE hgm.host_group_id = cs.entity_id) AS host_count
         FROM compliance_scores cs
         WHERE cs.entity_type = 'group'
         ORDER BY cs.score ASC`
      );

      res.json(result.rows.map((r) => ({
        groupId: r.group_id,
        name: r.name,
        score: r.score,
        classification: r.classification,
        hostCount: parseInt(r.host_count, 10),
        calculatedAt: r.calculated_at,
      })));
    } catch (err) {
      next(err);
    }
  });

  // ─── GET /environments — Environment compliance scores ───
  router.get("/environments", async (_req, res, next) => {
    try {
      const result = await pool.query(
        `SELECT cs.entity_name AS name, cs.score, cs.classification, cs.calculated_at
         FROM compliance_scores cs
         WHERE cs.entity_type = 'environment'
         ORDER BY cs.score ASC`
      );

      res.json(result.rows.map((r) => ({
        name: r.name,
        score: r.score,
        classification: r.classification,
        calculatedAt: r.calculated_at,
      })));
    } catch (err) {
      next(err);
    }
  });

  // ─── GET /trend — Historical trend data ───
  router.get("/trend", async (req, res, next) => {
    try {
      const entityType = req.query.entityType as string || "fleet";
      const entityId = req.query.entityId as string | undefined;
      const days = Math.min(Math.max(parseInt(req.query.days as string) || 90, 1), 365);

      if (entityId && !UUID_RE.test(entityId)) {
        res.status(400).json({ error: "entityId must be a valid UUID" });
        return;
      }

      let where = `WHERE entity_type = $1 AND snapshot_date >= CURRENT_DATE - $2::integer * INTERVAL '1 day'`;
      const params: (string | number)[] = [entityType, days];
      let idx = 3;

      if (entityId) {
        where += ` AND entity_id = $${idx++}`;
        params.push(entityId);
      } else if (entityType === "fleet") {
        where += ` AND entity_name = 'fleet'`;
      }

      const result = await pool.query(
        `SELECT snapshot_date, score, classification
         FROM compliance_score_history
         ${where}
         ORDER BY snapshot_date ASC
         LIMIT 365`,
        params
      );

      res.json(result.rows.map((r) => ({
        date: r.snapshot_date,
        score: r.score,
        classification: r.classification,
      })));
    } catch (err) {
      next(err);
    }
  });

  // ─── POST /recalculate — Trigger full recalculation ───
  router.post("/recalculate", async (_req, res, next) => {
    try {
      // Don't await — kick off in background
      complianceScorer.calculateAllScores();
      res.json({ message: "Compliance score recalculation started" });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
