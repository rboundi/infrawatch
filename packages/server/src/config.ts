export const config = {
  db: {
    host: process.env.DB_HOST ?? "localhost",
    port: parseInt(process.env.DB_PORT ?? "5432", 10),
    database: process.env.DB_NAME ?? "infrawatch",
    user: process.env.DB_USER ?? "infrawatch",
    password: process.env.DB_PASSWORD ?? "",
  },
  port: parseInt(process.env.PORT ?? "3001", 10),
  masterKey: process.env.MASTER_KEY ?? "",
  smtp: {
    host: process.env.SMTP_HOST ?? "",
    port: parseInt(process.env.SMTP_PORT ?? "587", 10),
    user: process.env.SMTP_USER ?? "",
    pass: process.env.SMTP_PASS ?? "",
  },
  alertEmail: process.env.ALERT_EMAIL ?? "",
  nodeEnv: process.env.NODE_ENV ?? "development",
  versionCheckIntervalHours: parseInt(process.env.VERSION_CHECK_INTERVAL_HOURS ?? "12", 10),
  alertDigestHour: parseInt(process.env.ALERT_DIGEST_HOUR ?? "8", 10),
} as const;
