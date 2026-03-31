import crypto from "node:crypto";
import type pg from "pg";
import type { Logger } from "pino";

const TOKEN_PREFIX = "iw_";

export interface AgentToken {
  id: string;
  tokenHash: string;
  name: string;
  description: string | null;
  scope: "single" | "fleet";
  allowedHostnames: string[];
  lockedHostname: string | null;
  environmentTag: string | null;
  hostGroupIds: string[];
  isActive: boolean;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  reportCount: number;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string | null;
}

function hashToken(rawToken: string): string {
  // Strip "iw_" prefix if present before hashing
  const token = rawToken.startsWith(TOKEN_PREFIX) ? rawToken.slice(TOKEN_PREFIX.length) : rawToken;
  return crypto.createHash("sha256").update(token).digest("hex");
}

function rowToToken(row: Record<string, unknown>): AgentToken {
  return {
    id: row.id as string,
    tokenHash: row.token_hash as string,
    name: row.name as string,
    description: (row.description as string) ?? null,
    scope: row.scope as "single" | "fleet",
    allowedHostnames: (row.allowed_hostnames as string[]) ?? [],
    lockedHostname: (row.locked_hostname as string) ?? null,
    environmentTag: (row.environment_tag as string) ?? null,
    hostGroupIds: (row.host_group_ids as string[]) ?? [],
    isActive: row.is_active as boolean,
    lastUsedAt: row.last_used_at ? (row.last_used_at as Date).toISOString() : null,
    lastUsedIp: (row.last_used_ip as string) ?? null,
    reportCount: row.report_count as number,
    createdBy: (row.created_by as string) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
    expiresAt: row.expires_at ? (row.expires_at as Date).toISOString() : null,
  };
}

export class AgentTokenService {
  constructor(
    private pool: pg.Pool,
    private logger: Logger,
  ) {}

  /**
   * Generate a new agent token.
   * Returns the raw token (shown once) and the created record.
   */
  async generateToken(opts: {
    name: string;
    description?: string;
    scope?: "single" | "fleet";
    allowedHostnames?: string[];
    environmentTag?: string;
    hostGroupIds?: string[];
    expiresAt?: string;
    createdBy?: string;
  }): Promise<{ rawToken: string; token: AgentToken }> {
    const rawHex = crypto.randomBytes(48).toString("hex");
    const rawToken = TOKEN_PREFIX + rawHex;
    const tokenHash = hashToken(rawToken);

    const result = await this.pool.query(
      `INSERT INTO agent_tokens
         (token_hash, name, description, scope, allowed_hostnames, environment_tag, host_group_ids, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        tokenHash,
        opts.name,
        opts.description ?? null,
        opts.scope ?? "single",
        opts.allowedHostnames ?? [],
        opts.environmentTag ?? null,
        opts.hostGroupIds ?? [],
        opts.expiresAt ?? null,
        opts.createdBy ?? null,
      ],
    );

    this.logger.info({ tokenId: result.rows[0].id, name: opts.name, scope: opts.scope ?? "single" }, "Agent token created");
    return { rawToken, token: rowToToken(result.rows[0]) };
  }

  /**
   * Validate a raw token (with or without "iw_" prefix).
   * Returns the token record if valid, null if not found/expired/inactive.
   */
  async validateToken(rawToken: string): Promise<AgentToken | null> {
    const tokenHash = hashToken(rawToken);

    const result = await this.pool.query(
      `SELECT * FROM agent_tokens
       WHERE token_hash = $1
         AND is_active = true
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [tokenHash],
    );

    if (result.rows.length === 0) return null;
    return rowToToken(result.rows[0]);
  }

  /**
   * Record token usage: update last_used_at, last_used_ip, increment report_count.
   */
  async recordUsage(tokenId: string, ip: string): Promise<void> {
    await this.pool.query(
      `UPDATE agent_tokens
       SET last_used_at = NOW(), last_used_ip = $1, report_count = report_count + 1
       WHERE id = $2`,
      [ip, tokenId],
    );
  }

