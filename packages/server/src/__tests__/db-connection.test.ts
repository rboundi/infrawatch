import { describe, it, expect } from "vitest";
import { getTestDb } from "./setup.js";

describe("Test database connection", () => {
  it("should connect and run a query", async () => {
    const pool = getTestDb();
    const result = await pool.query("SELECT 1 AS value");
    expect(result.rows[0].value).toBe(1);
  });

  it("should have migrations applied", async () => {
    const pool = getTestDb();
    const result = await pool.query(
      "SELECT COUNT(*)::int AS count FROM pgmigrations",
    );
    expect(result.rows[0].count).toBeGreaterThan(0);
  });
});
