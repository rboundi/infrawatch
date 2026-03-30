import { Router, type Request, type Response } from "express";
import type pg from "pg";
import type { Logger } from "pino";
import type { ScanLogger, ScanLogEntry } from "../services/scan-logger.js";

export function createScanLogRoutes(
  pool: pg.Pool,
  logger: Logger,
  scanLogger: ScanLogger,
): Router {
  const router = Router({ mergeParams: true });

  // ─── GET /api/v1/targets/:targetId/scan-logs ───
  router.get("/", async (req: Request, res: Response) => {
    const targetId = req.params.targetId as string;
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const offset = (page - 1) * limit;

    try {
      const [logsResult, countResult] = await Promise.all([
        pool.query(
          `SELECT id, scan_target_id, started_at, completed_at, status,
                  hosts_discovered, packages_discovered, error_message
           FROM scan_logs
           WHERE scan_target_id = $1
           ORDER BY started_at DESC
           LIMIT $2 OFFSET $3`,
          [targetId, limit, offset],
        ),
        pool.query(
          `SELECT COUNT(*) AS count FROM scan_logs WHERE scan_target_id = $1`,
          [targetId],
        ),
      ]);

      const total = parseInt(countResult.rows[0].count, 10);

      res.json({
        data: logsResult.rows.map(formatScanLog),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      });
    } catch (err) {
      logger.error({ err }, "Failed to list scan logs");
      res.status(500).json({ error: "Failed to list scan logs" });
    }
  });

  // ─── GET /api/v1/targets/:targetId/scan-logs/latest/stream ───
  // SSE stream for the most recent running scan log of a target
  router.get("/latest/stream", async (req: Request, res: Response) => {
    const targetId = req.params.targetId as string;

    try {
      // Find the most recent scan log (preferring running ones)
      const result = await pool.query(
        `SELECT id, status FROM scan_logs
         WHERE scan_target_id = $1
         ORDER BY
           CASE WHEN status = 'running' THEN 0 ELSE 1 END,
           started_at DESC
         LIMIT 1`,
        [targetId],
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: "No scan logs found" });
        return;
      }

      const logId = result.rows[0].id;
      const status = result.rows[0].status;

      streamScanLog(res, req, scanLogger, logId, status);
    } catch (err) {
      logger.error({ err }, "Failed to stream latest scan log");
      res.status(500).json({ error: "Failed to stream scan log" });
    }
  });

  // ─── GET /api/v1/targets/:targetId/scan-logs/:logId ───
  router.get("/:logId", async (req: Request, res: Response) => {
    const targetId = req.params.targetId as string;
    const logId = req.params.logId as string;

    try {
      const logResult = await pool.query(
        `SELECT id, scan_target_id, started_at, completed_at, status,
                hosts_discovered, packages_discovered, error_message
         FROM scan_logs
         WHERE id = $1 AND scan_target_id = $2`,
        [logId, targetId],
      );

      if (logResult.rows.length === 0) {
        res.status(404).json({ error: "Scan log not found" });
        return;
      }

      const entries = await scanLogger.getEntries(logId);
      const log = formatScanLog(logResult.rows[0]);

      res.json({ ...log, entries });
    } catch (err) {
      logger.error({ err }, "Failed to get scan log detail");
      res.status(500).json({ error: "Failed to get scan log" });
    }
  });

  // ─── GET /api/v1/targets/:targetId/scan-logs/:logId/stream ───
  router.get("/:logId/stream", async (req: Request, res: Response) => {
    const targetId = req.params.targetId as string;
    const logId = req.params.logId as string;

    try {
      const result = await pool.query(
        `SELECT id, status FROM scan_logs
         WHERE id = $1 AND scan_target_id = $2`,
        [logId, targetId],
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: "Scan log not found" });
        return;
      }

      streamScanLog(res, req, scanLogger, logId, result.rows[0].status);
    } catch (err) {
      logger.error({ err }, "Failed to stream scan log");
      res.status(500).json({ error: "Failed to stream scan log" });
    }
  });

  return router;
}

// ─── SSE streaming helper ───

function streamScanLog(
  res: Response,
  req: Request,
  scanLogger: ScanLogger,
  logId: string,
  currentStatus: string,
): void {
  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // nginx passthrough
  res.flushHeaders();

  // Send existing entries as initial burst
  scanLogger
    .getEntries(logId)
    .then((existing) => {
      for (const entry of existing) {
        res.write(`data: ${JSON.stringify(entry)}\n\n`);
      }

      // If already completed, send done event and close
      if (currentStatus !== "running") {
        res.write(
          `event: done\ndata: ${JSON.stringify({ status: currentStatus })}\n\n`,
        );
        res.end();
        return;
      }

      // Subscribe to live events
      const onEntry = (entry: ScanLogEntry) => {
        res.write(`data: ${JSON.stringify(entry)}\n\n`);
      };

      const onDone = (data: { status: string }) => {
        res.write(`event: done\ndata: ${JSON.stringify(data)}\n\n`);
        res.end();
      };

      scanLogger.subscribe(logId, onEntry);
      scanLogger.subscribeCompletion(logId, onDone);

      req.on("close", () => {
        scanLogger.unsubscribe(logId, onEntry);
        scanLogger.unsubscribeCompletion(logId, onDone);
      });
    })
    .catch(() => {
      res.end();
    });
}

// ─── Helpers ───

function formatScanLog(row: Record<string, unknown>) {
  return {
    id: row.id,
    scanTargetId: row.scan_target_id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    status: row.status,
    hostsDiscovered: row.hosts_discovered,
    packagesDiscovered: row.packages_discovered,
    errorMessage: row.error_message,
  };
}
