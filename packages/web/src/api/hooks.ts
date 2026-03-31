import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post, patch, del } from "./client";
import type {
  OverviewStats,
  HostSummary,
  HostDetail,
  Alert,
  AlertsSummary,
  ScanTarget,
  ScanLog,
  ScanLogDetail,
  PaginatedResponse,
  HostsParams,
  AlertsParams,
  UnifiedAlert,
  UnifiedAlertsSummary,
  UnifiedAlertsParams,
} from "./types";

// ─── Queries ───

export function useOverviewStats() {
  return useQuery({
    queryKey: ["stats", "overview"],
    queryFn: () => get<OverviewStats>("/stats/overview"),
    refetchInterval: 30_000,
  });
}

export function useHosts(params: HostsParams = {}) {
  return useQuery({
    queryKey: ["hosts", params],
    queryFn: () =>
      get<PaginatedResponse<HostSummary>>("/hosts", params as Record<string, unknown>),
  });
}

export function useHost(id: string | undefined) {
  return useQuery({
    queryKey: ["hosts", id],
    queryFn: () => get<HostDetail>(`/hosts/${id}`),
    enabled: !!id,
  });
}

export function useAlerts(params: AlertsParams = {}) {
  return useQuery({
    queryKey: ["alerts", params],
    queryFn: () =>
      get<PaginatedResponse<Alert>>("/alerts", params as Record<string, unknown>),
  });
}

export function useAlertsSummary() {
  return useQuery({
    queryKey: ["alerts", "summary"],
    queryFn: () => get<AlertsSummary>("/alerts/summary"),
    refetchInterval: 30_000,
  });
}

export function useAlertRemediation(alertId: string | null) {
  return useQuery({
    queryKey: ["alerts", "remediation", alertId],
    queryFn: () => get<import("./types").RemediationResult>(`/alerts/${alertId}/remediation`),
    enabled: !!alertId,
  });
}

export function useBulkRemediation() {
  return useMutation({
    mutationFn: (alertIds: string[]) =>
      post<import("./types").BulkRemediationPlan[]>("/alerts/bulk-remediation", { alertIds }),
  });
}

export function useHostRemediation(hostId: string | null) {
  return useQuery({
    queryKey: ["hosts", "remediation", hostId],
    queryFn: () => get<import("./types").HostRemediationPlan>(`/hosts/${hostId}/remediation`),
    enabled: !!hostId,
  });
}

export function useScanTargets() {
  return useQuery({
    queryKey: ["targets"],
    queryFn: () => get<ScanTarget[]>("/targets"),
  });
}

export function useScanTarget(id: string | undefined) {
  return useQuery({
    queryKey: ["targets", id],
    queryFn: () => get<ScanTarget>(`/targets/${id}`),
    enabled: !!id,
  });
}

export function useScanLogs(targetId: string | undefined, params: { page?: number; limit?: number } = {}) {
  return useQuery({
    queryKey: ["targets", targetId, "scan-logs", params],
    queryFn: () => get<PaginatedResponse<ScanLog>>(`/targets/${targetId}/scan-logs`, params as Record<string, unknown>),
    enabled: !!targetId,
  });
}

export function useScanLogDetail(targetId: string | undefined, logId: string | undefined) {
  return useQuery({
    queryKey: ["targets", targetId, "scan-logs", logId],
    queryFn: () => get<ScanLogDetail>(`/targets/${targetId}/scan-logs/${logId}`),
    enabled: !!targetId && !!logId,
  });
}

export function useHostPackages(
  id: string | undefined,
  params: { search?: string; ecosystem?: string; hasUpdate?: string; page?: number; limit?: number } = {}
) {
  return useQuery({
    queryKey: ["hosts", id, "packages", params],
    queryFn: () =>
      get<PaginatedResponse<import("./types").PackageInfo>>(
        `/hosts/${id}/packages`,
        params as Record<string, unknown>
      ),
    enabled: !!id,
  });
}

export function useHostHistory(id: string | undefined) {
  return useQuery({
    queryKey: ["hosts", id, "history"],
    queryFn: () => get<{ data: ScanLog[] }>(`/hosts/${id}/history`),
    enabled: !!id,
  });
}

export function useDiscoveryResults(params: import("./types").DiscoveryParams = {}) {
  return useQuery({
    queryKey: ["discovery", params],
    queryFn: () => get<PaginatedResponse<import("./types").DiscoveryResult>>("/discovery", params as Record<string, unknown>),
  });
}

