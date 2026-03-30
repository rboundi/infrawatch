import { describe, it, expect, beforeEach } from "vitest";
import supertest from "supertest";
import { getTestDb } from "./setup.js";
import { getTestApp } from "./app.js";
import { createTestUser, createTestAdmin, getAuthToken, createTestScanTarget, createTestHost } from "./helpers.js";

function request() {
  return supertest(getTestApp());
}

// ─────────────────────────────────────────────
// Login Tests
// ─────────────────────────────────────────────
describe("POST /api/v1/auth/login", () => {
  it("should login with valid credentials", async () => {
    const user = await createTestUser({ username: "alice", password: "StrongPass123" });

    const res = await request()
      .post("/api/v1/auth/login")
      .send({ username: "alice", password: "StrongPass123" })
      .expect(200);

    // User object
    expect(res.body.user).toBeDefined();
    expect(res.body.user.id).toBe(user.id);
    expect(res.body.user.username).toBe("alice");
    expect(res.body.user.email).toBe(user.email);
    expect(res.body.user.role).toBe("operator");
    expect(res.body.user).not.toHaveProperty("password_hash");
    expect(res.body.user).not.toHaveProperty("passwordHash");

    // Token & expiry
    expect(typeof res.body.token).toBe("string");
    expect(res.body.token.length).toBeGreaterThan(0);
    expect(res.body.expiresAt).toBeDefined();

    // Cookie
    const cookies = res.headers["set-cookie"];
    expect(cookies).toBeDefined();
    const sessionCookie = Array.isArray(cookies)
      ? cookies.find((c: string) => c.includes("infrawatch_session"))
      : (cookies as string);
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain("HttpOnly");
  });

  it("should fail with wrong password", async () => {
    await createTestUser({ username: "bob", password: "StrongPass123" });

    const res = await request()
      .post("/api/v1/auth/login")
      .send({ username: "bob", password: "WrongPassword1" })
      .expect(401);

    expect(res.body.error).toBe("Invalid credentials");
    // Should NOT reveal which field was wrong
    expect(res.body.error).not.toContain("password");
    expect(res.body.error).not.toContain("username");

    // failed_login_attempts incremented
    const pool = getTestDb();
    const dbUser = await pool.query("SELECT failed_login_attempts FROM users WHERE username = $1", ["bob"]);
    expect(dbUser.rows[0].failed_login_attempts).toBe(1);
  });

  it("should fail with non-existent username", async () => {
    const res = await request()
      .post("/api/v1/auth/login")
      .send({ username: "ghost_user", password: "SomePass123" })
      .expect(401);

    // Same generic error — no user enumeration
    expect(res.body.error).toBe("Invalid credentials");
  });

  it("should fail with inactive user", async () => {
    await createTestUser({ username: "disabled_user", password: "StrongPass123", isActive: false });

    const res = await request()
      .post("/api/v1/auth/login")
      .send({ username: "disabled_user", password: "StrongPass123" })
      .expect(401);

    // Same error as non-existent — no information leakage
    expect(res.body.error).toBe("Invalid credentials");
  });

  it("should lock account after threshold failures", async () => {
    await createTestUser({ username: "lockme", password: "StrongPass123" });
    const pool = getTestDb();

    // Fail 5 times (default threshold is 5)
    for (let i = 0; i < 5; i++) {
      await request()
        .post("/api/v1/auth/login")
        .send({ username: "lockme", password: "wrong" })
        .expect(401);
    }

    // 6th attempt should get 423
    const res = await request()
      .post("/api/v1/auth/login")
      .send({ username: "lockme", password: "wrong" });

    // After 5 failures the account should be locked; the 6th attempt
    // should return 423 (locked). Alternatively the 5th attempt triggers
    // the lock and 6th sees it.
    expect([401, 423]).toContain(res.status);

    // Verify locked_until is set in DB
    const dbUser = await pool.query("SELECT locked_until FROM users WHERE username = $1", ["lockme"]);
    expect(dbUser.rows[0].locked_until).not.toBeNull();

    // Correct password also fails while locked
    const correctRes = await request()
      .post("/api/v1/auth/login")
      .send({ username: "lockme", password: "StrongPass123" })
      .expect(423);

    expect(correctRes.body.error).toContain("locked");
  });

  it("should reset failed attempt counter on successful login", async () => {
    await createTestUser({ username: "resetme", password: "StrongPass123" });
    const pool = getTestDb();

    // Fail 3 times
    for (let i = 0; i < 3; i++) {
      await request()
        .post("/api/v1/auth/login")
        .send({ username: "resetme", password: "wrong" })
        .expect(401);
    }

    const before = await pool.query("SELECT failed_login_attempts FROM users WHERE username = $1", ["resetme"]);
    expect(before.rows[0].failed_login_attempts).toBe(3);

    // Succeed
    await request()
      .post("/api/v1/auth/login")
      .send({ username: "resetme", password: "StrongPass123" })
      .expect(200);

    const after = await pool.query("SELECT failed_login_attempts FROM users WHERE username = $1", ["resetme"]);
    expect(after.rows[0].failed_login_attempts).toBe(0);
  });

  it("should reject login with empty username/password", async () => {
    const res1 = await request()
      .post("/api/v1/auth/login")
      .send({ username: "", password: "" });
    expect(res1.status).toBe(400);

    const res2 = await request()
      .post("/api/v1/auth/login")
      .send({});
    expect(res2.status).toBe(400);
  });

  it("should reject very long username", async () => {
    const res = await request()
      .post("/api/v1/auth/login")
      .send({ username: "x".repeat(10000), password: "SomePass123" });

    // Should be 400 or 401, not 500
    expect(res.status).toBeLessThan(500);
  });
});

