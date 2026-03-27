import express from "express";
import pg from "pg";
import pino from "pino";
import { pinoHttp } from "pino-http";
import { config } from "./config.js";

const logger = pino({ level: config.nodeEnv === "test" ? "silent" : "info" });

const pool = new pg.Pool(config.db);

const app = express();

app.use(pinoHttp({ logger }));
app.use(express.json());

app.get("/api/v1/health", async (_req, res) => {
  let dbStatus = "ok";
  try {
    await pool.query("SELECT 1");
  } catch {
    dbStatus = "unreachable";
  }

  res.json({
    status: dbStatus === "ok" ? "healthy" : "degraded",
    db: dbStatus,
    timestamp: new Date().toISOString(),
    version: "0.1.0",
  });
});

app.listen(config.port, () => {
  logger.info(`Server listening on port ${config.port}`);
});

export { app, pool };
