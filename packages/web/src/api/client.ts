import axios, { AxiosError } from "axios";

const apiKey = import.meta.env.VITE_API_KEY as string | undefined;

const headers: Record<string, string> = { "Content-Type": "application/json" };
if (apiKey) {
  headers["X-API-Key"] = apiKey;
}

const api = axios.create({
  baseURL: "/api/v1",
  headers,
});

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
