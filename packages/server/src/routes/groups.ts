import { Router, type Request, type Response } from "express";
import type pg from "pg";
import type { Logger } from "pino";
import { GroupAssignmentService } from "../services/group-assignment.js";
import type { AuditLogger } from "../services/audit-logger.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createGroupRoutes(
  pool: pg.Pool,
  logger: Logger,
  groupAssignment: GroupAssignmentService,
  audit?: AuditLogger
): Router {
  const router = Router();

  // ─── GET /api/v1/groups ───
  router.get("/", async (_req: Request, res: Response) => {
    try {
      const result = await pool.query(`
        SELECT
          g.*,
          (SELECT COUNT(*) FROM host_group_members m WHERE m.host_group_id = g.id)::int AS member_count,
          (SELECT COUNT(*) FROM host_group_rules r WHERE r.host_group_id = g.id)::int AS rule_count,
          (SELECT COUNT(*) FROM alerts a
           JOIN host_group_members m ON m.host_id = a.host_id AND m.host_group_id = g.id
           WHERE a.acknowledged = false AND a.severity = 'critical')::int AS critical_alerts,
          (SELECT COUNT(*) FROM alerts a
           JOIN host_group_members m ON m.host_id = a.host_id AND m.host_group_id = g.id
           WHERE a.acknowledged = false AND a.severity = 'high')::int AS high_alerts,
          (SELECT COUNT(*) FROM alerts a
           JOIN host_group_members m ON m.host_id = a.host_id AND m.host_group_id = g.id
           WHERE a.acknowledged = false AND a.severity = 'medium')::int AS medium_alerts,
          (SELECT COUNT(*) FROM alerts a
           JOIN host_group_members m ON m.host_id = a.host_id AND m.host_group_id = g.id
           WHERE a.acknowledged = false AND a.severity = 'low')::int AS low_alerts,
          (SELECT COUNT(*) FROM hosts h
           JOIN host_group_members m ON m.host_id = h.id AND m.host_group_id = g.id
           WHERE h.status = 'active')::int AS active_hosts,
          (SELECT COUNT(*) FROM hosts h
           JOIN host_group_members m ON m.host_id = h.id AND m.host_group_id = g.id
           WHERE h.status = 'stale')::int AS stale_hosts
        FROM host_groups g
        ORDER BY g.name ASC
      `);

      res.json({
        data: result.rows.map(formatGroup),
      });
    } catch (err) {
      logger.error({ err }, "Failed to list groups");
      res.status(500).json({ error: "Failed to list groups" });
    }
  });

  // ─── POST /api/v1/groups ───
  router.post("/", async (req: Request, res: Response) => {
    try {
      const {
        name,
        description,
        color,
        icon,
        ownerName,
        ownerEmail,
        notificationChannelIds,
        alertSeverityThreshold,
      } = req.body;

      if (!name || typeof name !== "string" || name.trim().length === 0) {
        res.status(400).json({ error: "name is required" });
        return;
      }

      const result = await pool.query(
        `INSERT INTO host_groups (name, description, color, icon, owner_name, owner_email, notification_channel_ids, alert_severity_threshold)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          name.trim(),
          description ?? null,
          color ?? null,
          icon ?? null,
          ownerName ?? null,
          ownerEmail ?? null,
          notificationChannelIds ?? [],
          alertSeverityThreshold ?? "info",
        ]
      );

      audit?.log({ userId: req.user?.id, username: req.user?.username ?? "system", action: "host_group.created", entityType: "host_group", entityId: result.rows[0].id, details: { name }, ipAddress: req.ip ?? null });
      res.status(201).json(formatGroup(result.rows[0]));
    } catch (err: any) {
      if (err.code === "23505") {
        res.status(409).json({ error: "A group with this name already exists" });
        return;
      }
      logger.error({ err }, "Failed to create group");
      res.status(500).json({ error: "Failed to create group" });
    }
  });

  // ─── GET /api/v1/groups/:id ───
  router.get("/:id", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    if (!UUID_RE.test(id)) {
      res.status(400).json({ error: "Invalid group ID" });
      return;
    }

    try {
      const groupResult = await pool.query(
        `SELECT g.*,
           (SELECT COUNT(*) FROM host_group_members m WHERE m.host_group_id = g.id)::int AS member_count,
           (SELECT COUNT(*) FROM host_group_rules r WHERE r.host_group_id = g.id)::int AS rule_count
         FROM host_groups g WHERE g.id = $1`,
        [id]
      );
      if (groupResult.rows.length === 0) {
        res.status(404).json({ error: "Group not found" });
        return;
      }

      const rulesResult = await pool.query(
        `SELECT * FROM host_group_rules WHERE host_group_id = $1 ORDER BY priority DESC, created_at ASC`,
        [id]
      );

      const membersResult = await pool.query(
        `SELECT
           h.id, h.hostname, h.ip_address, h.os, h.status, h.environment_tag, h.last_seen_at,
           m.assigned_by, m.rule_id, m.assigned_at,
           (SELECT COUNT(*) FROM alerts a WHERE a.host_id = h.id AND a.acknowledged = false)::int AS open_alert_count
         FROM host_group_members m
         JOIN hosts h ON h.id = m.host_id
         WHERE m.host_group_id = $1
         ORDER BY h.hostname ASC`,
        [id]
      );

      // Get notification channel names
      const group = groupResult.rows[0];
      let channelNames: { id: string; name: string }[] = [];
      if (group.notification_channel_ids && group.notification_channel_ids.length > 0) {
        const chResult = await pool.query(
          `SELECT id, name FROM notification_channels WHERE id = ANY($1)`,
          [group.notification_channel_ids]
        );
        channelNames = chResult.rows;
      }

      res.json({
        ...formatGroup(group),
        rules: rulesResult.rows.map(formatRule),
        members: membersResult.rows.map(formatMember),
        channels: channelNames,
      });
    } catch (err) {
      logger.error({ err }, "Failed to get group");
      res.status(500).json({ error: "Failed to get group" });
    }
  });

  // ─── PATCH /api/v1/groups/:id ───
  router.patch("/:id", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    if (!UUID_RE.test(id)) {
      res.status(400).json({ error: "Invalid group ID" });
      return;
    }

    try {
      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;

      const allowed = [
        ["name", "name"],
        ["description", "description"],
        ["color", "color"],
        ["icon", "icon"],
        ["ownerName", "owner_name"],
        ["ownerEmail", "owner_email"],
        ["notificationChannelIds", "notification_channel_ids"],
        ["alertSeverityThreshold", "alert_severity_threshold"],
      ];

      for (const [jsKey, dbKey] of allowed) {
        if (req.body[jsKey] !== undefined) {
          fields.push(`${dbKey} = $${idx++}`);
          values.push(req.body[jsKey]);
        }
      }

      if (fields.length === 0) {
        res.status(400).json({ error: "No fields to update" });
        return;
      }

      fields.push(`updated_at = NOW()`);
      values.push(id);

      const result = await pool.query(
        `UPDATE host_groups SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`,
        values
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: "Group not found" });
        return;
      }

      audit?.log({ userId: req.user?.id, username: req.user?.username ?? "system", action: "host_group.updated", entityType: "host_group", entityId: id, ipAddress: req.ip ?? null });
      res.json(formatGroup(result.rows[0]));
    } catch (err: any) {
      if (err.code === "23505") {
        res.status(409).json({ error: "A group with this name already exists" });
        return;
      }
      logger.error({ err }, "Failed to update group");
      res.status(500).json({ error: "Failed to update group" });
    }
  });

  // ─── DELETE /api/v1/groups/:id ───
  router.delete("/:id", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    if (!UUID_RE.test(id)) {
      res.status(400).json({ error: "Invalid group ID" });
      return;
    }

    try {
      const result = await pool.query(
        "DELETE FROM host_groups WHERE id = $1 RETURNING id",
        [id]
      );
      if (result.rows.length === 0) {
        res.status(404).json({ error: "Group not found" });
        return;
      }
      audit?.log({ userId: req.user?.id, username: req.user?.username ?? "system", action: "host_group.deleted", entityType: "host_group", entityId: id, ipAddress: req.ip ?? null });
      res.status(204).end();
    } catch (err) {
      logger.error({ err }, "Failed to delete group");
      res.status(500).json({ error: "Failed to delete group" });
    }
  });

  // ─── POST /api/v1/groups/:id/rules ───
  router.post("/:id/rules", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    if (!UUID_RE.test(id)) {
      res.status(400).json({ error: "Invalid group ID" });
      return;
    }

    try {
      const { ruleType, ruleValue, priority } = req.body;
      if (!ruleType || !ruleValue) {
        res.status(400).json({ error: "ruleType and ruleValue are required" });
        return;
      }

      const result = await pool.query(
        `INSERT INTO host_group_rules (host_group_id, rule_type, rule_value, priority)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [id, ruleType, ruleValue, priority ?? 0]
      );

      // Re-evaluate group membership
      const evalResult = await groupAssignment.evaluateGroup(id);

      const ruleResult = result;
      audit?.log({ userId: req.user?.id, username: req.user?.username ?? "system", action: "group.rules_added", entityType: "host_group", entityId: id, details: { ruleId: ruleResult.rows[0].id }, ipAddress: req.ip ?? null });
      res.status(201).json({
        rule: formatRule(result.rows[0]),
        evaluation: evalResult,
      });
    } catch (err) {
      logger.error({ err }, "Failed to add rule");
      res.status(500).json({ error: "Failed to add rule" });
    }
  });

  // ─── DELETE /api/v1/groups/:id/rules/:ruleId ───
  router.delete("/:id/rules/:ruleId", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const ruleId = req.params.ruleId as string;

    try {
      const result = await pool.query(
        "DELETE FROM host_group_rules WHERE id = $1 AND host_group_id = $2 RETURNING id",
        [ruleId, id]
      );
      if (result.rows.length === 0) {
        res.status(404).json({ error: "Rule not found" });
        return;
      }

      // Re-evaluate
      const evalResult = await groupAssignment.evaluateGroup(id);
      audit?.log({ userId: req.user?.id, username: req.user?.username ?? "system", action: "group.rules_removed", entityType: "host_group", entityId: id, details: { ruleId }, ipAddress: req.ip ?? null });
      res.json({ deleted: true, evaluation: evalResult });
    } catch (err) {
      logger.error({ err }, "Failed to delete rule");
      res.status(500).json({ error: "Failed to delete rule" });
    }
  });

  // ─── POST /api/v1/groups/:id/members ───
  router.post("/:id/members", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    if (!UUID_RE.test(id)) {
      res.status(400).json({ error: "Invalid group ID" });
      return;
    }

    try {
      const { hostIds } = req.body;
      if (!Array.isArray(hostIds) || hostIds.length === 0) {
        res.status(400).json({ error: "hostIds array is required" });
        return;
      }

      let added = 0;
      for (const hostId of hostIds) {
        const result = await pool.query(
          `INSERT INTO host_group_members (host_id, host_group_id, assigned_by)
           VALUES ($1, $2, 'manual')
           ON CONFLICT (host_id, host_group_id) DO NOTHING`,
          [hostId, id]
        );
        if (result.rowCount && result.rowCount > 0) added++;
      }

      audit?.log({ userId: req.user?.id, username: req.user?.username ?? "system", action: "group.members_added", entityType: "host_group", entityId: id, details: { hostIds }, ipAddress: req.ip ?? null });
      res.json({ added });
    } catch (err) {
      logger.error({ err }, "Failed to add members");
      res.status(500).json({ error: "Failed to add members" });
    }
  });

  // ─── DELETE /api/v1/groups/:id/members ───
  router.delete("/:id/members", async (req: Request, res: Response) => {
    const id = req.params.id as string;

    try {
      const { hostIds } = req.body;
      if (!Array.isArray(hostIds) || hostIds.length === 0) {
        res.status(400).json({ error: "hostIds array is required" });
        return;
      }

      let removed = 0;
      for (const hostId of hostIds) {
        const result = await pool.query(
          `DELETE FROM host_group_members
           WHERE host_id = $1 AND host_group_id = $2 AND assigned_by = 'manual'`,
          [hostId, id]
        );
        if (result.rowCount && result.rowCount > 0) removed++;
      }

      audit?.log({ userId: req.user?.id, username: req.user?.username ?? "system", action: "group.members_removed", entityType: "host_group", entityId: id, details: { hostIds }, ipAddress: req.ip ?? null });
      res.json({ removed });
    } catch (err) {
      logger.error({ err }, "Failed to remove members");
      res.status(500).json({ error: "Failed to remove members" });
    }
  });

  // ─── POST /api/v1/groups/:id/evaluate ───
  router.post("/:id/evaluate", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    if (!UUID_RE.test(id)) {
      res.status(400).json({ error: "Invalid group ID" });
      return;
    }

    try {
      const result = await groupAssignment.evaluateGroup(id);
      res.json(result);
    } catch (err) {
      logger.error({ err }, "Failed to evaluate group");
      res.status(500).json({ error: "Failed to evaluate group" });
    }
  });

  // ─── POST /api/v1/groups/preview-rule ───
  router.post("/preview-rule", async (req: Request, res: Response) => {
    try {
      const { ruleType, ruleValue } = req.body;
      if (!ruleType || !ruleValue) {
        res.status(400).json({ error: "ruleType and ruleValue are required" });
        return;
      }
      const count = await groupAssignment.previewRule(ruleType, ruleValue);
      res.json({ matchCount: count });
    } catch (err) {
      logger.error({ err }, "Failed to preview rule");
      res.status(500).json({ error: "Failed to preview rule" });
    }
  });

  return router;
}

