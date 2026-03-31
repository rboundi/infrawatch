import { Router, type Request, type Response } from "express";
import { validationResult } from "express-validator";
import type pg from "pg";
import type { Logger } from "pino";
import { createScanner } from "@infrawatch/scanner";
import { validateScanTarget } from "../utils/validation.js";
import { encrypt, decrypt } from "../utils/crypto.js";
import { config } from "../config.js";
import { DataIngestionService } from "../services/data-ingestion.js";
import type { AuditLogger } from "../services/audit-logger.js";
import type { ScanLogger } from "../services/scan-logger.js";

// Track running scans so they can be cancelled
const runningScans = new Map<string, AbortController>();

const TYPE_LABELS: Record<string, string> = {
  ssh_linux: "SSH (Linux)",
  winrm: "WinRM",
  kubernetes: "Kubernetes",
  aws: "AWS",
  vmware: "VMware",
  docker: "Docker",
  network_discovery: "Network Discovery",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateIdParam(req: Request, res: Response): boolean {
  if (!UUID_RE.test(req.params.id as string)) {
    res.status(400).json({ error: "Invalid target ID format" });
    return false;
  }
  return true;
}

export function createScanTargetRoutes(pool: pg.Pool, logger: Logger, audit?: AuditLogger, scanLogger?: ScanLogger): Router {
  const router = Router();

  // ─── POST /api/v1/targets ───
  router.post("/", ...validateScanTarget, async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ error: "Validation failed", details: errors.array() });
      return;
    }

    const { name, type, connectionConfig, scanIntervalHours, enabled } = req.body;

    if (!config.masterKey) {
      res.status(500).json({ error: "MASTER_KEY not configured on server" });
      return;
    }

    const encryptedConfig = encrypt(connectionConfig, config.masterKey);

    try {
      const result = await pool.query(
        `INSERT INTO scan_targets (name, type, connection_config, scan_interval_hours, enabled)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, type, scan_interval_hours, last_scanned_at, last_scan_status, enabled, created_at, updated_at`,
        [
          name,
          type,
          JSON.stringify(encryptedConfig),
          scanIntervalHours ?? 6,
          enabled ?? true,
        ]
      );

      logger.info({ targetId: result.rows[0].id, name, type }, "Scan target created");
      audit?.log({ userId: req.user?.id, username: req.user?.username ?? "system", action: "scan_target.created", entityType: "scan_target", entityId: result.rows[0].id, details: { name, type }, ipAddress: req.ip ?? null });
      res.status(201).json(formatTarget(result.rows[0]));
    } catch (err) {
      logger.error({ err }, "Failed to create scan target");
      res.status(500).json({ error: "Failed to create scan target" });
    }
  });

  // ─── GET /api/v1/targets ───
  router.get("/", async (_req: Request, res: Response) => {
    try {
      const result = await pool.query(
        `SELECT id, name, type, scan_interval_hours, last_scanned_at, last_scan_status, enabled, created_at, updated_at
         FROM scan_targets
         ORDER BY created_at DESC`
      );
      res.json(result.rows.map(formatTarget));
    } catch (err) {
      logger.error({ err }, "Failed to list scan targets");
      res.status(500).json({ error: "Failed to list scan targets" });
    }
  });

  // ─── GET /api/v1/targets/:id ───
  router.get("/:id", async (req: Request, res: Response) => {
    if (!validateIdParam(req, res)) return;
    const id = req.params.id as string;
    try {
      const result = await pool.query(
        `SELECT id, name, type, connection_config, scan_interval_hours, last_scanned_at, last_scan_status, last_scan_error, enabled, created_at, updated_at
         FROM scan_targets
         WHERE id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: "Scan target not found" });
        return;
      }

      const row = result.rows[0];
      const target = formatTarget(row);

      // Decrypt and include connectionConfig for single-target detail view
      if (row.connection_config && config.masterKey) {
        try {
          const decrypted = decrypt(
            row.connection_config as string,
            config.masterKey,
          ) as Record<string, unknown>;
          // Redact sensitive fields
          const redacted = { ...decrypted };
          if (redacted.password) redacted.password = "••••••••";
          if (redacted.privateKey) redacted.privateKey = "••••••••";
          if (redacted.secretAccessKey) redacted.secretAccessKey = "••••••••";
          if (redacted.token) redacted.token = "••••••••";
          (target as Record<string, unknown>).connectionConfig = redacted;
        } catch {
          logger.warn({ targetId: id }, "Failed to decrypt connection config");
        }
      }

      res.json(target);
    } catch (err) {
      logger.error({ err }, "Failed to get scan target");
      res.status(500).json({ error: "Failed to get scan target" });
    }
  });

  // ─── PATCH /api/v1/targets/:id ───
  router.patch("/:id", async (req: Request, res: Response) => {
    if (!validateIdParam(req, res)) return;
    const id = req.params.id as string;
    const { name, type, connectionConfig, scanIntervalHours, enabled } = req.body;

    // Build dynamic SET clause
    const sets: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (name !== undefined) {
      sets.push(`name = $${paramIdx++}`);
      values.push(name);
    }
    if (type !== undefined) {
      sets.push(`type = $${paramIdx++}`);
      values.push(type);
    }
    if (connectionConfig !== undefined) {
      if (!config.masterKey) {
        res.status(500).json({ error: "MASTER_KEY not configured on server" });
        return;
      }

      // Merge with existing config to preserve fields not sent (e.g. passwords)
      let mergedConfig = connectionConfig;
      try {
        const existing = await pool.query(
          `SELECT connection_config FROM scan_targets WHERE id = $1`,
          [id],
        );
        if (existing.rows.length > 0 && existing.rows[0].connection_config) {
          const existingConfig = decrypt(
            existing.rows[0].connection_config as string,
            config.masterKey,
          ) as Record<string, unknown>;
          mergedConfig = { ...existingConfig, ...connectionConfig };
        }
      } catch {
        // If decrypt fails, just use the new config as-is
      }

      const encryptedConfig = encrypt(mergedConfig, config.masterKey);
      sets.push(`connection_config = $${paramIdx++}`);
      values.push(JSON.stringify(encryptedConfig));
    }
    if (scanIntervalHours !== undefined) {
      sets.push(`scan_interval_hours = $${paramIdx++}`);
      values.push(scanIntervalHours);
    }
    if (enabled !== undefined) {
      sets.push(`enabled = $${paramIdx++}`);
      values.push(enabled);
    }

    if (sets.length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    sets.push(`updated_at = NOW()`);
    values.push(id);

    try {
      const result = await pool.query(
        `UPDATE scan_targets SET ${sets.join(", ")} WHERE id = $${paramIdx}
         RETURNING id, name, type, scan_interval_hours, last_scanned_at, last_scan_status, enabled, created_at, updated_at`,
        values
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: "Scan target not found" });
        return;
      }

      logger.info({ targetId: id }, "Scan target updated");
      audit?.log({ userId: req.user?.id, username: req.user?.username ?? "system", action: "scan_target.updated", entityType: "scan_target", entityId: id, details: { fields: Object.keys(req.body).filter(k => req.body[k] !== undefined) }, ipAddress: req.ip ?? null });
      res.json(formatTarget(result.rows[0]));
    } catch (err) {
      logger.error({ err }, "Failed to update scan target");
      res.status(500).json({ error: "Failed to update scan target" });
    }
  });

  // ─── DELETE /api/v1/targets/:id ───
  // Hard delete: removes the target and cascades to scan_logs.
  // Hosts are preserved (FK ON DELETE SET NULL) so historical data isn't lost.
  router.delete("/:id", async (req: Request, res: Response) => {
    if (!validateIdParam(req, res)) return;
    const id = req.params.id as string;
    try {
      const result = await pool.query(
        `DELETE FROM scan_targets WHERE id = $1 RETURNING id`,
        [id]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: "Scan target not found" });
        return;
      }

      logger.info({ targetId: id }, "Scan target deleted");
      audit?.log({ userId: req.user?.id, username: req.user?.username ?? "system", action: "scan_target.deleted", entityType: "scan_target", entityId: id, ipAddress: req.ip ?? null });
      res.status(204).send();
    } catch (err) {
      logger.error({ err }, "Failed to delete scan target");
      res.status(500).json({ error: "Failed to delete scan target" });
    }
  });

  // ─── GET /api/v1/targets/:id/test/stream ───
  // SSE endpoint that streams real-time progress during connection testing
  router.get("/:id/test/stream", async (req: Request, res: Response) => {
    if (!validateIdParam(req, res)) return;
    const id = req.params.id as string;

    let headersSent = false;

    try {
      const target = await getTargetWithConfig(pool, id);
      if (!target) {
        res.status(404).json({ error: "Scan target not found" });
        return;
      }

      // Set SSE headers
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();
      headersSent = true;

      let aborted = false;
      req.on("close", () => { aborted = true; });

      const send = (event: string, data: Record<string, unknown>) => {
        if (!aborted) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const start = performance.now();

      if (target.type === "network_discovery") {
        await testNetworkDiscoveryStreamed(target.connectionConfig, send, () => aborted);
      } else {
        send("step", { message: `Decrypting credentials for ${TYPE_LABELS[target.type] ?? target.type} target...`, level: "info" });
        send("step", { message: `Creating ${target.type} scanner...`, level: "info" });

        const scanner = createScanner(target.type);
        send("step", { message: `Connecting to "${target.name}"...`, level: "info" });

        try {
          await scanner.scan({
            type: target.type,
            connectionConfig: target.connectionConfig,
          });
          const latencyMs = Math.round(performance.now() - start);
          send("step", { message: "Connection successful", level: "info" });
          audit?.log({ userId: req.user?.id, username: req.user?.username ?? "system", action: "scan.test_connection", entityType: "scan_target", entityId: id, details: { success: true, latencyMs }, ipAddress: req.ip ?? null });
          send("result", { success: true, message: `Successfully connected to ${target.type} target`, latencyMs });
        } catch (scanErr) {
          const latencyMs = Math.round(performance.now() - start);
          const message = scanErr instanceof Error ? scanErr.message : "Connection failed";
          send("step", { message: `Error: ${message}`, level: "error" });
          send("result", { success: false, message, latencyMs });
        }
      }

      send("done", {});
      res.end();
    } catch (err) {
      logger.error({ err }, "Failed to test scan target");
      if (!headersSent) {
        res.status(500).json({ error: "Failed to test scan target" });
      } else {
        res.end();
      }
    }
  });

  // ─── POST /api/v1/targets/:id/scan ───
  router.post("/:id/scan", async (req: Request, res: Response) => {
    if (!validateIdParam(req, res)) return;
    const id = req.params.id as string;
    try {
      const target = await getTargetWithConfig(pool, id);
      if (!target) {
        res.status(404).json({ error: "Scan target not found" });
        return;
      }

      // Create scan log entry
      const logResult = await pool.query(
        `INSERT INTO scan_logs (scan_target_id, status)
         VALUES ($1, 'running')
         RETURNING id`,
        [id]
      );
      const scanLogId = logResult.rows[0].id;

      // Mark target as running
      await pool.query(
        `UPDATE scan_targets SET last_scan_status = 'running', updated_at = NOW() WHERE id = $1`,
        [id]
      );

      // Run scan asynchronously — don't await
      const abortController = new AbortController();
      runningScans.set(id, abortController);
      runScanAsync(pool, logger, target, scanLogId, scanLogger, abortController.signal)
        .catch((err) => {
          logger.error({ err, scanLogId }, "Async scan failed unexpectedly");
        })
        .finally(() => {
          runningScans.delete(id);
        });

      audit?.log({ userId: req.user?.id, username: req.user?.username ?? "system", action: "scan.triggered", entityType: "scan_target", entityId: id, details: { scanLogId }, ipAddress: req.ip ?? null });
      res.status(202).json({ message: "Scan started", scanLogId });
    } catch (err) {
      logger.error({ err }, "Failed to trigger scan");
      res.status(500).json({ error: "Failed to trigger scan" });
    }
  });

  // ─── POST /api/v1/targets/:id/cancel ───
  router.post("/:id/cancel", async (req: Request, res: Response) => {
    if (!validateIdParam(req, res)) return;
    const id = req.params.id as string;
    const controller = runningScans.get(id);

    if (!controller) {
      res.status(404).json({ error: "No running scan found for this target" });
      return;
    }

    controller.abort();
    logger.info({ targetId: id }, "Scan cancellation requested");
    audit?.log({ userId: req.user?.id, username: req.user?.username ?? "system", action: "scan.cancelled", entityType: "scan_target", entityId: id, ipAddress: req.ip ?? null });
    res.json({ message: "Scan cancellation requested" });
  });

  return router;
}

// ─── Helpers ───

interface TargetWithConfig {
  id: string;
  name: string;
  type: string;
  connectionConfig: Record<string, unknown>;
}

async function getTargetWithConfig(
  pool: pg.Pool,
  targetId: string
): Promise<TargetWithConfig | null> {
  const result = await pool.query(
    `SELECT id, name, type, connection_config FROM scan_targets WHERE id = $1`,
    [targetId]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];

  if (!config.masterKey) {
    throw new Error("MASTER_KEY not configured");
  }

  // JSONB column auto-parsed by pg driver — already the encrypted base64 string
  const connectionConfig = decrypt(
    row.connection_config as string,
    config.masterKey
  ) as Record<string, unknown>;

  return {
    id: row.id,
    name: row.name,
    type: row.type,
    connectionConfig,
  };
}

async function runScanAsync(
  pool: pg.Pool,
  logger: Logger,
  target: TargetWithConfig,
  scanLogId: string,
  sl?: ScanLogger,
  signal?: AbortSignal,
): Promise<void> {
  const startTime = Date.now();
  const ingestion = new DataIngestionService(pool, logger);

  try {
    await sl?.log(scanLogId, "info", `Starting scan for "${target.name}" (${target.type})`);
    await sl?.log(scanLogId, "info", "Connecting to target...");

    const scanner = createScanner(target.type);

    await sl?.log(scanLogId, "info", "Scanning target — discovering hosts, packages, and services...");
    const result = await scanner.scan({
      type: target.type,
      connectionConfig: target.connectionConfig,
      onProgress: sl ? (msg) => { sl.log(scanLogId, "info", msg).catch(() => {}); } : undefined,
      signal,
    });

    const hostCount = result.hosts?.length ?? 0;
    const pkgCount = result.hosts?.reduce((sum, h) => sum + (h.packages?.length ?? 0), 0) ?? 0;
    await sl?.log(scanLogId, "info", `Scan returned ${hostCount} host(s) with ${pkgCount} package(s)`);

    await sl?.log(scanLogId, "info", "Processing and ingesting scan results...");
    const { hostsUpserted, packagesFound } =
      await ingestion.processResults(target.id, result);

    // Populate network_discovery_results for network_discovery scans
    if (target.type === "network_discovery" && result.hosts.length > 0) {
      await populateDiscoveryResults(pool, target.id, scanLogId, result.hosts, logger);
    }

    // Update scan log as success
    await pool.query(
      `UPDATE scan_logs SET status = 'success', completed_at = NOW(), hosts_discovered = $1, packages_discovered = $2
       WHERE id = $3`,
      [hostsUpserted, packagesFound, scanLogId]
    );

    // Update target status
    await pool.query(
      `UPDATE scan_targets SET last_scan_status = 'success', last_scanned_at = NOW(), last_scan_error = NULL, updated_at = NOW()
       WHERE id = $1`,
      [target.id]
    );

    const durationMs = Date.now() - startTime;
    await sl?.log(scanLogId, "success", `Scan completed — ${hostsUpserted} host(s), ${packagesFound} package(s) in ${(durationMs / 1000).toFixed(1)}s`);
    sl?.complete(scanLogId, "success");

    logger.info(
      { targetId: target.id, scanLogId, hosts: hostsUpserted, packages: packagesFound, durationMs },
      "Scan completed successfully"
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const isCancelled = errorMessage === "Scan cancelled";
    const status = isCancelled ? "cancelled" : "failed";

    await sl?.log(scanLogId, isCancelled ? "warn" : "error", isCancelled ? "Scan was cancelled by user" : `Scan failed: ${errorMessage}`);
    sl?.complete(scanLogId, status);

    await pool.query(
      `UPDATE scan_logs SET status = $1, completed_at = NOW(), error_message = $2 WHERE id = $3`,
      [status, isCancelled ? null : errorMessage, scanLogId]
    ).catch(() => {});

    await pool.query(
      `UPDATE scan_targets SET last_scan_status = $1, last_scanned_at = NOW(), last_scan_error = $2, updated_at = NOW()
       WHERE id = $3`,
      [status, isCancelled ? null : errorMessage, target.id]
    ).catch(() => {});

    logger.info(
      { targetId: target.id, scanLogId, durationMs: Date.now() - startTime, cancelled: isCancelled },
      isCancelled ? "Scan cancelled" : "Scan failed"
    );
  }
}

type SendFn = (event: string, data: Record<string, unknown>) => void;

/**
 * Streamed test for network discovery: validates config, checks nmap,
 * and runs a fast ping scan, emitting SSE progress events along the way.
 */
async function testNetworkDiscoveryStreamed(
  connectionConfig: Record<string, unknown>,
  send: SendFn,
  isAborted: () => boolean,
): Promise<void> {
  const { spawn } = await import("node:child_process");
  const start = performance.now();

  // Step 1: Validate config
  send("step", { message: "Validating network discovery configuration...", level: "info" });
  const subnets = connectionConfig.subnets as string[] | undefined;
  if (!subnets || subnets.length === 0) {
    send("step", { message: "No subnets configured", level: "error" });
    send("result", { success: false, message: "No subnets configured", latencyMs: Math.round(performance.now() - start) });
    return;
  }
  send("step", { message: `Found ${subnets.length} subnet(s): ${subnets.join(", ")}`, level: "info" });

  if (isAborted()) return;

  // Step 2: Check nmap availability
  send("step", { message: "Checking nmap availability...", level: "info" });
  let nmapVersion: string;
  try {
    nmapVersion = await new Promise<string>((resolve, reject) => {
      const proc = spawn("nmap", ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      proc.stdout?.on("data", (c: Buffer) => { out += c.toString(); });
      proc.on("close", (code) => code === 0 ? resolve(out.split("\n")[0] ?? "nmap") : reject(new Error("nmap not found or not executable")));
      proc.on("error", () => reject(new Error("nmap is not installed")));
      setTimeout(() => { proc.kill(); reject(new Error("nmap version check timed out")); }, 5000);
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "nmap check failed";
    send("step", { message, level: "error" });
    send("result", { success: false, message, latencyMs: Math.round(performance.now() - start) });
    return;
  }

  const version = nmapVersion.match(/Nmap version ([\d.]+)/)?.[1] ?? "unknown";
  send("step", { message: `nmap ${version} found`, level: "info" });

  if (isAborted()) return;

  // Step 3: Ping scan on first subnet
  send("step", { message: `Running ping scan on ${subnets[0]}...`, level: "info" });
  try {
    const hostsUp = await new Promise<number>((resolve, reject) => {
      const proc = spawn("nmap", ["-sn", "-T4", "--max-retries", "1", subnets[0]], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      proc.stdout?.on("data", (c: Buffer) => { stdout += c.toString(); });
      proc.on("close", (code) => {
        if (code !== 0) { reject(new Error("Ping scan failed")); return; }
        const match = stdout.match(/(\d+)\s+hosts?\s+up/);
        resolve(match ? parseInt(match[1], 10) : 0);
      });
      proc.on("error", (err) => reject(new Error(`Failed to run nmap: ${err.message}`)));
      setTimeout(() => { proc.kill(); reject(new Error("Ping scan timed out (30s)")); }, 30000);
    });

    const latencyMs = Math.round(performance.now() - start);
    const resultMsg = `nmap ${version} — ping scan found ${hostsUp} host(s) up on ${subnets[0]}${subnets.length > 1 ? ` (+${subnets.length - 1} more subnet(s))` : ""}`;
    send("step", { message: `Found ${hostsUp} host(s) up`, level: "info" });
    send("result", { success: true, message: resultMsg, latencyMs });
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);
    const message = err instanceof Error ? err.message : "Ping scan failed";
    send("step", { message: `Error: ${message}`, level: "error" });
    send("result", { success: false, message, latencyMs });
  }
}

/**
 * Populate network_discovery_results from scan output so the Discovery page can display them.
 * Upserts by (scan_target_id, ip_address) so re-scans update existing rows rather than duplicating.
 */
async function populateDiscoveryResults(
  pool: pg.Pool,
  scanTargetId: string,
  scanLogId: string,
  hosts: import("@infrawatch/scanner").HostInventory[],
  logger: Logger,
): Promise<void> {
  try {
    for (const host of hosts) {
      const meta = (host.metadata ?? {}) as Record<string, unknown>;
      const osMatches = meta.osMatches as { name: string; accuracy: number }[] | undefined;
      const bestOs = osMatches?.[0];
      const openPorts = host.services
        .filter((s) => s.port)
        .map((s) => ({
          port: s.port,
          protocol: "tcp",
          service: s.name,
          product: s.version ? `${s.name} ${s.version}` : s.name,
        }));

      await pool.query(
        `INSERT INTO network_discovery_results
           (scan_target_id, scan_log_id, ip_address, hostname, mac_address,
            os_match, os_accuracy, open_ports, detected_platform)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
         ON CONFLICT ON CONSTRAINT network_discovery_results_target_ip
         DO UPDATE SET
           scan_log_id = EXCLUDED.scan_log_id,
           hostname = COALESCE(EXCLUDED.hostname, network_discovery_results.hostname),
           mac_address = COALESCE(EXCLUDED.mac_address, network_discovery_results.mac_address),
           os_match = COALESCE(EXCLUDED.os_match, network_discovery_results.os_match),
           os_accuracy = COALESCE(EXCLUDED.os_accuracy, network_discovery_results.os_accuracy),
           open_ports = EXCLUDED.open_ports,
           detected_platform = COALESCE(EXCLUDED.detected_platform, network_discovery_results.detected_platform),
           created_at = NOW()`,
        [
          scanTargetId,
          scanLogId,
          host.ip,
          host.hostname !== host.ip ? host.hostname : null,
          (meta.mac as string) ?? null,
          bestOs?.name ?? host.os !== "Unknown" ? host.os : null,
          bestOs?.accuracy ?? null,
          JSON.stringify(openPorts),
          (meta.platform as string) ?? null,
        ],
      );
    }
    logger.info({ scanTargetId, count: hosts.length }, "Populated discovery results");
  } catch (err) {
    logger.error({ err, scanTargetId }, "Failed to populate discovery results");
  }
}

function formatTarget(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    scanIntervalHours: row.scan_interval_hours,
    lastScannedAt: row.last_scanned_at,
    lastScanStatus: row.last_scan_status,
    lastScanError: row.last_scan_error ?? undefined,
    enabled: row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
