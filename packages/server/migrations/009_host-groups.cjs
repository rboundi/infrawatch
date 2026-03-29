/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.up = (pgm) => {
  // Host groups
  pgm.createTable("host_groups", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    name: { type: "varchar(255)", notNull: true, unique: true },
    description: { type: "text" },
    color: { type: "varchar(7)" },
    icon: { type: "varchar(50)" },
    owner_name: { type: "varchar(255)" },
    owner_email: { type: "varchar(255)" },
    notification_channel_ids: { type: "uuid[]", default: "{}" },
    alert_severity_threshold: { type: "varchar(20)", default: "info", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  // Host group rules
  pgm.createTable("host_group_rules", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    host_group_id: {
      type: "uuid",
      notNull: true,
      references: '"host_groups"',
      onDelete: "CASCADE",
    },
    rule_type: {
      type: "varchar(50)",
      notNull: true,
      check: "rule_type IN ('hostname_contains','hostname_regex','hostname_prefix','hostname_suffix','ip_range','environment_equals','os_contains','scan_target_equals','tag_equals','detected_platform_equals')",
    },
    rule_value: { type: "varchar(500)", notNull: true },
    priority: { type: "integer", default: 0, notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createIndex("host_group_rules", "host_group_id");

  // Host group members (many-to-many)
  pgm.createTable("host_group_members", {
    host_id: {
      type: "uuid",
      notNull: true,
      references: '"hosts"',
      onDelete: "CASCADE",
    },
    host_group_id: {
      type: "uuid",
      notNull: true,
      references: '"host_groups"',
      onDelete: "CASCADE",
    },
    assigned_by: {
      type: "varchar(10)",
      notNull: true,
      check: "assigned_by IN ('manual','rule')",
    },
    rule_id: {
      type: "uuid",
      references: '"host_group_rules"',
      onDelete: "SET NULL",
    },
    assigned_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.addConstraint("host_group_members", "host_group_members_pkey", {
    primaryKey: ["host_id", "host_group_id"],
  });

  pgm.createIndex("host_group_members", "host_group_id");

  // Host tags
  pgm.createTable("host_tags", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    host_id: {
      type: "uuid",
      notNull: true,
      references: '"hosts"',
      onDelete: "CASCADE",
    },
    tag_key: { type: "varchar(100)", notNull: true },
    tag_value: { type: "varchar(500)" },
  });

  pgm.addConstraint("host_tags", "host_tags_host_key_unique", {
    unique: ["host_id", "tag_key"],
  });

  pgm.createIndex("host_tags", "tag_key");
  pgm.createIndex("host_tags", ["tag_key", "tag_value"]);
};

/** @type {import('node-pg-migrate').MigrationBuilder} */
exports.down = (pgm) => {
  pgm.dropTable("host_tags");
  pgm.dropTable("host_group_members");
  pgm.dropTable("host_group_rules");
  pgm.dropTable("host_groups");
};
