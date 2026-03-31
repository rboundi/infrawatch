/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  // Add a unique partial index on scan_targets to prevent duplicate agent
  // scan targets when concurrent agent reports arrive simultaneously.
  // This enables INSERT ... ON CONFLICT for the getOrCreateScanTarget method.
  pgm.createIndex("scan_targets", "name", {
    unique: true,
    where: "type = 'agent'",
    name: "scan_targets_agent_name_unique",
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropIndex("scan_targets", "name", {
    name: "scan_targets_agent_name_unique",
  });
};
