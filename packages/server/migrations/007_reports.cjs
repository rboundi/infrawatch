/** @type {import('node-pg-migrate').ColumnDefinitions} */

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  // ─── 1. report_schedules ───
  pgm.createTable("report_schedules", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    name: { type: "varchar(255)", notNull: true },
    report_type: { type: "varchar(50)", notNull: true },
    schedule_cron: { type: "varchar(100)", default: "'0 8 * * 1'" },
    recipients: { type: "text[]", default: pgm.func("ARRAY[]::text[]") },
    filters: { type: "jsonb", default: pgm.func("'{}'::jsonb") },
    enabled: { type: "boolean", default: true },
    last_generated_at: { type: "timestamptz" },
    last_generation_status: { type: "varchar(20)" },
    created_at: { type: "timestamptz", default: pgm.func("NOW()") },
  });

  pgm.addConstraint("report_schedules", "report_schedules_type_check", {
    check:
      "report_type IN ('weekly_summary','eol_report','alert_report','host_inventory')",
  });

  // ─── 2. generated_reports ───
  pgm.createTable("generated_reports", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    report_schedule_id: {
      type: "uuid",
      references: "report_schedules",
      onDelete: "SET NULL",
    },
    report_type: { type: "varchar(50)", notNull: true },
    title: { type: "varchar(500)", notNull: true },
    file_path: { type: "text", notNull: true },
    file_size_bytes: { type: "bigint" },
    period_start: { type: "timestamptz" },
    period_end: { type: "timestamptz" },
    metadata: { type: "jsonb", default: pgm.func("'{}'::jsonb") },
    created_at: { type: "timestamptz", default: pgm.func("NOW()") },
  });

  pgm.createIndex("generated_reports", "created_at", {
    name: "idx_generated_reports_created_at",
    method: "btree",
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable("generated_reports");
  pgm.dropTable("report_schedules");
};
