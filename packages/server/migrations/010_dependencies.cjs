/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.up = (pgm) => {
  // Host connections (observed TCP connections between hosts)
  pgm.createTable("host_connections", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    source_host_id: {
      type: "uuid",
      notNull: true,
      references: '"hosts"',
      onDelete: "CASCADE",
    },
    target_host_id: {
      type: "uuid",
      references: '"hosts"',
      onDelete: "SET NULL",
    },
    target_ip: { type: "varchar(45)", notNull: true },
    target_port: { type: "integer", notNull: true },
    source_process: { type: "varchar(255)" },
    target_service: { type: "varchar(255)" },
    connection_type: {
      type: "varchar(20)",
      notNull: true,
      default: "observed",
      check: "connection_type IN ('observed','inferred')",
    },
    first_seen_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    last_seen_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.addConstraint("host_connections", "host_connections_unique", {
    unique: ["source_host_id", "target_ip", "target_port", "source_process"],
  });

  pgm.createIndex("host_connections", "source_host_id");
  pgm.createIndex("host_connections", "target_host_id");
  pgm.createIndex("host_connections", "target_port");

  // Dependency annotations (manual labels for host-to-host dependencies)
  pgm.createTable("dependency_annotations", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    source_host_id: {
      type: "uuid",
      notNull: true,
      references: '"hosts"',
      onDelete: "CASCADE",
    },
    target_host_id: {
      type: "uuid",
      notNull: true,
      references: '"hosts"',
      onDelete: "CASCADE",
    },
    label: { type: "varchar(255)", notNull: true },
    notes: { type: "text" },
    created_by: { type: "varchar(255)" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.addConstraint("dependency_annotations", "dependency_annotations_unique", {
    unique: ["source_host_id", "target_host_id"],
  });
};

/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.down = (pgm) => {
  pgm.dropTable("dependency_annotations");
  pgm.dropTable("host_connections");
};
