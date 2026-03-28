/** @type {import("node-pg-migrate").ColumnDefinitions} */

/**
 * Migration 008: Notification channels and log
 */
exports.up = (pgm) => {
  // ── notification_channels ──
  pgm.createTable("notification_channels", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    name: { type: "varchar(255)", notNull: true },
    channel_type: {
      type: "varchar(30)",
      notNull: true,
      check: "channel_type IN ('ms_teams','slack','generic_webhook','email')",
    },
    webhook_url: { type: "text" },
    config: { type: "jsonb", notNull: true, default: pgm.func("'{}'::jsonb") },
    filters: { type: "jsonb", notNull: true, default: pgm.func("'{}'::jsonb") },
    enabled: { type: "boolean", notNull: true, default: true },
    last_sent_at: { type: "timestamptz" },
    last_status: { type: "varchar(20)" },
    last_error: { type: "text" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("NOW()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("NOW()") },
  });

  // ── notification_log ──
  pgm.createTable("notification_log", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    channel_id: {
      type: "uuid",
      notNull: true,
      references: "notification_channels",
      onDelete: "CASCADE",
    },
    event_type: { type: "varchar(50)", notNull: true },
    payload: { type: "jsonb", notNull: true, default: pgm.func("'{}'::jsonb") },
    status: {
      type: "varchar(20)",
      notNull: true,
      check: "status IN ('sent','failed','throttled')",
    },
    error_message: { type: "text" },
    response_code: { type: "integer" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("NOW()") },
  });

  pgm.createIndex("notification_log", ["channel_id", { name: "created_at", sort: "DESC" }]);
};

/**
 * @param {import("node-pg-migrate").MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable("notification_log");
  pgm.dropTable("notification_channels");
};
