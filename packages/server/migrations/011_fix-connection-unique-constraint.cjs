/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.up = (pgm) => {
  // Fix: NULL source_process breaks unique constraint (NULL != NULL in PostgreSQL).
  // Replace NULLs with empty string, add NOT NULL default, and recreate constraint.
  pgm.sql(`UPDATE host_connections SET source_process = '' WHERE source_process IS NULL`);

  pgm.alterColumn("host_connections", "source_process", {
    notNull: true,
    default: "''",
  });

  pgm.dropConstraint("host_connections", "host_connections_unique");
  pgm.addConstraint("host_connections", "host_connections_unique", {
    unique: ["source_host_id", "target_ip", "target_port", "source_process"],
  });
};

/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.down = (pgm) => {
  pgm.dropConstraint("host_connections", "host_connections_unique");
  pgm.alterColumn("host_connections", "source_process", {
    notNull: false,
    default: null,
  });
  pgm.addConstraint("host_connections", "host_connections_unique", {
    unique: ["source_host_id", "target_ip", "target_port", "source_process"],
  });
};
