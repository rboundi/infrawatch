/** @type {import('node-pg-migrate').ColumnDefinitions} */

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  // ─── 1. eol_definitions ───
  pgm.createTable("eol_definitions", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    product_name: { type: "varchar(255)", notNull: true },
    product_category: { type: "varchar(50)", notNull: true },
    version_pattern: { type: "varchar(255)", notNull: true },
    eol_date: { type: "date", notNull: true },
    lts: { type: "boolean", default: false },
    successor_version: { type: "varchar(100)" },
    source_url: { type: "text" },
    notes: { type: "text" },
    created_at: { type: "timestamptz", default: pgm.func("NOW()") },
    updated_at: { type: "timestamptz", default: pgm.func("NOW()") },
  });

  pgm.addConstraint("eol_definitions", "eol_definitions_product_version_unique", {
    unique: ["product_name", "version_pattern"],
  });

  pgm.addConstraint("eol_definitions", "eol_definitions_category_check", {
    check:
      "product_category IN ('os','runtime','database','webserver','appserver','language','framework','container','other')",
  });

  // ─── 2. eol_alerts ───
  pgm.createTable("eol_alerts", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    host_id: {
      type: "uuid",
      notNull: true,
      references: "hosts",
      onDelete: "CASCADE",
    },
    eol_definition_id: {
      type: "uuid",
      notNull: true,
      references: "eol_definitions",
      onDelete: "CASCADE",
    },
    product_name: { type: "varchar(255)", notNull: true },
    installed_version: { type: "varchar(200)", notNull: true },
    eol_date: { type: "date", notNull: true },
    days_past_eol: { type: "integer" },
    successor_version: { type: "varchar(100)" },
    status: { type: "varchar(20)", default: "'active'" },
    acknowledged_at: { type: "timestamptz" },
    acknowledged_by: { type: "varchar(255)" },
    exemption_reason: { type: "text" },
    created_at: { type: "timestamptz", default: pgm.func("NOW()") },
  });

  pgm.addConstraint("eol_alerts", "eol_alerts_host_definition_unique", {
    unique: ["host_id", "eol_definition_id"],
  });

  pgm.addConstraint("eol_alerts", "eol_alerts_status_check", {
    check: "status IN ('active','acknowledged','exempted','resolved')",
  });

  pgm.createIndex("eol_alerts", ["status", "eol_date"], {
    name: "idx_eol_alerts_status_eol_date",
  });
  pgm.createIndex("eol_alerts", "host_id", { name: "idx_eol_alerts_host_id" });

  // Update change_events constraint to include eol_detected
  pgm.dropConstraint("change_events", "change_events_event_type_check");
  pgm.addConstraint("change_events", "change_events_event_type_check", {
    check:
      "event_type IN ('host_discovered','host_disappeared','package_added','package_removed','package_updated','service_added','service_removed','service_changed','os_changed','ip_changed','eol_detected')",
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  // Restore original constraint
  pgm.dropConstraint("change_events", "change_events_event_type_check");
  pgm.addConstraint("change_events", "change_events_event_type_check", {
    check:
      "event_type IN ('host_discovered','host_disappeared','package_added','package_removed','package_updated','service_added','service_removed','service_changed','os_changed','ip_changed')",
  });

  pgm.dropTable("eol_alerts");
  pgm.dropTable("eol_definitions");
};
