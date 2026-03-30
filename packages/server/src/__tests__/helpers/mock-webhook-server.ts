import http from "node:http";

export interface ReceivedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
  parsedBody: unknown;
  timestamp: number;
}

export interface MockWebhookServer {
  url: string;
  port: number;
  requests: ReceivedRequest[];
  /** Set the status code the server will return for future requests */
  setStatus(code: number): void;
  /** Set a fixed response body */
  setResponseBody(body: string): void;
  /** Set response delay in ms (simulates slow endpoint) */
  setDelay(ms: number): void;
  /** Clear all recorded requests */
  clear(): void;
  /** Get the last received request */
  lastRequest(): ReceivedRequest | undefined;
  /** Stop the server */
  close(): Promise<void>;
}

export function createMockWebhookServer(): Promise<MockWebhookServer> {
  return new Promise((resolve, reject) => {
    let statusCode = 200;
    let responseBody = "OK";
    let delayMs = 0;
    const requests: ReceivedRequest[] = [];

    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        let parsedBody: unknown = body;
        try {
          parsedBody = JSON.parse(body);
        } catch {
          // keep raw string
        }

        requests.push({
          method: req.method ?? "POST",
          url: req.url ?? "/",
          headers: req.headers,
          body,
          parsedBody,
          timestamp: Date.now(),
        });

        const respond = () => {
          res.writeHead(statusCode, { "Content-Type": "text/plain" });
          res.end(responseBody);
        };

        if (delayMs > 0) {
          setTimeout(respond, delayMs);
        } else {
          respond();
        }
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to get server address"));
        return;
      }

      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        port: addr.port,
        requests,
        setStatus(code: number) {
          statusCode = code;
        },
        setResponseBody(body: string) {
          responseBody = body;
        },
        setDelay(ms: number) {
          delayMs = ms;
        },
        clear() {
          requests.length = 0;
        },
        lastRequest() {
          return requests[requests.length - 1];
        },
        close() {
          return new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          });
        },
      });
    });

    server.on("error", reject);
  });
}
