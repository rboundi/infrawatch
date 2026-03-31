import http from "node:http";
import type { Express } from "express";

export interface SSEEvent {
  type: string | null; // null = default "message" event
  data: string;
  parsed: unknown;
}

export interface SSEClient {
  events: SSEEvent[];
  raw: string;
  /** Wait for N events, or timeout */
  waitForEvents(count: number, timeoutMs?: number): Promise<SSEEvent[]>;
  /** Wait for a specific event type */
  waitForEvent(type: string, timeoutMs?: number): Promise<SSEEvent>;
  /** Close the connection */
  close(): void;
  /** Whether the connection has ended */
  ended: boolean;
}

/**
 * Create an SSE client that connects to an Express app via a raw HTTP request.
 * Parses the SSE stream format (event: / data: lines).
 */
export function createSSEClient(
  app: Express,
  path: string,
  headers: Record<string, string> = {},
): Promise<SSEClient> {
  return new Promise((resolve, reject) => {
    // Get the app to listen on an ephemeral port
    const server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to get server address"));
        return;
      }

      const events: SSEEvent[] = [];
      let raw = "";
      let ended = false;
      let currentEventType: string | null = null;
      let currentData = "";
      const waiters: Array<{ check: () => boolean; resolve: () => void }> = [];

      const checkWaiters = () => {
        for (const waiter of waiters) {
          if (waiter.check()) waiter.resolve();
        }
      };

      const processLine = (line: string) => {
        if (line.startsWith("event: ")) {
          currentEventType = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          currentData += (currentData ? "\n" : "") + line.slice(6);
        } else if (line === "") {
          // Empty line = end of event
          if (currentData) {
            let parsed: unknown = currentData;
            try {
              parsed = JSON.parse(currentData);
            } catch {
              // keep as string
            }
            events.push({ type: currentEventType, data: currentData, parsed });
            currentEventType = null;
            currentData = "";
            checkWaiters();
          }
        }
      };

      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: addr.port,
          path,
          method: "GET",
          headers: {
            Accept: "text/event-stream",
            ...headers,
          },
        },
        (res) => {
          res.setEncoding("utf-8");
          let buffer = "";

          res.on("data", (chunk: string) => {
            raw += chunk;
            buffer += chunk;
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              processLine(line);
            }
          });

          res.on("end", () => {
            if (buffer) processLine(buffer);
            processLine(""); // flush last event
            ended = true;
            checkWaiters();
          });

          const client: SSEClient = {
            events,
            get raw() { return raw; },
            get ended() { return ended; },
            waitForEvents(count: number, timeoutMs = 10_000) {
              return new Promise<SSEEvent[]>((res, rej) => {
                if (events.length >= count) { res(events.slice(0, count)); return; }
                const timer = setTimeout(() => rej(new Error(
                  `Timeout waiting for ${count} events (got ${events.length})`
                )), timeoutMs);
                waiters.push({
                  check: () => events.length >= count || ended,
                  resolve: () => { clearTimeout(timer); res(events.slice(0, count)); },
                });
              });
            },
            waitForEvent(type: string, timeoutMs = 10_000) {
              return new Promise<SSEEvent>((res, rej) => {
                const found = events.find((e) => e.type === type);
                if (found) { res(found); return; }
                const timer = setTimeout(() => rej(new Error(
                  `Timeout waiting for event type "${type}"`
                )), timeoutMs);
                waiters.push({
                  check: () => events.some((e) => e.type === type) || ended,
                  resolve: () => {
                    clearTimeout(timer);
                    const f = events.find((e) => e.type === type);
                    if (f) res(f);
                    else rej(new Error(`Stream ended without event type "${type}"`));
                  },
                });
              });
            },
            close() {
              req.destroy();
              server.close();
            },
          };

          resolve(client);
        },
      );

      req.on("error", (err) => {
        server.close();
        reject(err);
      });

      req.end();
    });
  });
}
