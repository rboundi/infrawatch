import type pg from "pg";
import type { Logger } from "pino";
import crypto from "node:crypto";

const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours
const MAX_SESSIONS = 5;

interface SessionRow {
  id: string;
  user_id: string;
  ip_address: string | null;
  user_agent: string | null;
  expires_at: string;
  created_at: string;
  last_activity_at: string;
}

interface SessionWithUser extends SessionRow {
  username: string;
  email: string;
  display_name: string | null;
  role: "admin" | "operator";
  is_active: boolean;
  force_password_change: boolean;
}

export interface ValidatedSession {
  sessionId: string;
  userId: string;
  username: string;
  email: string;
  displayName: string | null;
  role: "admin" | "operator";
  isActive: boolean;
  forcePasswordChange: boolean;
}

export class SessionService {
  constructor(
    private pool: pg.Pool,
    private logger: Logger,
  ) {}

  private hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  async createSession(
    userId: string,
    ipAddress: string | null,
    userAgent: string | null,
  ): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
    // Enforce concurrency limit before creating
    await this.enforceConcurrencyLimit(userId, MAX_SESSIONS);

    const token = crypto.randomBytes(64).toString("hex");
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO sessions (user_id, token_hash, ip_address, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [userId, tokenHash, ipAddress, userAgent, expiresAt.toISOString()],
    );

    this.logger.info({ userId, sessionId: result.rows[0].id }, "Session created");

    return { token, sessionId: result.rows[0].id, expiresAt };
  }

  async validateSession(token: string): Promise<ValidatedSession | null> {
    const tokenHash = this.hashToken(token);

    const result = await this.pool.query<SessionWithUser>(
      `SELECT s.id, s.user_id, s.ip_address, s.user_agent, s.expires_at,
              s.created_at, s.last_activity_at,
              u.username, u.email, u.display_name, u.role, u.is_active,
              u.force_password_change
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1`,
      [tokenHash],
    );

    if (result.rows.length === 0) {
      return null;
    }

    const session = result.rows[0];

    // Check absolute expiry
    if (new Date(session.expires_at) < new Date()) {
      await this.revokeSession(session.id);
      return null;
    }

    // Check idle timeout
    const lastActivity = new Date(session.last_activity_at).getTime();
    if (Date.now() - lastActivity > IDLE_TIMEOUT_MS) {
      await this.revokeSession(session.id);
      return null;
    }

    // Check user is still active
    if (!session.is_active) {
      await this.revokeSession(session.id);
      return null;
    }

    // Update last_activity_at
    await this.pool.query(
      "UPDATE sessions SET last_activity_at = NOW() WHERE id = $1",
      [session.id],
    );

    return {
      sessionId: session.id,
      userId: session.user_id,
      username: session.username,
      email: session.email,
      displayName: session.display_name,
      role: session.role,
      isActive: session.is_active,
      forcePasswordChange: session.force_password_change,
    };
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.pool.query("DELETE FROM sessions WHERE id = $1", [sessionId]);
  }

  async revokeAllUserSessions(
    userId: string,
    exceptSessionId?: string,
  ): Promise<void> {
    if (exceptSessionId) {
      await this.pool.query(
        "DELETE FROM sessions WHERE user_id = $1 AND id != $2",
        [userId, exceptSessionId],
      );
    } else {
      await this.pool.query(
        "DELETE FROM sessions WHERE user_id = $1",
        [userId],
      );
    }
    this.logger.info({ userId, exceptSessionId }, "User sessions revoked");
  }

  async cleanExpiredSessions(): Promise<number> {
    const result = await this.pool.query(
      "DELETE FROM sessions WHERE expires_at < NOW()",
    );
    const count = result.rowCount ?? 0;
    if (count > 0) {
      this.logger.info({ count }, "Expired sessions cleaned");
    }
    return count;
  }

  async enforceConcurrencyLimit(
    userId: string,
    maxSessions: number = MAX_SESSIONS,
  ): Promise<void> {
    const countResult = await this.pool.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM sessions WHERE user_id = $1",
      [userId],
    );

    const count = parseInt(countResult.rows[0].count, 10);
    if (count >= maxSessions) {
      // Delete oldest sessions to make room
      const excess = count - maxSessions + 1;
      await this.pool.query(
        `DELETE FROM sessions WHERE id IN (
           SELECT id FROM sessions WHERE user_id = $1
           ORDER BY last_activity_at ASC LIMIT $2
         )`,
        [userId, excess],
      );
      this.logger.info({ userId, deleted: excess }, "Excess sessions removed");
    }
  }

  async getUserSessions(userId: string): Promise<SessionRow[]> {
    const result = await this.pool.query<SessionRow>(
      `SELECT id, user_id, ip_address, user_agent, expires_at, created_at, last_activity_at
       FROM sessions WHERE user_id = $1 AND expires_at > NOW()
       ORDER BY last_activity_at DESC`,
      [userId],
    );
    return result.rows;
  }

  async getSessionById(sessionId: string): Promise<SessionRow | null> {
    const result = await this.pool.query<SessionRow>(
      `SELECT id, user_id, ip_address, user_agent, expires_at, created_at, last_activity_at
       FROM sessions WHERE id = $1`,
      [sessionId],
    );
    return result.rows[0] ?? null;
  }
}
