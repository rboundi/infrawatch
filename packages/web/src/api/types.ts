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
  search?: string;
  sortBy?: string;
  order?: string;
  page?: number;
  limit?: number;
}
