import express from "express";
import cookieParser from "cookie-parser";
import { getTestDb } from "./setup.js";
import { createScanTargetRoutes } from "../routes/scan-targets.js";
import { createHostRoutes } from "../routes/hosts.js";
import { createAlertRoutes, createStatsRoutes } from "../routes/alerts.js";
import { createDiscoveryRoutes } from "../routes/discovery.js";
import { createChangeRoutes } from "../routes/changes.js";
import { createEolRoutes } from "../routes/eol.js";
import { createReportRoutes } from "../routes/reports.js";
import { createNotificationRoutes } from "../routes/notifications.js";
import { createGroupRoutes } from "../routes/groups.js";
import { createDependencyRoutes } from "../routes/dependencies.js";
import { createComplianceRoutes } from "../routes/compliance.js";
import { createAuthRoutes } from "../routes/auth.js";
import { createUserRoutes } from "../routes/users.js";
import { createAuditRoutes } from "../routes/audit.js";
import { createSettingsRoutes } from "../routes/settings.js";
import { createScanLogRoutes } from "../routes/scan-logs.js";
import { createRequireAuth } from "../middleware/auth.js";
import { createErrorHandler } from "../middleware/error-handler.js";
import { AuditLogger } from "../services/audit-logger.js";
import { ScanLogger } from "../services/scan-logger.js";
import { SettingsService } from "../services/settings-service.js";
import { UserService } from "../services/user-service.js";
import { SessionService } from "../services/session-service.js";
import { GroupAssignmentService } from "../services/group-assignment.js";
import { ImpactAnalyzer } from "../services/impact-analyzer.js";
import { ComplianceScorer } from "../services/compliance-scorer.js";
import { ReportGenerator } from "../services/reports/report-generator.js";
import { NotificationService } from "../services/notifications/notification-service.js";
import pino from "pino";

const logger = pino({ level: "silent" });

let app: express.Express | null = null;

export function getTestApp(): express.Express {
  if (app) return app;

  const pool = getTestDb();

  app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  // Services
  const settingsService = new SettingsService(pool, logger);
  const userService = new UserService(pool, logger, settingsService);
  const sessionService = new SessionService(pool, logger, settingsService);
  const audit = new AuditLogger(pool, logger);
  const scanLogger = new ScanLogger(pool, logger);
  const groupAssignment = new GroupAssignmentService(pool, logger);
  const impactAnalyzer = new ImpactAnalyzer(pool);
  const complianceScorer = new ComplianceScorer(pool, logger);
  const reportGenerator = new ReportGenerator(pool, logger);
  const notificationService = new NotificationService(pool, logger);
  const requireAuth = createRequireAuth(sessionService);

  // Health check (unauthenticated)
  app.get("/api/v1/health", async (_req, res) => {
    res.json({ status: "healthy" });
  });

  // Auth routes (login is public, others require auth — handled inside the router)
  app.use("/api/v1/auth", createAuthRoutes(pool, logger, userService, sessionService, settingsService));

  // Authenticated routes
  app.use("/api/v1/targets", requireAuth, createScanTargetRoutes(pool, logger, audit, scanLogger));
  app.use("/api/v1/targets/:targetId/scan-logs", requireAuth, createScanLogRoutes(pool, logger, scanLogger));
  app.use("/api/v1/hosts", requireAuth, createHostRoutes(pool, logger, audit));
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

  // Error handler
  app.use(createErrorHandler(logger));

  return app;
}

/**
 * Reset the cached app instance (call if you need a fresh app between test suites).
 */
export function resetTestApp(): void {
  app = null;
}
