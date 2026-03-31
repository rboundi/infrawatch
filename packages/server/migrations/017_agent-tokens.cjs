/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  // ─── agent_tokens table ───
  pgm.createTable("agent_tokens", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    token_hash: {
      type: "varchar(255)",
      notNull: true,
      unique: true,
    },
    name: {
      type: "varchar(255)",
      notNull: true,
    },
    description: {
      type: "text",
    },
    scope: {
      type: "varchar(20)",
      default: "single",
    },
    allowed_hostnames: {
      type: "text[]",
      default: pgm.func("ARRAY[]::text[]"),
    },
    locked_hostname: {
      type: "varchar(255)",
    },
    environment_tag: {
      type: "varchar(100)",
    },
    host_group_ids: {
      type: "uuid[]",
      default: pgm.func("ARRAY[]::uuid[]"),
    },
    is_active: {
      type: "boolean",
      default: true,
    },
    last_used_at: {
      type: "timestamptz",
    },
    last_used_ip: {
      type: "varchar(45)",
    },
    report_count: {
      type: "integer",
      default: 0,
    },
    created_by: {
      type: "uuid",
      references: '"users"',
      onDelete: "SET NULL",
    },
    created_at: {
      type: "timestamptz",
      default: pgm.func("NOW()"),
    },
    expires_at: {
      type: "timestamptz",
    },
  });

  pgm.addConstraint("agent_tokens", "agent_tokens_scope_check", {
    check: "scope IN ('single', 'fleet')",
  });

  pgm.createIndex("agent_tokens", "token_hash");
  pgm.createIndex("agent_tokens", "is_active");

  // ─── Add agent columns to hosts table ───
  pgm.addColumns("hosts", {
    reporting_method: {
      type: "varchar(20)",
      default: "scanner",
    },
    agent_token_id: {
      type: "uuid",
      references: '"agent_tokens"',
      onDelete: "SET NULL",
    },
    agent_version: {
      type: "varchar(50)",
    },
    last_report_ip: {
      type: "varchar(45)",
    },
  });

  // Backfill existing rows before adding constraint
  pgm.sql(`UPDATE hosts SET reporting_method = 'scanner' WHERE reporting_method IS NULL`);

  pgm.addConstraint("hosts", "hosts_reporting_method_check", {
    check: "reporting_method IN ('scanner', 'agent', 'manual')",
  });

  // ─── Extend scan_targets type check to include 'agent' ───
  pgm.sql(`ALTER TABLE scan_targets DROP CONSTRAINT scan_targets_type_check`);
  pgm.sql(
    `ALTER TABLE scan_targets ADD CONSTRAINT scan_targets_type_check CHECK (type IN ('ssh_linux','winrm','kubernetes','aws','vmware','docker','network_discovery','agent'))`
  );
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropConstraint("hosts", "hosts_reporting_method_check");
  pgm.dropColumns("hosts", [
    "reporting_method",
    "agent_token_id",
    "agent_version",
    "last_report_ip",
  ]);
  pgm.dropTable("agent_tokens", { cascade: true });

  // Restore original type check without 'agent'
  pgm.sql(`ALTER TABLE scan_targets DROP CONSTRAINT scan_targets_type_check`);
  pgm.sql(
    `ALTER TABLE scan_targets ADD CONSTRAINT scan_targets_type_check CHECK (type IN ('ssh_linux','winrm','kubernetes','aws','vmware','docker','network_discovery'))`
  );
};
