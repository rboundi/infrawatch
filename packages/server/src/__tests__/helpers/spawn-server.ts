import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";

export interface SpawnedServer {
  process: ChildProcess;
  port: number;
  stdout: string;
  stderr: string;
  /** Send a signal to the process */
  sendSignal(signal: NodeJS.Signals): void;
  /** Wait for the process to exit (returns exit code) */
  waitForExit(timeoutMs?: number): Promise<number | null>;
  /** Make an HTTP request to the server */
  fetch(path: string, init?: RequestInit): Promise<Response>;
  /** Force kill the process (cleanup) */
  kill(): void;
}

/**
 * Spawn the infrawatch server as a child process with test-compatible env vars.
 * Waits for the health endpoint to respond before resolving.
 */
export async function spawnServer(envOverrides: Record<string, string> = {}): Promise<SpawnedServer> {
  // Pick a random port in the ephemeral range
  const port = 10000 + Math.floor(Math.random() * 50000);
  // __tests__/helpers/ -> __tests__ -> src -> packages/server
  const serverDir = resolve(import.meta.dirname, "../../..");
  const entryPoint = resolve(serverDir, "src/index.ts");

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    PORT: String(port),
    NODE_ENV: "test",
    DB_HOST: "localhost",
    DB_PORT: "5433",
    DB_NAME: "infrawatch_test",
    DB_USER: "infrawatch",
    DB_PASSWORD: "infrawatch_dev",
    DB_POOL_MAX: "3",
    MASTER_KEY: "test-master-key-for-encryption-do-not-use-in-prod",
    CORS_ORIGIN: "http://localhost",
    ...envOverrides,
  };

  const child = spawn("npx", ["tsx", entryPoint], {
    cwd: serverDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  let exited = false;
  let exitCode: number | null = null;
  const exitPromise = new Promise<number | null>((resolveExit) => {
    child.on("exit", (code) => {
      exited = true;
      exitCode = code;
      resolveExit(code);
    });
  });

  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const server: SpawnedServer = {
    process: child,
    port,
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    sendSignal(signal: NodeJS.Signals) {
      if (!exited) child.kill(signal);
    },
    async waitForExit(timeoutMs = 15_000): Promise<number | null> {
      if (exited) return exitCode;
      return Promise.race([
        exitPromise,
        new Promise<number | null>((_, reject) =>
          setTimeout(() => reject(new Error(`Server did not exit within ${timeoutMs}ms`)), timeoutMs),
        ),
      ]);
    },
    async fetch(path: string, init?: RequestInit): Promise<Response> {
      return globalThis.fetch(`http://127.0.0.1:${port}${path}`, init);
    },
    kill() {
      if (!exited) {
        child.kill("SIGKILL");
      }
    },
  };

  // Wait for the server to be ready by polling the health endpoint
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (exited) {
      throw new Error(
        `Server exited prematurely with code ${exitCode}.\nstdout: ${stdout.slice(-2000)}\nstderr: ${stderr.slice(-2000)}`
      );
    }
    try {
      const res = await globalThis.fetch(`http://127.0.0.1:${port}/api/v1/health`);
      if (res.ok) return server;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  server.kill();
  throw new Error(
    `Server did not become ready within 30s.\nstdout: ${stdout.slice(-2000)}\nstderr: ${stderr.slice(-2000)}`
  );
}
