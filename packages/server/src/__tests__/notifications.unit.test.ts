import { describe, it, expect } from "vitest";
import { formatTeamsMessage } from "../services/notifications/formatters/ms-teams-formatter.js";
import { formatSlackMessage } from "../services/notifications/formatters/slack-formatter.js";
import type { NotificationEvent, NotificationChannel } from "../services/notifications/types.js";

function makeEvent(overrides: Partial<NotificationEvent> = {}): NotificationEvent {
  return {
    eventType: overrides.eventType ?? "alert_created",
    severity: overrides.severity ?? "high",
    title: overrides.title ?? "Test Alert",
    summary: overrides.summary ?? "Something happened",
    details: overrides.details ?? {
      hostname: "web-01",
      hostId: "host-uuid",
      packageName: "openssl",
      currentVersion: "1.0.0",
      availableVersion: "3.0.0",
    },
  };
}

function makeChannel(overrides: Partial<NotificationChannel> = {}): NotificationChannel {
  return {
    id: overrides.id ?? "ch-1",
    name: overrides.name ?? "test-channel",
    channelType: overrides.channelType ?? "ms_teams",
    webhookUrl: overrides.webhookUrl ?? "https://webhook.example.com",
    config: overrides.config ?? {},
    filters: overrides.filters ?? {},
    enabled: overrides.enabled ?? true,
  };
}

// ─── Teams formatter ───

describe("formatTeamsMessage", () => {
  it("should produce valid MessageCard with correct color", () => {
    const event = makeEvent({ severity: "critical" });
    const result = formatTeamsMessage(event, "https://infra.example.com");
    const body = result.body as Record<string, unknown>;

    expect(body["@type"]).toBe("MessageCard");
    expect(body.themeColor).toBe("FF0000"); // critical = red
    expect(body.summary).toBe("Test Alert");

    const sections = body.sections as Array<Record<string, unknown>>;
    expect(sections[0].activityTitle).toBe("Test Alert");
    expect(sections[0].activitySubtitle).toBe("Something happened");
  });

  it("should include severity fact in output", () => {
    const event = makeEvent({ severity: "medium" });
    const result = formatTeamsMessage(event);
    const body = result.body as Record<string, unknown>;

    expect(body.themeColor).toBe("FFD700"); // medium = gold

    const sections = body.sections as Array<Record<string, unknown>>;
    const facts = sections[0].facts as Array<{ name: string; value: string }>;
    const severityFact = facts.find((f) => f.name === "Severity");
    expect(severityFact?.value).toBe("MEDIUM");
  });

  it("should include host and package facts", () => {
    const event = makeEvent();
    const result = formatTeamsMessage(event);
    const body = result.body as Record<string, unknown>;
    const sections = body.sections as Array<Record<string, unknown>>;
    const facts = sections[0].facts as Array<{ name: string; value: string }>;

    const hostFact = facts.find((f) => f.name === "Host");
    expect(hostFact?.value).toBe("web-01");

    const pkgFact = facts.find((f) => f.name === "Package");
    expect(pkgFact?.value).toBe("openssl");

    const versionFact = facts.find((f) => f.name === "Versions");
    expect(versionFact?.value).toBe("1.0.0 → 3.0.0");
  });

  it("should add dashboard link when hostId present", () => {
    const event = makeEvent();
    const result = formatTeamsMessage(event, "https://infra.example.com");
    const body = result.body as Record<string, unknown>;
    const actions = body.potentialAction as Array<Record<string, unknown>>;

    expect(actions.length).toBe(1);
    expect(actions[0].name).toBe("View in InfraWatch");
    const targets = actions[0].targets as Array<{ uri: string }>;
    expect(targets[0].uri).toBe("https://infra.example.com/hosts/host-uuid");
  });

  it("should format daily digest card differently", () => {
    const event = makeEvent({
      eventType: "daily_digest",
      severity: "info",
      title: "InfraWatch Daily Digest",
      summary: "Last 24h: 5 new alerts",
      details: {
        newAlerts: 5,
        alertsBySeverity: { critical: 1, high: 2, medium: 2 },
        eolWarnings: 3,
        staleHosts: 1,
      },
    });
    const result = formatTeamsMessage(event, "https://infra.example.com");
    const body = result.body as Record<string, unknown>;

    // Digest cards use blue theme color
    expect(body.themeColor).toBe("4169E1");

    const sections = body.sections as Array<Record<string, unknown>>;
    const facts = sections[0].facts as Array<{ name: string; value: string }>;

    const newAlertsFact = facts.find((f) => f.name === "New Alerts");
    expect(newAlertsFact?.value).toBe("5");
    const eolFact = facts.find((f) => f.name === "EOL Warnings");
    expect(eolFact?.value).toBe("3");
  });

  it("should use fallback color for unknown severity", () => {
    const event = makeEvent({ severity: "unknown" as any });
    const result = formatTeamsMessage(event);
    const body = result.body as Record<string, unknown>;
    expect(body.themeColor).toBe("808080"); // fallback gray
  });
});

