import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import supertest from "supertest";
import pino from "pino";
import { getTestDb } from "./setup.js";
import { getTestApp } from "./app.js";
import { createTestAdmin, getAuthToken, createTestScanTarget, createTestHost, createTestAlert } from "./helpers.js";
import { createMockWebhookServer, type MockWebhookServer } from "./helpers/mock-webhook-server.js";
import { NotificationService } from "../services/notifications/notification-service.js";

const logger = pino({ level: "silent" });

// ─── Helpers ───

async function createChannel(
  token: string,
  overrides: {
    name?: string;
    channelType?: string;
    webhookUrl?: string;
    config?: Record<string, unknown>;
    filters?: Record<string, unknown>;
    enabled?: boolean;
  } = {},
) {
  const app = getTestApp();
  const res = await supertest(app)
    .post("/api/v1/notifications/channels")
    .set("Authorization", `Bearer ${token}`)
    .send({
      name: overrides.name ?? "test-channel",
      channelType: overrides.channelType ?? "slack",
      webhookUrl: overrides.webhookUrl ?? "http://127.0.0.1:9999/hook",
      config: overrides.config ?? {},
      filters: overrides.filters ?? {},
      enabled: overrides.enabled ?? true,
    });
  return res;
}

describe("Notification Delivery E2E", () => {
  let mockServer: MockWebhookServer;
  let token: string;

  beforeEach(async () => {
    mockServer = await createMockWebhookServer();
    const admin = await createTestAdmin();
    token = await getAuthToken(admin.username, admin.password);
  });

  afterEach(async () => {
    await mockServer.close();
  });

  // ─── Webhook Delivery ───

  describe("Teams webhook delivery", () => {
    it("should deliver MessageCard formatted payload to Teams endpoint", async () => {
      const pool = getTestDb();
      const notificationService = new NotificationService(pool, logger);

      // Create ms_teams channel pointing at mock server
      const chanRes = await createChannel(token, {
        name: "teams-test",
        channelType: "ms_teams",
        webhookUrl: `${mockServer.url}/teams`,
      });
      expect(chanRes.status).toBe(201);
      const channelId = chanRes.body.id;

      const result = await notificationService.sendTest(channelId);
      expect(result.success).toBe(true);
      expect(result.responseCode).toBe(200);

      // Verify mock received the request
      expect(mockServer.requests.length).toBe(1);
      const req = mockServer.lastRequest()!;
      expect(req.headers["content-type"]).toBe("application/json");
      expect(req.headers["user-agent"]).toBe("infrawatch/0.1.0");

      // Verify Teams MessageCard format
      const body = req.parsedBody as Record<string, unknown>;
      expect(body["@type"]).toBe("MessageCard");
      expect(body["@context"]).toBe("https://schema.org/extensions");
      expect(body.themeColor).toBeDefined();
      expect(body.summary).toBeDefined();
      expect(body.sections).toBeDefined();
    });
  });

  describe("Slack webhook delivery", () => {
    it("should deliver Block Kit formatted payload to Slack endpoint", async () => {
      const pool = getTestDb();
      const notificationService = new NotificationService(pool, logger);

      const chanRes = await createChannel(token, {
        name: "slack-test",
        channelType: "slack",
        webhookUrl: `${mockServer.url}/slack`,
      });
      const channelId = chanRes.body.id;

      const result = await notificationService.sendTest(channelId);
      expect(result.success).toBe(true);

      const req = mockServer.lastRequest()!;
      const body = req.parsedBody as Record<string, unknown>;

      // Slack Block Kit format
      expect(body.blocks).toBeDefined();
      expect(Array.isArray(body.blocks)).toBe(true);
      expect(body.attachments).toBeDefined();
    });
  });

  describe("Generic webhook delivery", () => {
    it("should deliver raw event JSON when no template configured", async () => {
      const pool = getTestDb();
      const notificationService = new NotificationService(pool, logger);

      const chanRes = await createChannel(token, {
        name: "generic-test",
        channelType: "generic_webhook",
        webhookUrl: `${mockServer.url}/generic`,
      });
      const channelId = chanRes.body.id;

      const result = await notificationService.sendTest(channelId);
      expect(result.success).toBe(true);

      const req = mockServer.lastRequest()!;
      const body = req.parsedBody as Record<string, unknown>;

      // Generic webhook returns the raw event
      expect(body.eventType).toBe("alert_created");
      expect(body.severity).toBe("info");
      expect(body.title).toContain("Test Notification");
    });

    it("should apply template substitution with {{variable}} syntax", async () => {
      const pool = getTestDb();
      const notificationService = new NotificationService(pool, logger);

      const template = JSON.stringify({
        text: "Alert: {{title}} - {{severity}}",
        host: "{{details.hostname}}",
      });

      const chanRes = await createChannel(token, {
        name: "template-test",
        channelType: "generic_webhook",
        webhookUrl: `${mockServer.url}/templated`,
        config: { bodyTemplate: template },
      });
      const channelId = chanRes.body.id;

      const result = await notificationService.sendTest(channelId);
      expect(result.success).toBe(true);

      const req = mockServer.lastRequest()!;
      const body = req.parsedBody as Record<string, unknown>;
      expect(body.text).toContain("InfraWatch Test Notification");
      expect(body.text).toContain("info");
      expect(body.host).toBe("test-host.example.com");
    });
  });

  // ─── Error handling ───

  describe("Error handling", () => {
    it("should handle HTTP 429 (rate limited by remote) gracefully", async () => {
      const pool = getTestDb();
      const notificationService = new NotificationService(pool, logger);

      mockServer.setStatus(429);
      mockServer.setResponseBody("Too Many Requests");

      const chanRes = await createChannel(token, {
        name: "ratelimit-test",
        channelType: "slack",
        webhookUrl: `${mockServer.url}/ratelimited`,
      });
      const channelId = chanRes.body.id;

      const result = await notificationService.sendTest(channelId);
      expect(result.success).toBe(false);
      expect(result.message).toContain("429");

      // Verify failure logged in DB
      const log = await pool.query(
        "SELECT * FROM notification_log WHERE channel_id = $1",
        [channelId],
      );
      expect(log.rows.length).toBe(1);
      expect(log.rows[0].status).toBe("failed");
      expect(log.rows[0].error_message).toContain("429");
    });

    it("should handle HTTP 500 (server error) gracefully", async () => {
      const pool = getTestDb();
      const notificationService = new NotificationService(pool, logger);

      mockServer.setStatus(500);
      mockServer.setResponseBody("Internal Server Error");

      const chanRes = await createChannel(token, {
        name: "servererr-test",
        channelType: "slack",
        webhookUrl: `${mockServer.url}/error`,
      });
      const channelId = chanRes.body.id;

      const result = await notificationService.sendTest(channelId);
      expect(result.success).toBe(false);
      expect(result.message).toContain("500");

      // Channel status should be updated to failed
      const ch = await pool.query(
        "SELECT last_status, last_error FROM notification_channels WHERE id = $1",
        [channelId],
      );
      expect(ch.rows[0].last_status).toBe("failed");
      expect(ch.rows[0].last_error).toContain("500");
    });

    it("should handle connection refused", async () => {
      const pool = getTestDb();
      const notificationService = new NotificationService(pool, logger);

      // Use a port that's definitely not listening
      const chanRes = await createChannel(token, {
        name: "connrefused-test",
        channelType: "slack",
        webhookUrl: "http://127.0.0.1:19999/dead",
      });
      const channelId = chanRes.body.id;

      const result = await notificationService.sendTest(channelId);
      expect(result.success).toBe(false);
      expect(result.message.length).toBeGreaterThan(0);
    });
  });

  // ─── Pipeline: Severity Filtering ───

  describe("Severity filtering", () => {
    it("should only deliver notifications matching minSeverity filter", async () => {
      const pool = getTestDb();
      const notificationService = new NotificationService(pool, logger);

      // Channel only wants high+ severity
      const chanRes = await createChannel(token, {
        name: "high-only",
        channelType: "slack",
        webhookUrl: `${mockServer.url}/filtered`,
        filters: { minSeverity: "high" },
      });
      expect(chanRes.status).toBe(201);

      // Send low-severity event — should be filtered
      await notificationService.notify({
        eventType: "alert_created",
        severity: "low",
        title: "Low alert",
        summary: "Should be filtered",
        details: { hostname: "h1" },
      });

      // Send critical event — should pass
      await notificationService.notify({
        eventType: "alert_created",
        severity: "critical",
        title: "Critical alert",
        summary: "Should pass",
        details: { hostname: "h2" },
      });

      // Process queue
      notificationService.start();
      await new Promise((r) => setTimeout(r, 2000));
      notificationService.stop();

      // Only the critical one should have been delivered
      expect(mockServer.requests.length).toBe(1);
      const body = mockServer.lastRequest()!.parsedBody as Record<string, unknown>;
      const blocks = body.blocks as Array<Record<string, unknown>>;
      // Verify it's the critical one by checking the log
      const log = await pool.query(
        "SELECT * FROM notification_log ORDER BY created_at",
      );
      expect(log.rows.length).toBe(1);
      expect(log.rows[0].status).toBe("sent");
    });

    it("should filter by event type", async () => {
      const pool = getTestDb();
      const notificationService = new NotificationService(pool, logger);

      // Only interested in eol_detected events
      const chanRes = await createChannel(token, {
        name: "eol-only",
        channelType: "slack",
        webhookUrl: `${mockServer.url}/eol`,
        filters: { eventTypes: ["eol_detected"] },
      });
      expect(chanRes.status).toBe(201);

      // Send alert_created — should be filtered
      await notificationService.notify({
        eventType: "alert_created",
        severity: "high",
        title: "Alert",
        summary: "Should be filtered",
        details: { hostname: "h1" },
      });

      // Send eol_detected — should pass
      await notificationService.notify({
        eventType: "eol_detected",
        severity: "high",
        title: "EOL",
        summary: "Should pass",
        details: { hostname: "h2" },
      });

      notificationService.start();
      await new Promise((r) => setTimeout(r, 2000));
      notificationService.stop();

      expect(mockServer.requests.length).toBe(1);
    });

    it("should filter by environment", async () => {
      const pool = getTestDb();
      const notificationService = new NotificationService(pool, logger);

      // Only production alerts
      const chanRes = await createChannel(token, {
        name: "prod-only",
        channelType: "slack",
        webhookUrl: `${mockServer.url}/prod`,
        filters: { environments: ["production"] },
      });
      expect(chanRes.status).toBe(201);

      // Send staging event — should be filtered
      await notificationService.notify({
        eventType: "alert_created",
        severity: "high",
        title: "Staging alert",
        summary: "Should be filtered",
        details: { hostname: "h1", environment: "staging" },
      });

      // Send production event — should pass
      await notificationService.notify({
        eventType: "alert_created",
        severity: "high",
        title: "Prod alert",
        summary: "Should pass",
        details: { hostname: "h2", environment: "production" },
      });

      notificationService.start();
      await new Promise((r) => setTimeout(r, 2000));
      notificationService.stop();

      expect(mockServer.requests.length).toBe(1);
    });
  });

  // ─── Deduplication ───

  describe("Deduplication", () => {
    it("should deduplicate identical events within dedup window", async () => {
      const pool = getTestDb();
      const notificationService = new NotificationService(pool, logger);

      const chanRes = await createChannel(token, {
        name: "dedup-test",
        channelType: "slack",
        webhookUrl: `${mockServer.url}/dedup`,
      });
      expect(chanRes.status).toBe(201);

      const event = {
        eventType: "alert_created" as const,
        severity: "high" as const,
        title: "Same alert",
        summary: "Duplicate test",
        details: { hostname: "host-1", packageName: "openssl" },
      };

      // Send the same event twice
      await notificationService.notify(event);
      await notificationService.notify(event);

      notificationService.start();
      await new Promise((r) => setTimeout(r, 2000));
      notificationService.stop();

      // Only one should have been delivered (second is deduped at enqueue time)
      expect(mockServer.requests.length).toBe(1);
    });

    it("should deliver events with different dedup keys", async () => {
      const pool = getTestDb();
      const notificationService = new NotificationService(pool, logger);

      const chanRes = await createChannel(token, {
        name: "nodup-test",
        channelType: "slack",
        webhookUrl: `${mockServer.url}/nodup`,
      });
      expect(chanRes.status).toBe(201);

      // Different hostnames = different dedup keys
      await notificationService.notify({
        eventType: "alert_created",
        severity: "high",
        title: "Alert 1",
        summary: "Host 1",
        details: { hostname: "host-1", packageName: "openssl" },
      });
      await notificationService.notify({
        eventType: "alert_created",
        severity: "high",
        title: "Alert 2",
        summary: "Host 2",
        details: { hostname: "host-2", packageName: "openssl" },
      });

      notificationService.start();
      // Wait longer for rate limit (5s default between sends to same channel)
      await new Promise((r) => setTimeout(r, 7000));
      notificationService.stop();

      expect(mockServer.requests.length).toBe(2);
    });
  });

  // ─── Rate Limiting ───

  describe("Rate limiting", () => {
    it("should rate limit delivery to the same channel", async () => {
      const pool = getTestDb();
      const notificationService = new NotificationService(pool, logger);

      const chanRes = await createChannel(token, {
        name: "ratelimit-chan",
        channelType: "slack",
        webhookUrl: `${mockServer.url}/rate`,
      });
      expect(chanRes.status).toBe(201);

      // Enqueue 3 events with different dedup keys
      for (let i = 0; i < 3; i++) {
        await notificationService.notify({
          eventType: "alert_created",
          severity: "high",
          title: `Alert ${i}`,
          summary: `Test ${i}`,
          details: { hostname: `host-${i}` },
        });
      }

      // Start, wait only 2 seconds (rate limit is 5s default)
      notificationService.start();
      await new Promise((r) => setTimeout(r, 2000));
      notificationService.stop();

      // Only 1 should have been sent (the others are still rate-limited in queue)
      expect(mockServer.requests.length).toBe(1);
    });
  });

  // ─── Daily Digest ───

  describe("Daily digest", () => {
    it("should send daily digest when there are alerts", async () => {
      const pool = getTestDb();
      const notificationService = new NotificationService(pool, logger);

      // Create channel that accepts daily_digest
      const chanRes = await createChannel(token, {
        name: "digest-chan",
        channelType: "slack",
        webhookUrl: `${mockServer.url}/digest`,
        filters: { eventTypes: ["daily_digest"] },
      });
      expect(chanRes.status).toBe(201);

      // Create some alerts in the last 24h
      const target = await createTestScanTarget();
      const host = await createTestHost(target.id, { hostname: "digest-host" });
      await createTestAlert(host.id, { severity: "critical", packageName: "openssl" });
      await createTestAlert(host.id, { severity: "high", packageName: "curl" });

      // Send digest (enqueues the event)
      await notificationService.sendDailyDigest();

      // Process queue
      notificationService.start();
      await new Promise((r) => setTimeout(r, 2000));
      notificationService.stop();

      expect(mockServer.requests.length).toBe(1);
      const body = mockServer.lastRequest()!.parsedBody as Record<string, unknown>;
      // Slack format should have blocks
      expect(body.blocks).toBeDefined();
    });

    it("should NOT send digest when nothing to report", async () => {
      const pool = getTestDb();
      const notificationService = new NotificationService(pool, logger);

      const chanRes = await createChannel(token, {
        name: "empty-digest",
        channelType: "slack",
        webhookUrl: `${mockServer.url}/empty-digest`,
      });
      expect(chanRes.status).toBe(201);

      // No alerts, no EOL, no stale hosts — digest should skip
      await notificationService.sendDailyDigest();

      notificationService.start();
      await new Promise((r) => setTimeout(r, 2000));
      notificationService.stop();

      expect(mockServer.requests.length).toBe(0);
    });
  });

  // ─── Test Notification API Endpoint ───

  describe("POST /channels/:id/test endpoint", () => {
    it("should send test notification and return success", async () => {
      const app = getTestApp();

      const chanRes = await createChannel(token, {
        name: "api-test-chan",
        channelType: "slack",
        webhookUrl: `${mockServer.url}/api-test`,
      });
      const channelId = chanRes.body.id;

      const res = await supertest(app)
        .post(`/api/v1/notifications/channels/${channelId}/test`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.responseCode).toBe(200);
      expect(mockServer.requests.length).toBe(1);
    });

    it("should return failure when endpoint returns error", async () => {
      const app = getTestApp();
      mockServer.setStatus(500);

      const chanRes = await createChannel(token, {
        name: "api-fail-chan",
        channelType: "slack",
        webhookUrl: `${mockServer.url}/api-fail`,
      });
      const channelId = chanRes.body.id;

      const res = await supertest(app)
        .post(`/api/v1/notifications/channels/${channelId}/test`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200); // endpoint always returns 200, but body has success: false

      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("500");
    });

    it("should return error for non-existent channel", async () => {
      const app = getTestApp();

      const res = await supertest(app)
        .post("/api/v1/notifications/channels/00000000-0000-0000-0000-000000000000/test")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("not found");
    });

    it("should return 400 for invalid channel ID", async () => {
      const app = getTestApp();

      await supertest(app)
        .post("/api/v1/notifications/channels/not-a-uuid/test")
        .set("Authorization", `Bearer ${token}`)
        .expect(400);
    });
  });

  // ─── Notification Log ───

  describe("Notification log", () => {
    it("should record sent notifications in the log", async () => {
      const pool = getTestDb();
      const notificationService = new NotificationService(pool, logger);

      const chanRes = await createChannel(token, {
        name: "log-test",
        channelType: "slack",
        webhookUrl: `${mockServer.url}/log`,
      });
      const channelId = chanRes.body.id;

      await notificationService.sendTest(channelId);

      const app = getTestApp();
      const res = await supertest(app)
        .get("/api/v1/notifications/log")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body.total).toBeGreaterThanOrEqual(1);
      const entry = res.body.data.find(
        (e: Record<string, unknown>) => e.channelId === channelId,
      );
      expect(entry).toBeDefined();
      expect(entry.status).toBe("sent");
      expect(entry.responseCode).toBe(200);
    });

    it("should record failed notifications in the log", async () => {
      const pool = getTestDb();
      const notificationService = new NotificationService(pool, logger);

      mockServer.setStatus(503);

      const chanRes = await createChannel(token, {
        name: "fail-log",
        channelType: "slack",
        webhookUrl: `${mockServer.url}/faillog`,
      });
      const channelId = chanRes.body.id;

      await notificationService.sendTest(channelId);

      const app = getTestApp();
      const res = await supertest(app)
        .get(`/api/v1/notifications/log?channelId=${channelId}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].status).toBe("failed");
      expect(res.body.data[0].errorMessage).toContain("503");
    });
  });

  // ─── Channel CRUD ───

  describe("Channel management", () => {
    it("should create, update, and delete a channel", async () => {
      const app = getTestApp();

      // Create
      const createRes = await createChannel(token, {
        name: "crud-test",
        channelType: "ms_teams",
        webhookUrl: `${mockServer.url}/crud`,
      });
      expect(createRes.status).toBe(201);
      const id = createRes.body.id;
      expect(createRes.body.channelType).toBe("ms_teams");
      // Webhook URL should be masked in response
      expect(createRes.body.webhookUrl).toContain("****");

      // Update
      const updateRes = await supertest(app)
        .patch(`/api/v1/notifications/channels/${id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "updated-name", enabled: false })
        .expect(200);
      expect(updateRes.body.name).toBe("updated-name");
      expect(updateRes.body.enabled).toBe(false);

      // Delete
      await supertest(app)
        .delete(`/api/v1/notifications/channels/${id}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      // Verify deleted
      const listRes = await supertest(app)
        .get("/api/v1/notifications/channels")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
      const found = listRes.body.find(
        (c: Record<string, unknown>) => c.id === id,
      );
      expect(found).toBeUndefined();
    });

    it("should reject invalid channel type", async () => {
      const app = getTestApp();
      const res = await supertest(app)
        .post("/api/v1/notifications/channels")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "bad-type",
          channelType: "discord",
          webhookUrl: mockServer.url,
        })
        .expect(400);
      expect(res.body.error).toContain("channelType");
    });

    it("should require webhookUrl for non-email channels", async () => {
      const app = getTestApp();
      const res = await supertest(app)
        .post("/api/v1/notifications/channels")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "no-url",
          channelType: "slack",
        })
        .expect(400);
      expect(res.body.error).toContain("webhookUrl");
    });

    it("should allow email channel without webhookUrl", async () => {
      const app = getTestApp();
      const res = await supertest(app)
        .post("/api/v1/notifications/channels")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "email-chan",
          channelType: "email",
          config: { recipients: ["admin@test.local"] },
        })
        .expect(201);
      expect(res.body.channelType).toBe("email");
      expect(res.body.webhookUrl).toBeNull();
    });
  });

  // ─── Disabled channels ───

  describe("Disabled channels", () => {
    it("should not deliver to disabled channels", async () => {
      const pool = getTestDb();
      const notificationService = new NotificationService(pool, logger);

      const chanRes = await createChannel(token, {
        name: "disabled-chan",
        channelType: "slack",
        webhookUrl: `${mockServer.url}/disabled`,
        enabled: true,
      });
      const channelId = chanRes.body.id;

      // Disable the channel
      const app = getTestApp();
      await supertest(app)
        .patch(`/api/v1/notifications/channels/${channelId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ enabled: false })
        .expect(200);

      // Try to notify
      await notificationService.notify({
        eventType: "alert_created",
        severity: "critical",
        title: "Should not arrive",
        summary: "Disabled channel test",
        details: { hostname: "h1" },
      });

      notificationService.start();
      await new Promise((r) => setTimeout(r, 2000));
      notificationService.stop();

      expect(mockServer.requests.length).toBe(0);
    });
  });

  // ─── Multiple channels ───

  describe("Multiple channels", () => {
    it("should deliver to all matching channels", async () => {
      const pool = getTestDb();
      const notificationService = new NotificationService(pool, logger);

      // Create a second mock server for the second channel
      const mockServer2 = await createMockWebhookServer();

      try {
        await createChannel(token, {
          name: "multi-chan-1",
          channelType: "slack",
          webhookUrl: `${mockServer.url}/multi1`,
        });
        await createChannel(token, {
          name: "multi-chan-2",
          channelType: "ms_teams",
          webhookUrl: `${mockServer2.url}/multi2`,
        });

        await notificationService.notify({
          eventType: "alert_created",
          severity: "critical",
          title: "Multi-channel test",
          summary: "Should arrive at both",
          details: { hostname: "h1" },
        });

        notificationService.start();
        // Rate limit applies per-channel, so both can be sent immediately
        await new Promise((r) => setTimeout(r, 2000));
        notificationService.stop();

        expect(mockServer.requests.length).toBe(1);
        expect(mockServer2.requests.length).toBe(1);
      } finally {
        await mockServer2.close();
      }
    });
  });
});