  /**
   * Lock a single-scope token to a hostname (first report).
   */
  async lockHostname(tokenId: string, hostname: string): Promise<void> {
    await this.pool.query(
      `UPDATE agent_tokens SET locked_hostname = $1 WHERE id = $2 AND locked_hostname IS NULL`,
      [hostname, tokenId],
    );
  }

  /**
   * Get token by ID.
   */
  async getById(tokenId: string): Promise<AgentToken | null> {
    const result = await this.pool.query(`SELECT * FROM agent_tokens WHERE id = $1`, [tokenId]);
    if (result.rows.length === 0) return null;
    return rowToToken(result.rows[0]);
  }

  /**
   * List all tokens (for admin).
   */
  async listTokens(): Promise<AgentToken[]> {
    const result = await this.pool.query(
      `SELECT * FROM agent_tokens ORDER BY created_at DESC`,
    );
    return result.rows.map(rowToToken);
  }

  /**
   * Update token fields.
   */
  async updateToken(
    tokenId: string,
    updates: {
      name?: string;
      description?: string;
      allowedHostnames?: string[];
      environmentTag?: string | null;
      hostGroupIds?: string[];
      isActive?: boolean;
      expiresAt?: string | null;
    },
  ): Promise<AgentToken | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (updates.name !== undefined) { sets.push(`name = $${idx++}`); values.push(updates.name); }
    if (updates.description !== undefined) { sets.push(`description = $${idx++}`); values.push(updates.description); }
    if (updates.allowedHostnames !== undefined) { sets.push(`allowed_hostnames = $${idx++}`); values.push(updates.allowedHostnames); }
    if (updates.environmentTag !== undefined) { sets.push(`environment_tag = $${idx++}`); values.push(updates.environmentTag); }
    if (updates.hostGroupIds !== undefined) { sets.push(`host_group_ids = $${idx++}`); values.push(updates.hostGroupIds); }
    if (updates.isActive !== undefined) { sets.push(`is_active = $${idx++}`); values.push(updates.isActive); }
    if (updates.expiresAt !== undefined) { sets.push(`expires_at = $${idx++}`); values.push(updates.expiresAt); }

    if (sets.length === 0) return this.getById(tokenId);

    values.push(tokenId);
    const result = await this.pool.query(
      `UPDATE agent_tokens SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
      values,
    );

    if (result.rows.length === 0) return null;
    return rowToToken(result.rows[0]);
  }

  /**
   * Deactivate a token (soft delete).
   */
  async revokeToken(tokenId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE agent_tokens SET is_active = false WHERE id = $1 RETURNING id`,
      [tokenId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Rotate a token: deactivate the old one and create a new one with the same settings.
   */
  async rotateToken(tokenId: string): Promise<{ rawToken: string; token: AgentToken } | null> {
    const existing = await this.getById(tokenId);
    if (!existing) return null;

    // Deactivate old token
    await this.revokeToken(tokenId);

    // Create new token with same settings
    return this.generateToken({
      name: existing.name,
      description: existing.description ?? undefined,
      scope: existing.scope,
      allowedHostnames: existing.allowedHostnames,
      environmentTag: existing.environmentTag ?? undefined,
      hostGroupIds: existing.hostGroupIds,
      expiresAt: existing.expiresAt ?? undefined,
      createdBy: existing.createdBy ?? undefined,
    });
  }

  /**
   * Get or create a virtual scan_target for an agent token.
   * Agent reports flow through the data ingestion service just like scanner results,
   * so we need a scan_target record to link hosts to.
   */
  async getOrCreateScanTarget(token: AgentToken): Promise<string> {
    // Check for existing
    const existing = await this.pool.query(
      `SELECT id FROM scan_targets WHERE type = 'agent' AND name = $1`,
      [`agent:${token.id}`],
    );

    if (existing.rows.length > 0) return existing.rows[0].id as string;

    // Create new — connection_config stores empty encrypted JSON since encrypt requires MASTER_KEY
    // Store raw empty JSON since agents don't need credentials
    const result = await this.pool.query(
      `INSERT INTO scan_targets (name, type, connection_config, scan_interval_hours, enabled, last_scan_status)
       VALUES ($1, 'agent', '{}', 0, false, 'pending')
       RETURNING id`,
      [`agent:${token.id}`],
    );

    return result.rows[0].id as string;
  }
}
