import type pg from "pg";
import type { Logger } from "pino";
import nodemailer from "nodemailer";
import { config } from "../../config.js";
import type { NotificationEvent, NotificationChannel, FormattedMessage } from "./types.js";
import { formatTeamsMessage } from "./formatters/ms-teams-formatter.js";
import { formatSlackMessage } from "./formatters/slack-formatter.js";
import { formatGenericWebhookMessage } from "./formatters/generic-webhook-formatter.js";

const SEVERITY_ORDER = ["info", "low", "medium", "high", "critical"];

/** Min interval between messages to the same channel (ms) */
const RATE_LIMIT_MS = 5_000;

/** Dedup window: same alert+host+channel within this time is skipped */
const DEDUP_WINDOW_MS = 60 * 60 * 1000; // 1 hour

interface QueueEntry {
  channel: NotificationChannel;
  event: NotificationEvent;
  formatted: FormattedMessage;
}

export class NotificationService {
  private queue: QueueEntry[] = [];
  private processing = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSentAt = new Map<string, number>(); // channelId -> timestamp
  private recentKeys = new Map<string, number>(); // dedup key -> timestamp
  private dashboardUrl: string;

  constructor(
    private pool: pg.Pool,
    private logger: Logger
  ) {
    this.dashboardUrl = config.corsOrigin.replace(/\/$/, "");
  }

  start(): void {
    if (this.timer) return;
    // Process queue every second
    this.timer = setInterval(() => this.processQueue(), 1_000);
    // Clean dedup cache every 10 minutes
    setInterval(() => this.cleanDedupCache(), 10 * 60 * 1000);
    this.logger.info("Notification service started");
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.logger.info("Notification service stopped");
  }

  /**
   * Main entry point: evaluates all channels and enqueues matching ones.
   */
  async notify(event: NotificationEvent): Promise<void> {
    try {
      const channels = await this.getEnabledChannels();
      const enqueuedChannelIds = new Set<string>();

      for (const channel of channels) {
        if (!this.matchesFilters(channel, event)) continue;
        this.enqueueIfNew(channel, event, enqueuedChannelIds);
      }

      // Group-based routing: look up host's groups and send to group channels
      if (event.details.hostId) {
        const groupChannels = await this.getGroupChannelsForHost(
          event.details.hostId as string,
          event.severity
        );
        for (const channel of groupChannels) {
          this.enqueueIfNew(channel, event, enqueuedChannelIds);
        }
      }
    } catch (err) {
      this.logger.error({ err }, "Failed to enqueue notifications");
    }
  }

  private enqueueIfNew(
    channel: NotificationChannel,
    event: NotificationEvent,
    enqueuedChannelIds: Set<string>
  ): void {
    if (enqueuedChannelIds.has(channel.id)) return;

    const dedupKey = this.dedupKey(channel.id, event);
    const lastSent = this.recentKeys.get(dedupKey);
    if (lastSent && Date.now() - lastSent < DEDUP_WINDOW_MS) {
      this.logger.debug(
        { channelId: channel.id, eventType: event.eventType },
        "Skipping duplicate notification"
      );
      return;
    }

    const formatted = this.formatForChannel(channel, event);
    this.queue.push({ channel, event, formatted });
    enqueuedChannelIds.add(channel.id);
  }

  private async getGroupChannelsForHost(
    hostId: string,
    eventSeverity: string
  ): Promise<NotificationChannel[]> {
    // Find groups this host belongs to that have notification channels configured
    const result = await this.pool.query<{
      notification_channel_ids: string[];
      alert_severity_threshold: string;
    }>(
      `SELECT g.notification_channel_ids, g.alert_severity_threshold
       FROM host_groups g
       JOIN host_group_members m ON m.host_group_id = g.id
       WHERE m.host_id = $1
         AND g.notification_channel_ids IS NOT NULL
         AND array_length(g.notification_channel_ids, 1) > 0`,
      [hostId]
    );

    const channelIds = new Set<string>();
    for (const row of result.rows) {
      // Check severity threshold
      const threshIdx = SEVERITY_ORDER.indexOf(row.alert_severity_threshold);
      const eventIdx = SEVERITY_ORDER.indexOf(eventSeverity);
      if (threshIdx >= 0 && eventIdx >= 0 && eventIdx < threshIdx) continue;

      for (const cid of row.notification_channel_ids) {
        channelIds.add(cid);
      }
    }

    if (channelIds.size === 0) return [];

    const channelsResult = await this.pool.query(
      `SELECT * FROM notification_channels WHERE id = ANY($1) AND enabled = true`,
      [Array.from(channelIds)]
    );
    return channelsResult.rows.map(rowToChannel);
  }

