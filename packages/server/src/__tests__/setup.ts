import pg from "pg";
import { runner } from "node-pg-migrate";
import { beforeAll, afterEach, afterAll } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Ensure test environment has required env vars
if (!process.env.MASTER_KEY) {
  process.env.MASTER_KEY = "test-master-key-for-encryption-do-not-use-in-prod";
}
process.env.NODE_ENV = "test";

const testDbConfig = {
  host: process.env.DB_HOST_TEST ?? process.env.DB_HOST ?? "localhost",
  port: parseInt(process.env.DB_PORT_TEST ?? process.env.DB_PORT ?? "5433", 10),
  database: process.env.DB_NAME_TEST ?? "infrawatch_test",
  user: process.env.DB_USER_TEST ?? process.env.DB_USER ?? "infrawatch",
  password: process.env.DB_PASSWORD_TEST ?? process.env.DB_PASSWORD ?? "infrawatch_dev",
  max: 5,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 5_000,
};

let pool: pg.Pool;
let migrationsRun = false;

export function getTestDb(): pg.Pool {
  if (!pool) {
    throw new Error("Test DB pool not initialized — did setup run?");
  }
  return pool;
}

beforeAll(async () => {
  if (!pool) {
    pool = new pg.Pool(testDbConfig);
  }

  // Verify connectivity
  await pool.query("SELECT 1");

  // Run migrations only once across all test files
  if (!migrationsRun) {
    const dbUrl = `postgresql://${testDbConfig.user}:${testDbConfig.password}@${testDbConfig.host}:${testDbConfig.port}/${testDbConfig.database}`;
    const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../../migrations");

    await runner({
      databaseUrl: dbUrl,
      dir: migrationsDir,
      direction: "up",
      migrationsTable: "pgmigrations",
      log: () => {},
    });
    migrationsRun = true;
  }
});

afterEach(async () => {
  // Truncate all application tables (preserve migration tracking)
  await pool.query(`
    DO $$
    DECLARE
      tbl text;
    BEGIN
      FOR tbl IN
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename != 'pgmigrations'
      LOOP
        EXECUTE format('TRUNCATE TABLE %I CASCADE', tbl);
      END LOOP;
    END $$;
  `);
});

afterAll(async () => {
  if (pool) {
    await pool.end();
  }
});
