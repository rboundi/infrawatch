// ─── Shared API response types ───

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}

export interface OverviewStats {
  totalHosts: number;
  activeHosts: number;
  staleHosts: number;
  totalPackages: number;
  totalAlerts: number;
  criticalAlerts: number;
  scanTargets: number;
  lastScanAt: string | null;
  networkDiscoveryHosts: number;
  autoPromotedTargets: number;
  groups?: Array<{
    id: string;
    name: string;
    color: string | null;
    icon: string | null;
    memberCount: number;
    openAlerts: number;
  }>;
}

export interface HostSummary {
  id: string;
  hostname: string;
  ip: string | null;
  os: string | null;
  osVersion: string | null;
  arch: string | null;
  environmentTag: string | null;
  lastSeenAt: string;
  firstSeenAt: string;
  status: "active" | "stale" | "decommissioned";
  scanTargetName: string | null;
  packageCount: number;
  openAlertCount: number;
}

export interface HostDetail extends HostSummary {
  metadata: Record<string, unknown>;
  scanTargetId: string | null;
  packages: PackageInfo[];
  services: ServiceInfo[];
  recentAlerts: Alert[];
  groups?: HostGroupMembership[];
  tags?: HostTag[];
}

export interface HostGroupMembership {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  assignedBy: "manual" | "rule";
}

export interface HostTag {
  id: string;
  key: string;
  value: string | null;
}

export interface PackageInfo {
  id: string;
  packageName: string;
  installedVersion: string | null;
  packageManager: string | null;
  ecosystem: string | null;
  firstDetectedAt: string;
  lastDetectedAt: string;
  updateAvailable: boolean;
}

export interface ServiceInfo {
  id: string;
  serviceName: string;
  serviceType: string | null;
  version: string | null;
  port: number | null;
  status: string;
  detectedAt: string;
  lastSeenAt: string;
}

export interface Alert {
  id: string;
  hostId: string;
  hostname?: string | null;
  packageId: string | null;
  packageName: string;
  currentVersion: string | null;
  availableVersion: string | null;
  severity: "critical" | "high" | "medium" | "low" | "info";
  acknowledged: boolean;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  notes: string | null;
  createdAt: string;
}

export interface AlertsSummary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  unacknowledged: number;
}