  /**
   * Send a test message to a specific channel, bypassing filters and queue.
   */
  async sendTest(channelId: string): Promise<{ success: boolean; message: string; responseCode?: number }> {
    const result = await this.pool.query<ChannelRow>(
      "SELECT * FROM notification_channels WHERE id = $1",
      [channelId]
    );
    if (result.rows.length === 0) {
      return { success: false, message: "Channel not found" };
    }

    const channel = rowToChannel(result.rows[0]);
    const testEvent: NotificationEvent = {
      eventType: "alert_created",
      severity: "info",
      title: "InfraWatch Test Notification",
      summary: "This is a test message to verify your notification channel is configured correctly.",
      details: {
        hostname: "test-host.example.com",
        environment: "test",
      },
    };

    const formatted = this.formatForChannel(channel, testEvent);

    try {
      const responseCode = await this.deliver(channel, formatted);
      await this.logNotification(channel.id, "alert_created", testEvent, "sent", null, responseCode);
      await this.updateChannelStatus(channel.id, "sent", null);
      return { success: true, message: "Test notification sent successfully", responseCode };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await this.logNotification(channel.id, "alert_created", testEvent, "failed", errorMsg, null);
      await this.updateChannelStatus(channel.id, "failed", errorMsg);
      return { success: false, message: errorMsg };
    }
  }

