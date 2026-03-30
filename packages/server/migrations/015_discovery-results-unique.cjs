/**
 * Add unique constraint on (scan_target_id, ip_address) to network_discovery_results
 * so re-scans can upsert instead of creating duplicates.
 */

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.addConstraint("network_discovery_results", "network_discovery_results_target_ip", {
    unique: ["scan_target_id", "ip_address"],
  });
};

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropConstraint("network_discovery_results", "network_discovery_results_target_ip");
};