// ─────────────────────────────────────────────
// Session Tests
// ─────────────────────────────────────────────
describe("Session management", () => {
  it("should authenticate with Bearer token", async () => {
    const user = await createTestUser({ username: "bearer_user", password: "StrongPass123" });
    const token = await getAuthToken("bearer_user", "StrongPass123");

    const res = await request()
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(res.body.username).toBe("bearer_user");
  });

  it("should authenticate with cookie", async () => {
    await createTestUser({ username: "cookie_user", password: "StrongPass123" });

    const loginRes = await request()
      .post("/api/v1/auth/login")
      .send({ username: "cookie_user", password: "StrongPass123" })
      .expect(200);

    // Use the Set-Cookie from login
    const cookies = loginRes.headers["set-cookie"];

    const res = await request()
      .get("/api/v1/auth/me")
      .set("Cookie", cookies)
      .expect(200);

    expect(res.body.username).toBe("cookie_user");
  });

  it("should reject expired session", async () => {
    const user = await createTestUser({ username: "expired_user", password: "StrongPass123" });
    const pool = getTestDb();

    // Create a session with expires_at in the past
    const crypto = await import("node:crypto");
    const token = crypto.randomBytes(64).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    await pool.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at, last_activity_at)
       VALUES ($1, $2, NOW() - INTERVAL '1 hour', NOW())`,
      [user.id, tokenHash],
    );

    await request()
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(401);
  });

  it("should reject invalid token", async () => {
    await request()
      .get("/api/v1/auth/me")
      .set("Authorization", "Bearer garbage-token-12345")
      .expect(401);
  });

  it("should reject request with no token on protected routes", async () => {
    await request()
      .get("/api/v1/auth/me")
      .expect(401);
  });

  it("should allow unauthenticated access to health endpoint", async () => {
    await request()
      .get("/api/v1/health")
      .expect(200);
  });

  it("should invalidate session on logout", async () => {
    await createTestUser({ username: "logout_user", password: "StrongPass123" });
    const token = await getAuthToken("logout_user", "StrongPass123");

    // Logout
    await request()
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    // Token should no longer work
    await request()
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(401);
  });

  it("should reject session past idle timeout", async () => {
    const user = await createTestUser({ username: "idle_user", password: "StrongPass123" });
    const pool = getTestDb();

    // Create session with last_activity_at 3 hours ago (idle timeout default is 2 hours)
    const crypto = await import("node:crypto");
    const token = crypto.randomBytes(64).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    await pool.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at, last_activity_at)
       VALUES ($1, $2, NOW() + INTERVAL '5 hours', NOW() - INTERVAL '3 hours')`,
      [user.id, tokenHash],
    );

    await request()
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(401);
  });

  it("should enforce concurrent session limit", async () => {
    await createTestUser({ username: "multi_user", password: "StrongPass123" });

    // Login 6 times (limit is 5)
    const tokens: string[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await request()
        .post("/api/v1/auth/login")
        .send({ username: "multi_user", password: "StrongPass123" })
        .expect(200);
      tokens.push(res.body.token);
    }

    // Oldest token (first) should be revoked
    await request()
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${tokens[0]}`)
      .expect(401);

    // Newest token (last) should still work
    await request()
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${tokens[5]}`)
      .expect(200);
  });
});

