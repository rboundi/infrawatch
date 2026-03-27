import type { PackageInfo, ServiceInfo } from "../types.js";

// ─── OS Discovery Parsers ───

export interface OsReleaseInfo {
  id: string;
  versionId: string;
  prettyName: string;
}

export function parseOsRelease(output: string): OsReleaseInfo {
  const lines = output.split("\n");
  const data: Record<string, string> = {};

  for (const line of lines) {
    const match = line.match(/^(\w+)=(.*)$/);
    if (match) {
      // Strip surrounding quotes
      data[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }

  return {
    id: data["ID"] ?? "unknown",
    versionId: data["VERSION_ID"] ?? "unknown",
    prettyName: data["PRETTY_NAME"] ?? "unknown",
  };
}

export function parseUname(output: string): string {
  return output.trim();
}

export function parseHostname(output: string): string {
  return output.trim().split("\n")[0] ?? "unknown";
}

export function parseHostnameIp(output: string): string {
  // hostname -I returns space-separated IPs, take the first
  const ips = output.trim().split(/\s+/);
  return ips[0] ?? "";
}

// ─── Package Discovery Parsers ───

export function parseDpkgOutput(output: string): PackageInfo[] {
  const packages: PackageInfo[] = [];
  const lines = output.trim().split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length >= 2) {
      packages.push({
        name: parts[0].trim(),
        installedVersion: parts[1].trim(),
        packageManager: "apt",
        ecosystem: "debian",
      });
    }
  }

  return packages;
}

export function parseRpmOutput(output: string): PackageInfo[] {
  const packages: PackageInfo[] = [];
  const lines = output.trim().split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length >= 2) {
      packages.push({
        name: parts[0].trim(),
        installedVersion: parts[1].trim(),
        packageManager: "yum",
        ecosystem: "rhel",
      });
    }
  }

  return packages;
}

export function parseApkOutput(output: string): PackageInfo[] {
  const packages: PackageInfo[] = [];
  const lines = output.trim().split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;
    // Format: "package-name-1.2.3-r0 x86_64 {origin} (license)"
    // or:     "package-name-1.2.3-r0 {origin} (license) [installed]"
    const match = line.match(/^(\S+)-(\d\S*)\s/);
    if (match) {
      packages.push({
        name: match[1],
        installedVersion: match[2],
        packageManager: "apk",
        ecosystem: "alpine",
      });
    }
  }

  return packages;
}

export function parsePipOutput(output: string): PackageInfo[] {
  const packages: PackageInfo[] = [];

  try {
    const parsed = JSON.parse(output) as Array<{
      name: string;
      version: string;
    }>;
    for (const pkg of parsed) {
      packages.push({
        name: pkg.name,
        installedVersion: pkg.version,
        packageManager: "pip",
        ecosystem: "pypi",
      });
    }
  } catch {
    // pip output was not valid JSON, skip
  }

  return packages;
}

export function parseNpmGlobalOutput(output: string): PackageInfo[] {
  const packages: PackageInfo[] = [];

  try {
    const parsed = JSON.parse(output) as {
      dependencies?: Record<string, { version: string }>;
    };
    if (parsed.dependencies) {
      for (const [name, info] of Object.entries(parsed.dependencies)) {
        packages.push({
          name,
          installedVersion: info.version,
          packageManager: "npm",
          ecosystem: "npm",
        });
      }
    }
  } catch {
    // npm output was not valid JSON, skip
  }

  return packages;
}

// ─── Service Discovery Parsers ───

export interface SystemctlUnit {
  name: string;
  fullName: string;
}

export function parseSystemctlOutput(output: string): SystemctlUnit[] {
  const units: SystemctlUnit[] = [];
  const lines = output.trim().split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;
    // Plain format: "unit.service loaded active running Description..."
    const parts = line.trim().split(/\s+/);
    const fullName = parts[0];
    if (!fullName || !fullName.endsWith(".service")) continue;

    const name = fullName.replace(/\.service$/, "");
    units.push({ name, fullName });
  }

  return units;
}

