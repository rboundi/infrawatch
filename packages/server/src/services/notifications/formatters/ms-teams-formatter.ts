import type { NotificationEvent, FormattedMessage } from "../types.js";

const SEVERITY_COLORS: Record<string, string> = {
  critical: "FF0000",
  high: "FF8C00",
  medium: "FFD700",
  low: "4169E1",
  info: "808080",
};

export function formatTeamsMessage(
  event: NotificationEvent,
  dashboardUrl?: string
): FormattedMessage {
  const color = SEVERITY_COLORS[event.severity] ?? "808080";
  const facts = buildFacts(event);

  if (event.eventType === "daily_digest") {
    return formatDigestCard(event, dashboardUrl);
  }

  const card: Record<string, unknown> = {
    "@type": "MessageCard",
    "@context": "https://schema.org/extensions",
    themeColor: color,
    summary: event.title,
    sections: [
      {
        activityTitle: event.title,
        activitySubtitle: event.summary,
        facts,
        markdown: true,
      },
    ],
    potentialAction: [] as unknown[],
  };

  // Add "View in InfraWatch" link
  if (dashboardUrl && event.details.hostId) {
    (card.potentialAction as unknown[]).push({
      "@type": "OpenUri",
      name: "View in InfraWatch",
      targets: [{ os: "default", uri: `${dashboardUrl}/hosts/${event.details.hostId}` }],
    });
  }

  return { body: card };
}

function formatDigestCard(
  event: NotificationEvent,
  dashboardUrl?: string
): FormattedMessage {
  const d = event.details;
  const facts = [
    { name: "New Alerts", value: String(d.newAlerts ?? 0) },
    { name: "Critical", value: String(d.alertsBySeverity?.critical ?? 0) },
    { name: "High", value: String(d.alertsBySeverity?.high ?? 0) },
    { name: "EOL Warnings", value: String(d.eolWarnings ?? 0) },
    { name: "Stale Hosts", value: String(d.staleHosts ?? 0) },
  ];

  const card: Record<string, unknown> = {
    "@type": "MessageCard",
    "@context": "https://schema.org/extensions",
    themeColor: "4169E1",
    summary: event.title,
    sections: [
      {
        activityTitle: event.title,
        activitySubtitle: event.summary,
        facts,
        markdown: true,
      },
    ],
    potentialAction: [] as unknown[],
  };

  if (dashboardUrl) {
    (card.potentialAction as unknown[]).push({
      "@type": "OpenUri",
      name: "View Dashboard",
      targets: [{ os: "default", uri: dashboardUrl }],
    });
  }

  return { body: card };
}

function buildFacts(
  event: NotificationEvent
): Array<{ name: string; value: string }> {
  const facts: Array<{ name: string; value: string }> = [];
  const d = event.details;

  facts.push({ name: "Severity", value: event.severity.toUpperCase() });

  if (d.hostname) facts.push({ name: "Host", value: d.hostname });
  if (d.packageName) facts.push({ name: "Package", value: d.packageName });
  if (d.currentVersion && d.availableVersion) {
    facts.push({ name: "Versions", value: `${d.currentVersion} → ${d.availableVersion}` });
  }
  if (d.environment) facts.push({ name: "Environment", value: d.environment });
  if (d.targetName) facts.push({ name: "Target", value: d.targetName });
  if (d.errorMessage) facts.push({ name: "Error", value: d.errorMessage });
  if (d.lastSeenAt) facts.push({ name: "Last Seen", value: d.lastSeenAt });
  if (d.cveIds && d.cveIds.length > 0) {
    facts.push({ name: "CVEs", value: d.cveIds.join(", ") });
  }

  return facts;
}