// ─── Notification filter matching ───

describe("NotificationService filter matching (unit logic)", () => {
  // We test the filter logic directly since matchesFilters is private.
  // We replicate the logic here to test filtering behavior.
  const SEVERITY_ORDER = ["info", "low", "medium", "high", "critical"];

  function matchesFilters(channel: NotificationChannel, event: NotificationEvent): boolean {
    const f = channel.filters;
    if (f.minSeverity) {
      const minIdx = SEVERITY_ORDER.indexOf(f.minSeverity);
      const eventIdx = SEVERITY_ORDER.indexOf(event.severity);
      if (minIdx >= 0 && eventIdx >= 0 && eventIdx < minIdx) return false;
    }
    if (f.eventTypes && f.eventTypes.length > 0) {
      if (!f.eventTypes.includes(event.eventType)) return false;
    }
    if (f.environments && f.environments.length > 0 && event.details.environment) {
      if (!f.environments.includes(event.details.environment)) return false;
    }
    return true;
  }

  it("should filter by minimum severity", () => {
    const channel = makeChannel({ filters: { minSeverity: "high" } });

    expect(matchesFilters(channel, makeEvent({ severity: "critical" }))).toBe(true);
    expect(matchesFilters(channel, makeEvent({ severity: "high" }))).toBe(true);
    expect(matchesFilters(channel, makeEvent({ severity: "medium" }))).toBe(false);
    expect(matchesFilters(channel, makeEvent({ severity: "low" }))).toBe(false);
    expect(matchesFilters(channel, makeEvent({ severity: "info" }))).toBe(false);
  });

  it("should filter by event type", () => {
    const channel = makeChannel({
      filters: { eventTypes: ["alert_created", "eol_detected"] },
    });

    expect(matchesFilters(channel, makeEvent({ eventType: "alert_created" }))).toBe(true);
    expect(matchesFilters(channel, makeEvent({ eventType: "eol_detected" }))).toBe(true);
    expect(matchesFilters(channel, makeEvent({ eventType: "daily_digest" }))).toBe(false);
  });

  it("should filter by environment", () => {
    const channel = makeChannel({
      filters: { environments: ["production"] },
    });

    expect(matchesFilters(channel, makeEvent({ details: { environment: "production" } }))).toBe(true);
    expect(matchesFilters(channel, makeEvent({ details: { environment: "staging" } }))).toBe(false);
    // No environment in event → passes (environment filter only applies when event has environment)
    expect(matchesFilters(channel, makeEvent({ details: {} }))).toBe(true);
  });

  it("should pass all events when no filters set", () => {
    const channel = makeChannel({ filters: {} });
    expect(matchesFilters(channel, makeEvent({ severity: "info", eventType: "daily_digest" }))).toBe(true);
  });
});

// ─── Dedup key logic ───

describe("Dedup key generation", () => {
  // Replicate dedupKey logic from NotificationService
  function dedupKey(channelId: string, event: NotificationEvent): string {
    const host = event.details.hostId ?? event.details.hostname ?? "";
    return `${channelId}:${event.eventType}:${host}:${event.details.packageName ?? ""}`;
  }

  it("should generate unique keys for different hosts", () => {
    const e1 = makeEvent({ details: { hostId: "host-1", packageName: "nginx" } });
    const e2 = makeEvent({ details: { hostId: "host-2", packageName: "nginx" } });

    expect(dedupKey("ch-1", e1)).not.toBe(dedupKey("ch-1", e2));
  });

  it("should generate unique keys for different packages", () => {
    const e1 = makeEvent({ details: { hostId: "host-1", packageName: "nginx" } });
    const e2 = makeEvent({ details: { hostId: "host-1", packageName: "openssl" } });

    expect(dedupKey("ch-1", e1)).not.toBe(dedupKey("ch-1", e2));
  });

  it("should generate same key for duplicate events", () => {
    const e1 = makeEvent({ details: { hostId: "host-1", packageName: "nginx" } });
    const e2 = makeEvent({ details: { hostId: "host-1", packageName: "nginx" } });

    expect(dedupKey("ch-1", e1)).toBe(dedupKey("ch-1", e2));
  });

  it("should differentiate by channel", () => {
    const event = makeEvent();
    expect(dedupKey("ch-1", event)).not.toBe(dedupKey("ch-2", event));
  });

  it("should fall back to hostname when no hostId", () => {
    const event = makeEvent({ details: { hostname: "web-01" } });
    const key = dedupKey("ch-1", event);
    expect(key).toContain("web-01");
  });
});
