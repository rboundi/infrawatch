/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.up = (pgm) => {
  // Fix the status column default — the original migration used "'active'" which
  // node-pg-migrate wrapped to produce DEFAULT '''active''' (literal quotes stored).
  // This caused check constraint violations when inserting without explicit status.
  pgm.alterColumn("eol_alerts", "status", {
    default: "active",
  });
};

/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.down = (pgm) => {
  // Revert to the original (broken) default
  pgm.alterColumn("eol_alerts", "status", {
    default: "'active'",
  });
};
