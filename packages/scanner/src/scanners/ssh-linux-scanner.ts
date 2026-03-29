import { Client } from "ssh2";
import type { ConnectConfig } from "ssh2";
import { BaseScanner } from "../base-scanner.js";
import type {
  ScanResult,
  ScanTargetConfig,
  HostInventory,
  PackageInfo,
  ServiceInfo,
  ConnectionInfo,
} from "../types.js";
import {
  parseOsRelease,
  parseUname,
  parseHostname,
  parseHostnameIp,
  parseDpkgOutput,
  parseRpmOutput,
  parseApkOutput,
  parsePipOutput,
  parseNpmGlobalOutput,
  parseSystemctlOutput,
  classifyServiceType,
  parseNginxVersion,
  parseApacheVersion,
  parseJavaVersion,
  parseTomcatVersion,
  parsePostgresVersion,
  parseMysqlVersion,
  parseRedisVersion,
  parseDockerVersion,
  parseNodeVersion,
  parseDockerPs,
  dockerContainersToPackages,
  dockerContainersToServices,
  parseSsOutput,
} from "./parsers.js";

const COMMAND_TIMEOUT_MS = 30_000;

export interface SshConnectionConfig {
  host: string;
  port?: number;
  username: string;
  privateKey?: string;
  password?: string;
  passphrase?: string;
  collectConnections?: boolean;
}

interface CommandResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/**
 * Execute a single command over an established SSH connection.
 * Returns stdout/stderr with a configurable timeout.
 */
export function execSshCommand(
  conn: Client,
  command: string,
  timeoutMs = COMMAND_TIMEOUT_MS
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`SSH command timed out after ${timeoutMs}ms: ${command}`));
    }, timeoutMs);

    conn.exec(command, (err, stream) => {
      if (err) {
        clearTimeout(timer);
        reject(err);
        return;
      }

      let stdout = "";
      let stderr = "";

      stream.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      stream.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      stream.on("close", (code: number | null) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, code });
      });
    });
  });
}

/**
 * Helper: run a command, return stdout if successful or undefined if it fails.
 */
async function tryCommand(
  conn: Client,
  command: string,
  label: string
): Promise<string | undefined> {
  try {
    const result = await execSshCommand(conn, command);
    if (result.code !== 0 && result.code !== null) {
      console.warn(
        `[ssh-scanner] Command "${label}" exited with code ${result.code}`
      );
      return undefined;
    }
    return result.stdout;
  } catch (err) {
    console.warn(`[ssh-scanner] Command "${label}" failed:`, err);
    return undefined;
  }
}

/** Service version detection commands keyed by service name patterns */
const VERSION_DETECTORS: Array<{
  pattern: RegExp;
  commands: string[];
  parser: (output: string) => string | undefined;
  port?: number;
}> = [
  {
    pattern: /^nginx/,
    commands: ["nginx -v 2>&1"],
    parser: parseNginxVersion,
    port: 80,
  },
  {
    pattern: /^(apache2|httpd)/,
    commands: ["httpd -v 2>&1", "apache2 -v 2>&1"],
    parser: parseApacheVersion,
    port: 80,
  },
  {
    pattern: /^(tomcat|catalina)/,
    commands: [
      "catalina.sh version 2>&1",
      "ps aux | grep -oP 'catalina\\.base=\\K\\S+' | head -1 | xargs -I{} cat {}/RELEASE-NOTES 2>/dev/null | head -5",
    ],
    parser: parseTomcatVersion,
    port: 8080,
  },
  {
    pattern: /^(postgresql|postgres)/,
    commands: ["psql --version 2>/dev/null"],
    parser: parsePostgresVersion,
    port: 5432,
  },
  {
    pattern: /^(mysql|mariadb|mysqld)/,
    commands: ["mysql --version 2>/dev/null"],
    parser: parseMysqlVersion,
    port: 3306,
  },
  {
    pattern: /^(redis|redis-server)/,
    commands: ["redis-server --version 2>/dev/null"],
    parser: parseRedisVersion,
    port: 6379,
  },
  {
    pattern: /^docker/,
    commands: ["docker --version 2>/dev/null"],
    parser: parseDockerVersion,
  },
  {
    pattern: /^node/,
    commands: ["node --version 2>/dev/null"],
    parser: parseNodeVersion,
  },
];

export class SshLinuxScanner extends BaseScanner {
  async scan(config: ScanTargetConfig): Promise<ScanResult> {
    const connConfig = config.connectionConfig as unknown as SshConnectionConfig;
    const conn = await this.connect(connConfig);

    try {
      const collectConnections = connConfig.collectConnections !== false;
      const host = await this.discoverHost(conn, collectConnections);
      return { hosts: [host] };
    } finally {
      conn.end();
    }
  }

  private connect(config: SshConnectionConfig): Promise<Client> {
    return new Promise((resolve, reject) => {
      const conn = new Client();

      const sshConfig: ConnectConfig = {
        host: config.host,
        port: config.port ?? 22,
        username: config.username,
      };

      if (config.privateKey) {
        sshConfig.privateKey = config.privateKey;
        if (config.passphrase) {
          sshConfig.passphrase = config.passphrase;
        }
      } else if (config.password) {
        sshConfig.password = config.password;
      }

      conn.on("ready", () => resolve(conn));
      conn.on("error", (err) => reject(err));
      conn.connect(sshConfig);
    });
  }

