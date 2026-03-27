/**
 * Network discovery migration
 * Adds network_discovery scan target type, new host columns, and
 * network_discovery_results table.
 */

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  // 1. Extend scan_targets type check to include 'network_discovery'
  pgm.sql(`ALTER TABLE scan_targets DROP CONSTRAINT scan_targets_type_check`);
  pgm.sql(
    `ALTER TABLE scan_targets ADD CONSTRAINT scan_targets_type_check CHECK (type IN ('ssh_linux','winrm','kubernetes','aws','vmware','docker','network_discovery'))`
  );

  // 2. Add new columns to hosts
  pgm.addColumns("hosts", {
    mac_address: { type: "varchar(17)" },
    mac_vendor: { type: "varchar(255)" },
    detected_platform: { type: "varchar(50)" },
    discovery_method: { type: "varchar(50)", default: "scanner" },
    open_ports: {
      type: "integer[]",
      default: pgm.func("ARRAY[]::integer[]"),
    },
  });

  // 3. Create network_discovery_results table
  pgm.createTable("network_discovery_results", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    scan_target_id: {
      type: "uuid",
      notNull: true,
      references: "scan_targets",
      onDelete: "CASCADE",
    },
    scan_log_id: {
      type: "uuid",
      references: "scan_logs",
      onDelete: "SET NULL",
    },
    ip_address: { type: "varchar(45)", notNull: true },
    hostname: { type: "varchar(255)" },
    mac_address: { type: "varchar(17)" },
    mac_vendor: { type: "varchar(255)" },
    os_match: { type: "varchar(255)" },
    os_accuracy: { type: "integer" },
    open_ports: { type: "jsonb", default: pgm.func("'[]'::jsonb") },
    detected_platform: { type: "varchar(50)" },
    auto_promoted: { type: "boolean", default: false },
    dismissed: { type: "boolean", default: false },
    created_at: {
      type: "timestamptz",
      default: pgm.func("NOW()"),
    },
  });

  pgm.createIndex("network_discovery_results", ["scan_target_id", "ip_address"]);
  pgm.createIndex("network_discovery_results", "detected_platform");
  pgm.createIndex("network_discovery_results", "created_at");
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropTable("network_discovery_results");

  pgm.dropColumns("hosts", [
    "mac_address",
    "mac_vendor",
    "detected_platform",
    "discovery_method",
    "open_ports",
  ]);

  pgm.sql(`ALTER TABLE scan_targets DROP CONSTRAINT scan_targets_type_check`);
  pgm.sql(
    `ALTER TABLE scan_targets ADD CONSTRAINT scan_targets_type_check CHECK (type IN ('ssh_linux','winrm','kubernetes','aws','vmware','docker'))`
  );
};
