import { Router, type Request, type Response } from "express";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import type { Logger } from "pino";
import type { HostInventory, ScanResult } from "@infrawatch/scanner";
import { DataIngestionService } from "../services/data-ingestion.js";
import type { AgentTokenService } from "../services/agent-token-service.js";
import type { GroupAssignmentService } from "../services/group-assignment.js";
import type { AuditLogger } from "../services/audit-logger.js";
import type { SettingsService } from "../services/settings-service.js";

// In-memory rate limiter: token_id -> { count, windowStart }
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 60; // 60 reports per hour per token

function checkRateLimit(tokenId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(tokenId);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(tokenId, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

export function createAgentReportRoutes(
  pool: pg.Pool,
  logger: Logger,
  tokenService: AgentTokenService,
  groupAssignment: GroupAssignmentService,
  audit?: AuditLogger,
  settingsService?: SettingsService,
): Router {
  const router = Router();
  const ingestion = new DataIngestionService(pool, logger);
  ingestion.setGroupAssignment(groupAssignment);

  /**
   * Extract and validate bearer token from Authorization header.
   */
  async function authenticateAgent(req: Request, res: Response) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing or invalid Authorization header. Use: Bearer iw_XXXX" });
      return null;
    }

    const rawToken = authHeader.slice(7).trim();
    if (!rawToken) {
      res.status(401).json({ error: "Empty token" });
      return null;
    }

    const token = await tokenService.validateToken(rawToken);
    if (!token) {
      res.status(401).json({ error: "Invalid, expired, or revoked token" });
      return null;
    }

    return token;
  }

  // ─── POST /api/v1/agent/report ───
  router.post("/report", async (req: Request, res: Response) => {
    try {
      const token = await authenticateAgent(req, res);
      if (!token) return;

      // Rate limit
      if (!checkRateLimit(token.id)) {
        res.status(429).json({ error: "Rate limit exceeded. Max 60 reports per hour per token." });
        return;
      }

      const body = req.body;

      // Basic validation
      if (!body.hostname || typeof body.hostname !== "string") {
        res.status(400).json({ error: "hostname is required and must be a string" });
        return;
      }

      // Hostname constraints
      if (token.scope === "single") {
        if (token.lockedHostname && token.lockedHostname !== body.hostname) {
          res.status(403).json({ error: `Token locked to hostname: ${token.lockedHostname}` });
          return;
        }
        // Lock hostname on first report
        if (!token.lockedHostname) {
          await tokenService.lockHostname(token.id, body.hostname);
        }
      } else if (token.scope === "fleet") {
        if (token.allowedHostnames.length > 0 && !token.allowedHostnames.includes(body.hostname)) {
          res.status(403).json({ error: `Hostname "${body.hostname}" not in allowed list for this fleet token` });
          return;
        }
      }

      // Convert agent report to HostInventory format
      const hostInventory: HostInventory = {
        hostname: body.hostname,
        ip: body.ip ?? req.ip ?? "unknown",
        os: body.os ?? "Unknown",
        osVersion: body.osVersion ?? "",
        arch: body.arch ?? "",
        packages: (body.packages ?? []).map((p: Record<string, string>) => ({
          name: p.name,
          installedVersion: p.version ?? p.installedVersion ?? "",
          packageManager: p.manager ?? p.packageManager ?? "unknown",
          ecosystem: p.ecosystem ?? "unknown",
        })),
        services: (body.services ?? []).map((s: Record<string, unknown>) => ({
          name: s.name as string,
          serviceType: (s.type ?? s.serviceType ?? "unknown") as string,
          version: (s.version as string) ?? undefined,
          port: (s.port as number) ?? undefined,
          status: (s.status as string) ?? "unknown",
        })),
        connections: (body.connections ?? []).map((c: Record<string, unknown>) => ({
          localPort: c.localPort as number,
          remoteIp: c.remoteIp as string,
          remotePort: c.remotePort as number,
          processName: (c.processName as string) ?? null,
          protocol: "tcp" as const,
        })),
        metadata: {
          ...(body.metadata ?? {}),
          agentVersion: body.agentVersion,
          reportedAt: body.reportedAt ?? new Date().toISOString(),
        },
      };

      const scanResult: ScanResult = { hosts: [hostInventory] };

      // Get or create virtual scan target for this agent token
      const scanTargetId = await tokenService.getOrCreateScanTarget(token);

      // Process through data ingestion (same pipeline as scanner results)
      const stats = await ingestion.processResults(scanTargetId, scanResult);

      // Update host-specific agent fields
      const clientIp = req.ip ?? req.socket.remoteAddress ?? "unknown";
      const hostResult = await pool.query(
        `UPDATE hosts
         SET reporting_method = 'agent',
             agent_token_id = $1,
             agent_version = $2,
             last_report_ip = $3
         WHERE hostname = $4 AND scan_target_id = $5
         RETURNING id`,
        [token.id, body.agentVersion ?? null, clientIp, body.hostname, scanTargetId],
      );

      // Apply environment tag from token
      if (token.environmentTag && hostResult.rows.length > 0) {
        await pool.query(
          `UPDATE hosts SET environment_tag = $1 WHERE id = $2`,
          [token.environmentTag, hostResult.rows[0].id],
        );
      }

      // Auto-assign to groups from token config
      if (token.hostGroupIds.length > 0 && hostResult.rows.length > 0) {
        const hostId = hostResult.rows[0].id;
        for (const groupId of token.hostGroupIds) {
          await pool.query(
            `INSERT INTO host_group_members (host_group_id, host_id, assigned_by)
             VALUES ($1, $2, 'rule')
             ON CONFLICT (host_group_id, host_id) DO NOTHING`,
            [groupId, hostId],
          ).catch(() => {}); // ignore invalid group IDs
        }
      }

      // Record token usage
      await tokenService.recordUsage(token.id, clientIp);

      logger.info(
        { tokenId: token.id, hostname: body.hostname, packages: stats.packagesFound, services: stats.servicesFound },
        `Agent report processed for "${body.hostname}"`,
      );

      // Check for agent update
      const latestVersion = settingsService?.get<string>("agent_latest_version") ?? "1.0.0";
      const autoUpdateEnabled = settingsService?.get<boolean>("agent_auto_update_enabled") ?? true;
      const reportedVersion = body.agentVersion ?? "0.0.0";
      const updateAvailable = latestVersion !== reportedVersion && latestVersion > reportedVersion;

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const isWindows = (body.os ?? "").toLowerCase().includes("windows");
      const updateUrl = updateAvailable
        ? `${baseUrl}/api/v1/agent/script/${isWindows ? "windows" : "linux"}`
        : undefined;

      res.json({
        received: true,
        hostname: body.hostname,
        packagesCount: stats.packagesFound,
        servicesCount: stats.servicesFound,
        nextReportIn: "5m",
        updateAvailable: updateAvailable && autoUpdateEnabled,
        latestAgentVersion: latestVersion,
        updateUrl,
      });
    } catch (err) {
      logger.error({ err }, "Failed to process agent report");
      res.status(500).json({ error: "Failed to process agent report" });
    }
  });

  // ─── POST /api/v1/agent/heartbeat ───
  router.post("/heartbeat", async (req: Request, res: Response) => {
    try {
      const token = await authenticateAgent(req, res);
      if (!token) return;

      const { hostname, agentVersion } = req.body;

      if (!hostname || typeof hostname !== "string") {
        res.status(400).json({ error: "hostname is required" });
        return;
      }

      // Hostname constraints (same as report)
      if (token.scope === "single" && token.lockedHostname && token.lockedHostname !== hostname) {
        res.status(403).json({ error: `Token locked to hostname: ${token.lockedHostname}` });
        return;
      }
      if (token.scope === "fleet" && token.allowedHostnames.length > 0 && !token.allowedHostnames.includes(hostname)) {
        res.status(403).json({ error: `Hostname "${hostname}" not in allowed list for this fleet token` });
        return;
      }

      // Find the scan target for this token
      const targetResult = await pool.query(
        `SELECT id FROM scan_targets WHERE type = 'agent' AND name = $1`,
        [`agent:${token.id}`],
      );

      if (targetResult.rows.length === 0) {
        // No reports yet, nothing to heartbeat
        res.json({ received: true, hostname, message: "No previous report found — send a full report first" });
        return;
      }

      const scanTargetId = targetResult.rows[0].id;
      const clientIp = req.ip ?? req.socket.remoteAddress ?? "unknown";

      // Update host last_seen_at and agent fields
      await pool.query(
        `UPDATE hosts
         SET last_seen_at = NOW(),
             status = 'active',
             agent_version = COALESCE($1, agent_version),
             last_report_ip = $2
         WHERE hostname = $3 AND scan_target_id = $4`,
        [agentVersion ?? null, clientIp, hostname, scanTargetId],
      );

      // Update token usage (don't increment report_count for heartbeats)
      await pool.query(
        `UPDATE agent_tokens SET last_used_at = NOW(), last_used_ip = $1 WHERE id = $2`,
        [clientIp, token.id],
      );

      res.json({ received: true, hostname });
    } catch (err) {
      logger.error({ err }, "Failed to process agent heartbeat");
      res.status(500).json({ error: "Failed to process heartbeat" });
    }
  });

  // ─── Static agent script downloads (public, no auth) ───

  const agentDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../agents");

  function serveScript(res: Response, filePath: string, filename: string) {
    try {
      const content = readFileSync(filePath, "utf-8");
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
      res.send(content);
    } catch {
      res.status(404).json({ error: `Script not found: ${filename}` });
    }
  }

  router.get("/install/linux", (_req, res) => {
    serveScript(res, resolve(agentDir, "linux/install.sh"), "install.sh");
  });

  router.get("/install/windows", (_req, res) => {
    serveScript(res, resolve(agentDir, "windows/Install-InfraWatchAgent.ps1"), "Install-InfraWatchAgent.ps1");
  });

  router.get("/script/linux", (_req, res) => {
    serveScript(res, resolve(agentDir, "linux/infrawatch-agent.sh"), "infrawatch-agent.sh");
  });

  router.get("/script/windows", (_req, res) => {
    serveScript(res, resolve(agentDir, "windows/infrawatch-agent.ps1"), "infrawatch-agent.ps1");
  });

  return router;
}