// ─── Formatters ───

function formatGroup(row: any) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    icon: row.icon,
    ownerName: row.owner_name,
    ownerEmail: row.owner_email,
    notificationChannelIds: row.notification_channel_ids ?? [],
    alertSeverityThreshold: row.alert_severity_threshold,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    memberCount: row.member_count ?? 0,
    ruleCount: row.rule_count ?? 0,
    criticalAlerts: row.critical_alerts ?? 0,
    highAlerts: row.high_alerts ?? 0,
    mediumAlerts: row.medium_alerts ?? 0,
    lowAlerts: row.low_alerts ?? 0,
    activeHosts: row.active_hosts ?? 0,
    staleHosts: row.stale_hosts ?? 0,
  };
}

function formatRule(row: any) {
  return {
    id: row.id,
    hostGroupId: row.host_group_id,
    ruleType: row.rule_type,
    ruleValue: row.rule_value,
    priority: row.priority,
    createdAt: row.created_at,
  };
}

function formatMember(row: any) {
  return {
    id: row.id,
    hostname: row.hostname,
    ip: row.ip_address,
    os: row.os,
    status: row.status,
    environment: row.environment_tag,
    lastSeenAt: row.last_seen_at,
    assignedBy: row.assigned_by,
    ruleId: row.rule_id,
    assignedAt: row.assigned_at,
    openAlertCount: row.open_alert_count ?? 0,
  };
}
