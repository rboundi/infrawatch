/**
 * Add unique constraint on (host_id, service_name) to services table
 * so we can upsert services during data ingestion.
 *
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = (pgm) => {
  pgm.createIndex("services", ["host_id", "service_name"], {
    unique: true,
    name: "services_host_service_unique",
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = (pgm) => {
  pgm.dropIndex("services", ["host_id", "service_name"], {
    name: "services_host_service_unique",
  });
};
