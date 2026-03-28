import type { NotificationEvent, FormattedMessage } from "../types.js";

const SEVERITY_COLORS: Record<string, string> = {
  critical: "#FF0000",
  high: "#FF8C00",
  medium: "#FFD700",
  low: "#4169E1",
  info: "#808080",
};

export function formatSlackMessage(
  event: NotificationEvent,
  dashboardUrl?: string
): FormattedMessage {
  if (event.eventType === "daily_digest") {
    return formatDigestBlocks(event, dashboardUrl);
  }

  const color = SEVERITY_COLORS[event.severity] ?? "#808080";
  const fields = buildFields(event);
  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: event.title, emoji: true },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: event.summary },
    },
    { type: "divider" },
    {
      type: "section",
      fields,
    },
  ];

  // Action button
  if (dashboardUrl && event.details.hostId) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "View in InfraWatch" },
          url: `${dashboardUrl}/hosts/${event.details.hostId}`,
          style: "primary",
        },
      ],
    });
  }

  // Context
  blocks.push({
    type: "context",
    elements: [
      { type: "mrkdwn", text: `*InfraWatch* | ${new Date().toISOString()}` },
    ],
  });

  return {
    body: {
      blocks,
      attachments: [{ color, blocks: [] }],
    },
  };
}

function formatDigestBlocks(
  event: NotificationEvent,
  dashboardUrl?: string
): FormattedMessage {
  const d = event.details;
  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: event.title, emoji: true },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: event.summary },
    },
    { type: "divider" },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*New Alerts:* ${d.newAlerts ?? 0}` },
        { type: "mrkdwn", text: `*Critical:* ${d.alertsBySeverity?.critical ?? 0}` },
        { type: "mrkdwn", text: `*High:* ${d.alertsBySeverity?.high ?? 0}` },
        { type: "mrkdwn", text: `*EOL Warnings:* ${d.eolWarnings ?? 0}` },
        { type: "mrkdwn", text: `*Stale Hosts:* ${d.staleHosts ?? 0}` },
      ],
    },
  ];

  if (dashboardUrl) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "View Dashboard" },
          url: dashboardUrl,
          style: "primary",
        },
      ],
    });
  }

  return {
    body: {
      blocks,
      attachments: [{ color: "#4169E1", blocks: [] }],
    },
  };
}

function buildFields(
  event: NotificationEvent
): Array<{ type: string; text: string }> {
  const fields: Array<{ type: string; text: string }> = [];
  const d = event.details;

  fields.push({ type: "mrkdwn", text: `*Severity:* ${event.severity.toUpperCase()}` });
  if (d.hostname) fields.push({ type: "mrkdwn", text: `*Host:* ${d.hostname}` });
  if (d.packageName) fields.push({ type: "mrkdwn", text: `*Package:* ${d.packageName}` });
  if (d.currentVersion && d.availableVersion) {
    fields.push({ type: "mrkdwn", text: `*Versions:* ${d.currentVersion} → ${d.availableVersion}` });
  }
  if (d.environment) fields.push({ type: "mrkdwn", text: `*Environment:* ${d.environment}` });
  if (d.targetName) fields.push({ type: "mrkdwn", text: `*Target:* ${d.targetName}` });
  if (d.errorMessage) fields.push({ type: "mrkdwn", text: `*Error:* ${d.errorMessage}` });

  return fields;
}
