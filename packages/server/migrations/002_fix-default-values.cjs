/**
 * Fix default values that were double-quoted in the initial migration.
 * node-pg-migrate wraps string defaults in quotes, so "'pending'" became '''pending'''.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  // scan_targets.last_scan_status
  pgm.alterColumn("scan_targets", "last_scan_status", {
    default: "pending",
  });

  // hosts.status
  pgm.alterColumn("hosts", "status", {
    default: "active",
  });

  // services.status
  pgm.alterColumn("services", "status", {
    default: "unknown",
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  // Revert to the (broken) defaults — not really useful, but keeps down() consistent
  pgm.alterColumn("scan_targets", "last_scan_status", {
    default: "'pending'",
  });
  pgm.alterColumn("hosts", "status", {
    default: "'active'",
  });
  pgm.alterColumn("services", "status", {
    default: "'unknown'",
  });
};