// ─── Mutations ───

export function usePromoteDiscovery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; type: string; templateTargetId: string; name?: string }) =>
      post<import("./types").ScanTarget>(`/discovery/${id}/promote`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["discovery"] });
      qc.invalidateQueries({ queryKey: ["targets"] });
    },
  });
}

export function useDismissDiscovery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => patch<void>(`/discovery/${id}/dismiss`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["discovery"] });
    },
  });
}

export function useAcknowledgeAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; acknowledgedBy?: string; notes?: string }) =>
      patch<Alert>(`/alerts/${id}/acknowledge`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["alerts"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export function useBulkAcknowledgeAlerts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { alertIds: string[]; acknowledgedBy?: string; notes?: string }) =>
      post<{ acknowledged: number; ids: string[] }>("/alerts/bulk-acknowledge", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["alerts"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export function useTriggerScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (targetId: string) =>
      post<{ message: string; scanLogId: string }>(`/targets/${targetId}/scan`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["targets"] });
    },
  });
}

export function useCancelScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (targetId: string) =>
      post<{ message: string }>(`/targets/${targetId}/cancel`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["targets"] });
    },
  });
}

export function useCreateTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: import("./types").CreateTargetPayload) =>
      post<ScanTarget>("/targets", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["targets"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export function useUpdateTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & import("./types").UpdateTargetPayload) =>
      patch<ScanTarget>(`/targets/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["targets"] });
    },
  });
}

export function useDeleteTarget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del(`/targets/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["targets"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export function useTestConnection() {
  return useMutation({
    mutationFn: (targetId: string) =>
      post<import("./types").TestConnectionResult>(`/targets/${targetId}/test`),
  });
}

// ─── EOL hooks ───

export function useEolAlerts(params: import("./types").EolAlertsParams = {}) {
  return useQuery({
    queryKey: ["eol", "alerts", params],
    queryFn: () =>
      get<PaginatedResponse<import("./types").EolAlert>>("/eol/alerts", params as Record<string, unknown>),
  });
}

export function useEolAlertsSummary() {
  return useQuery({
    queryKey: ["eol", "alerts", "summary"],
    queryFn: () => get<import("./types").EolAlertsSummary>("/eol/alerts/summary"),
    refetchInterval: 60_000,
  });
}

export function useAcknowledgeEolAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; acknowledgedBy?: string }) =>
      patch<import("./types").EolAlert>(`/eol/alerts/${id}/acknowledge`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["eol"] });
    },
  });
}

export function useExemptEolAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; exemptionReason: string; acknowledgedBy?: string }) =>
      patch<import("./types").EolAlert>(`/eol/alerts/${id}/exempt`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["eol"] });
    },
  });
}

// ─── Change detection hooks ───

export function useChanges(params: import("./types").ChangesParams = {}) {
  return useQuery({
    queryKey: ["changes", params],
    queryFn: () =>
      get<PaginatedResponse<import("./types").ChangeEvent>>("/changes", params as Record<string, unknown>),
  });
}

export function useChangeSummary() {
  return useQuery({
    queryKey: ["changes", "summary"],
    queryFn: () => get<import("./types").ChangeSummary>("/changes/summary"),
    refetchInterval: 30_000,
  });
}

export function useChangeTrends() {
  return useQuery({
    queryKey: ["changes", "trends"],
    queryFn: () =>
      get<{ trends: import("./types").ChangeTrend[]; snapshots: import("./types").ChangeSnapshot[] }>(
        "/changes/trends"
      ),
  });
}

// ─── Report hooks ───

export function useReportSchedules() {
  return useQuery({
    queryKey: ["reports", "schedules"],
    queryFn: () => get<import("./types").ReportSchedule[]>("/reports/schedules"),
  });
}

export function useReportHistory(params: { page?: number; limit?: number } = {}) {
  return useQuery({
    queryKey: ["reports", "history", params],
    queryFn: () =>
      get<PaginatedResponse<import("./types").GeneratedReport>>("/reports/history", params as Record<string, unknown>),
  });
}

export function useCreateReportSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      name: string; reportType: string; scheduleCron?: string;
      recipients?: string[]; filters?: Record<string, unknown>; enabled?: boolean;
    }) => post<import("./types").ReportSchedule>("/reports/schedules", body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["reports"] }); },
  });
}

