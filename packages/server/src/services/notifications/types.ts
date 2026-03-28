export interface NotificationEvent {
  eventType:
    | "alert_created"
    | "eol_detected"
    | "host_disappeared"
    | "scan_failed"
    | "daily_digest";
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string;
  summary: string;
  details: {
    hostname?: string;
    hostId?: string;
    packageName?: string;
    currentVersion?: string;
    availableVersion?: string;
    cveIds?: string[];
    environment?: string;
    affectedHostCount?: number;
    targetName?: string;
    errorMessage?: string;
    lastSeenAt?: string;
    // Daily digest fields
    alertsBySeverity?: Record<string, number>;
    eolWarnings?: number;
    staleHosts?: number;
    newAlerts?: number;
    // Generic extra data
    [key: string]: unknown;
  };
}

export interface NotificationChannel {
  id: string;
  name: string;
  channelType: "ms_teams" | "slack" | "generic_webhook" | "email";
  webhookUrl: string | null;
  config: Record<string, unknown>;
  filters: {
    minSeverity?: string;
    eventTypes?: string[];
    environments?: string[];
  };
  enabled: boolean;
}

export interface FormattedMessage {
  /** JSON body to POST */
  body: unknown;
  /** Optional content-type override (default application/json) */
  contentType?: string;
}
