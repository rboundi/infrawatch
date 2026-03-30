import { Router } from "express";
import type pg from "pg";
import type { Logger } from "pino";
import type { NotificationService } from "../services/notifications/notification-service.js";
import type { AuditLogger } from "../services/audit-logger.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_CHANNEL_TYPES = ["ms_teams", "slack", "generic_webhook", "email"] as const;

function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, (c) => "\\" + c);
}

function maskWebhookUrl(url: string | null): string | null {
  if (!url) return null;
  if (url.length <= 8) return "****";
  return "****" + url.slice(-8);
}

export function createNotificationRoutes(
  pool: pg.Pool,
  _logger: Logger,
  notificationService: NotificationService,
  audit?: AuditLogger
): Router {
  const router = Router();

  // ─── GET /channels ───
  router.get("/channels", async (_req, res, next) => {
    try {
      const result = await pool.query(
        `SELECT id, name, channel_type, webhook_url, config, filters,
                enabled, last_sent_at, last_status, last_error, created_at, updated_at
         FROM notification_channels
         ORDER BY created_at DESC`
      );

      const data = result.rows.map((r) => ({
        id: r.id,
        name: r.name,
        channelType: r.channel_type,
        webhookUrl: maskWebhookUrl(r.webhook_url),
        config: sanitizeConfig(r.config),
        filters: r.filters ?? {},
        enabled: r.enabled,
        lastSentAt: r.last_sent_at,
        lastStatus: r.last_status,
        lastError: r.last_error,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));

      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  // ─── POST /channels ───
  router.post("/channels", async (req, res, next) => {
    try {
      const { name, channelType, webhookUrl, config: channelConfig, filters, enabled } = req.body;

      if (!name || typeof name !== "string" || name.trim().length === 0) {
        return res.status(400).json({ error: "name is required" });
      }
      if (!VALID_CHANNEL_TYPES.includes(channelType)) {
        return res.status(400).json({ error: `channelType must be one of: ${VALID_CHANNEL_TYPES.join(", ")}` });
      }
      if (channelType !== "email" && (!webhookUrl || typeof webhookUrl !== "string")) {
        return res.status(400).json({ error: "webhookUrl is required for non-email channels" });
      }

      const result = await pool.query(
        `INSERT INTO notification_channels (name, channel_type, webhook_url, config, filters, enabled)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          name.trim(),
          channelType,
          channelType === "email" ? null : webhookUrl,
          JSON.stringify(channelConfig ?? {}),
          JSON.stringify(filters ?? {}),
          enabled !== false,
        ]
      );

      const r = result.rows[0];
      audit?.log({ userId: req.user?.id, username: req.user?.username ?? "system", action: "notification_channel.created", entityType: "notification_channel", entityId: result.rows[0].id, details: { name, type }, ipAddress: req.ip ?? null });
      res.status(201).json({
        id: r.id,
        name: r.name,
        channelType: r.channel_type,
        webhookUrl: maskWebhookUrl(r.webhook_url),
        config: sanitizeConfig(r.config),
        filters: r.filters ?? {},
        enabled: r.enabled,
        lastSentAt: r.last_sent_at,
        lastStatus: r.last_status,
        lastError: r.last_error,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      });
    } catch (err) {
      next(err);
    }
  });

  // ─── PATCH /channels/:id ───
  router.patch("/channels/:id", async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!UUID_RE.test(id)) return res.status(400).json({ error: "Invalid channel ID" });

      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;

      const allowedFields: Array<[string, string]> = [
        ["name", "name"],
        ["channelType", "channel_type"],
        ["webhookUrl", "webhook_url"],
        ["enabled", "enabled"],
      ];

      for (const [bodyKey, dbCol] of allowedFields) {
        if (req.body[bodyKey] !== undefined) {
          if (bodyKey === "channelType" && !VALID_CHANNEL_TYPES.includes(req.body[bodyKey])) {
            return res.status(400).json({ error: `channelType must be one of: ${VALID_CHANNEL_TYPES.join(", ")}` });
          }
          fields.push(`${dbCol} = $${idx}`);
          values.push(req.body[bodyKey]);
          idx++;
        }
      }

      if (req.body.config !== undefined) {
        fields.push(`config = $${idx}`);
        values.push(JSON.stringify(req.body.config));
        idx++;
      }
      if (req.body.filters !== undefined) {
        fields.push(`filters = $${idx}`);
        values.push(JSON.stringify(req.body.filters));
        idx++;
      }

      if (fields.length === 0) {
        return res.status(400).json({ error: "No fields to update" });
      }

      fields.push(`updated_at = NOW()`);
      values.push(id);

      const result = await pool.query(
        `UPDATE notification_channels SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`,
        values
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Channel not found" });
      }

      const r = result.rows[0];
      audit?.log({ userId: req.user?.id, username: req.user?.username ?? "system", action: "notification_channel.updated", entityType: "notification_channel", entityId: id, ipAddress: req.ip ?? null });
      res.json({
        id: r.id,
        name: r.name,
        channelType: r.channel_type,
        webhookUrl: maskWebhookUrl(r.webhook_url),
        config: sanitizeConfig(r.config),
        filters: r.filters ?? {},
        enabled: r.enabled,
        lastSentAt: r.last_sent_at,
        lastStatus: r.last_status,
        lastError: r.last_error,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      });
    } catch (err) {
      next(err);
    }
  });

  // ─── DELETE /channels/:id ───
  router.delete("/channels/:id", async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!UUID_RE.test(id)) return res.status(400).json({ error: "Invalid channel ID" });

      const result = await pool.query(
        "DELETE FROM notification_channels WHERE id = $1 RETURNING id",
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Channel not found" });
      }

      audit?.log({ userId: req.user?.id, username: req.user?.username ?? "system", action: "notification_channel.deleted", entityType: "notification_channel", entityId: id, ipAddress: req.ip ?? null });
      res.json({ message: "Channel deleted" });
    } catch (err) {
      next(err);
    }
  });

  // ─── POST /channels/:id/test ───
  router.post("/channels/:id/test", async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!UUID_RE.test(id)) return res.status(400).json({ error: "Invalid channel ID" });

      const result = await notificationService.sendTest(id);
      audit?.log({ userId: req.user?.id, username: req.user?.username ?? "system", action: "notification_channel.tested", entityType: "notification_channel", entityId: id, ipAddress: req.ip ?? null });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // ─── GET /log ───
  router.get("/log", async (req, res, next) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 25));
      const offset = (page - 1) * limit;

      const channelId = req.query.channelId as string | undefined;

      const conditions: string[] = [];
      const values: unknown[] = [];
      let idx = 1;

      if (channelId && UUID_RE.test(channelId)) {
        conditions.push(`nl.channel_id = $${idx++}`);
        values.push(channelId);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const countResult = await pool.query(
        `SELECT COUNT(*) FROM notification_log nl ${where}`,
        values
      );
      const total = parseInt(countResult.rows[0].count, 10);

      const dataResult = await pool.query(
        `SELECT nl.*, nc.name AS channel_name, nc.channel_type
         FROM notification_log nl
         LEFT JOIN notification_channels nc ON nc.id = nl.channel_id
         ${where}
         ORDER BY nl.created_at DESC
         LIMIT $${idx++} OFFSET $${idx}`,
        [...values, limit, offset]
      );

      res.json({
        data: dataResult.rows.map((r) => ({
          id: r.id,
          channelId: r.channel_id,
          channelName: r.channel_name,
          channelType: r.channel_type,
          eventType: r.event_type,
          payload: r.payload,
          status: r.status,
          errorMessage: r.error_message,
          responseCode: r.response_code,
          createdAt: r.created_at,
        })),
        total,
        page,
        totalPages: Math.ceil(total / limit),
      });
    } catch (err) {
      next(err);
    }
  });

  // ─── GET /log/stats ───
  router.get("/log/stats", async (_req, res, next) => {
    try {
      const statsResult = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'sent' AND created_at > NOW() - INTERVAL '24 hours') AS sent_24h,
          COUNT(*) FILTER (WHERE status = 'failed' AND created_at > NOW() - INTERVAL '24 hours') AS failed_24h,
          COUNT(*) FILTER (WHERE status = 'throttled' AND created_at > NOW() - INTERVAL '24 hours') AS throttled_24h
        FROM notification_log
      `);

      const byChannelResult = await pool.query(`
        SELECT nc.id, nc.name, nc.channel_type,
               COUNT(*) FILTER (WHERE nl.status = 'sent') AS sent,
               COUNT(*) FILTER (WHERE nl.status = 'failed') AS failed
        FROM notification_channels nc
        LEFT JOIN notification_log nl ON nl.channel_id = nc.id AND nl.created_at > NOW() - INTERVAL '24 hours'
        GROUP BY nc.id, nc.name, nc.channel_type
      `);

      const s = statsResult.rows[0];
      res.json({
        sent24h: parseInt(s.sent_24h, 10),
        failed24h: parseInt(s.failed_24h, 10),
        throttled24h: parseInt(s.throttled_24h, 10),
        byChannel: byChannelResult.rows.map((r) => ({
          id: r.id,
          name: r.name,
          channelType: r.channel_type,
          sent: parseInt(r.sent, 10),
          failed: parseInt(r.failed, 10),
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/** Remove sensitive fields from config before returning to client */
function sanitizeConfig(config: Record<string, unknown>): Record<string, unknown> {
  if (!config) return {};
  const sanitized = { ...config };
  // Don't expose bodyTemplate contents in list view
  if (sanitized.bodyTemplate && typeof sanitized.bodyTemplate === "string") {
    sanitized.bodyTemplate = sanitized.bodyTemplate.length > 100
      ? sanitized.bodyTemplate.slice(0, 100) + "..."
      : sanitized.bodyTemplate;
  }
  return sanitized;
}
