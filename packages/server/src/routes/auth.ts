import { Router } from "express";
import type pg from "pg";
import type { Logger } from "pino";
import type { UserService } from "../services/user-service.js";
import type { SessionService } from "../services/session-service.js";
import { createRequireAuth } from "../middleware/auth.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Lock durations based on failed attempts
const LOCK_THRESHOLDS = [
  { attempts: 20, durationMs: 100 * 365 * 24 * 60 * 60 * 1000 }, // 100 years (effectively permanent)
  { attempts: 10, durationMs: 60 * 60 * 1000 },                   // 1 hour
  { attempts: 5, durationMs: 15 * 60 * 1000 },                    // 15 minutes
];

async function auditLog(
  pool: pg.Pool,
  userId: string | null,
  username: string,
  action: string,
  ipAddress: string | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  await pool.query(
    `INSERT INTO audit_log (user_id, username, action, ip_address, details)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, username, action, ipAddress, JSON.stringify(details)],
  );
}

export function createAuthRoutes(
  pool: pg.Pool,
  logger: Logger,
  userService: UserService,
  sessionService: SessionService,
): Router {
  const router = Router();
  const requireAuth = createRequireAuth(sessionService);

  // ─── POST /login ───
  router.post("/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      const ip = req.ip ?? null;

      if (!username || !password) {
        res.status(400).json({ error: "Username and password are required" });
        return;
      }

      if (typeof username !== "string" || typeof password !== "string") {
        res.status(400).json({ error: "Invalid input" });
        return;
      }

      // Truncate to prevent DoS with huge strings
      const safeUsername = username.slice(0, 100);
      const safePassword = password.slice(0, 256);

      const user = await userService.findByUsernameWithHash(safeUsername);

      if (!user || !user.is_active) {
        await auditLog(pool, null, safeUsername, "user.login_failed", ip, {
          reason: "user_not_found_or_inactive",
        });
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }

      // Check account lock
      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        await auditLog(pool, user.id, user.username, "user.login_failed", ip, {
          reason: "account_locked",
        });
        res.status(423).json({
          error: "Account locked",
          lockedUntil: user.locked_until,
        });
        return;
      }

      // Verify password
      const valid = await userService.verifyPassword(safePassword, user.password_hash);

      if (!valid) {
        const newAttempts = user.failed_login_attempts + 1;

        // Determine lock duration
        let lockUntil: string | null = null;
        for (const threshold of LOCK_THRESHOLDS) {
          if (newAttempts >= threshold.attempts) {
            lockUntil = new Date(Date.now() + threshold.durationMs).toISOString();
            break;
          }
        }

        await pool.query(
          `UPDATE users SET failed_login_attempts = $1, locked_until = $2, updated_at = NOW()
           WHERE id = $3`,
          [newAttempts, lockUntil, user.id],
        );

        await auditLog(pool, user.id, user.username, "user.login_failed", ip, {
          reason: "invalid_password",
          attempts: newAttempts,
          locked: !!lockUntil,
        });

        logger.warn(
          { username: user.username, attempts: newAttempts, locked: !!lockUntil },
          "Failed login attempt",
        );

        res.status(401).json({ error: "Invalid credentials" });
        return;
      }

      // Success — reset failed attempts, update login stats
      await pool.query(
        `UPDATE users SET
           failed_login_attempts = 0,
           locked_until = NULL,
           last_login_at = NOW(),
           login_count = login_count + 1,
           updated_at = NOW()
         WHERE id = $1`,
        [user.id],
      );

      // Create session
      const userAgent = req.headers["user-agent"] ?? null;
      const session = await sessionService.createSession(user.id, ip, userAgent);

      await auditLog(pool, user.id, user.username, "user.login", ip);

      // Set httpOnly cookie
      res.cookie("infrawatch_session", session.token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 8 * 60 * 60 * 1000, // 8 hours
        path: "/",
      });

      res.json({
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          displayName: user.display_name,
          forcePasswordChange: user.force_password_change,
        },
        token: session.token,
        expiresAt: session.expiresAt.toISOString(),
      });
    } catch (err) {
      logger.error({ err }, "Login error");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── POST /logout ───
  router.post("/logout", requireAuth, async (req, res) => {
    try {
      await sessionService.revokeSession(req.sessionId!);

      await auditLog(pool, req.user!.id, req.user!.username, "user.logout", req.ip ?? null);

      res.clearCookie("infrawatch_session", { path: "/" });
      res.json({ message: "Logged out" });
    } catch (err) {
      logger.error({ err }, "Logout error");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── POST /change-password ───
  router.post("/change-password", requireAuth, async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        res.status(400).json({ error: "Current and new passwords are required" });
        return;
      }

      if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
        res.status(400).json({ error: "Invalid input" });
        return;
      }

      const user = await userService.findByUsernameWithHash(req.user!.username);
      if (!user) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      // Verify current password
      const validCurrent = await userService.verifyPassword(currentPassword, user.password_hash);
      if (!validCurrent) {
        res.status(401).json({ error: "Current password is incorrect" });
        return;
      }

      // Check new password isn't same as current
      const sameAsOld = await userService.verifyPassword(newPassword, user.password_hash);
      if (sameAsOld) {
        res.status(400).json({ error: "New password must be different from current password" });
        return;
      }

      // Validate strength
      const strength = userService.validatePasswordStrength(newPassword, user.username);
      if (!strength.valid) {
        res.status(400).json({ error: "Password too weak", details: strength.errors });
        return;
      }

      // Hash and update
      const newHash = await userService.hashPassword(newPassword);
      await pool.query(
        `UPDATE users SET
           password_hash = $1,
           password_changed_at = NOW(),
           force_password_change = false,
           updated_at = NOW()
         WHERE id = $2`,
        [newHash, user.id],
      );

      // Revoke all other sessions
      await sessionService.revokeAllUserSessions(user.id, req.sessionId);

      await auditLog(pool, user.id, user.username, "user.password_changed", req.ip ?? null);

      res.json({ message: "Password changed" });
    } catch (err) {
      logger.error({ err }, "Change password error");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── GET /me ───
  router.get("/me", requireAuth, async (req, res) => {
    try {
      const user = await userService.findById(req.user!.id);
      if (!user) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      res.json({
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        displayName: user.display_name,
        lastLoginAt: user.last_login_at,
        passwordChangedAt: user.password_changed_at,
        forcePasswordChange: user.force_password_change,
      });
    } catch (err) {
      logger.error({ err }, "Get profile error");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── GET /sessions ───
  router.get("/sessions", requireAuth, async (req, res) => {
    try {
      const sessions = await sessionService.getUserSessions(req.user!.id);

      res.json(
        sessions.map((s) => ({
          id: s.id,
          ipAddress: s.ip_address,
          userAgent: s.user_agent,
          createdAt: s.created_at,
          lastActivityAt: s.last_activity_at,
          isCurrent: s.id === req.sessionId,
        })),
      );
    } catch (err) {
      logger.error({ err }, "List sessions error");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── DELETE /sessions/:id ───
  router.delete("/sessions/:id", requireAuth, async (req, res) => {
    try {
      const sessionId = req.params.id as string;
      if (!UUID_RE.test(sessionId)) {
        res.status(400).json({ error: "Invalid session ID" });
        return;
      }

      const session = await sessionService.getSessionById(sessionId);
      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      // Users can only revoke their own sessions; admins can revoke anyone's
      if (session.user_id !== req.user!.id && req.user!.role !== "admin") {
        res.status(403).json({ error: "Cannot revoke another user's session" });
        return;
      }

      await sessionService.revokeSession(sessionId);

      await auditLog(pool, req.user!.id, req.user!.username, "session.revoked", req.ip ?? null, {
        targetSessionId: sessionId,
        targetUserId: session.user_id,
      });

      res.json({ message: "Session revoked" });
    } catch (err) {
      logger.error({ err }, "Revoke session error");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
