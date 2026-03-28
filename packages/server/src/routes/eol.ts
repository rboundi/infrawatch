import { Router } from "express";
import type pg from "pg";
import type { Logger } from "pino";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_CATEGORIES = ["os", "runtime", "database", "webserver", "appserver", "language", "framework", "container", "other"];

function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, "\\$&");
}

export function createEolRoutes(pool: pg.Pool, _logger: Logger): Router {
  const router = Router();

  // GET /eol/alerts — paginated, filterable
  router.get("/alerts", async (req, res, next) => {
    try {
      const {
        status,
        product,
        hostId,
        daysRange,
        search,
        sortBy = "eolDate",
        order = "asc",
        page = "1",
        limit = "50",
      } = req.query as Record<string, string | undefined>;

      const pageNum = Math.max(1, parseInt(page ?? "1", 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit ?? "50", 10) || 50));
      const offset = (pageNum - 1) * limitNum;

      const conditions: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;

      if (status) {
        const statuses = status.split(",");
        conditions.push(`ea.status = ANY($${paramIdx}::text[])`);
        params.push(statuses);
        paramIdx++;
      } else {
        // Default to non-resolved
        conditions.push(`ea.status != 'resolved'`);
      }

      if (product) {
        conditions.push(`ea.product_name ILIKE $${paramIdx}`);
        params.push(`%${escapeLike(product)}%`);
        paramIdx++;
      }

      if (hostId) {
        if (!UUID_RE.test(hostId)) {
          return res.status(400).json({ error: "Invalid hostId format" });
        }
        conditions.push(`ea.host_id = $${paramIdx}`);
        params.push(hostId);
        paramIdx++;
      }

      if (daysRange === "past") {
        conditions.push(`ea.days_past_eol > 0`);
      } else if (daysRange === "upcoming") {
        conditions.push(`ea.days_past_eol <= 0`);
      }

      if (search) {
        conditions.push(`(ea.product_name ILIKE $${paramIdx} OR h.hostname ILIKE $${paramIdx})`);
        params.push(`%${escapeLike(search)}%`);
        paramIdx++;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const sortColumn =
        sortBy === "product" ? "ea.product_name"
          : sortBy === "daysPastEol" ? "ea.days_past_eol"
            : sortBy === "hostname" ? "h.hostname"
              : "ea.eol_date";
      const sortOrder = order === "desc" ? "DESC" : "ASC";

      const countResult = await pool.query(
        `SELECT COUNT(*) FROM eol_alerts ea JOIN hosts h ON h.id = ea.host_id ${whereClause}`,
        params
      );
      const total = parseInt(countResult.rows[0].count, 10);

      const dataParams = [...params, limitNum, offset];
      const dataResult = await pool.query(
        `SELECT ea.id, ea.host_id, h.hostname, ea.eol_definition_id, ea.product_name,
                ea.installed_version, ea.eol_date, ea.days_past_eol, ea.successor_version,
                ea.status, ea.acknowledged_at, ea.acknowledged_by, ea.exemption_reason, ea.created_at,
                ed.product_category, ed.source_url, ed.lts
         FROM eol_alerts ea
         JOIN hosts h ON h.id = ea.host_id
         JOIN eol_definitions ed ON ed.id = ea.eol_definition_id
         ${whereClause}
         ORDER BY ${sortColumn} ${sortOrder}
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        dataParams
      );

      const data = dataResult.rows.map((r) => ({
        id: r.id,
        hostId: r.host_id,
        hostname: r.hostname,
        eolDefinitionId: r.eol_definition_id,
        productName: r.product_name,
        productCategory: r.product_category,
        installedVersion: r.installed_version,
        eolDate: r.eol_date,
        daysPastEol: r.days_past_eol,
        successorVersion: r.successor_version,
        status: r.status,
        acknowledgedAt: r.acknowledged_at,
        acknowledgedBy: r.acknowledged_by,
        exemptionReason: r.exemption_reason,
        sourceUrl: r.source_url,
        lts: r.lts,
        createdAt: r.created_at,
      }));

      res.json({ data, total, page: pageNum, totalPages: Math.ceil(total / limitNum) });
    } catch (err) {
      next(err);
    }
  });

  // GET /eol/alerts/summary
  router.get("/alerts/summary", async (_req, res, next) => {
    try {
      const result = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE ea.status = 'active')::int AS total_active,
          COUNT(*) FILTER (WHERE ea.status = 'active' AND ea.days_past_eol > 0)::int AS past_eol,
          COUNT(*) FILTER (WHERE ea.status = 'active' AND ea.days_past_eol <= 0 AND ea.days_past_eol >= -90)::int AS upcoming_eol,
          COUNT(*) FILTER (WHERE ea.status = 'active' AND ea.days_past_eol <= 0 AND ea.days_past_eol >= -180)::int AS within_6_months
        FROM eol_alerts ea
      `);
      const row = result.rows[0];

      // By product
      const byProductResult = await pool.query(`
        SELECT ea.product_name, COUNT(*)::int AS count
        FROM eol_alerts ea
        WHERE ea.status = 'active'
        GROUP BY ea.product_name
        ORDER BY count DESC
      `);

      // By category
      const byCategoryResult = await pool.query(`
        SELECT ed.product_category, COUNT(*)::int AS count
        FROM eol_alerts ea
        JOIN eol_definitions ed ON ed.id = ea.eol_definition_id
        WHERE ea.status = 'active'
        GROUP BY ed.product_category
        ORDER BY count DESC
      `);

      // Most affected hosts
      const mostAffectedResult = await pool.query(`
        SELECT h.id, h.hostname, COUNT(*)::int AS eol_count
        FROM eol_alerts ea
        JOIN hosts h ON h.id = ea.host_id
        WHERE ea.status = 'active'
        GROUP BY h.id, h.hostname
        ORDER BY eol_count DESC
        LIMIT 10
      `);

      res.json({
        totalActive: row.total_active,
        pastEol: row.past_eol,
        upcomingEol: row.upcoming_eol,
        within6Months: row.within_6_months,
        byProduct: byProductResult.rows.map((r) => ({ product: r.product_name, count: r.count })),
        byCategory: byCategoryResult.rows.map((r) => ({ category: r.product_category, count: r.count })),
        mostAffectedHosts: mostAffectedResult.rows.map((r) => ({
          id: r.id,
          hostname: r.hostname,
          eolCount: r.eol_count,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /eol/alerts/:id/acknowledge
  router.patch("/alerts/:id/acknowledge", async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!UUID_RE.test(id)) {
        return res.status(400).json({ error: "Invalid alert ID format" });
      }
      const { acknowledgedBy } = req.body ?? {};

      const result = await pool.query(
        `UPDATE eol_alerts SET status = 'acknowledged', acknowledged_at = NOW(), acknowledged_by = $1
         WHERE id = $2 RETURNING *`,
        [acknowledgedBy ?? null, id]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: "EOL alert not found" });
      }
      res.json(formatAlert(result.rows[0]));
    } catch (err) {
      next(err);
    }
  });

  // PATCH /eol/alerts/:id/exempt
  router.patch("/alerts/:id/exempt", async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!UUID_RE.test(id)) {
        return res.status(400).json({ error: "Invalid alert ID format" });
      }
      const { exemptionReason, acknowledgedBy } = req.body ?? {};

      if (!exemptionReason) {
        return res.status(400).json({ error: "exemptionReason is required" });
      }

      const result = await pool.query(
        `UPDATE eol_alerts SET status = 'exempted', acknowledged_at = NOW(), acknowledged_by = $1, exemption_reason = $2
         WHERE id = $3 RETURNING *`,
        [acknowledgedBy ?? null, exemptionReason, id]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: "EOL alert not found" });
      }
      res.json(formatAlert(result.rows[0]));
    } catch (err) {
      next(err);
    }
  });

  // GET /eol/definitions — all definitions grouped by category
  router.get("/definitions", async (_req, res, next) => {
    try {
      const result = await pool.query(
        `SELECT id, product_name, product_category, version_pattern, eol_date, lts, successor_version, source_url, notes, created_at, updated_at
         FROM eol_definitions
         ORDER BY product_category, product_name, eol_date`
      );

      const grouped: Record<string, Array<Record<string, unknown>>> = {};
      for (const row of result.rows) {
        const cat = row.product_category;
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push({
          id: row.id,
          productName: row.product_name,
          productCategory: row.product_category,
          versionPattern: row.version_pattern,
          eolDate: row.eol_date,
          lts: row.lts,
          successorVersion: row.successor_version,
          sourceUrl: row.source_url,
          notes: row.notes,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        });
      }

      res.json(grouped);
    } catch (err) {
      next(err);
    }
  });

  // POST /eol/definitions — add custom definition
  router.post("/definitions", async (req, res, next) => {
    try {
      const { productName, productCategory, versionPattern, eolDate, lts, successorVersion, sourceUrl, notes } = req.body;

      if (!productName || !productCategory || !versionPattern || !eolDate) {
        return res.status(400).json({ error: "productName, productCategory, versionPattern, and eolDate are required" });
      }

      if (!VALID_CATEGORIES.includes(productCategory)) {
        return res.status(400).json({ error: `Invalid productCategory. Must be one of: ${VALID_CATEGORIES.join(", ")}` });
      }

      const result = await pool.query(
        `INSERT INTO eol_definitions (product_name, product_category, version_pattern, eol_date, lts, successor_version, source_url, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [productName, productCategory, versionPattern, eolDate, lts ?? false, successorVersion ?? null, sourceUrl ?? null, notes ?? null]
      );

      res.status(201).json(formatDefinition(result.rows[0]));
    } catch (err) {
      // Handle unique constraint violation (duplicate product_name + version_pattern)
      if (err instanceof Error && "code" in err && (err as { code: string }).code === "23505") {
        return res.status(409).json({ error: "A definition for this product and version already exists" });
      }
      next(err);
    }
  });

  // PUT /eol/definitions/:id — update definition
  router.put("/definitions/:id", async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!UUID_RE.test(id)) {
        return res.status(400).json({ error: "Invalid definition ID format" });
      }
      const { productName, productCategory, versionPattern, eolDate, lts, successorVersion, sourceUrl, notes } = req.body;

      if (productCategory && !VALID_CATEGORIES.includes(productCategory)) {
        return res.status(400).json({ error: `Invalid productCategory. Must be one of: ${VALID_CATEGORIES.join(", ")}` });
      }

      const result = await pool.query(
        `UPDATE eol_definitions SET
           product_name = COALESCE($1, product_name),
           product_category = COALESCE($2, product_category),
           version_pattern = COALESCE($3, version_pattern),
           eol_date = COALESCE($4, eol_date),
           lts = COALESCE($5, lts),
           successor_version = $6,
           source_url = $7,
           notes = $8,
           updated_at = NOW()
         WHERE id = $9
         RETURNING *`,
        [productName, productCategory, versionPattern, eolDate, lts, successorVersion ?? null, sourceUrl ?? null, notes ?? null, id]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: "EOL definition not found" });
      }
      res.json(formatDefinition(result.rows[0]));
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function formatAlert(row: Record<string, unknown>) {
  return {
    id: row.id,
    hostId: row.host_id,
    eolDefinitionId: row.eol_definition_id,
    productName: row.product_name,
    installedVersion: row.installed_version,
    eolDate: row.eol_date,
    daysPastEol: row.days_past_eol,
    successorVersion: row.successor_version,
    status: row.status,
    acknowledgedAt: row.acknowledged_at,
    acknowledgedBy: row.acknowledged_by,
    exemptionReason: row.exemption_reason,
    createdAt: row.created_at,
  };
}

function formatDefinition(row: Record<string, unknown>) {
  return {
    id: row.id,
    productName: row.product_name,
    productCategory: row.product_category,
    versionPattern: row.version_pattern,
    eolDate: row.eol_date,
    lts: row.lts,
    successorVersion: row.successor_version,
    sourceUrl: row.source_url,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
