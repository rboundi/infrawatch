import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { get, post, patch, del } from "./client";

// ─── Types ───

export interface User {
  id: string;
  username: string;
  email: string;
  displayName: string | null;
  role: "admin" | "operator";
  isActive: boolean;
  failedLoginAttempts: number;
  lockedUntil: string | null;
  forcePasswordChange: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  activeSessionCount?: number;
}

export interface UserListResponse {
  data: User[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface UserFilters {
  page?: number;
  limit?: number;
  role?: string;
  isActive?: boolean;
  search?: string;
}

export interface CreateUserData {
  username: string;
  email: string;
  displayName?: string;
  role?: "admin" | "operator";
  password?: string;
  autoGeneratePassword?: boolean;
}

export interface UpdateUserData {
  email?: string;
  displayName?: string;
  role?: "admin" | "operator";
  isActive?: boolean;
}

export interface SettingDefinition {
  key: string;
  value: unknown;
  description: string;
  valueType: "string" | "number" | "boolean" | "email" | "select";
  constraints?: {
    min?: number;
    max?: number;
    maxLength?: number;
    pattern?: string;
    options?: string[];
  };
}

export interface SettingsResponse {
  [category: string]: SettingDefinition[];
}

export interface AuditLogEntry {
  id: string;
  userId: string | null;
  username: string;
  displayName: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  details: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
}

export interface AuditLogResponse {
  data: AuditLogEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AuditLogFilters {
  page?: number;
  limit?: number;
  userId?: string;
  action?: string;
  entityType?: string;
  since?: string;
  until?: string;
}

// ─── User hooks ───

export function useUsers(filters: UserFilters = {}) {
  return useQuery({
    queryKey: ["admin", "users", filters],
    queryFn: () => get<UserListResponse>("/users", filters as Record<string, unknown>),
    staleTime: 30_000,
  });
}

export function useUser(id: string | undefined) {
  return useQuery({
    queryKey: ["admin", "users", id],
    queryFn: () => get<User>(`/users/${id}`),
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateUserData) =>
      post<User & { generatedPassword?: string }>("/users", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateUserData }) =>
      patch<User>(`/users/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
  });
}

export function useResetPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      post<{ generatedPassword: string }>(`/users/${id}/reset-password`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
  });
}

export function useUnlockUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => post<void>(`/users/${id}/unlock`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
  });
}

export function useDeactivateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => patch<User>(`/users/${id}`, { isActive: false }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
  });
}

export function useActivateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => patch<User>(`/users/${id}`, { isActive: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
  });
}

// ─── Settings hooks ───

export function useSettings() {
  return useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () => get<SettingsResponse>("/settings"),
    staleTime: 60_000,
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (updates: Record<string, unknown>) =>
      patch<{ message: string; changes: Array<{ key: string; oldValue: unknown; newValue: unknown }> }>("/settings", updates),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "settings"] }),
  });
}

export function useTestSmtp() {
  return useMutation({
    mutationFn: () => post<{ success: boolean; message: string }>("/settings/test-smtp"),
  });
}

// ─── Audit log hooks ───

export function useAuditLog(filters: AuditLogFilters = {}) {
  return useQuery({
    queryKey: ["admin", "audit-log", filters],
    queryFn: () => get<AuditLogResponse>("/audit-log", filters as Record<string, unknown>),
    staleTime: 30_000,
  });
}

export function useAuditUsers() {
  return useQuery({
    queryKey: ["admin", "users", "all"],
    queryFn: () => get<UserListResponse>("/users", { limit: 100 }),
  });
}
