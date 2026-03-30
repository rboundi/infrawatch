import { Router } from "express";
import type pg from "pg";
import type { Logger } from "pino";
import nodemailer from "nodemailer";
import { requireAdmin } from "../middleware/auth.js";
import { SettingsService, SettingsError } from "../services/settings-service.js";
import type { AuditLogger } from "../services/audit-logger.js";

export function createSettingsRoutes(
  _pool: pg.Pool,
  _logger: Logger,
  settingsService: SettingsService,
  audit: AuditLogger,
): Router {
  const router = Router();

  router.use(requireAdmin);

  // ─── GET / — All settings grouped by category ───
  router.get("/", (_req, res) => {
    const settings = settingsService.getAllWithDefinitions();
    res.json(settings);
  });

  // ─── PATCH / — Bulk update settings ───
  router.patch("/", async (req, res) => {
    try {
      const updates = req.body;

      if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
        res.status(400).json({ error: "Body must be a JSON object of key-value pairs" });
        return;
      }

      const keys = Object.keys(updates);
      if (keys.length === 0) {
        res.status(400).json({ error: "No settings to update" });
        return;
      }

      const changes = await settingsService.bulkUpdate(updates, req.user!.id);

      for (const change of changes) {
        audit.log({
          userId: req.user!.id,
          username: req.user!.username,
          action: "setting.updated",
          entityType: "system_setting",
          entityId: change.key,
          details: { oldValue: change.oldValue, newValue: change.newValue },
          ipAddress: req.ip ?? null,
        });
      }

      res.json({
        message: `Updated ${changes.length} setting(s)`,
        changes: changes.map((c) => ({
          key: c.key,
          oldValue: c.oldValue,
          newValue: c.newValue,
        })),
      });
    } catch (err) {
      if (err instanceof SettingsError) {
        res.status(400).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── POST /test-smtp — Send test email ───
  router.post("/test-smtp", async (req, res) => {
    try {
      const host = settingsService.get<string>("smtp_host");
      const port = settingsService.get<number>("smtp_port");
      const user = settingsService.get<string>("smtp_user");
      const pass = settingsService.get<string>("smtp_password");
      const fromAddress = settingsService.get<string>("smtp_from_address");
      const useTls = settingsService.get<boolean>("smtp_tls");

      if (!host) {
        res.status(400).json({ success: false, message: "SMTP host is not configured" });
        return;
      }

      const transport = nodemailer.createTransport({
        host,
        port,
        secure: useTls && port === 465,
        auth: user ? { user, pass } : undefined,
        tls: useTls ? { rejectUnauthorized: false } : undefined,
      });

      await transport.verify();

      const toEmail = req.user!.email;
      await transport.sendMail({
        from: fromAddress,
        to: toEmail,
        subject: "InfraWatch SMTP Test",
        text: "This is a test email from InfraWatch. If you received this, SMTP is configured correctly.",
        html: "<h3>InfraWatch SMTP Test</h3><p>This is a test email from InfraWatch. If you received this, SMTP is configured correctly.</p>",
      });

      audit.log({
        userId: req.user!.id,
        username: req.user!.username,
        action: "settings.smtp_test",
        entityType: "system_setting",
        details: { success: true, toEmail },
        ipAddress: req.ip ?? null,
      });

      res.json({ success: true, message: `Test email sent to ${toEmail}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : "SMTP test failed";
      res.json({ success: false, message });
    }
  });

  return router;
}
