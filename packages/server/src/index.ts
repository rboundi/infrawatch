import express from "express";
import pg from "pg";
import pino from "pino";
import { pinoHttp } from "pino-http";
import { config } from "./config.js";
import { runMigrations } from "./migrate.js";
import { createScanTargetRoutes } from "./routes/scan-targets.js";
import { createHostRoutes } from "./routes/hosts.js";
import { createAlertRoutes, createStatsRoutes } from "./routes/alerts.js";
import { createDiscoveryRoutes } from "./routes/discovery.js";
import { createErrorHandler } from "./middleware/error-handler.js";
import { ScanOrchestrator } from "./services/scan-orchestrator.js";
import { StaleHostChecker } from "./services/stale-host-checker.js";
import { VersionChecker } from "./services/version-checker.js";
import { EmailNotifier } from "./services/email-notifier.js";

const logger = pino({ level: config.nodeEnv === "test" ? "silent" : "info" });

const pool = new pg.Pool(config.db);

const app = express();

app.use(pinoHttp({ logger }));
app.use(express.json());

// ─── Health ───
app.get("/api/v1/health", async (_req, res) => {
  let dbStatus = "ok";
  try {
    await pool.query("SELECT 1");
  } catch {
    dbStatus = "unreachable";
  }

  res.json({
    status: dbStatus === "ok" ? "healthy" : "degraded",
    db: dbStatus,
    timestamp: new Date().toISOString(),
    version: "0.1.0",
  });
});

// ─── Routes ───
app.use("/api/v1/targets", createScanTargetRoutes(pool, logger));
app.use("/api/v1/hosts", createHostRoutes(pool, logger));
app.use("/api/v1/alerts", createAlertRoutes(pool, logger));
app.use("/api/v1/stats", createStatsRoutes(pool, logger));
app.use("/api/v1/discovery", createDiscoveryRoutes(pool, logger));

// ─── Error handler (must be last) ───
app.use(createErrorHandler(logger));

// ─── Background services ───
const orchestrator = new ScanOrchestrator(pool, logger);
const staleChecker = new StaleHostChecker(pool, logger);
const versionChecker = new VersionChecker(pool, logger);
const emailNotifier = new EmailNotifier(pool, logger);

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

  // ─── Graceful shutdown ───
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutdown signal received");

    server.close(() => {
      logger.info("HTTP server closed");
    });

    await orchestrator.stop();
    staleChecker.stop();
    versionChecker.stop();
    emailNotifier.stop();

    await pool.end();
    logger.info("Database pool closed");

    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start();

export { app, pool };
