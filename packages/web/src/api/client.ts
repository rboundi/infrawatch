import axios, { AxiosError } from "axios";
import { getSessionToken, clearSessionToken } from "../contexts/AuthContext";

const api = axios.create({
  baseURL: "/api/v1",
  headers: { "Content-Type": "application/json" },
  withCredentials: true,
});

// Attach session token if available
api.interceptors.request.use((config) => {
  const token = getSessionToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 — redirect to login
api.interceptors.response.use(
  (res) => res,
  (err: AxiosError) => {
    if (
      err.response?.status === 401 &&
      !err.config?.url?.includes("/auth/login")
    ) {
      clearSessionToken();
      window.location.href = "/login";
    }
    return Promise.reject(err);
  },
);

/** Extract a readable error message from an API error */
function extractError(err: unknown): string {
  if (err instanceof AxiosError) {
    const data = err.response?.data as { error?: string } | undefined;
    if (data?.error) return data.error;
    if (err.response?.status === 404) return "Not found";
    if (err.message) return err.message;
  }
  if (err instanceof Error) return err.message;
  return "An unexpected error occurred";
}

export async function get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  try {
    const res = await api.get<T>(url, { params });
    return res.data;
  } catch (err) {
    throw new Error(extractError(err));
  }
}

export async function post<T>(url: string, body?: unknown): Promise<T> {
  try {
    const res = await api.post<T>(url, body);
    return res.data;
  } catch (err) {
    throw new Error(extractError(err));
  }
}

export async function patch<T>(url: string, body?: unknown): Promise<T> {
  try {
    const res = await api.patch<T>(url, body);
    return res.data;
  } catch (err) {
    throw new Error(extractError(err));
  }
}

export async function del(url: string, body?: unknown): Promise<void> {
  try {
    await api.delete(url, body ? { data: body } : undefined);
  } catch (err) {
    throw new Error(extractError(err));
  }
}
