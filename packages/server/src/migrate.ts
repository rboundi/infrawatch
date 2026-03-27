import { runner } from "node-pg-migrate";
import { config } from "./config.js";
import type { Logger } from "pino";

export async function runMigrations(logger: Logger): Promise<void> {
  const dbUrl = `postgresql://${config.db.user}:${config.db.password}@${config.db.host}:${config.db.port}/${config.db.database}`;

  logger.info("Running database migrations...");

  try {
    const migrations = await runner({
      databaseUrl: dbUrl,
      dir: new URL("../migrations", import.meta.url).pathname,
      direction: "up",
      migrationsTable: "pgmigrations",
      log: (msg: string) => logger.debug(msg),
    });

    if (migrations.length === 0) {
      logger.info("No pending migrations");
    } else {
      logger.info(
        { count: migrations.length, migrations: migrations.map((m: { name: string }) => m.name) },
        "Migrations applied successfully"
      );
    }
  } catch (err) {
    logger.error({ err }, "Migration failed");
    throw err;
  }
}
