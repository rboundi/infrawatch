import type { NotificationEvent, FormattedMessage } from "../types.js";

export function formatGenericWebhookMessage(
  event: NotificationEvent,
  channelConfig: Record<string, unknown>
): FormattedMessage {
  const bodyTemplate = channelConfig.bodyTemplate as string | undefined;

  if (bodyTemplate) {
    // Substitute {{variable}} placeholders
    const substituted = bodyTemplate.replace(
      /\{\{(\w+(?:\.\w+)*)\}\}/g,
      (_match, path: string) => {
        const value = resolvePath(event, path);
        return value !== undefined ? String(value) : "";
      }
    );

    // Try to parse as JSON, otherwise send as text
    try {
      return { body: JSON.parse(substituted) };
    } catch {
      return { body: substituted, contentType: "text/plain" };
    }
  }

  // Default: send raw event JSON
  return {
    body: {
      eventType: event.eventType,
      severity: event.severity,
      title: event.title,
      summary: event.summary,
      details: event.details,
      timestamp: new Date().toISOString(),
    },
  };
}

function resolvePath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
