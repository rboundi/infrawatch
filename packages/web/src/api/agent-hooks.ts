import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post, patch, del } from "./client";

// ─── Types ───

export interface AgentToken {
  id: string;
  name: string;
  description: string | null;
  scope: "single" | "fleet";
  lockedHostname: string | null;
  environmentTag: string | null;
  hostGroupIds: string[];
  isActive: boolean;
  lastUsedAt: string | null;
  reportCount: number;
  createdAt: string;
  expiresAt: string | null;
}

export interface AgentTokenDetail extends AgentToken {
  lastUsedIp: string | null;
  hostCount: number;
}

export interface CreateAgentTokenData {
  name: string;
  description?: string;
  scope?: "single" | "fleet";
  allowedHostnames?: string[];
  environmentTag?: string;
  hostGroupIds?: string[];
  expiresAt?: string;
}

export interface CreateAgentTokenResponse {
  id: string;
  name: string;
  token: string;
  scope: string;
  createdAt: string;
  message: string;
}

export interface RotateTokenResponse {
  id: string;
  name: string;
  token: string;
  scope: string;
  createdAt: string;
  message: string;
}

export interface UpdateAgentTokenData {
  name?: string;
  description?: string;
  allowedHostnames?: string[];
  environmentTag?: string;
  hostGroupIds?: string[];
  isActive?: boolean;
  expiresAt?: string | null;
}

// ─── Hooks ───

export function useAgentTokens() {
  return useQuery({
    queryKey: ["admin", "agent-tokens"],
    queryFn: () => get<AgentToken[]>("/agent-tokens"),
    staleTime: 30_000,
  });
}

export function useAgentToken(id: string | undefined) {
  return useQuery({
    queryKey: ["admin", "agent-tokens", id],
    queryFn: () => get<AgentTokenDetail>(`/agent-tokens/${id}`),
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function useCreateAgentToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateAgentTokenData) =>
      post<CreateAgentTokenResponse>("/agent-tokens", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "agent-tokens"] }),
  });
}

export function useUpdateAgentToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateAgentTokenData }) =>
      patch<AgentToken>(`/agent-tokens/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "agent-tokens"] }),
  });
}

export function useDeleteAgentToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del(`/agent-tokens/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "agent-tokens"] }),
  });
}

export function useRotateAgentToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      post<RotateTokenResponse>(`/agent-tokens/${id}/rotate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "agent-tokens"] }),
  });
}

export function useRevokeAgentToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      post<{ message: string }>(`/agent-tokens/${id}/revoke`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "agent-tokens"] }),
  });
}