// ─────────────────────────────────────────────
// Password Change Tests
// ─────────────────────────────────────────────
describe("POST /api/v1/auth/change-password", () => {
  it("should change password successfully", async () => {
    await createTestUser({ username: "changeme", password: "OldPassWord1" });
    const token = await getAuthToken("changeme", "OldPassWord1");

    await request()
      .post("/api/v1/auth/change-password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: "OldPassWord1", newPassword: "NewPassWord2" })
      .expect(200);

    // Can login with new password
    await request()
      .post("/api/v1/auth/login")
      .send({ username: "changeme", password: "NewPassWord2" })
      .expect(200);

    // Cannot login with old password
    await request()
      .post("/api/v1/auth/login")
      .send({ username: "changeme", password: "OldPassWord1" })
      .expect(401);
  });

  it("should revoke other sessions on password change", async () => {
    await createTestUser({ username: "revoke_user", password: "OldPassWord1" });
    const token1 = await getAuthToken("revoke_user", "OldPassWord1");
    const token2 = await getAuthToken("revoke_user", "OldPassWord1");

    // Change password using token1
    await request()
      .post("/api/v1/auth/change-password")
      .set("Authorization", `Bearer ${token1}`)
      .send({ currentPassword: "OldPassWord1", newPassword: "NewPassWord2" })
      .expect(200);

    // token2 (other session) should be revoked
    await request()
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token2}`)
      .expect(401);

    // token1 (current session) should still work
    await request()
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token1}`)
      .expect(200);
  });

  it("should fail with wrong current password", async () => {
    await createTestUser({ username: "wrongcurr", password: "CurrentPass1" });
    const token = await getAuthToken("wrongcurr", "CurrentPass1");

    const res = await request()
      .post("/api/v1/auth/change-password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: "WrongPassword1", newPassword: "NewPassWord2" })
      .expect(401);

    expect(res.body.error).toContain("incorrect");
  });

  it("should reject weak password", async () => {
    await createTestUser({ username: "weakpw", password: "StrongPass123" });
    const token = await getAuthToken("weakpw", "StrongPass123");

    const res = await request()
      .post("/api/v1/auth/change-password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: "StrongPass123", newPassword: "short" })
      .expect(400);

    expect(res.body.error).toContain("weak");
    expect(res.body.details).toBeDefined();
    expect(res.body.details.length).toBeGreaterThan(0);
  });

  it("should reject same-as-current password", async () => {
    await createTestUser({ username: "samepw", password: "StrongPass123" });
    const token = await getAuthToken("samepw", "StrongPass123");

    const res = await request()
      .post("/api/v1/auth/change-password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: "StrongPass123", newPassword: "StrongPass123" })
      .expect(400);

    expect(res.body.error).toContain("different");
  });

  it("should handle force_password_change flag", async () => {
    const pool = getTestDb();
    const user = await createTestUser({ username: "forcepw", password: "TempPass123!" });

    // Set force_password_change
    await pool.query("UPDATE users SET force_password_change = true WHERE id = $1", [user.id]);

    // Login should indicate forcePasswordChange
    const loginRes = await request()
      .post("/api/v1/auth/login")
      .send({ username: "forcepw", password: "TempPass123!" })
      .expect(200);

    expect(loginRes.body.user.forcePasswordChange).toBe(true);

    // Change password
    await request()
      .post("/api/v1/auth/change-password")
      .set("Authorization", `Bearer ${loginRes.body.token}`)
      .send({ currentPassword: "TempPass123!", newPassword: "NewSecure456" })
      .expect(200);

    // After change, forcePasswordChange should be false
    const meRes = await request()
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${loginRes.body.token}`)
      .expect(200);

    expect(meRes.body.forcePasswordChange).toBe(false);
  });
});

// ─────────────────────────────────────────────
// Role-Based Access Tests
// ─────────────────────────────────────────────
describe("Role-based access control", () => {
  let operatorToken: string;
  let adminToken: string;

  beforeEach(async () => {
    await createTestUser({ username: "operator1", password: "OperatorPass1" });
    operatorToken = await getAuthToken("operator1", "OperatorPass1");

    await createTestAdmin({ username: "admin1", password: "AdminPass1234" });
    adminToken = await getAuthToken("admin1", "AdminPass1234");
  });

  it("should deny operator access to admin routes (GET /users)", async () => {
    await request()
      .get("/api/v1/users")
      .set("Authorization", `Bearer ${operatorToken}`)
      .expect(403);
  });

  it("should allow operator to access operational routes", async () => {
    // GET /hosts
    await request()
      .get("/api/v1/hosts")
      .set("Authorization", `Bearer ${operatorToken}`)
      .expect(200);

    // GET /alerts
    await request()
      .get("/api/v1/alerts")
      .set("Authorization", `Bearer ${operatorToken}`)
      .expect(200);
  });

  it("should allow operator to acknowledge an alert", async () => {
    const target = await createTestScanTarget();
    const host = await createTestHost(target.id);
    const pool = getTestDb();
    const alert = await pool.query(
      `INSERT INTO alerts (host_id, package_name, current_version, available_version, severity)
       VALUES ($1, 'test-pkg', '1.0', '2.0', 'medium')
       RETURNING id`,
      [host.id],
    );

    await request()
      .patch(`/api/v1/alerts/${alert.rows[0].id}/acknowledge`)
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({ acknowledgedBy: "operator1" })
      .expect(200);
  });

  it("should allow admin to access everything", async () => {
    // Admin routes
    await request()
      .get("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    // Operational routes
    await request()
      .get("/api/v1/hosts")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
  });

  it("should allow operator to create scan targets", async () => {
    // Scan target creation is NOT admin-only in this codebase
    const res = await request()
      .post("/api/v1/targets")
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({
        name: "Operator Target",
        type: "ssh_linux",
        connectionConfig: { host: "10.0.0.1", username: "root" },
      });

    // Should succeed (200 or 201)
    expect([200, 201]).toContain(res.status);
  });

  it("should allow operator to trigger scan", async () => {
    const target = await createTestScanTarget();

    const res = await request()
      .post(`/api/v1/targets/${target.id}/scan`)
      .set("Authorization", `Bearer ${operatorToken}`);

    expect([200, 202]).toContain(res.status);
  });
});
