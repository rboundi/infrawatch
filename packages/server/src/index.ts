import express from "express";
import pg from "pg";
import pino from "pino";
import { pinoHttp } from "pino-http";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
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
import { createUnifiedAlertRoutes } from "./routes/unified-alerts.js";
import { createReportRoutes } from "./routes/reports.js";
import { createNotificationRoutes } from "./routes/notifications.js";
import { createGroupRoutes } from "./routes/groups.js";
import { createDependencyRoutes } from "./routes/dependencies.js";
import { createComplianceRoutes } from "./routes/compliance.js";
import { createAuthRoutes } from "./routes/auth.js";
import { createUserRoutes } from "./routes/users.js";
import { createAuditRoutes } from "./routes/audit.js";
import { createSettingsRoutes } from "./routes/settings.js";
import { AuditLogger } from "./services/audit-logger.js";
import { SettingsService } from "./services/settings-service.js";
import { MaintenanceService } from "./services/maintenance-service.js";
import { GroupAssignmentService } from "./services/group-assignment.js";
import { ImpactAnalyzer } from "./services/impact-analyzer.js";
import { ComplianceScorer } from "./services/compliance-scorer.js";
import { createErrorHandler } from "./middleware/error-handler.js";
import { createRequireAuth } from "./middleware/auth.js";
import { ScanOrchestrator } from "./services/scan-orchestrator.js";
import { StaleHostChecker } from "./services/stale-host-checker.js";
import { VersionChecker } from "./services/version-checker.js";
import { EmailNotifier } from "./services/email-notifier.js";
import { ChangeDetector } from "./services/change-detector.js";
import { EolChecker } from "./services/eol-checker.js";
import { ReportGenerator } from "./services/reports/report-generator.js";
import { NotificationService } from "./services/notifications/notification-service.js";
import { UserService } from "./services/user-service.js";
import { SessionService } from "./services/session-service.js";
import { ScanLogger } from "./services/scan-logger.js";
import { createScanLogRoutes } from "./routes/scan-logs.js";
import { createAgentReportRoutes } from "./routes/agent-report.js";
import { createAgentTokenRoutes } from "./routes/agent-tokens.js";
import { AgentTokenService } from "./services/agent-token-service.js";
import { AgentHealthChecker } from "./services/agent-health-checker.js";

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
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  })
);

// Request body limits
app.use(express.json({ limit: "1mb" }));

// Cookie parsing
app.use(cookieParser());

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

const loginLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many login attempts, please try again later" },
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

// ─── Scan trigger rate limit ───
app.use("/api/v1/targets/:id/scan", scanLimiter);
app.use("/api/v1/targets/:id/test", scanLimiter);
app.use("/api/v1/agent/report", scanLimiter);

// Login rate limiter
app.use("/api/v1/auth/login", loginLimiter);

// ─── Background services (instantiated before routes — reportGenerator/notificationService needed by routes) ───
const orchestrator = new ScanOrchestrator(pool, logger);
const staleChecker = new StaleHostChecker(pool, logger);
const versionChecker = new VersionChecker(pool, logger);
const emailNotifier = new EmailNotifier(pool, logger);
const changeDetector = new ChangeDetector(pool, logger);
const eolChecker = new EolChecker(pool, logger);
const reportGenerator = new ReportGenerator(pool, logger);
const notificationService = new NotificationService(pool, logger);
const groupAssignment = new GroupAssignmentService(pool, logger);
const impactAnalyzer = new ImpactAnalyzer(pool);
const complianceScorer = new ComplianceScorer(pool, logger);
const settingsService = new SettingsService(pool, logger);
const userService = new UserService(pool, logger, settingsService);
const sessionService = new SessionService(pool, logger, settingsService);
const audit = new AuditLogger(pool, logger);
const scanLogger = new ScanLogger(pool, logger);
const agentTokenService = new AgentTokenService(pool, logger);
const agentHealthChecker = new AgentHealthChecker(pool, logger);
const maintenance = new MaintenanceService(pool, logger, settingsService);
const requireAuth = createRequireAuth(sessionService);

// Wire settings into background services
orchestrator.setSettings(settingsService);
staleChecker.setSettings(settingsService);
versionChecker.setSettings(settingsService);
eolChecker.setSettings(settingsService);
notificationService.setSettings(settingsService);
agentHealthChecker.setSettings(settingsService);

// Wire notification service into background services
orchestrator.setNotificationService(notificationService);
orchestrator.setGroupAssignment(groupAssignment);
orchestrator.setComplianceScorer(complianceScorer);
orchestrator.setScanLogger(scanLogger);
staleChecker.setNotificationService(notificationService);
versionChecker.setNotificationService(notificationService);
eolChecker.setNotificationService(notificationService);
agentHealthChecker.setNotificationService(notificationService);

// ─── Routes ───

// Auth routes (login is public, others require auth — handled inside the router)
app.use("/api/v1/auth", createAuthRoutes(pool, logger, userService, sessionService, settingsService));