  private async discoverHost(conn: Client, collectConnections = true): Promise<HostInventory> {
    // ─── OS Discovery ───
    const osReleaseRaw = await tryCommand(
      conn,
      "cat /etc/os-release",
      "os-release"
    );
    const osInfo = osReleaseRaw
      ? parseOsRelease(osReleaseRaw)
      : { id: "unknown", versionId: "unknown", prettyName: "unknown" };

    const unameRaw = await tryCommand(conn, "uname -m", "uname");
    const arch = unameRaw ? parseUname(unameRaw) : "unknown";

    const hostnameRaw = await tryCommand(conn, "hostname -f", "hostname");
    const hostname = hostnameRaw ? parseHostname(hostnameRaw) : "unknown";

    const ipRaw = await tryCommand(conn, "hostname -I", "hostname-ip");
    const ip = ipRaw ? parseHostnameIp(ipRaw) : "";

    // ─── Package Discovery ───
    const packages: PackageInfo[] = [];

    // OS-level packages based on distro
    const distroId = osInfo.id.toLowerCase();

    if (["debian", "ubuntu", "linuxmint", "pop"].includes(distroId)) {
      const dpkgOut = await tryCommand(
        conn,
        "dpkg-query -W -f='${Package}\\t${Version}\\n'",
        "dpkg"
      );
      if (dpkgOut) packages.push(...parseDpkgOutput(dpkgOut));
    } else if (
      ["rhel", "centos", "fedora", "rocky", "alma", "ol", "amzn"].includes(
        distroId
      )
    ) {
      const rpmOut = await tryCommand(
        conn,
        "rpm -qa --queryformat '%{NAME}\\t%{VERSION}-%{RELEASE}\\n'",
        "rpm"
      );
      if (rpmOut) packages.push(...parseRpmOutput(rpmOut));
    } else if (distroId === "alpine") {
      const apkOut = await tryCommand(conn, "apk list -I", "apk");
      if (apkOut) packages.push(...parseApkOutput(apkOut));
    }

    // Python packages
    const pipOut = await tryCommand(
      conn,
      "pip3 list --format=json 2>/dev/null",
      "pip"
    );
    if (pipOut) packages.push(...parsePipOutput(pipOut));

    // Node global packages
    const npmOut = await tryCommand(
      conn,
      "npm list -g --json 2>/dev/null",
      "npm"
    );
    if (npmOut) packages.push(...parseNpmGlobalOutput(npmOut));

    // ─── Service Discovery ───
    const services: ServiceInfo[] = [];

    const systemctlOut = await tryCommand(
      conn,
      "systemctl list-units --type=service --state=running --no-pager --plain",
      "systemctl"
    );

    const runningUnits = systemctlOut
      ? parseSystemctlOutput(systemctlOut)
      : [];

    for (const unit of runningUnits) {
      const serviceType = classifyServiceType(unit.name);

      let version: string | undefined;
      let port: number | undefined;

      // Try to detect version for known services
      for (const detector of VERSION_DETECTORS) {
        if (detector.pattern.test(unit.name)) {
          for (const cmd of detector.commands) {
            const out = await tryCommand(conn, cmd, `version:${unit.name}`);
            if (out) {
              version = detector.parser(out);
              if (version) break;
            }
          }
          port = detector.port;
          break;
        }
      }

      // Also check for Java/Tomcat via process inspection
      if (/^(tomcat|catalina)/.test(unit.name) && !version) {
        const psOut = await tryCommand(
          conn,
          "ps aux | grep '[t]omcat' | head -1",
          "ps-tomcat"
        );
        if (psOut) {
          version = parseTomcatVersion(psOut);
        }
      }

      if (unit.name === "java" || /jvm/.test(unit.name)) {
        const javaOut = await tryCommand(
          conn,
          "java -version 2>&1",
          "java-version"
        );
        if (javaOut) {
          version = parseJavaVersion(javaOut);
        }
      }

      services.push({
        name: unit.name,
        serviceType,
        version,
        port,
        status: "running",
      });
    }

    // ─── Docker Container Discovery ───
    const dockerPsOut = await tryCommand(
      conn,
      "docker ps --format '{{.ID}}\\t{{.Image}}\\t{{.Names}}\\t{{.Status}}\\t{{.Ports}}' 2>/dev/null",
      "docker-ps"
    );

    if (dockerPsOut && dockerPsOut.trim()) {
      const containers = parseDockerPs(dockerPsOut);
      packages.push(...dockerContainersToPackages(containers));
      services.push(...dockerContainersToServices(containers));
    }

    // ─── Connection Discovery ───
    let connections: ConnectionInfo[] = [];

    if (collectConnections) {
      const ssOut = await tryCommand(
        conn,
        "ss -tnpH 2>/dev/null || netstat -tnp 2>/dev/null | grep ESTABLISHED",
        "connections"
      );
      if (ssOut) {
        connections = parseSsOutput(ssOut);
      }
    }

    return {
      hostname,
      ip,
      os: osInfo.prettyName,
      osVersion: osInfo.versionId,
      arch,
      packages,
      services,
      connections,
      metadata: {
        distroId: osInfo.id,
        scannedAt: new Date().toISOString(),
      },
    };
  }
}
