/** @type {import('node-pg-migrate').ColumnDefinitions} */

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  // ─── 1. scan_targets ───
  pgm.createTable("scan_targets", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    name: { type: "varchar(255)", notNull: true },
    type: { type: "varchar(50)", notNull: true },
    connection_config: { type: "jsonb", notNull: true },
    scan_interval_hours: { type: "integer", default: 6 },
    last_scanned_at: { type: "timestamptz" },
    last_scan_status: { type: "varchar(20)", default: "'pending'" },
    last_scan_error: { type: "text" },
    enabled: { type: "boolean", default: true },
    created_at: { type: "timestamptz", default: pgm.func("NOW()") },
    updated_at: { type: "timestamptz", default: pgm.func("NOW()") },
  });

  pgm.addConstraint("scan_targets", "scan_targets_type_check", {
    check: "type IN ('ssh_linux','winrm','kubernetes','aws','vmware','docker')",
  });

  pgm.addConstraint("scan_targets", "scan_targets_last_scan_status_check", {
    check:
      "last_scan_status IN ('pending','running','success','failed')",
  });

  // ─── 2. hosts ───
  pgm.createTable("hosts", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    scan_target_id: {
      type: "uuid",
      references: "scan_targets(id)",
      onDelete: "SET NULL",
    },
    hostname: { type: "varchar(255)", notNull: true },
    ip_address: { type: "varchar(45)" },
    os: { type: "varchar(100)" },
    os_version: { type: "varchar(100)" },
    architecture: { type: "varchar(50)" },
    environment_tag: { type: "varchar(100)" },
    last_seen_at: { type: "timestamptz", default: pgm.func("NOW()") },
    first_seen_at: { type: "timestamptz", default: pgm.func("NOW()") },
    status: { type: "varchar(20)", default: "'active'" },
    metadata: { type: "jsonb", default: pgm.func("'{}'::jsonb") },
  });

  pgm.addConstraint("hosts", "hosts_status_check", {
    check: "status IN ('active','stale','decommissioned')",
  });

  pgm.addConstraint("hosts", "hosts_hostname_scan_target_unique", {
    unique: ["hostname", "scan_target_id"],
  });

  pgm.createIndex("hosts", "hostname");
  pgm.createIndex("hosts", "scan_target_id");
  pgm.createIndex("hosts", "status");
  pgm.createIndex("hosts", "last_seen_at");

  // ─── 3. discovered_packages ───
  pgm.createTable("discovered_packages", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    host_id: {
      type: "uuid",
      notNull: true,
      references: "hosts(id)",
      onDelete: "CASCADE",
    },
    package_name: { type: "varchar(500)", notNull: true },
    installed_version: { type: "varchar(200)" },
    package_manager: { type: "varchar(50)" },
    ecosystem: { type: "varchar(50)" },
    first_detected_at: { type: "timestamptz", default: pgm.func("NOW()") },
    last_detected_at: { type: "timestamptz", default: pgm.func("NOW()") },
    removed_at: { type: "timestamptz" },
  });

  pgm.createIndex(
    "discovered_packages",
    ["host_id", "package_name", "package_manager"],
    {
      unique: true,
      where: "removed_at IS NULL",
      name: "discovered_packages_active_unique",
    }
  );

  pgm.createIndex("discovered_packages", "host_id");
  pgm.createIndex("discovered_packages", "package_name");
  pgm.createIndex("discovered_packages", "ecosystem");

  // ─── 4. services ───
  pgm.createTable("services", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    host_id: {
      type: "uuid",
      notNull: true,
      references: "hosts(id)",
      onDelete: "CASCADE",
    },
    service_name: { type: "varchar(255)", notNull: true },
    service_type: { type: "varchar(50)" },
    version: { type: "varchar(200)" },
    port: { type: "integer" },
    status: { type: "varchar(20)", default: "'unknown'" },
    detected_at: { type: "timestamptz", default: pgm.func("NOW()") },
    last_seen_at: { type: "timestamptz", default: pgm.func("NOW()") },
  });

  // ─── 5. known_latest_versions ───
  pgm.createTable("known_latest_versions", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    package_name: { type: "varchar(500)", notNull: true },
    ecosystem: { type: "varchar(50)", notNull: true },
    latest_version: { type: "varchar(200)" },
    latest_checked_at: { type: "timestamptz", default: pgm.func("NOW()") },
    cve_ids: { type: "text[]", default: pgm.func("ARRAY[]::text[]") },
    cve_count: { type: "integer", default: 0 },
    source_url: { type: "text" },
  });

  pgm.addConstraint(
    "known_latest_versions",
    "known_latest_versions_pkg_eco_unique",
    { unique: ["package_name", "ecosystem"] }
  );

  pgm.createIndex("known_latest_versions", ["package_name", "ecosystem"]);

  // ─── 6. alerts ───
  pgm.createTable("alerts", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    host_id: {
      type: "uuid",
      notNull: true,
      references: "hosts(id)",
      onDelete: "CASCADE",
    },
    package_id: {
      type: "uuid",
      references: "discovered_packages(id)",
      onDelete: "SET NULL",
    },
    package_name: { type: "varchar(500)", notNull: true },
    current_version: { type: "varchar(200)" },
    available_version: { type: "varchar(200)" },
    severity: { type: "varchar(20)", notNull: true },
    acknowledged: { type: "boolean", default: false },
    acknowledged_at: { type: "timestamptz" },
    acknowledged_by: { type: "varchar(255)" },
    notes: { type: "text" },
    created_at: { type: "timestamptz", default: pgm.func("NOW()") },
  });

  pgm.addConstraint("alerts", "alerts_severity_check", {
    check: "severity IN ('critical','high','medium','low','info')",
  });

  pgm.createIndex(
    "alerts",
    ["host_id", "package_name", "available_version"],
    {
      unique: true,
      where: "acknowledged = false",
      name: "alerts_unacknowledged_unique",
    }
  );

  pgm.createIndex("alerts", ["severity", "acknowledged"]);
  pgm.createIndex("alerts", "host_id");
  pgm.createIndex("alerts", "created_at");

  // ─── 7. scan_logs ───
  pgm.createTable("scan_logs", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    scan_target_id: {
      type: "uuid",
      references: "scan_targets(id)",
      onDelete: "CASCADE",
    },
    started_at: { type: "timestamptz", default: pgm.func("NOW()") },
    completed_at: { type: "timestamptz" },
    status: { type: "varchar(20)" },
    hosts_discovered: { type: "integer", default: 0 },
    packages_discovered: { type: "integer", default: 0 },
    error_message: { type: "text" },
  });

  pgm.addConstraint("scan_logs", "scan_logs_status_check", {
    check: "status IN ('running','success','failed')",
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropTable("scan_logs", { cascade: true });
  pgm.dropTable("alerts", { cascade: true });
  pgm.dropTable("known_latest_versions", { cascade: true });
  pgm.dropTable("services", { cascade: true });
  pgm.dropTable("discovered_packages", { cascade: true });
  pgm.dropTable("hosts", { cascade: true });
  pgm.dropTable("scan_targets", { cascade: true });
};