// All remaining routes require authentication
app.use("/api/v1/targets", requireAuth, createScanTargetRoutes(pool, logger, audit, scanLogger));
app.use("/api/v1/targets/:targetId/scan-logs", requireAuth, createScanLogRoutes(pool, logger, scanLogger));
app.use("/api/v1/hosts", requireAuth, createHostRoutes(pool, logger, audit));
app.use("/api/v1/alerts/unified", requireAuth, createUnifiedAlertRoutes(pool, logger));
app.use("/api/v1/alerts", requireAuth, createAlertRoutes(pool, logger, audit));
app.use("/api/v1/stats", requireAuth, createStatsRoutes(pool, logger));
app.use("/api/v1/discovery", requireAuth, createDiscoveryRoutes(pool, logger, audit));
app.use("/api/v1/changes", requireAuth, createChangeRoutes(pool, logger));
app.use("/api/v1/eol", requireAuth, createEolRoutes(pool, logger, audit));
app.use("/api/v1/reports", requireAuth, createReportRoutes(pool, logger, reportGenerator, audit));
app.use("/api/v1/notifications", requireAuth, createNotificationRoutes(pool, logger, notificationService, audit));
app.use("/api/v1/groups", requireAuth, createGroupRoutes(pool, logger, groupAssignment, audit));
app.use("/api/v1/dependencies", requireAuth, createDependencyRoutes(pool, logger, impactAnalyzer, audit));
app.use("/api/v1/compliance", requireAuth, createComplianceRoutes(pool, logger, complianceScorer, audit));
app.use("/api/v1/users", requireAuth, createUserRoutes(pool, logger, userService, sessionService, audit));
app.use("/api/v1/audit-log", requireAuth, createAuditRoutes(pool, logger));
app.use("/api/v1/settings", requireAuth, createSettingsRoutes(pool, logger, settingsService, audit));
app.use("/api/v1/agent-tokens", requireAuth, createAgentTokenRoutes(pool, logger, agentTokenService, audit, settingsService));
// Agent report/heartbeat — NOT behind requireAuth (uses its own bearer token authentication)
app.use("/api/v1/agent", createAgentReportRoutes(pool, logger, agentTokenService, groupAssignment, audit, settingsService));

// ─── Error handler (must be last) ───
app.use(createErrorHandler(logger));

async function start() {
  try {
    await runMigrations(logger);
  } catch (err) {
    logger.fatal({ err }, "Failed to run migrations, shutting down");
    process.exit(1);
  }

  // Seed and load settings
  try {
    await settingsService.seed();
  } catch (err) {
    logger.error({ err }, "Failed to seed/load settings");
  }

  // Seed default admin user if no users exist
  try {
    await userService.ensureDefaultAdmin();
  } catch (err) {
    logger.error({ err }, "Failed to seed default admin user");
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

  // Start report generator (loads cron schedules from DB)
  await reportGenerator.start();

  // Start notification service
  notificationService.start();

  // Start compliance scorer
  complianceScorer.start();

  // Start agent health checker
  agentHealthChecker.start();

  // Start maintenance service (daily at 3 AM)
  maintenance.start();

  // Daily digest at configured hour (default 8 AM)
  let digestTimer: ReturnType<typeof setTimeout> | null = null;
  let digestInterval: ReturnType<typeof setInterval> | null = null;
  const scheduleDigest = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(config.alertDigestHour, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delay = next.getTime() - now.getTime();
    digestTimer = setTimeout(() => {
      notificationService.sendDailyDigest();
      // Schedule next run 24h later
      digestInterval = setInterval(() => notificationService.sendDailyDigest(), 24 * 60 * 60 * 1000);
    }, delay);
  };
  scheduleDigest();

  // Daily snapshot scheduler — take a snapshot on startup and then every 24h
  changeDetector.takeSnapshot();
  const snapshotTimer = setInterval(() => changeDetector.takeSnapshot(), 24 * 60 * 60 * 1000);

  // Daily session cleanup
  sessionService.cleanExpiredSessions();
  const sessionCleanupTimer = setInterval(() => sessionService.cleanExpiredSessions(), 24 * 60 * 60 * 1000);

  // ─── Recover stale scan targets ───
  try {
    const staleRunning = await pool.query(
      `UPDATE scan_targets
       SET last_scan_status = 'failed', last_scan_error = 'Server restarted during scan', updated_at = NOW()
       WHERE last_scan_status = 'running'
       RETURNING id, name`
    );
    if (staleRunning.rows.length > 0) {
      logger.info(
        { count: staleRunning.rows.length, targets: staleRunning.rows.map((r) => r.name) },
        "Recovered stale scan targets stuck in 'running' state"
      );
    }
  } catch (err) {
    logger.error({ err }, "Failed to recover stale scan targets");
  }

  // ─── Graceful shutdown ───
  let shuttingDown = false;
  const SHUTDOWN_TIMEOUT_MS = 30_000;

  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      logger.info({ signal }, "Second shutdown signal received, forcing immediate exit");
      process.exit(1);
    }
    shuttingDown = true;

    logger.info({ signal }, "Shutdown signal received, starting graceful shutdown...");

    // Set a hard deadline — force exit if cleanup takes too long
    const forceExitTimer = setTimeout(() => {
      logger.error("Shutdown timeout exceeded, forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExitTimer.unref();

    try {
      // 1. Stop accepting new connections
      server.close(() => {
        logger.info("HTTP server closed");
      });

      // 2. Stop background services
      logger.info("Stopping scan orchestrator (waiting for current scan)...");
      await orchestrator.stop();
      logger.info("Scan orchestrator stopped");

      logger.info("Stopping background services...");
      staleChecker.stop();
      versionChecker.stop();
      emailNotifier.stop();
      eolChecker.stop();
      reportGenerator.stop();
      notificationService.stop();
      complianceScorer.stop();
      agentHealthChecker.stop();
      maintenance.stop();
      clearInterval(snapshotTimer);
      clearInterval(sessionCleanupTimer);
      if (digestTimer) clearTimeout(digestTimer);
      if (digestInterval) clearInterval(digestInterval);
      logger.info("Background services stopped");

      // 3. Close database pool
      await pool.end();
      logger.info("Database pool closed");

      logger.info("Graceful shutdown complete");
      clearTimeout(forceExitTimer);
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "Error during shutdown");
      clearTimeout(forceExitTimer);
      process.exit(1);
    }
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
