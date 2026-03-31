import { useState, useRef, useCallback } from "react";
import { getSessionToken } from "../contexts/AuthContext";

export interface TestStep {
  message: string;
  level: "info" | "warn" | "error";
}

export interface TestResult {
  success: boolean;
  message: string;
  latencyMs: number;
}

interface UseTestStreamReturn {
  steps: TestStep[];
  result: TestResult | null;
  isStreaming: boolean;
  start: (targetId: string) => void;
  reset: () => void;
}

/**
 * Hook that connects to the SSE stream for a connection test.
 * Returns live progress steps as they arrive.
 */
export function useTestStream(): UseTestStreamReturn {
  const [steps, setSteps] = useState<TestStep[]>([]);
  const [result, setResult] = useState<TestResult | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    cleanup();
    setSteps([]);
    setResult(null);
    setIsStreaming(false);
  }, [cleanup]);

  const start = useCallback(
    (targetId: string) => {
      // Close any existing connection
      cleanup();
      setSteps([]);
      setResult(null);
      setIsStreaming(true);

      const token = getSessionToken();
      const params = token ? `?token=${encodeURIComponent(token)}` : "";
      const url = `/api/v1/targets/${targetId}/test/stream${params}`;

      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.addEventListener("step", (event) => {
        try {
          const step: TestStep = JSON.parse((event as MessageEvent).data);
          setSteps((prev) => [...prev, step]);
        } catch {
          // ignore parse errors
        }
      });

      es.addEventListener("result", (event) => {
        try {
          const data: TestResult = JSON.parse((event as MessageEvent).data);
          setResult(data);
        } catch {
          // ignore
        }
      });

      es.addEventListener("done", () => {
        setIsStreaming(false);
        es.close();
      });

      es.onerror = () => {
        setIsStreaming(false);
        es.close();
      };
    },
    [cleanup],
  );

  return { steps, result, isStreaming, start, reset };
}