export interface ScanTarget {
  id: string;
  name: string;
  type: string;
  scanIntervalHours: number;
  lastScannedAt: string | null;
  lastScanStatus: string;
  lastScanError?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ScanLog {
  id: string;
  scanTargetId: string;
  startedAt: string;
  completedAt: string | null;
  status: string;
  hostsDiscovered: number;
  packagesDiscovered: number;
  errorMessage: string | null;
}

export interface TestConnectionResult {
  success: boolean;
  message: string;
  latencyMs: number;
}

export interface CreateTargetPayload {
  name: string;
  type: string;
  connectionConfig: Record<string, unknown>;
  scanIntervalHours?: number;
  enabled?: boolean;
}

export interface UpdateTargetPayload {
  name?: string;
  type?: string;
  connectionConfig?: Record<string, unknown>;
  scanIntervalHours?: number;
  enabled?: boolean;
}

export interface DiscoveryResult {
  id: string;
  scanTargetId: string;
  scanLogId: string | null;
  ipAddress: string;
  hostname: string | null;
  macAddress: string | null;
  macVendor: string | null;
  osMatch: string | null;
  osAccuracy: number | null;
  openPorts: Array<{ port: number; protocol: string; state: string; service: string; product: string; version: string }>;
  detectedPlatform: string | null;
  autoPromoted: boolean;
  dismissed: boolean;
  createdAt: string;
  hostId: string | null;
}

export interface DiscoveryParams {
  scanTargetId?: string;
  platform?: string;
  hasPort?: number;
  search?: string;
  autoPromoted?: string;
  dismissed?: string;
  page?: number;
  limit?: number;
}

export interface HostsParams {
  status?: string;
  environment?: string;
  groupId?: string;
  search?: string;
  sortBy?: string;
  order?: string;
  page?: number;
  limit?: number;
}

export interface AlertsParams {
  severity?: string;
  acknowledged?: string;
  hostId?: string;
  groupId?: string;
  search?: string;
  sortBy?: string;
  order?: string;
  page?: number;
  limit?: number;
}

// ─── Change detection types ───

export interface ChangeEvent {
  id: string;
  hostId: string | null;
  hostname: string;
  eventType: string;
  category: string;
  summary: string;
  details: Record<string, unknown>;
  scanTargetId: string | null;
  createdAt: string;
}

export interface ChangeSummary {
  total: number;
  last24h: number;
  last7d: number;
  byCategory: {
    host: number;
    package: number;
    service: number;
    config: number;
  };
}

export interface ChangeTrend {
  date: string;
  count: number;
}

export interface ChangeSnapshot {
  date: string;
  totalHosts: number;
  activeHosts: number;
  totalPackages: number;
  totalServices: number;
  totalAlerts: number;
  criticalAlerts: number;
}

// ─── EOL types ───

export interface EolAlert {
  id: string;
  hostId: string;
  hostname: string;
  eolDefinitionId: string;
  productName: string;
  productCategory: string;
  installedVersion: string;
  eolDate: string;
  daysPastEol: number;
  successorVersion: string | null;
  status: "active" | "acknowledged" | "exempted" | "resolved";
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  exemptionReason: string | null;
  sourceUrl: string | null;
  lts: boolean;
  createdAt: string;
}

export interface EolAlertsSummary {
  totalActive: number;
  pastEol: number;
  upcomingEol: number;
  within6Months: number;
  byProduct: Array<{ product: string; count: number }>;
  byCategory: Array<{ category: string; count: number }>;
  mostAffectedHosts: Array<{ id: string; hostname: string; eolCount: number }>;
}

export interface EolAlertsParams {
  status?: string;
  product?: string;
  hostId?: string;
  daysRange?: string;
  search?: string;
  sortBy?: string;
  order?: string;
  page?: number;
  limit?: number;
}

export interface ChangesParams {
  eventType?: string;
  category?: string;
  hostId?: string;
  groupId?: string;
  search?: string;
  since?: string;
  until?: string;
  sortBy?: string;
  order?: string;
  page?: number;
  limit?: number;
}

// ─── Report types ───

export interface ReportSchedule {
  id: string;
  name: string;
  reportType: string;
  scheduleCron: string;
  recipients: string[];
  filters: Record<string, unknown>;
  enabled: boolean;
  lastGeneratedAt: string | null;
  lastGenerationStatus: string | null;
  createdAt: string;
}

export interface GeneratedReport {
  id: string;
  reportScheduleId: string | null;
  scheduleName: string | null;
  reportType: string;
  title: string;
  fileSizeBytes: number;
  periodStart: string | null;
  periodEnd: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

// ─── Remediation types ───

export interface RemediationCommand {
  step: number;
  description: string;
  command: string;
  runAs: "root" | "sudo" | "user";
  platform: string;
}

export interface RemediationResult {
  commands: RemediationCommand[];
  warnings: string[];
  notes: string[];
  rollbackCommands: RemediationCommand[];
  requiresRestart: boolean;
  affectedServices: string[];
  estimatedDowntime: "none" | "seconds" | "minutes" | "unknown";
}

export interface HostRemediationPlan {
  hostId: string;
  hostname: string;
  os: string | null;
  preUpdate: RemediationCommand[];
  packageUpdates: Array<{ packageName: string; commands: RemediationCommand[] }>;
  serviceRestarts: RemediationCommand[];
  postUpdate: RemediationCommand[];
  reboot: RemediationCommand[];
  rollbackCommands: RemediationCommand[];
  warnings: string[];
  notes: string[];
  requiresReboot: boolean;
  estimatedDowntime: "none" | "seconds" | "minutes" | "unknown";
}

export interface BulkRemediationPlan {
  hostId: string;
  hostname: string;
  remediations: Array<{
    alertId: string;
    packageName: string;
    remediation: RemediationResult;
  }>;
}

// ─── Notification types ───

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
  lastSentAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationLogEntry {
  id: string;
  channelId: string;
  channelName: string | null;
  channelType: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  status: "sent" | "failed" | "throttled";
  errorMessage: string | null;
  responseCode: number | null;
  createdAt: string;
}

export interface NotificationLogStats {
  sent24h: number;
  failed24h: number;
  throttled24h: number;
  byChannel: Array<{
    id: string;
    name: string;
    channelType: string;
    sent: number;
    failed: number;
  }>;
}

// ─── Group types ───

export interface HostGroup {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  notificationChannelIds: string[];
  alertSeverityThreshold: string;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
  ruleCount: number;
  criticalAlerts: number;
  highAlerts: number;
  mediumAlerts: number;
  lowAlerts: number;
  activeHosts: number;
  staleHosts: number;
}

export interface HostGroupRule {
  id: string;
  hostGroupId: string;
  ruleType: string;
  ruleValue: string;
  priority: number;
  createdAt: string;
}

export interface HostGroupMember {
  id: string;
  hostname: string;
  ip: string | null;
  os: string | null;
  status: string;
  environment: string | null;
  lastSeenAt: string;
  assignedBy: "manual" | "rule";
  ruleId: string | null;
  assignedAt: string;
  openAlertCount: number;
}

export interface HostGroupDetail extends HostGroup {
  rules: HostGroupRule[];
  members: HostGroupMember[];
  channels: Array<{ id: string; name: string }>;
}
