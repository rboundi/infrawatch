import express from "express";
import pg from "pg";
import pino from "pino";
import { pinoHttp } from "pino-http";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { readFileSync } from "fs";
import { config } from "./config.js";
import { runMigrations } from "./migrate.js";
import { createScanTargetRoutes } from "./routes/scan-targets.js";
import { createHostRoutes } from "./routes/hosts.js";
import { createAlertRoutes, createStatsRoutes } from "./routes/alerts.js";
import { createDiscoveryRoutes } from "./routes/discovery.js";
import { createChangeRoutes } from "./routes/changes.js";
import { createEolRoutes } from "./routes/eol.js";
import { createErrorHandler } from "./middleware/error-handler.js";
import { apiKeyAuth } from "./middleware/api-key.js";
import { ScanOrchestrator } from "./services/scan-orchestrator.js";
import { StaleHostChecker } from "./services/stale-host-checker.js";
import { VersionChecker } from "./services/version-checker.js";
import { EmailNotifier } from "./services/email-notifier.js";
import { ChangeDetector } from "./services/change-detector.js";
import { EolChecker } from "./services/eol-checker.js";

const logger = pino({ level: config.nodeEnv === "test" ? "silent" : "info" });
const startedAt = Date.now();

// ─── Database pool ───
const pool = new pg.Pool(config.db);

pool.on("error", (err) => {
  logger.error({ err }, "Unexpected database pool error");
});

// ─── Express app ───
const app = express();

// Security headers
app.use(helmet());

// CORS
app.use(
  cors({
    origin: config.corsOrigin,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "X-API-Key"],
    maxAge: 86400,
  })
);

// Request body limits
app.use(express.json({ limit: "1mb" }));

// Request logging
app.use(pinoHttp({ logger }));

// ─── Rate limiters ───
const globalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 100,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

const scanLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many scan requests, please try again later" },
});

const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many auth attempts, please try again later" },
});

app.use("/api/", globalLimiter);

// ─── Health check (unauthenticated) ───
let pkgVersion = "0.1.0";
try {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));
  pkgVersion = pkg.version;
} catch {
  // fallback to hardcoded version
}

app.get("/api/v1/health", async (_req, res) => {
  let dbStatus = "ok";
  try {
    await pool.query("SELECT 1");
  } catch {
    dbStatus = "unreachable";
  }

  // Active scans count
  let activeScans = 0;
  let lastScanTime: string | null = null;
  try {
    const scanResult = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE last_scan_status = 'running') AS active_scans,
         MAX(last_scanned_at) AS last_scan_time
       FROM scan_targets`
    );
    activeScans = parseInt(scanResult.rows[0].active_scans, 10);
    lastScanTime = scanResult.rows[0].last_scan_time;
  } catch {
    // pool might be down, activeScans stays 0
  }

  const mem = process.memoryUsage();

  res.json({
    status: dbStatus === "ok" ? "healthy" : "degraded",
    db: dbStatus,
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    memory: {
      rss: Math.round(mem.rss / 1024 / 1024),
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
    },
    activeScans,
    lastScanTime,
    timestamp: new Date().toISOString(),
    version: pkgVersion,
  });
});

// ─── API key auth (all /api/v1 routes below) ───
app.use("/api/v1", apiKeyAuth);

// ─── Scan trigger rate limit ───
app.use("/api/v1/targets/:id/scan", scanLimiter);
app.use("/api/v1/targets/:id/test", scanLimiter);

// Auth limiter placeholder for future auth routes
app.use("/api/v1/auth", authLimiter);

// ─── Routes ───
app.use("/api/v1/targets", createScanTargetRoutes(pool, logger));
app.use("/api/v1/hosts", createHostRoutes(pool, logger));
app.use("/api/v1/alerts", createAlertRoutes(pool, logger));
app.use("/api/v1/stats", createStatsRoutes(pool, logger));
app.use("/api/v1/discovery", createDiscoveryRoutes(pool, logger));
app.use("/api/v1/changes", createChangeRoutes(pool, logger));
app.use("/api/v1/eol", createEolRoutes(pool, logger));

// ─── Error handler (must be last) ───
app.use(createErrorHandler(logger));

// ─── Background services ───
const orchestrator = new ScanOrchestrator(pool, logger);
const staleChecker = new StaleHostChecker(pool, logger);
const versionChecker = new VersionChecker(pool, logger);
const emailNotifier = new EmailNotifier(pool, logger);
const changeDetector = new ChangeDetector(pool, logger);
const eolChecker = new EolChecker(pool, logger);

async function start() {
  try {
    await runMigrations(logger);
  } catch (err) {
    logger.fatal({ err }, "Failed to run migrations, shutting down");
    process.exit(1);
  }

  const server = app.listen(config.port, () => {
    logger.info(`Server listening on port ${config.port}`);
  });

  // Start background services
  orchestrator.start();
  staleChecker.start();
  versionChecker.start();
  emailNotifier.start();

  // Seed EOL definitions and start checker
  await eolChecker.seedDefinitions();
  eolChecker.start();

  // Daily snapshot scheduler — take a snapshot on startup and then every 24h
  changeDetector.takeSnapshot();
  const snapshotTimer = setInterval(() => changeDetector.takeSnapshot(), 24 * 60 * 60 * 1000);

  // ─── Graceful shutdown ───
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, "Shutdown signal received, starting graceful shutdown...");

    // 1. Stop accepting new connections
    server.close(() => {
      logger.info("HTTP server closed");
    });

    // 2. Stop background services
    logger.info("Stopping scan orchestrator (waiting for current scan up to 30s)...");
    await orchestrator.stop();
    logger.info("Scan orchestrator stopped");

    logger.info("Stopping background services...");
    staleChecker.stop();
    versionChecker.stop();
    emailNotifier.stop();
    eolChecker.stop();
    clearInterval(snapshotTimer);
    logger.info("Background services stopped");

    // 3. Close database pool
    await pool.end();
    logger.info("Database pool closed");

    logger.info("Graceful shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

// ─── Unhandled rejection / uncaught exception ───
process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "Unhandled promise rejection, exiting");
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception, exiting");
  process.exit(1);
});

start();

export { app, pool };