  // ─── Queue processing ───

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    try {
      const now = Date.now();
      const remaining: QueueEntry[] = [];

      for (const entry of this.queue) {
        const lastTime = this.lastSentAt.get(entry.channel.id) ?? 0;
        if (now - lastTime < RATE_LIMIT_MS) {
          remaining.push(entry); // rate limited, keep in queue
          continue;
        }

        try {
          const responseCode = await this.deliver(entry.channel, entry.formatted);
          this.lastSentAt.set(entry.channel.id, Date.now());

          const dedupKey = this.dedupKey(entry.channel.id, entry.event);
          this.recentKeys.set(dedupKey, Date.now());

          await this.logNotification(
            entry.channel.id, entry.event.eventType, entry.event, "sent", null, responseCode
          );
          await this.updateChannelStatus(entry.channel.id, "sent", null);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          this.logger.error(
            { err, channelId: entry.channel.id, eventType: entry.event.eventType },
            "Failed to deliver notification"
          );
          await this.logNotification(
            entry.channel.id, entry.event.eventType, entry.event, "failed", errorMsg, null
          );
          await this.updateChannelStatus(entry.channel.id, "failed", errorMsg);
        }
      }

      this.queue = remaining;
    } finally {
      this.processing = false;
    }
  }

  // ─── Delivery ───

  private async deliver(channel: NotificationChannel, formatted: FormattedMessage): Promise<number> {
    if (channel.channelType === "email") {
      return this.deliverEmail(channel, formatted);
    }

    if (!channel.webhookUrl) {
      throw new Error("Webhook URL not configured");
    }

    const contentType = formatted.contentType ?? "application/json";
    const body = typeof formatted.body === "string" ? formatted.body : JSON.stringify(formatted.body);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch(channel.webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": contentType,
          "User-Agent": "infrawatch/0.1.0",
        },
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
      }

      return response.status;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async deliverEmail(
    channel: NotificationChannel,
    formatted: FormattedMessage
  ): Promise<number> {
    if (!config.smtp.host || !config.smtp.user) {
      throw new Error("SMTP not configured");
    }

    const recipients = (channel.config.recipients as string[]) ?? [];
    if (recipients.length === 0) {
      throw new Error("No email recipients configured");
    }

    const transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
    });

    const payload = formatted.body as { eventType: string; title: string; summary: string; severity: string };

    await transporter.sendMail({
      from: config.smtp.user,
      to: recipients.join(", "),
      subject: `[InfraWatch] ${payload.title}`,
      html: `<h2>${escHtml(payload.title)}</h2><p>${escHtml(payload.summary)}</p><p>Severity: <strong>${escHtml(payload.severity)}</strong></p>`,
    });

    return 250;
  }

  // ─── Formatting ───

  private formatForChannel(channel: NotificationChannel, event: NotificationEvent): FormattedMessage {
    switch (channel.channelType) {
      case "ms_teams":
        return formatTeamsMessage(event, this.dashboardUrl);
      case "slack":
        return formatSlackMessage(event, this.dashboardUrl);
      case "generic_webhook":
        return formatGenericWebhookMessage(event, channel.config);
      case "email":
        // Email uses a simple payload; actual formatting happens in deliverEmail
        return {
          body: {
            eventType: event.eventType,
            severity: event.severity,
            title: event.title,
            summary: event.summary,
          },
        };
      default:
        return formatGenericWebhookMessage(event, channel.config);
    }
  }

  // ─── Filters ───

  private matchesFilters(channel: NotificationChannel, event: NotificationEvent): boolean {
    const f = channel.filters;

    // Min severity check
    if (f.minSeverity) {
      const minIdx = SEVERITY_ORDER.indexOf(f.minSeverity);
      const eventIdx = SEVERITY_ORDER.indexOf(event.severity);
      if (minIdx >= 0 && eventIdx >= 0 && eventIdx < minIdx) return false;
    }

    // Event type filter
    if (f.eventTypes && f.eventTypes.length > 0) {
      if (!f.eventTypes.includes(event.eventType)) return false;
    }

    // Environment filter
    if (f.environments && f.environments.length > 0 && event.details.environment) {
      if (!f.environments.includes(event.details.environment)) return false;
    }

    return true;
  }

  // ─── DB helpers ───

  private async getEnabledChannels(): Promise<NotificationChannel[]> {
    const result = await this.pool.query<ChannelRow>(
      "SELECT * FROM notification_channels WHERE enabled = true"
    );
    return result.rows.map(rowToChannel);
  }

  private async logNotification(
    channelId: string,
    eventType: string,
    event: NotificationEvent,
    status: string,
    errorMessage: string | null,
    responseCode: number | null
  ): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO notification_log (channel_id, event_type, payload, status, error_message, response_code)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          channelId,
          eventType,
          JSON.stringify({ title: event.title, summary: event.summary, severity: event.severity }),
          status,
          errorMessage,
          responseCode,
        ]
      );
    } catch (err) {
      this.logger.error({ err }, "Failed to log notification");
    }
  }

  private async updateChannelStatus(
    channelId: string,
    status: string,
    error: string | null
  ): Promise<void> {
    try {
      await this.pool.query(
        `UPDATE notification_channels
         SET last_sent_at = NOW(), last_status = $1, last_error = $2, updated_at = NOW()
         WHERE id = $3`,
        [status, error, channelId]
      );
    } catch (err) {
      this.logger.error({ err }, "Failed to update channel status");
    }
  }

  // ─── Dedup ───

  private dedupKey(channelId: string, event: NotificationEvent): string {
    const host = event.details.hostId ?? event.details.hostname ?? "";
    return `${channelId}:${event.eventType}:${host}:${event.details.packageName ?? ""}`;
  }

  private cleanDedupCache(): void {
    const cutoff = Date.now() - DEDUP_WINDOW_MS;
    for (const [key, ts] of this.recentKeys) {
      if (ts < cutoff) this.recentKeys.delete(key);
    }
  }

  // ─── Daily digest ───

  async sendDailyDigest(): Promise<void> {
    try {
      // Gather last 24h stats
      const alertResult = await this.pool.query<{
        severity: string;
        cnt: string;
      }>(
        `SELECT severity, COUNT(*) AS cnt
         FROM alerts
         WHERE created_at > NOW() - INTERVAL '24 hours'
         GROUP BY severity`
      );

      const alertsBySeverity: Record<string, number> = {};
      let newAlerts = 0;
      for (const row of alertResult.rows) {
        const count = parseInt(row.cnt, 10);
        alertsBySeverity[row.severity] = count;
        newAlerts += count;
      }

      const eolResult = await this.pool.query<{ cnt: string }>(
        "SELECT COUNT(*) AS cnt FROM eol_alerts WHERE status = 'active'"
      );
      const eolWarnings = parseInt(eolResult.rows[0]?.cnt ?? "0", 10);

      const staleResult = await this.pool.query<{ cnt: string }>(
        "SELECT COUNT(*) AS cnt FROM hosts WHERE status = 'stale'"
      );
      const staleHosts = parseInt(staleResult.rows[0]?.cnt ?? "0", 10);

      // Only send if there's something to report
      if (newAlerts === 0 && eolWarnings === 0 && staleHosts === 0) {
        this.logger.debug("Daily digest skipped — nothing to report");
        return;
      }

      const event: NotificationEvent = {
        eventType: "daily_digest",
        severity: (alertsBySeverity.critical ?? 0) > 0 ? "critical" : (alertsBySeverity.high ?? 0) > 0 ? "high" : "info",
        title: "InfraWatch Daily Digest",
        summary: `Last 24h: ${newAlerts} new alerts, ${eolWarnings} EOL warnings, ${staleHosts} stale hosts`,
        details: {
          alertsBySeverity,
          newAlerts,
          eolWarnings,
          staleHosts,
        },
      };

      await this.notify(event);
      this.logger.info("Daily digest notifications enqueued");
    } catch (err) {
      this.logger.error({ err }, "Failed to send daily digest");
    }
  }
}

// ─── Row mapping ───

interface ChannelRow {
  id: string;
  name: string;
  channel_type: string;
  webhook_url: string | null;
  config: Record<string, unknown>;
  filters: Record<string, unknown>;
  enabled: boolean;
}

function rowToChannel(row: ChannelRow): NotificationChannel {
  return {
    id: row.id,
    name: row.name,
    channelType: row.channel_type as NotificationChannel["channelType"],
    webhookUrl: row.webhook_url,
    config: row.config ?? {},
    filters: (row.filters ?? {}) as NotificationChannel["filters"],
    enabled: row.enabled,
  };
}

function escHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
