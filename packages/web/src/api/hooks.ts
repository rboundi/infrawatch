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
  PaginatedResponse,
  HostsParams,
  AlertsParams,
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

export function useScanTargets() {
  return useQuery({
    queryKey: ["targets"],
    queryFn: () => get<ScanTarget[]>("/targets"),
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
