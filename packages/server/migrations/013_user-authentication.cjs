/**
 * Migration: User authentication tables
 * - users, sessions, audit_log, system_settings
 */

/** @type {import("node-pg-migrate").ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/** @param pgm {import("node-pg-migrate").MigrationBuilder} */
exports.up = (pgm) => {
  // ─── users ───
  pgm.createTable("users", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    username: {
      type: "varchar(100)",
      notNull: true,
      unique: true,
    },
    email: {
      type: "varchar(255)",
      notNull: true,
      unique: true,
    },
    password_hash: {
      type: "varchar(255)",
      notNull: true,
    },
    display_name: {
      type: "varchar(255)",
    },
    role: {
      type: "varchar(20)",
      notNull: true,
      default: "operator",
      check: "role IN ('admin', 'operator')",
    },
    is_active: {
      type: "boolean",
      default: true,
    },
    force_password_change: {
      type: "boolean",
      default: false,
    },
    last_login_at: {
      type: "timestamptz",
    },
    login_count: {
      type: "integer",
      default: 0,
    },
    failed_login_attempts: {
      type: "integer",
      default: 0,
    },
    locked_until: {
      type: "timestamptz",
    },
    password_changed_at: {
      type: "timestamptz",
      default: pgm.func("NOW()"),
    },
    created_by: {
      type: "uuid",
      references: "users(id)",
      onDelete: "SET NULL",
    },
    created_at: {
      type: "timestamptz",
      default: pgm.func("NOW()"),
    },
    updated_at: {
      type: "timestamptz",
      default: pgm.func("NOW()"),
    },
  });

  // ─── sessions ───
  pgm.createTable("sessions", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(id)",
      onDelete: "CASCADE",
    },
    token_hash: {
      type: "varchar(255)",
      notNull: true,
      unique: true,
    },
    ip_address: {
      type: "varchar(45)",
    },
    user_agent: {
      type: "text",
    },
    expires_at: {
      type: "timestamptz",
      notNull: true,
    },
    created_at: {
      type: "timestamptz",
      default: pgm.func("NOW()"),
    },
    last_activity_at: {
      type: "timestamptz",
      default: pgm.func("NOW()"),
    },
  });

  pgm.createIndex("sessions", "token_hash");
  pgm.createIndex("sessions", "user_id");
  pgm.createIndex("sessions", "expires_at");

  // ─── audit_log ───
  pgm.createTable("audit_log", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    user_id: {
      type: "uuid",
      references: "users(id)",
      onDelete: "SET NULL",
    },
    username: {
      type: "varchar(100)",
      notNull: true,
    },
    action: {
      type: "varchar(100)",
      notNull: true,
    },
    entity_type: {
      type: "varchar(50)",
    },
    entity_id: {
      type: "uuid",
    },
    details: {
      type: "jsonb",
      default: pgm.func("'{}'::jsonb"),
    },
    ip_address: {
      type: "varchar(45)",
    },
    created_at: {
      type: "timestamptz",
      default: pgm.func("NOW()"),
    },
  });

  pgm.createIndex("audit_log", "created_at", { method: "btree", name: "idx_audit_log_created_at" });
  pgm.createIndex("audit_log", "user_id", { name: "idx_audit_log_user_id" });
  pgm.createIndex("audit_log", "action", { name: "idx_audit_log_action" });
  pgm.createIndex("audit_log", "entity_type", { name: "idx_audit_log_entity_type" });

  // ─── system_settings ───
  pgm.createTable("system_settings", {
    key: {
      type: "varchar(100)",
      primaryKey: true,
    },
    value: {
      type: "jsonb",
      notNull: true,
    },
    description: {
      type: "text",
    },
    category: {
      type: "varchar(50)",
      notNull: true,
    },
    value_type: {
      type: "varchar(20)",
      notNull: true,
      check: "value_type IN ('string', 'number', 'boolean', 'email', 'cron', 'select')",
    },
    constraints: {
      type: "jsonb",
    },
    updated_at: {
      type: "timestamptz",
      default: pgm.func("NOW()"),
    },
    updated_by: {
      type: "uuid",
      references: "users(id)",
      onDelete: "SET NULL",
    },
  });
};

/** @param pgm {import("node-pg-migrate").MigrationBuilder} */
exports.down = (pgm) => {
  pgm.dropTable("system_settings");
  pgm.dropTable("audit_log");
  pgm.dropTable("sessions");
  pgm.dropTable("users");
};