export function useUpdateReportSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Partial<{
      name: string; reportType: string; scheduleCron: string;
      recipients: string[]; filters: Record<string, unknown>; enabled: boolean;
    }>) => patch<import("./types").ReportSchedule>(`/reports/schedules/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["reports"] }); },
  });
}

export function useDeleteReportSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del(`/reports/schedules/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["reports"] }); },
  });
}

export function useTriggerReportGeneration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      post<{ message: string; reportId: string }>(`/reports/schedules/${id}/generate`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["reports"] }); },
  });
}

export function useGenerateReportPreview() {
  return useMutation({
    mutationFn: async (body: { reportType: string; filters?: Record<string, unknown> }) => {
      const res = await fetch("/api/v1/reports/generate-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to generate preview");
      return res.text();
    },
  });
}

// ─── Notification hooks ───

export function useNotificationChannels() {
  return useQuery({
    queryKey: ["notifications", "channels"],
    queryFn: () => get<import("./types").NotificationChannel[]>("/notifications/channels"),
  });
}

export function useCreateNotificationChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      name: string; channelType: string; webhookUrl?: string;
      config?: Record<string, unknown>; filters?: Record<string, unknown>; enabled?: boolean;
    }) => post<import("./types").NotificationChannel>("/notifications/channels", body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["notifications"] }); },
  });
}

export function useUpdateNotificationChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Partial<{
      name: string; channelType: string; webhookUrl: string;
      config: Record<string, unknown>; filters: Record<string, unknown>; enabled: boolean;
    }>) => patch<import("./types").NotificationChannel>(`/notifications/channels/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["notifications"] }); },
  });
}

export function useDeleteNotificationChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del(`/notifications/channels/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["notifications"] }); },
  });
}

export function useTestNotificationChannel() {
  return useMutation({
    mutationFn: (id: string) =>
      post<{ success: boolean; message: string; responseCode?: number }>(`/notifications/channels/${id}/test`),
  });
}

export function useNotificationLog(params: { page?: number; limit?: number; channelId?: string } = {}) {
  return useQuery({
    queryKey: ["notifications", "log", params],
    queryFn: () =>
      get<PaginatedResponse<import("./types").NotificationLogEntry>>("/notifications/log", params as Record<string, unknown>),
  });
}

export function useNotificationLogStats() {
  return useQuery({
    queryKey: ["notifications", "log", "stats"],
    queryFn: () => get<import("./types").NotificationLogStats>("/notifications/log/stats"),
    refetchInterval: 30_000,
  });
}

// ─── Groups ───

export function useGroups() {
  return useQuery({
    queryKey: ["groups"],
    queryFn: () => get<{ data: import("./types").HostGroup[] }>("/groups"),
  });
}

export function useGroupDetail(id: string | null) {
  return useQuery({
    queryKey: ["groups", id],
    queryFn: () => get<import("./types").HostGroupDetail>(`/groups/${id}`),
    enabled: !!id,
  });
}

export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      post<import("./types").HostGroup>("/groups", body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["groups"] }); },
  });
}

export function useUpdateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
      patch<import("./types").HostGroup>(`/groups/${id}`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["groups"] }); },
  });
}

export function useDeleteGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del(`/groups/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["groups"] }); },
  });
}

export function useAddGroupRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, ...body }: { groupId: string; ruleType: string; ruleValue: string; priority?: number }) =>
      post(`/groups/${groupId}/rules`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["groups"] }); },
  });
}

export function useDeleteGroupRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, ruleId }: { groupId: string; ruleId: string }) =>
      del(`/groups/${groupId}/rules/${ruleId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["groups"] }); },
  });
}

export function useAddGroupMembers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, hostIds }: { groupId: string; hostIds: string[] }) =>
      post(`/groups/${groupId}/members`, { hostIds }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["groups"] }); },
  });
}

export function useRemoveGroupMembers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, hostIds }: { groupId: string; hostIds: string[] }) =>
      del(`/groups/${groupId}/members`, { hostIds }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["groups"] }); },
  });
}

export function useEvaluateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (groupId: string) =>
      post<{ added: number; removed: number }>(`/groups/${groupId}/evaluate`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["groups"] }); },
  });
}

export function usePreviewRule() {
  return useMutation({
    mutationFn: (body: { ruleType: string; ruleValue: string }) =>
      post<{ matchCount: number }>("/groups/preview-rule", body),
  });
}

// ─── Host Tags ───

