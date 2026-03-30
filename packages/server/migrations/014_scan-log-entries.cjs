/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.up = (pgm) => {
  pgm.createTable("scan_log_entries", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    scan_log_id: {
      type: "uuid",
      notNull: true,
      references: '"scan_logs"',
      onDelete: "CASCADE",
    },
    timestamp: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("NOW()"),
    },
    level: {
      type: "varchar(10)",
      notNull: true,
      default: "'info'",
      check: "level IN ('info', 'warn', 'error', 'success')",
    },
    message: {
      type: "text",
      notNull: true,
    },
  });

  pgm.createIndex("scan_log_entries", ["scan_log_id", "timestamp"]);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.down = (pgm) => {
  pgm.dropTable("scan_log_entries");
};