/** Map of service name patterns to service type categories */
const SERVICE_TYPE_MAP: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /^nginx/, type: "webserver" },
  { pattern: /^(apache2?|httpd)/, type: "webserver" },
  { pattern: /^(tomcat|catalina)/, type: "appserver" },
  { pattern: /^(postgresql|postgres|pgbouncer)/, type: "database" },
  { pattern: /^(mysql|mariadb|mysqld)/, type: "database" },
  { pattern: /^(redis|redis-server)/, type: "cache" },
  { pattern: /^(memcached)/, type: "cache" },
  { pattern: /^(rabbitmq|kafka)/, type: "queue" },
  { pattern: /^(docker|containerd|podman)/, type: "container-runtime" },
  { pattern: /^(prometheus|grafana|node_exporter|alertmanager)/, type: "monitoring" },
  { pattern: /^(sshd|ssh)/, type: "other" },
];

export function classifyServiceType(serviceName: string): string {
  for (const { pattern, type } of SERVICE_TYPE_MAP) {
    if (pattern.test(serviceName)) return type;
  }
  return "other";
}

// ─── Version Parsers ───

export function parseNginxVersion(output: string): string | undefined {
  // nginx version: nginx/1.24.0
  const match = output.match(/nginx\/([\d.]+)/);
  return match?.[1];
}

export function parseApacheVersion(output: string): string | undefined {
  // Server version: Apache/2.4.57 (Ubuntu)
  const match = output.match(/Apache\/([\d.]+)/);
  return match?.[1];
}

export function parseJavaVersion(output: string): string | undefined {
  // openjdk version "17.0.8" or java version "1.8.0_382"
  const match = output.match(/(?:openjdk|java) version "([^"]+)"/);
  return match?.[1];
}

export function parseTomcatVersion(output: string): string | undefined {
  // Server version: Apache Tomcat/10.1.13 or "Apache Tomcat Version 10.1.13"
  const match = output.match(/Tomcat[/ ]?([\d.]+)/i);
  return match?.[1];
}

export function parsePostgresVersion(output: string): string | undefined {
  // psql (PostgreSQL) 16.1
  const match = output.match(/(\d+\.\d+(?:\.\d+)?)/);
  return match?.[1];
}

export function parseMysqlVersion(output: string): string | undefined {
  // mysql  Ver 8.0.35 or mysqld  Ver 8.0.35-0ubuntu0.22.04.1
  const match = output.match(/Ver\s+([\d.]+)/);
  return match?.[1];
}

export function parseRedisVersion(output: string): string | undefined {
  // Redis server v=7.2.3 sha=...
  const match = output.match(/v=([\d.]+)/);
  return match?.[1];
}

export function parseDockerVersion(output: string): string | undefined {
  // Docker version 24.0.7, build afdd53b
  const match = output.match(/Docker version ([\d.]+)/);
  return match?.[1];
}

export function parseNodeVersion(output: string): string | undefined {
  // v20.10.0
  const match = output.match(/v?([\d.]+)/);
  return match?.[1];
}

// ─── Docker Container Parsers ───

export interface DockerContainer {
  id: string;
  image: string;
  name: string;
  status: string;
  ports: string;
}

export function parseDockerPs(output: string): DockerContainer[] {
  const containers: DockerContainer[] = [];
  const lines = output.trim().split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length >= 5) {
      containers.push({
        id: parts[0].trim(),
        image: parts[1].trim(),
        name: parts[2].trim(),
        status: parts[3].trim(),
        ports: parts[4].trim(),
      });
    }
  }

  return containers;
}

export function dockerContainersToPackages(
  containers: DockerContainer[]
): PackageInfo[] {
  return containers.map((c) => {
    const [imageName, tag] = c.image.includes(":")
      ? c.image.split(":")
      : [c.image, "latest"];

    return {
      name: imageName,
      installedVersion: tag ?? "latest",
      packageManager: "docker",
      ecosystem: "docker",
    };
  });
}

export function dockerContainersToServices(
  containers: DockerContainer[]
): ServiceInfo[] {
  return containers.map((c) => {
    // Try to extract port number from ports string like "0.0.0.0:8080->80/tcp"
    let port: number | undefined;
    const portMatch = c.ports.match(/:(\d+)->/);
    if (portMatch) {
      port = parseInt(portMatch[1], 10);
    }

    return {
      name: `docker:${c.name}`,
      serviceType: "container-runtime",
      version: c.image,
      port,
      status: c.status.toLowerCase().includes("up") ? "running" : "stopped",
    };
  });
}
