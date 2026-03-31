import { Router, type Request, type Response } from "express";
import type pg from "pg";
import type { Logger } from "pino";

function escapeIlike(str: string): string {
  return str.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createUnifiedAlertRoutes(pool: pg.Pool, logger: Logger): Router {
  const router = Router();

  // ─── GET /api/v1/alerts/unified ───
  router.get("/", async (req: Request, res: Response) => {
    try {
      const {
        type,
        severity,
        status = "unacknowledged",
        search,
        hostId,
        groupId,
        sortBy = "createdAt",
        order = "desc",
        page = "1",
        limit = "50",
      } = req.query as Record<string, string | undefined>;

      const pageNum = Math.max(1, parseInt(page ?? "1", 10));
      const limitNum = Math.min(200, Math.max(1, parseInt(limit ?? "50", 10)));
      const offset = (pageNum - 1) * limitNum;

      // Build WHERE conditions for each part of the UNION
      const vulnConditions: string[] = [];
      const vulnValues: unknown[] = [];
      let vulnIdx = 1;

      const eolConditions: string[] = ["e.status != 'resolved'"];
      const eolValues: unknown[] = [];
      let eolIdx = 1;

      // Status filter
      if (status === "unacknowledged") {
        vulnConditions.push("a.acknowledged = false");
        eolConditions.push("e.status = 'active'");
      } else if (status === "acknowledged") {
        vulnConditions.push("a.acknowledged = true");
        eolConditions.push("e.status IN ('acknowledged', 'exempted')");
      }

      // Search
      if (search) {
        vulnConditions.push(`(a.package_name ILIKE $${vulnIdx} OR h.hostname ILIKE $${vulnIdx})`);
        vulnValues.push(`%${escapeIlike(search)}%`);
        vulnIdx++;

        eolConditions.push(`(e.product_name ILIKE $${eolIdx} OR h2.hostname ILIKE $${eolIdx})`);
        eolValues.push(`%${escapeIlike(search)}%`);
        eolIdx++;
      }

      // Host filter
      if (hostId && UUID_RE.test(hostId)) {
        vulnConditions.push(`a.host_id = $${vulnIdx++}`);
        vulnValues.push(hostId);
        eolConditions.push(`e.host_id = $${eolIdx++}`);
        eolValues.push(hostId);
      }

      // Group filter
      if (groupId && UUID_RE.test(groupId)) {
        vulnConditions.push(`EXISTS (SELECT 1 FROM host_group_members hgm WHERE hgm.host_id = a.host_id AND hgm.host_group_id = $${vulnIdx++})`);
        vulnValues.push(groupId);
        eolConditions.push(`EXISTS (SELECT 1 FROM host_group_members hgm WHERE hgm.host_id = e.host_id AND hgm.host_group_id = $${eolIdx++})`);
        eolValues.push(groupId);
      }

      // Severity filter (applies to computed severity for EOL)
      const severityArr = severity ? severity.split(",").filter(Boolean) : [];

      const vulnWhere = vulnConditions.length > 0 ? `WHERE ${vulnConditions.join(" AND ")}` : "";
      const eolWhere = eolConditions.length > 0 ? `WHERE ${eolConditions.join(" AND ")}` : "";

      // Build UNION query
      const vulnSelect = `
        SELECT a.id, 'vulnerability'::text as type, a.severity::text,
          h.hostname, a.host_id,
          a.package_name, a.current_version, a.available_version,
          NULL::text as product_name, NULL::text as eol_date, NULL::integer as days_past_eol,
          NULL::text as successor_version,
          CASE WHEN a.acknowledged THEN 'acknowledged' ELSE 'active' END as status,
          a.acknowledged,
          a.acknowledged_at, a.acknowledged_by, a.notes, NULL::text as exemption_reason,
          a.created_at
        FROM alerts a JOIN hosts h ON a.host_id = h.id
        ${vulnWhere}`;

      const eolSelect = `
        SELECT e.id, 'eol'::text as type,
          CASE
            WHEN e.days_past_eol > 0 THEN 'high'
            WHEN e.eol_date <= CURRENT_DATE + INTERVAL '90 days' THEN 'medium'
            WHEN e.eol_date <= CURRENT_DATE + INTERVAL '6 months' THEN 'low'
            ELSE 'info'
          END::text as severity,
          h2.hostname, e.host_id,
          e.product_name as package_name, e.installed_version as current_version,
          e.successor_version as available_version,
          e.product_name, e.eol_date::text, e.days_past_eol,
          e.successor_version,
          e.status::text,
          (e.status = 'acknowledged' OR e.status = 'exempted') as acknowledged,
          e.acknowledged_at, e.acknowledged_by, NULL::text as notes, e.exemption_reason,
          e.created_at
        FROM eol_alerts e JOIN hosts h2 ON e.host_id = h2.id
        ${eolWhere}`;

      // Type filter — only include relevant subquery
      let unionQuery: string;
      let allValues: unknown[];

      if (type === "vulnerability") {
        unionQuery = vulnSelect;
        allValues = [...vulnValues];
      } else if (type === "eol") {
        unionQuery = eolSelect;
        allValues = [...eolValues];
      } else {
        // Renumber eol params to not overlap with vuln params
        const renumberedEolSelect = renumberParams(eolSelect, vulnValues.length);
        unionQuery = `(${vulnSelect}) UNION ALL (${renumberedEolSelect})`;
        allValues = [...vulnValues, ...eolValues];
      }

      // Wrap in outer query for severity filter, sorting, pagination
      let outerWhere = "";
      if (severityArr.length > 0) {
        const placeholders = severityArr.map((_, i) => `$${allValues.length + i + 1}`).join(",");
        outerWhere = `WHERE u.severity IN (${placeholders})`;
        allValues.push(...severityArr);
      }

      // Sort mapping
      const sortMap: Record<string, string> = {
        createdAt: "u.created_at",
        severity: "CASE u.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END",
        hostname: "u.hostname",
      };
      const sortCol = sortMap[sortBy ?? "createdAt"] || "u.created_at";
      const sortOrder = order === "asc" ? "ASC" : "DESC";

      // Count query
      const countSql = `SELECT COUNT(*) FROM (${unionQuery}) u ${outerWhere}`;
      const countResult = await pool.query(countSql, allValues);
      const total = parseInt(countResult.rows[0].count, 10);

      // Data query
      const dataSql = `SELECT u.* FROM (${unionQuery}) u ${outerWhere} ORDER BY ${sortCol} ${sortOrder}, u.created_at DESC LIMIT ${limitNum} OFFSET ${offset}`;
      const dataResult = await pool.query(dataSql, allValues);

      const data = dataResult.rows.map(formatRow);

      res.json({
        data,
        total,
        page: pageNum,
        totalPages: Math.ceil(total / limitNum),
      });
    } catch (err) {
      logger.error({ err }, "Failed to list unified alerts");
      res.status(500).json({ error: "Failed to list unified alerts" });
    }
  });

  // ─── GET /api/v1/alerts/unified/summary ───
  router.get("/summary", async (_req: Request, res: Response) => {
    try {
      const sql = `
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE NOT acknowledged) as unacknowledged,
          COUNT(*) FILTER (WHERE type = 'vulnerability') as vuln_count,
          COUNT(*) FILTER (WHERE type = 'eol') as eol_count,
          COUNT(*) FILTER (WHERE severity = 'critical') as critical,
          COUNT(*) FILTER (WHERE severity = 'high') as high,
          COUNT(*) FILTER (WHERE severity = 'medium') as medium,
          COUNT(*) FILTER (WHERE severity = 'low') as low,
          COUNT(*) FILTER (WHERE severity = 'info') as info
        FROM (
          SELECT 'vulnerability' as type, a.severity, a.acknowledged
          FROM alerts a

          UNION ALL

          SELECT 'eol' as type,
            CASE
              WHEN e.days_past_eol > 0 THEN 'high'
              WHEN e.eol_date <= CURRENT_DATE + INTERVAL '90 days' THEN 'medium'
              WHEN e.eol_date <= CURRENT_DATE + INTERVAL '6 months' THEN 'low'
              ELSE 'info'
            END as severity,
            (e.status = 'acknowledged' OR e.status = 'exempted') as acknowledged
          FROM eol_alerts e WHERE e.status != 'resolved'
        ) combined
      `;

      const result = await pool.query(sql);
      const row = result.rows[0];

      res.json({
        total: parseInt(row.total, 10),
        unacknowledged: parseInt(row.unacknowledged, 10),
        byType: {
          vulnerability: parseInt(row.vuln_count, 10),
          eol: parseInt(row.eol_count, 10),
        },
        bySeverity: {
          critical: parseInt(row.critical, 10),
          high: parseInt(row.high, 10),
          medium: parseInt(row.medium, 10),
          low: parseInt(row.low, 10),
          info: parseInt(row.info, 10),
        },
      });
    } catch (err) {
      logger.error({ err }, "Failed to get unified alerts summary");
      res.status(500).json({ error: "Failed to get unified alerts summary" });
    }
  });

  return router;
}

// ─── Helpers ───

function renumberParams(sql: string, offset: number): string {
  return sql.replace(/\$(\d+)/g, (_, n) => `$${parseInt(n, 10) + offset}`);
}

function formatRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    type: row.type,
    severity: row.severity,
    hostname: row.hostname,
    hostId: row.host_id,
    packageName: row.package_name,
    currentVersion: row.current_version,
    availableVersion: row.available_version,
    productName: row.product_name,
    eolDate: row.eol_date,
    daysPastEol: row.days_past_eol,
    successorVersion: row.successor_version,
    status: row.status,
    acknowledged: row.acknowledged,
    acknowledgedAt: row.acknowledged_at ? (row.acknowledged_at as Date).toISOString() : null,
    acknowledgedBy: row.acknowledged_by,
    notes: row.notes,
    exemptionReason: row.exemption_reason,
    createdAt: (row.created_at as Date).toISOString(),
  };
}
