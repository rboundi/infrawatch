import type pg from "pg";
import type { Logger } from "pino";
import { encrypt, decrypt } from "../utils/crypto.js";
import { config } from "../config.js";

// ─── Setting definition ───

export interface SettingDefinition {
  key: string;
  defaultValue: unknown;
  category: string;
  valueType: "string" | "number" | "boolean" | "email" | "select";
  description: string;
  constraints?: {
    min?: number;
    max?: number;
    maxLength?: number;
    pattern?: string;
    options?: string[];
  };
  encrypted?: boolean;
  /** Optional env var override: DB > env > default */
  envVar?: string;
}

// ─── All setting definitions ───

export const SETTING_DEFINITIONS: SettingDefinition[] = [
  // ── general ──
  { key: "app_name", defaultValue: "InfraWatch", category: "general", valueType: "string", description: "Application display name", constraints: { maxLength: 50 } },
  { key: "app_url", defaultValue: "http://localhost", category: "general", valueType: "string", description: "Application base URL", constraints: { pattern: "^https?://" } },
  { key: "timezone", defaultValue: "UTC", category: "general", valueType: "select", description: "Server timezone", constraints: { options: ["UTC", "Europe/Athens", "Europe/London", "US/Eastern", "US/Central", "US/Pacific", "Asia/Tokyo", "Asia/Shanghai", "Australia/Sydney"] } },

  // ── scanning ──
  { key: "scan_check_interval_minutes", defaultValue: 5, category: "scanning", valueType: "number", description: "How often to check for targets due for scanning", constraints: { min: 1, max: 60 } },
  { key: "scan_timeout_minutes", defaultValue: 5, category: "scanning", valueType: "number", description: "Max time allowed per scan target", constraints: { min: 1, max: 30 } },
  { key: "scan_concurrency", defaultValue: 1, category: "scanning", valueType: "number", description: "Max concurrent scans", constraints: { min: 1, max: 5 } },
  { key: "stale_host_threshold_hours", defaultValue: 24, category: "scanning", valueType: "number", description: "Hours before a host is considered stale", constraints: { min: 1, max: 168 } },
  { key: "default_scan_interval_hours", defaultValue: 6, category: "scanning", valueType: "number", description: "Default scan interval for new targets", constraints: { min: 1, max: 168 } },
  { key: "ssh_command_timeout_seconds", defaultValue: 30, category: "scanning", valueType: "number", description: "SSH command timeout", constraints: { min: 5, max: 120 } },
  { key: "collect_connections", defaultValue: true, category: "scanning", valueType: "boolean", description: "Collect network connections during scans" },

  // ── alerts ──
  { key: "version_check_interval_hours", defaultValue: 12, category: "alerts", valueType: "number", description: "How often to check for new package versions", constraints: { min: 1, max: 72 }, envVar: "VERSION_CHECK_INTERVAL_HOURS" },
  { key: "eol_check_enabled", defaultValue: true, category: "alerts", valueType: "boolean", description: "Enable end-of-life checking" },
  { key: "eol_warning_days", defaultValue: 90, category: "alerts", valueType: "number", description: "Days before EOL to start warning", constraints: { min: 7, max: 365 } },
  { key: "severity_critical_cve_threshold", defaultValue: 5, category: "alerts", valueType: "number", description: "CVE count for critical severity", constraints: { min: 1, max: 50 } },
  { key: "severity_high_cve_threshold", defaultValue: 1, category: "alerts", valueType: "number", description: "CVE count for high severity", constraints: { min: 1, max: 50 } },

  // ── notifications ──
  { key: "daily_digest_enabled", defaultValue: true, category: "notifications", valueType: "boolean", description: "Enable daily alert digest" },
  { key: "daily_digest_time", defaultValue: "08:00", category: "notifications", valueType: "string", description: "Time to send daily digest (HH:MM)", constraints: { pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" }, envVar: "ALERT_DIGEST_HOUR" },
  { key: "notification_rate_limit_seconds", defaultValue: 5, category: "notifications", valueType: "number", description: "Min seconds between messages to same channel", constraints: { min: 1, max: 60 } },
  { key: "notification_dedup_hours", defaultValue: 1, category: "notifications", valueType: "number", description: "Hours to dedup identical notifications", constraints: { min: 0, max: 24 } },
  { key: "smtp_host", defaultValue: "", category: "notifications", valueType: "string", description: "SMTP server hostname", envVar: "SMTP_HOST" },
  { key: "smtp_port", defaultValue: 587, category: "notifications", valueType: "number", description: "SMTP server port", constraints: { min: 1, max: 65535 }, envVar: "SMTP_PORT" },
  { key: "smtp_user", defaultValue: "", category: "notifications", valueType: "string", description: "SMTP username", envVar: "SMTP_USER" },
  { key: "smtp_password", defaultValue: "", category: "notifications", valueType: "string", description: "SMTP password", encrypted: true, envVar: "SMTP_PASS" },
  { key: "smtp_from_address", defaultValue: "infrawatch@localhost", category: "notifications", valueType: "email", description: "From address for emails" },
  { key: "smtp_tls", defaultValue: true, category: "notifications", valueType: "boolean", description: "Use TLS for SMTP" },

  // ── reports ──
  { key: "report_retention_days", defaultValue: 90, category: "reports", valueType: "number", description: "Days to keep generated reports", constraints: { min: 0, max: 365 } },
  { key: "report_company_name", defaultValue: "", category: "reports", valueType: "string", description: "Company name on reports", constraints: { maxLength: 100 } },
  { key: "report_footer_text", defaultValue: "Generated by InfraWatch", category: "reports", valueType: "string", description: "Footer text on reports", constraints: { maxLength: 200 } },

  // ── security ──
  { key: "session_duration_hours", defaultValue: 8, category: "security", valueType: "number", description: "Session absolute expiry (hours)", constraints: { min: 1, max: 72 } },
  { key: "session_idle_timeout_hours", defaultValue: 2, category: "security", valueType: "number", description: "Session idle timeout (hours)", constraints: { min: 1, max: 24 } },
  { key: "max_concurrent_sessions", defaultValue: 5, category: "security", valueType: "number", description: "Max active sessions per user", constraints: { min: 1, max: 20 } },
  { key: "password_min_length", defaultValue: 10, category: "security", valueType: "number", description: "Minimum password length", constraints: { min: 8, max: 128 } },
  { key: "failed_login_lock_threshold", defaultValue: 5, category: "security", valueType: "number", description: "Failed logins before account lock", constraints: { min: 3, max: 20 } },
  { key: "failed_login_lock_minutes", defaultValue: 15, category: "security", valueType: "number", description: "Lock duration after failed logins (minutes)", constraints: { min: 1, max: 1440 } },
  { key: "api_rate_limit_per_minute", defaultValue: 100, category: "security", valueType: "number", description: "API requests per minute per IP", constraints: { min: 10, max: 1000 } },

  // ── agents ──
  { key: "agent_latest_version", defaultValue: "1.0.0", category: "agents", valueType: "string", description: "Latest agent version (agents compare against this)", constraints: { maxLength: 20, pattern: "^\\d+\\.\\d+\\.\\d+$" } },
  { key: "agent_auto_update_enabled", defaultValue: true, category: "agents", valueType: "boolean", description: "Allow agents to self-update when a new version is available" },
  { key: "agent_stale_threshold_hours", defaultValue: 12, category: "agents", valueType: "number", description: "Hours before an agent-reported host is considered stale", constraints: { min: 1, max: 168 } },
  { key: "agent_offline_alert_hours", defaultValue: 48, category: "agents", valueType: "number", description: "Hours before an offline agent triggers a notification", constraints: { min: 6, max: 336 } },

  // ── maintenance ──
  { key: "change_retention_days", defaultValue: 90, category: "maintenance", valueType: "number", description: "Days to keep change events", constraints: { min: 0, max: 365 } },
  { key: "audit_log_retention_days", defaultValue: 365, category: "maintenance", valueType: "number", description: "Days to keep audit log entries", constraints: { min: 30, max: 730 } },
  { key: "notification_log_retention_days", defaultValue: 30, category: "maintenance", valueType: "number", description: "Days to keep notification log", constraints: { min: 7, max: 365 } },
  { key: "scan_log_retention_days", defaultValue: 90, category: "maintenance", valueType: "number", description: "Days to keep scan log entries", constraints: { min: 7, max: 365 } },
  { key: "removed_package_cleanup_days", defaultValue: 30, category: "maintenance", valueType: "number", description: "Days before cleaning up removed packages", constraints: { min: 7, max: 90 } },
  { key: "stale_connection_cleanup_days", defaultValue: 7, category: "maintenance", valueType: "number", description: "Days before cleaning up stale connections", constraints: { min: 1, max: 30 } },
];

// Build a lookup map
const DEFINITIONS_MAP = new Map<string, SettingDefinition>(
  SETTING_DEFINITIONS.map((d) => [d.key, d]),
);

// Env var lookup helpers
const ENV_OVERRIDES: Record<string, () => string | undefined> = {};
for (const def of SETTING_DEFINITIONS) {
  if (def.envVar) {
    ENV_OVERRIDES[def.key] = () => process.env[def.envVar!];
  }
}

// ─── SettingsService ───

export class SettingsService {
  private cache = new Map<string, unknown>();
  private loaded = false;

  constructor(
    private pool: pg.Pool,
    private logger: Logger,
  ) {}

  /** Load all settings from DB into memory. Call once on startup. */
  async load(): Promise<void> {
    const result = await this.pool.query<{
      key: string;
      value: unknown;
      value_type: string;
    }>("SELECT key, value, value_type FROM system_settings");

    for (const row of result.rows) {
      const def = DEFINITIONS_MAP.get(row.key);
      let val = row.value;

      // Decrypt encrypted settings
      if (def?.encrypted && typeof val === "string" && val.length > 0 && config.masterKey) {
        try {
          const decrypted = decrypt(val, config.masterKey) as { v: string };
          val = decrypted.v;
        } catch {
          this.logger.warn({ key: row.key }, "Failed to decrypt setting, using empty string");
          val = "";
        }
      }

      this.cache.set(row.key, val);
    }

    this.loaded = true;
    this.logger.info({ count: result.rows.length }, "Settings loaded from database");
  }

  /** Seed settings that don't exist yet. Call on first run after migrations. */
  async seed(): Promise<void> {
    let seeded = 0;
    for (const def of SETTING_DEFINITIONS) {
      const existing = await this.pool.query(
        "SELECT 1 FROM system_settings WHERE key = $1",
        [def.key],
      );
      if (existing.rows.length > 0) continue;

      let storedValue: unknown = def.defaultValue;

      // For encrypted fields, encrypt the default
      if (def.encrypted && typeof storedValue === "string" && storedValue.length > 0 && config.masterKey) {
        storedValue = encrypt({ v: storedValue }, config.masterKey);
      }

      await this.pool.query(
        `INSERT INTO system_settings (key, value, description, category, value_type, constraints)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (key) DO NOTHING`,
        [
          def.key,
          JSON.stringify(storedValue),
          def.description,
          def.category,
          def.valueType,
          JSON.stringify(def.constraints ?? {}),
        ],
      );
      seeded++;
    }

    if (seeded > 0) {
      this.logger.info({ seeded }, "Seeded default settings");
    }

    // Reload cache after seeding
    await this.load();
  }

  /**
   * Get a setting value. Priority: DB cache > env var > hardcoded default.
   */
  get<T = unknown>(key: string): T {
    // 1. DB cache
    if (this.cache.has(key)) {
      return this.cache.get(key) as T;
    }

    const def = DEFINITIONS_MAP.get(key);

    // 2. Env var override
    const envFn = ENV_OVERRIDES[key];
    if (envFn) {
      const envVal = envFn();
      if (envVal !== undefined && envVal !== "") {
        return this.coerce(envVal, def?.valueType ?? "string") as T;
      }
    }

    // 3. Hardcoded default
    if (def) {
      return def.defaultValue as T;
    }

    return undefined as T;
  }

  /** Get all settings, optionally grouped by category. */
  getAll(category?: string): Record<string, Record<string, unknown>> {
    const grouped: Record<string, Record<string, unknown>> = {};

    for (const def of SETTING_DEFINITIONS) {
      if (category && def.category !== category) continue;

      if (!grouped[def.category]) {
        grouped[def.category] = {};
      }

      let val = this.get(def.key);

      // Mask encrypted values
      if (def.encrypted) {
        val = (typeof val === "string" && val.length > 0) ? "********" : "";
      }

      grouped[def.category][def.key] = val;
    }

    return grouped;
  }

  /** Get full definitions with current values (for admin UI). */
  getAllWithDefinitions(category?: string): Record<string, Array<{
    key: string;
    value: unknown;
    description: string;
    valueType: string;
    constraints?: SettingDefinition["constraints"];
  }>> {
    const grouped: Record<string, Array<{
      key: string;
      value: unknown;
      description: string;
      valueType: string;
      constraints?: SettingDefinition["constraints"];
    }>> = {};

    for (const def of SETTING_DEFINITIONS) {
      if (category && def.category !== category) continue;

      if (!grouped[def.category]) {
        grouped[def.category] = [];
      }

      let val = this.get(def.key);
      if (def.encrypted) {
        val = (typeof val === "string" && val.length > 0) ? "********" : "";
      }

      grouped[def.category].push({
        key: def.key,
        value: val,
        description: def.description,
        valueType: def.valueType,
        constraints: def.constraints,
      });
    }

    return grouped;
  }

  /**
   * Update a single setting. Validates, persists, refreshes cache.
   * Returns { oldValue, newValue }.
   */
  async update(
    key: string,
    value: unknown,
    userId: string,
  ): Promise<{ oldValue: unknown; newValue: unknown }> {
    const def = DEFINITIONS_MAP.get(key);
    if (!def) {
      throw new SettingsError(`Unknown setting: ${key}`);
    }

    this.validate(def, value);

    const oldValue = this.get(key);
    let storedValue = value;

    // Encrypt if needed
    if (def.encrypted && typeof value === "string" && value.length > 0) {
      if (!config.masterKey) throw new SettingsError("MASTER_KEY not configured");
      storedValue = encrypt({ v: value }, config.masterKey);
    }

    await this.pool.query(
      `INSERT INTO system_settings (key, value, description, category, value_type, constraints, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW(), updated_by = $7`,
      [
        key,
        JSON.stringify(storedValue),
        def.description,
        def.category,
        def.valueType,
        JSON.stringify(def.constraints ?? {}),
        userId,
      ],
    );

    // Update cache with unencrypted value
    this.cache.set(key, value);

    return { oldValue: def.encrypted ? undefined : oldValue, newValue: def.encrypted ? "[encrypted]" : value };
  }

  /**
   * Update multiple settings at once. Returns changes array.
   */
  async bulkUpdate(
    updates: Record<string, unknown>,
    userId: string,
  ): Promise<Array<{ key: string; oldValue: unknown; newValue: unknown }>> {
    const changes: Array<{ key: string; oldValue: unknown; newValue: unknown }> = [];

    for (const [key, value] of Object.entries(updates)) {
      const change = await this.update(key, value, userId);
      changes.push({ key, ...change });
    }

    return changes;
  }

  /** Get the definition for a key. */
  getDefinition(key: string): SettingDefinition | undefined {
    return DEFINITIONS_MAP.get(key);
  }

  // ─── Validation ───

  private validate(def: SettingDefinition, value: unknown): void {
    const { key, valueType, constraints } = def;

    switch (valueType) {
      case "number": {
        if (typeof value !== "number" || !Number.isFinite(value)) {
          throw new SettingsError(`${key} must be a number`);
        }
        if (constraints?.min !== undefined && value < constraints.min) {
          throw new SettingsError(`${key} must be at least ${constraints.min}`);
        }
        if (constraints?.max !== undefined && value > constraints.max) {
          throw new SettingsError(`${key} must be at most ${constraints.max}`);
        }
        break;
      }
      case "boolean": {
        if (typeof value !== "boolean") {
          throw new SettingsError(`${key} must be a boolean`);
        }
        break;
      }
      case "string": {
        if (typeof value !== "string") {
          throw new SettingsError(`${key} must be a string`);
        }
        if (constraints?.maxLength && value.length > constraints.maxLength) {
          throw new SettingsError(`${key} must be at most ${constraints.maxLength} characters`);
        }
        if (constraints?.pattern && !new RegExp(constraints.pattern).test(value)) {
          throw new SettingsError(`${key} has invalid format`);
        }
        break;
      }
      case "email": {
        if (typeof value !== "string") {
          throw new SettingsError(`${key} must be a string`);
        }
        if (value.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          throw new SettingsError(`${key} must be a valid email address`);
        }
        break;
      }
      case "select": {
        if (typeof value !== "string") {
          throw new SettingsError(`${key} must be a string`);
        }
        if (constraints?.options && !constraints.options.includes(value)) {
          throw new SettingsError(`${key} must be one of: ${constraints.options.join(", ")}`);
        }
        break;
      }
    }
  }

  private coerce(envVal: string, valueType: string): unknown {
    switch (valueType) {
      case "number":
        return parseInt(envVal, 10);
      case "boolean":
        return envVal === "true" || envVal === "1";
      default:
        return envVal;
    }
  }
}

export class SettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsError";
  }
}
