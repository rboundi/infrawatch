import { Router, type Request, type Response } from "express";
import type pg from "pg";
import type { Logger } from "pino";
import type { AgentTokenService } from "../services/agent-token-service.js";
import type { AuditLogger } from "../services/audit-logger.js";
import type { SettingsService } from "../services/settings-service.js";
import { requireAdmin } from "../middleware/auth.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateIdParam(req: Request, res: Response): boolean {
  if (!UUID_RE.test(req.params.id as string as string)) {
    res.status(400).json({ error: "Invalid token ID format" });
    return false;
  }
  return true;
}

function formatTokenForList(t: {
  id: string;
  name: string;
  description: string | null;
  scope: string;
  lockedHostname: string | null;
  environmentTag: string | null;
  hostGroupIds: string[];
  isActive: boolean;
  lastUsedAt: string | null;
  reportCount: number;
  createdAt: string;
  expiresAt: string | null;
}) {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    scope: t.scope,
    lockedHostname: t.lockedHostname,
    environmentTag: t.environmentTag,
    hostGroupIds: t.hostGroupIds,
    isActive: t.isActive,
    lastUsedAt: t.lastUsedAt,
    reportCount: t.reportCount,
    createdAt: t.createdAt,
    expiresAt: t.expiresAt,
  };
}

