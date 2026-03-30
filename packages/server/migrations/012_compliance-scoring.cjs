/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.up = (pgm) => {
  pgm.createTable("compliance_scores", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    entity_type: {
      type: "varchar(20)",
      notNull: true,
      check: "entity_type IN ('host','group','environment','fleet')",
    },
    entity_id: { type: "uuid" },
    entity_name: { type: "varchar(255)" },
    score: { type: "integer", notNull: true, check: "score >= 0 AND score <= 100" },
    classification: { type: "varchar(20)", notNull: true },
    breakdown: { type: "jsonb", notNull: true, default: pgm.func("'{}'::jsonb") },
    calculated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  // Unique upsert targets
  pgm.addConstraint("compliance_scores", "compliance_scores_host_unique", {
    unique: ["entity_type", "entity_id"],
  });
  pgm.sql(
    `CREATE UNIQUE INDEX compliance_scores_name_unique ON compliance_scores (entity_type, entity_name) WHERE entity_id IS NULL`
  );
  pgm.createIndex("compliance_scores", ["entity_type", "score"]);

  pgm.createTable("compliance_score_history", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    entity_type: { type: "varchar(20)", notNull: true },
    entity_id: { type: "uuid" },
    entity_name: { type: "varchar(255)" },
    score: { type: "integer", notNull: true },
    classification: { type: "varchar(20)", notNull: true },
    snapshot_date: { type: "date", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.sql(
    `CREATE UNIQUE INDEX compliance_history_entity_date ON compliance_score_history (entity_type, entity_id, snapshot_date) WHERE entity_id IS NOT NULL`
  );
  pgm.sql(
    `CREATE UNIQUE INDEX compliance_history_name_date ON compliance_score_history (entity_type, entity_name, snapshot_date) WHERE entity_id IS NULL`
  );
  pgm.createIndex("compliance_score_history", ["entity_type", "entity_id", "snapshot_date"]);
};

/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.down = (pgm) => {
  pgm.dropTable("compliance_score_history");
  pgm.dropTable("compliance_scores");
};
