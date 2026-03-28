/** @type {import('node-pg-migrate').ColumnDefinitions} */

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  // ─── 1. change_events ───
  pgm.createTable("change_events", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    host_id: {
      type: "uuid",
      references: "hosts",
      onDelete: "CASCADE",
    },
    hostname: { type: "varchar(255)", notNull: true },
    event_type: { type: "varchar(50)", notNull: true },
    category: { type: "varchar(30)", notNull: true },
    summary: { type: "text", notNull: true },
    details: { type: "jsonb", default: pgm.func("'{}'::jsonb") },
    scan_target_id: {
      type: "uuid",
      references: "scan_targets",
      onDelete: "SET NULL",
    },
    created_at: { type: "timestamptz", default: pgm.func("NOW()") },
  });

  pgm.addConstraint("change_events", "change_events_event_type_check", {
    check:
      "event_type IN ('host_discovered','host_disappeared','package_added','package_removed','package_updated','service_added','service_removed','service_changed','os_changed','ip_changed')",
  });

  pgm.addConstraint("change_events", "change_events_category_check", {
    check: "category IN ('host','package','service','config')",
  });

  pgm.createIndex("change_events", "created_at", { name: "idx_change_events_created_at" });
  pgm.createIndex("change_events", "host_id", { name: "idx_change_events_host_id" });
  pgm.createIndex("change_events", "event_type", { name: "idx_change_events_event_type" });
  pgm.createIndex("change_events", "category", { name: "idx_change_events_category" });

  // ─── 2. change_snapshots ───
  pgm.createTable("change_snapshots", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    snapshot_date: { type: "date", notNull: true, unique: true },
    total_hosts: { type: "integer", notNull: true, default: 0 },
    active_hosts: { type: "integer", notNull: true, default: 0 },
    total_packages: { type: "integer", notNull: true, default: 0 },
    total_services: { type: "integer", notNull: true, default: 0 },
    total_alerts: { type: "integer", notNull: true, default: 0 },
    critical_alerts: { type: "integer", notNull: true, default: 0 },
    created_at: { type: "timestamptz", default: pgm.func("NOW()") },
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable("change_snapshots");
  pgm.dropTable("change_events");
};