export function useHostTags(hostId: string) {
  return useQuery({
    queryKey: ["hosts", hostId, "tags"],
    queryFn: () => get<{ data: import("./types").HostTag[] }>(`/hosts/${hostId}/tags`),
    enabled: !!hostId,
  });
}

export function useCreateHostTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ hostId, key, value }: { hostId: string; key: string; value?: string }) =>
      post<import("./types").HostTag>(`/hosts/${hostId}/tags`, { key, value }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["hosts", vars.hostId] });
    },
  });
}

export function useDeleteHostTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ hostId, tagKey }: { hostId: string; tagKey: string }) =>
      del(`/hosts/${hostId}/tags/${tagKey}`),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["hosts", vars.hostId] });
    },
  });
}

// ─── Compliance ───

export function useComplianceFleet() {
  return useQuery({
    queryKey: ["compliance", "fleet"],
    queryFn: () => get<import("./types").ComplianceFleetData>("/compliance/fleet"),
    refetchInterval: 60_000,
  });
}

export function useComplianceHosts(params: import("./types").ComplianceHostsParams = {}) {
  return useQuery({
    queryKey: ["compliance", "hosts", params],
    queryFn: () =>
      get<PaginatedResponse<import("./types").ComplianceHostScore>>("/compliance/hosts", params as Record<string, unknown>),
  });
}

export function useComplianceHostDetail(hostId: string | null) {
  return useQuery({
    queryKey: ["compliance", "hosts", hostId],
    queryFn: () => get<import("./types").ComplianceHostScore>(`/compliance/hosts/${hostId}`),
    enabled: !!hostId,
  });
}

export function useComplianceGroups() {
  return useQuery({
    queryKey: ["compliance", "groups"],
    queryFn: () => get<import("./types").ComplianceGroupScore[]>("/compliance/groups"),
  });
}

export function useComplianceEnvironments() {
  return useQuery({
    queryKey: ["compliance", "environments"],
    queryFn: () => get<import("./types").ComplianceEnvironmentScore[]>("/compliance/environments"),
  });
}

export function useComplianceTrend(params: { entityType?: string; entityId?: string; days?: number } = {}) {
  return useQuery({
    queryKey: ["compliance", "trend", params],
    queryFn: () =>
      get<import("./types").ComplianceTrendPoint[]>("/compliance/trend", params as Record<string, unknown>),
  });
}

export function useRecalculateCompliance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post<{ message: string }>("/compliance/recalculate"),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["compliance"] }); },
  });
}

// ─── Dependencies ───

export function useHostConnections(params: { hostId?: string; direction?: string; limit?: number; offset?: number } = {}) {
  return useQuery({
    queryKey: ["dependencies", "connections", params],
    queryFn: () =>
      get<{ data: import("./types").HostConnection[]; total: number }>("/dependencies/connections", params as Record<string, unknown>),
  });
}

export function useImpactAnalysis(hostId: string | null) {
  return useQuery({
    queryKey: ["dependencies", "impact", hostId],
    queryFn: () => get<import("./types").ImpactResult>(`/dependencies/impact/${hostId}`),
    enabled: !!hostId,
  });
}

export function useDependencyMap() {
  return useQuery({
    queryKey: ["dependencies", "map"],
    queryFn: () => get<import("./types").DependencyMapData>("/dependencies/map"),
  });
}

export function useDependencyAnnotations(hostId?: string) {
  return useQuery({
    queryKey: ["dependencies", "annotations", hostId],
    queryFn: () =>
      get<import("./types").DependencyAnnotation[]>(
        "/dependencies/annotations",
        hostId ? { hostId } : undefined
      ),
  });
}

export function useCreateAnnotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { sourceHostId: string; targetHostId: string; label: string; notes?: string; createdBy?: string }) =>
      post<import("./types").DependencyAnnotation>("/dependencies/annotations", body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["dependencies"] }); },
  });
}

export function useDeleteAnnotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del(`/dependencies/annotations/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["dependencies"] }); },
  });
}

// ─── Unified Alerts ───

export function useUnifiedAlerts(params: UnifiedAlertsParams = {}) {
  return useQuery({
    queryKey: ["unified-alerts", params],
    queryFn: () =>
      get<PaginatedResponse<UnifiedAlert>>("/alerts/unified", params as Record<string, unknown>),
  });
}

export function useUnifiedAlertsSummary() {
  return useQuery({
    queryKey: ["unified-alerts", "summary"],
    queryFn: () => get<UnifiedAlertsSummary>("/alerts/unified/summary"),
    refetchInterval: 30_000,
  });
}
