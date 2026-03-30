import { useState, useEffect, useRef, useCallback } from "react";
import { getSessionToken } from "../contexts/AuthContext";
import type { ScanLogEntry } from "../api/types";

interface UseScanLogStreamResult {
  entries: ScanLogEntry[];
  isStreaming: boolean;
  status: string | null;
}

/**
 * Hook that connects to the SSE stream for a scan log.
 * Returns live entries as they arrive.
 */
export function useScanLogStream(
  targetId: string | null,
  logId: string | null,
): UseScanLogStreamResult {
  const [entries, setEntries] = useState<ScanLogEntry[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!targetId || !logId) {
      cleanup();
      return;
    }

    // Reset state for new stream
    setEntries([]);
    setIsStreaming(true);
    setStatus(null);

    const token = getSessionToken();
    const params = token ? `?token=${encodeURIComponent(token)}` : "";
    const url = `/api/v1/targets/${targetId}/scan-logs/${logId}/stream${params}`;

    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const entry: ScanLogEntry = JSON.parse(event.data);
        setEntries((prev) => [...prev, entry]);
      } catch {
        // ignore parse errors
      }
    };

    es.addEventListener("done", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        setStatus(data.status);
      } catch {
        setStatus("unknown");
      }
      setIsStreaming(false);
      es.close();
    });

    es.onerror = () => {
      setIsStreaming(false);
      es.close();
    };

    return () => {
      cleanup();
    };
  }, [targetId, logId, cleanup]);

  return { entries, isStreaming, status };
}
