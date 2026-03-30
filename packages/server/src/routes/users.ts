import { Router } from "express";
import type pg from "pg";
import type { Logger } from "pino";
import crypto from "node:crypto";
import type { UserService } from "../services/user-service.js";
import type { SessionService } from "../services/session-service.js";
import type { AuditLogger } from "../services/audit-logger.js";
import { requireAdmin } from "../middleware/auth.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_ROLES = new Set(["admin", "operator"]);

export function createUserRoutes(
  pool: pg.Pool,
  logger: Logger,
  userService: UserService,
  sessionService: SessionService,
  audit: AuditLogger,
): Router {
  const router = Router();

  // All user management routes require admin
  router.use(requireAdmin);

  // ─── GET / — List users ───
  router.get("/", async (req, res) => {
    try {
      const page = Math.max(parseInt(req.query.page as string) || 1, 1);
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 25, 1), 100);
      const offset = (page - 1) * limit;
      const roleFilter = req.query.role as string | undefined;
      const isActiveFilter = req.query.isActive as string | undefined;
      const search = (req.query.search as string || "").slice(0, 100);

      const conditions: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      if (roleFilter && VALID_ROLES.has(roleFilter)) {
        conditions.push(`role = $${idx++}`);
        params.push(roleFilter);
      }

      if (isActiveFilter === "true" || isActiveFilter === "false") {
        conditions.push(`is_active = $${idx++}`);
        params.push(isActiveFilter === "true");
      }

      if (search) {
        conditions.push(`(username ILIKE $${idx} OR email ILIKE $${idx})`);
        params.push(`%${search}%`);
        idx++;
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const [countResult, dataResult] = await Promise.all([
        pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM users ${where}`, params),
        pool.query(
          `SELECT id, username, email, display_name, role, is_active,
                  last_login_at, login_count, failed_login_attempts, locked_until,
                  created_at
           FROM users ${where}
           ORDER BY created_at ASC
           LIMIT $${idx} OFFSET $${idx + 1}`,
          [...params, limit, offset],
        ),
      ]);

      const total = parseInt(countResult.rows[0].count, 10);

      res.json({
        data: dataResult.rows.map((u) => ({
          id: u.id,
          username: u.username,
          email: u.email,
          displayName: u.display_name,
          role: u.role,
          isActive: u.is_active,
          lastLoginAt: u.last_login_at,
          loginCount: u.login_count,
          failedLoginAttempts: u.failed_login_attempts,
          lockedUntil: u.locked_until,
          createdAt: u.created_at,
        })),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      });
    } catch (err) {
      logger.error({ err }, "List users error");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── POST / — Create user ───
  router.post("/", async (req, res) => {
    try {
      const { username, email, password, displayName, role } = req.body;

      if (!username || !email) {
        res.status(400).json({ error: "Username and email are required" });
        return;
      }

      if (typeof username !== "string" || username.length > 100) {
        res.status(400).json({ error: "Invalid username" });
        return;
      }

      if (typeof email !== "string" || !EMAIL_RE.test(email) || email.length > 255) {
        res.status(400).json({ error: "Invalid email format" });
        return;
      }

      if (role && !VALID_ROLES.has(role)) {
        res.status(400).json({ error: "Role must be 'admin' or 'operator'" });
        return;
      }

      // Check uniqueness
      const existing = await pool.query(
        "SELECT id FROM users WHERE username = $1 OR email = $2",
        [username, email],
      );
      if (existing.rows.length > 0) {
        res.status(409).json({ error: "Username or email already exists" });
        return;
      }

      // Password: provided or auto-generated
      let actualPassword = password;
      let generatedPassword: string | undefined;

      if (!actualPassword) {
        actualPassword = crypto.randomBytes(8).toString("hex");
        generatedPassword = actualPassword;
      } else {
        if (typeof actualPassword !== "string") {
          res.status(400).json({ error: "Invalid password" });
          return;
        }
        const strength = userService.validatePasswordStrength(actualPassword, username);
        if (!strength.valid) {
          res.status(400).json({ error: "Password too weak", details: strength.errors });
          return;
        }
      }

      const user = await userService.createUser({
        username,
        email,
        password: actualPassword,
        displayName: displayName || undefined,
        role: role || "operator",
        createdBy: req.user!.id,
      });

      // If password was auto-generated, set force_password_change
      if (generatedPassword) {
        await pool.query(
          "UPDATE users SET force_password_change = true WHERE id = $1",
          [user.id],
        );
      }

      audit.log({
        userId: req.user!.id,
        username: req.user!.username,
        action: "user.created",
        entityType: "user",
        entityId: user.id,
        details: { targetUsername: username, role: role || "operator" },
        ipAddress: req.ip ?? null,
      });

      const response: Record<string, unknown> = {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.display_name,
        role: user.role,
        isActive: user.is_active,
        createdAt: user.created_at,
      };

      if (generatedPassword) {
        response.generatedPassword = generatedPassword;
      }

      res.status(201).json(response);
    } catch (err) {
      logger.error({ err }, "Create user error");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── GET /:id — User detail ───
  router.get("/:id", async (req, res) => {
    try {
      const id = req.params.id as string;
      if (!UUID_RE.test(id)) {
        res.status(400).json({ error: "Invalid user ID" });
        return;
      }

      const user = await userService.findById(id);
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      // Get active session count
      const sessionResult = await pool.query<{ count: string }>(
        "SELECT COUNT(*) AS count FROM sessions WHERE user_id = $1 AND expires_at > NOW()",
        [id],
      );

      res.json({
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.display_name,
        role: user.role,
        isActive: user.is_active,
        forcePasswordChange: user.force_password_change,
        lastLoginAt: user.last_login_at,
        loginCount: user.login_count,
        failedLoginAttempts: user.failed_login_attempts,
        lockedUntil: user.locked_until,
        passwordChangedAt: user.password_changed_at,
        createdBy: user.created_by,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
        activeSessionCount: parseInt(sessionResult.rows[0].count, 10),
      });
    } catch (err) {
      logger.error({ err }, "Get user error");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── PATCH /:id — Update user ───
  router.patch("/:id", async (req, res) => {
    try {
      const id = req.params.id as string;
      if (!UUID_RE.test(id)) {
        res.status(400).json({ error: "Invalid user ID" });
        return;
      }

      const user = await userService.findById(id);
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const { email, displayName, role, isActive } = req.body;
      const changes: Record<string, unknown> = {};
      const oldValues: Record<string, unknown> = {};

      // Cannot deactivate yourself
      if (isActive === false && id === req.user!.id) {
        res.status(400).json({ error: "Cannot deactivate your own account" });
        return;
      }

      // Cannot demote if last admin (use FOR UPDATE to prevent TOCTOU race)
      if (role && role !== user.role && user.role === "admin") {
        const adminCount = await pool.query<{ count: string }>(
          "SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND is_active = true AND id != $1",
          [id],
        );
        if (parseInt(adminCount.rows[0].count, 10) < 1) {
          res.status(400).json({ error: "Cannot demote the last admin" });
          return;
        }
      }

      if (email !== undefined) {
        if (typeof email !== "string" || !EMAIL_RE.test(email) || email.length > 255) {
          res.status(400).json({ error: "Invalid email format" });
          return;
        }
        // Check unique
        const dup = await pool.query(
          "SELECT id FROM users WHERE email = $1 AND id != $2",
          [email, id],
        );
        if (dup.rows.length > 0) {
          res.status(409).json({ error: "Email already in use" });
          return;
        }
        oldValues.email = user.email;
        changes.email = email;
      }

      if (displayName !== undefined) {
        oldValues.displayName = user.display_name;
        changes.displayName = displayName;
      }

      if (role !== undefined) {
        if (!VALID_ROLES.has(role)) {
          res.status(400).json({ error: "Role must be 'admin' or 'operator'" });
          return;
        }
        oldValues.role = user.role;
        changes.role = role;
      }

      if (isActive !== undefined) {
        oldValues.isActive = user.is_active;
        changes.isActive = isActive;
      }

      if (Object.keys(changes).length === 0) {
        res.status(400).json({ error: "No valid fields to update" });
        return;
      }

      // Build dynamic UPDATE
      const setClauses: string[] = ["updated_at = NOW()"];
      const params: unknown[] = [];
      let idx = 1;

      if (changes.email !== undefined) {
        setClauses.push(`email = $${idx++}`);
        params.push(changes.email);
      }
      if (changes.displayName !== undefined) {
        setClauses.push(`display_name = $${idx++}`);
        params.push(changes.displayName);
      }
      if (changes.role !== undefined) {
        setClauses.push(`role = $${idx++}`);
        params.push(changes.role);
      }
      if (changes.isActive !== undefined) {
        setClauses.push(`is_active = $${idx++}`);
        params.push(changes.isActive);
      }

      params.push(id);
      await pool.query(
        `UPDATE users SET ${setClauses.join(", ")} WHERE id = $${idx}`,
        params,
      );

      // If deactivated, revoke all sessions
      if (changes.isActive === false) {
        await sessionService.revokeAllUserSessions(id);
      }

      audit.log({
        userId: req.user!.id,
        username: req.user!.username,
        action: "user.updated",
        entityType: "user",
        entityId: id,
        details: { changes, oldValues },
        ipAddress: req.ip ?? null,
      });

      const updated = await userService.findById(id);
      if (!updated) {
        res.status(404).json({ error: "User not found after update" });
        return;
      }
      res.json({
        id: updated.id,
        username: updated.username,
        email: updated.email,
        displayName: updated.display_name,
        role: updated.role,
        isActive: updated.is_active,
        updatedAt: updated.updated_at,
      });
    } catch (err) {
      logger.error({ err }, "Update user error");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── DELETE /:id — Soft-delete user ───
  router.delete("/:id", async (req, res) => {
    try {
      const id = req.params.id as string;
      if (!UUID_RE.test(id)) {
        res.status(400).json({ error: "Invalid user ID" });
        return;
      }

      if (id === req.user!.id) {
        res.status(400).json({ error: "Cannot delete your own account" });
        return;
      }

      const user = await userService.findById(id);
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      // Cannot delete last admin (exclude self from count to check if others exist)
      if (user.role === "admin") {
        const adminCount = await pool.query<{ count: string }>(
          "SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND is_active = true AND id != $1",
          [id],
        );
        if (parseInt(adminCount.rows[0].count, 10) < 1) {
          res.status(400).json({ error: "Cannot delete the last admin" });
          return;
        }
      }

      await pool.query(
        "UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1",
        [id],
      );
      await sessionService.revokeAllUserSessions(id);

      audit.log({
        userId: req.user!.id,
        username: req.user!.username,
        action: "user.deleted",
        entityType: "user",
        entityId: id,
        details: { targetUsername: user.username },
        ipAddress: req.ip ?? null,
      });

      res.json({ message: "User deactivated" });
    } catch (err) {
      logger.error({ err }, "Delete user error");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── POST /:id/reset-password ───
  router.post("/:id/reset-password", async (req, res) => {
    try {
      const id = req.params.id as string;
      if (!UUID_RE.test(id)) {
        res.status(400).json({ error: "Invalid user ID" });
        return;
      }

      const user = await userService.findById(id);
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const generatedPassword = crypto.randomBytes(8).toString("hex");
      const hash = await userService.hashPassword(generatedPassword);

      await pool.query(
        `UPDATE users SET password_hash = $1, force_password_change = true,
                password_changed_at = NOW(), updated_at = NOW()
         WHERE id = $2`,
        [hash, id],
      );

      await sessionService.revokeAllUserSessions(id);

      audit.log({
        userId: req.user!.id,
        username: req.user!.username,
        action: "user.password_reset",
        entityType: "user",
        entityId: id,
        details: { targetUsername: user.username },
        ipAddress: req.ip ?? null,
      });

      res.json({ generatedPassword });
    } catch (err) {
      logger.error({ err }, "Reset password error");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── POST /:id/unlock ───
  router.post("/:id/unlock", async (req, res) => {
    try {
      const id = req.params.id as string;
      if (!UUID_RE.test(id)) {
        res.status(400).json({ error: "Invalid user ID" });
        return;
      }

      const user = await userService.findById(id);
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      await pool.query(
        "UPDATE users SET failed_login_attempts = 0, locked_until = NULL, updated_at = NOW() WHERE id = $1",
        [id],
      );

      audit.log({
        userId: req.user!.id,
        username: req.user!.username,
        action: "user.unlocked",
        entityType: "user",
        entityId: id,
        details: { targetUsername: user.username },
        ipAddress: req.ip ?? null,
      });

      res.json({ message: "Account unlocked" });
    } catch (err) {
      logger.error({ err }, "Unlock user error");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