export function createAgentTokenRoutes(
  pool: pg.Pool,
  logger: Logger,
  tokenService: AgentTokenService,
  audit?: AuditLogger,
  settingsService?: SettingsService,
): Router {
  const router = Router();

  // All agent-token management routes require admin role
  router.use(requireAdmin);

  // ─── POST /api/v1/agent-tokens ───
  router.post("/", async (req: Request, res: Response) => {
    try {
      const { name, description, scope, allowedHostnames, environmentTag, hostGroupIds, expiresAt } = req.body;

      if (!name || typeof name !== "string" || name.trim().length === 0) {
        res.status(400).json({ error: "name is required" });
        return;
      }

      if (scope && !["single", "fleet"].includes(scope)) {
        res.status(400).json({ error: "scope must be 'single' or 'fleet'" });
        return;
      }

      const { rawToken, token } = await tokenService.generateToken({
        name: name.trim(),
        description: description?.trim(),
        scope: scope ?? "single",
        allowedHostnames: allowedHostnames ?? [],
        environmentTag: environmentTag?.trim(),
        hostGroupIds: hostGroupIds ?? [],
        expiresAt: expiresAt ?? undefined,
        createdBy: req.user?.id,
      });

      audit?.log({
        userId: req.user?.id,
        username: req.user?.username ?? "system",
        action: "agent_token.created",
        entityType: "agent_token",
        entityId: token.id,
        details: { name: token.name, scope: token.scope },
        ipAddress: req.ip ?? null,
      });

      // Return the raw token ONLY on creation
      res.status(201).json({
        id: token.id,
        name: token.name,
        token: rawToken,
        scope: token.scope,
        createdAt: token.createdAt,
        message: "Save this token now — it cannot be retrieved again.",
      });
    } catch (err) {
      logger.error({ err }, "Failed to create agent token");
      res.status(500).json({ error: "Failed to create agent token" });
    }
  });

  // ─── GET /api/v1/agent-tokens ───
  router.get("/", async (_req: Request, res: Response) => {
    try {
      const tokens = await tokenService.listTokens();
      res.json(tokens.map(formatTokenForList));
    } catch (err) {
      logger.error({ err }, "Failed to list agent tokens");
      res.status(500).json({ error: "Failed to list agent tokens" });
    }
  });

  // ─── GET /api/v1/agent-tokens/:id ───
  router.get("/:id", async (req: Request, res: Response) => {
    if (!validateIdParam(req, res)) return;

    try {
      const token = await tokenService.getById(req.params.id as string);
      if (!token) {
        res.status(404).json({ error: "Agent token not found" });
        return;
      }

      // Include extra detail: last_used_ip and associated host count
      const hostCountResult = await pool.query(
        `SELECT COUNT(*) AS count FROM hosts WHERE agent_token_id = $1`,
        [token.id],
      );

      res.json({
        ...formatTokenForList(token),
        lastUsedIp: token.lastUsedIp,
        hostCount: parseInt(hostCountResult.rows[0].count, 10),
      });
    } catch (err) {
      logger.error({ err }, "Failed to get agent token");
      res.status(500).json({ error: "Failed to get agent token" });
    }
  });

  // ─── PATCH /api/v1/agent-tokens/:id ───
  router.patch("/:id", async (req: Request, res: Response) => {
    if (!validateIdParam(req, res)) return;

    try {
      const { name, description, allowedHostnames, environmentTag, hostGroupIds, isActive, expiresAt } = req.body;

      const updated = await tokenService.updateToken(req.params.id as string, {
        name,
        description,
        allowedHostnames,
        environmentTag,
        hostGroupIds,
        isActive,
        expiresAt,
      });

      if (!updated) {
        res.status(404).json({ error: "Agent token not found" });
        return;
      }

      res.json(formatTokenForList(updated));
    } catch (err) {
      logger.error({ err }, "Failed to update agent token");
      res.status(500).json({ error: "Failed to update agent token" });
    }
  });

  // ─── DELETE /api/v1/agent-tokens/:id ───
  router.delete("/:id", async (req: Request, res: Response) => {
    if (!validateIdParam(req, res)) return;

    try {
      const revoked = await tokenService.revokeToken(req.params.id as string);
      if (!revoked) {
        res.status(404).json({ error: "Agent token not found" });
        return;
      }

      audit?.log({
        userId: req.user?.id,
        username: req.user?.username ?? "system",
        action: "agent_token.revoked",
        entityType: "agent_token",
        entityId: req.params.id as string,
        ipAddress: req.ip ?? null,
      });

      res.json({ message: "Token deactivated" });
    } catch (err) {
      logger.error({ err }, "Failed to deactivate agent token");
      res.status(500).json({ error: "Failed to deactivate agent token" });
    }
  });

  // ─── POST /api/v1/agent-tokens/:id/rotate ───
  router.post("/:id/rotate", async (req: Request, res: Response) => {
    if (!validateIdParam(req, res)) return;

    try {
      const result = await tokenService.rotateToken(req.params.id as string);
      if (!result) {
        res.status(404).json({ error: "Agent token not found" });
        return;
      }

      audit?.log({
        userId: req.user?.id,
        username: req.user?.username ?? "system",
        action: "agent_token.rotated",
        entityType: "agent_token",
        entityId: result.token.id,
        details: { oldTokenId: req.params.id as string },
        ipAddress: req.ip ?? null,
      });

      res.json({
        id: result.token.id,
        name: result.token.name,
        token: result.rawToken,
        scope: result.token.scope,
        createdAt: result.token.createdAt,
        message: "Token rotated. Save the new token — it cannot be retrieved again. The old token is now deactivated.",
      });
    } catch (err) {
      logger.error({ err }, "Failed to rotate agent token");
      res.status(500).json({ error: "Failed to rotate agent token" });
    }
  });

  // ─── POST /api/v1/agent-tokens/:id/revoke ───
  router.post("/:id/revoke", async (req: Request, res: Response) => {
    if (!validateIdParam(req, res)) return;

    try {
      const revoked = await tokenService.revokeToken(req.params.id as string);
      if (!revoked) {
        res.status(404).json({ error: "Agent token not found" });
        return;
      }

      audit?.log({
        userId: req.user?.id,
        username: req.user?.username ?? "system",
        action: "agent_token.revoked",
        entityType: "agent_token",
        entityId: req.params.id as string,
        ipAddress: req.ip ?? null,
      });

      res.json({ message: "Token immediately revoked. All future reports with this token will be rejected." });
    } catch (err) {
      logger.error({ err }, "Failed to revoke agent token");
      res.status(500).json({ error: "Failed to revoke agent token" });
    }
  });

  // ─── GET /api/v1/agent-tokens/health/hosts ───
  router.get("/health/hosts", async (_req: Request, res: Response) => {
    try {
      const staleThreshold = settingsService?.get<number>("agent_stale_threshold_hours") ?? 12;
      const offlineThreshold = settingsService?.get<number>("agent_offline_alert_hours") ?? 48;

      const result = await pool.query(
        `SELECT
           h.id,
           h.hostname,
           h.agent_version,
           h.last_seen_at,
           h.last_report_ip,
           h.status,
           at.name AS token_name,
           at.id AS token_id,
           CASE
             WHEN h.last_seen_at >= NOW() - ($1 || ' hours')::interval THEN 'healthy'
             WHEN h.last_seen_at >= NOW() - ($2 || ' hours')::interval THEN 'stale'
             ELSE 'offline'
           END AS health_status
         FROM hosts h
         LEFT JOIN agent_tokens at ON at.id = h.agent_token_id
         WHERE h.reporting_method = 'agent'
         ORDER BY h.last_seen_at ASC`,
        [staleThreshold, offlineThreshold],
      );

      const hosts = result.rows.map((r: Record<string, unknown>) => ({
        id: r.id,
        hostname: r.hostname,
        agentVersion: r.agent_version,
        lastSeenAt: r.last_seen_at,
        lastReportIp: r.last_report_ip,
        status: r.status,
        healthStatus: r.health_status,
        tokenName: r.token_name,
        tokenId: r.token_id,
      }));

      // Summary counts
      const healthy = hosts.filter((h) => h.healthStatus === "healthy").length;
      const stale = hosts.filter((h) => h.healthStatus === "stale").length;
      const offline = hosts.filter((h) => h.healthStatus === "offline").length;

      res.json({
        hosts,
        summary: { healthy, stale, offline, total: hosts.length },
        thresholds: { staleHours: staleThreshold, offlineHours: offlineThreshold },
      });
    } catch (err) {
      logger.error({ err }, "Failed to get agent health");
      res.status(500).json({ error: "Failed to get agent health" });
    }
  });

  return router;
}
