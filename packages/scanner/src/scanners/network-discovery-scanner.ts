import { spawn } from "node:child_process";
import { readFile, unlink, mkdtemp, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { XMLParser } from "fast-xml-parser";
import { BaseScanner } from "../base-scanner.js";
import type {
  ScanResult,
  ScanTargetConfig,
  HostInventory,
  PackageInfo,
  ServiceInfo,
} from "../types.js";

// ─── Configuration ───

export interface NetworkDiscoveryConfig {
  subnets: string[];
  excludeHosts?: string[];
  scanProfile?: "stealthy" | "polite" | "normal" | "aggressive";
  portProfile?: "common" | "infrastructure" | "full" | "custom";
  customPorts?: string;
  // UI sends these keys (osDetection / versionDetection / scriptScanning)
  osDetection?: boolean;
  versionDetection?: boolean;
  scriptScanning?: boolean;
  // Legacy keys (enableOsDetection / enableVersionDetection / enableScriptScan)
  enableOsDetection?: boolean;
  enableVersionDetection?: boolean;
  enableScriptScan?: boolean;
  maxScanMinutes?: number;
  scanTimeout?: number;
  autoPromote?: "none" | "suggest";
  sshTemplateTargetId?: string;
  winrmTemplateTargetId?: string;
  /** Run nmap with sudo (required for SYN scan and OS detection). Defaults to auto-detect. */
  useSudo?: boolean;
}

// ─── Constants ───

export const INFRASTRUCTURE_PORTS =
  "22,23,25,53,80,110,111,135,139,143,443,445,993,995,1433,1521,2375,2376,3000,3306,3389,4243,5432,5672,5900,5901,5985,5986,6379,6443,8080-8090,8443,9090,9200,9300,10250,15672,27017,50000";

const TIMING_MAP: Record<string, string> = {
  stealthy: "-T1",
  polite: "-T2",
  normal: "-T3",
  aggressive: "-T4",
};

const SCRIPT_SET =
  "ssl-cert,http-title,ssh-hostkey,smb-os-discovery,vmware-version";

// ─── Intermediate types for XML parsing ───

export interface NmapHost {
  ip: string;
  mac?: string;
  hostname?: string;
  status: string;
  osMatch?: { name: string; accuracy: number }[];
  ports: NmapPort[];
}

export interface NmapPort {
  portId: number;
  protocol: string;
  state: string;
  service?: {
    name: string;
    product?: string;
    version?: string;
    extraInfo?: string;
  };
}

// ─── Pure functions ───

export function buildNmapArgs(config: NetworkDiscoveryConfig, useSudo: boolean): string[] {
  // Resolve UI keys vs legacy keys (UI sends osDetection, scanner had enableOsDetection)
  const wantOsDetection = config.osDetection ?? config.enableOsDetection ?? true;
  const wantVersionDetection = config.versionDetection ?? config.enableVersionDetection ?? true;
  const wantScriptScan = config.scriptScanning ?? config.enableScriptScan ?? false;

  const args: string[] = [];

  // Verbose output for progress reporting
  args.push("-v");

  if (useSudo) {
    // TCP SYN scan (requires root)
    args.push("-sS");
  } else {
    // TCP connect scan (no root needed)
    args.push("-sT");
  }

  // Timing
  const profile = config.scanProfile ?? "polite";
  args.push(TIMING_MAP[profile] ?? "-T2");

  // OS detection (requires root)
  if (wantOsDetection && useSudo) {
    args.push("-O", "--osscan-guess");
  }

  // Version detection — use lighter intensity (2) for polite/stealthy, normal (5) for aggressive
  if (wantVersionDetection) {
    const intensity = profile === "aggressive" ? "5" : profile === "normal" ? "3" : "2";
    args.push("-sV", "--version-intensity", intensity);
  }

  // Script scanning
  if (wantScriptScan) {
    args.push("--script", SCRIPT_SET);
  }

  // Port profile
  const portProfile = config.portProfile ?? "infrastructure";
  switch (portProfile) {
    case "infrastructure":
      args.push("-p", INFRASTRUCTURE_PORTS);
      break;
    case "full":
      args.push("-p-");
      break;
    case "custom":
      if (config.customPorts) {
        args.push("-p", config.customPorts);
      }
      break;
    case "common":
      // nmap default — no flag needed
      break;
  }

  // Exclude hosts
  if (config.excludeHosts && config.excludeHosts.length > 0) {
    args.push("--exclude", config.excludeHosts.join(","));
  }

  // Performance tuning
  args.push("--max-retries", "2");
  args.push("--host-timeout", "120s");
  if (profile !== "stealthy") {
    args.push("--min-rate", "100");
  }

  // Progress reporting
  args.push("--stats-every", "10s");

  // Targets
  args.push(...config.subnets);

  return args;
}

export function validateSubnets(subnets: string[]): void {
  if (!subnets || subnets.length === 0) {
    throw new Error("At least one subnet must be specified");
  }

  for (const subnet of subnets) {
    // Allow IP range format like 192.168.1.1-50
    if (/^\d{1,3}(\.\d{1,3}){3}-\d{1,3}$/.test(subnet)) {
      continue;
    }

    // CIDR format
    const cidrMatch = subnet.match(
      /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/
    );
    if (!cidrMatch) {
      throw new Error(
        `Invalid subnet format: "${subnet}". Expected CIDR notation (e.g. 192.168.1.0/24) or range (e.g. 192.168.1.1-50)`
      );
    }

    const octets = [
      Number(cidrMatch[1]),
      Number(cidrMatch[2]),
      Number(cidrMatch[3]),
      Number(cidrMatch[4]),
    ];
    for (const octet of octets) {
      if (octet < 0 || octet > 255) {
        throw new Error(`Invalid subnet format: "${subnet}". Octet out of range`);
      }
    }

    const prefix = Number(cidrMatch[5]);
    if (prefix < 16) {
      throw new Error(
        `Subnet "${subnet}" is too large (/${prefix}). Maximum allowed is /16 (65536 IPs)`
      );
    }
  }
}

export function parseNmapXml(xml: string): NmapHost[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    isArray: (tagName: string) => {
      return [
        "host",
        "address",
        "hostname",
        "port",
        "osmatch",
        "osclass",
      ].includes(tagName);
    },
  });

  const parsed = parser.parse(xml);
  const nmaprun = parsed.nmaprun;
  if (!nmaprun || !nmaprun.host) {
    return [];
  }

  const hosts: NmapHost[] = [];

  const rawHosts = Array.isArray(nmaprun.host)
    ? nmaprun.host
    : [nmaprun.host];

  for (const rawHost of rawHosts) {
    // Skip hosts that are down
    const status = rawHost.status?.["@_state"];
    if (status !== "up") continue;

    // Parse addresses
    const addresses = Array.isArray(rawHost.address)
      ? rawHost.address
      : rawHost.address
        ? [rawHost.address]
        : [];

    let ip = "";
    let mac: string | undefined;
    for (const addr of addresses) {
      if (addr["@_addrtype"] === "ipv4") ip = addr["@_addr"];
      if (addr["@_addrtype"] === "mac") mac = addr["@_addr"];
    }
    if (!ip) continue;

    // Parse hostnames
    let hostname: string | undefined;
    if (rawHost.hostnames) {
      const hostnameEntries = rawHost.hostnames.hostname;
      const hnArray = Array.isArray(hostnameEntries)
        ? hostnameEntries
        : hostnameEntries
          ? [hostnameEntries]
          : [];
      // Prefer PTR record
      const ptrRecord = hnArray.find(
        (h: Record<string, string>) => h["@_type"] === "PTR"
      );
      const userRecord = hnArray.find(
        (h: Record<string, string>) => h["@_type"] === "user"
      );
      hostname = (ptrRecord ?? userRecord)?.["@_name"];
    }

    // Parse OS matches
    const osMatches: { name: string; accuracy: number }[] = [];
    if (rawHost.os?.osmatch) {
      const rawMatches = Array.isArray(rawHost.os.osmatch)
        ? rawHost.os.osmatch
        : [rawHost.os.osmatch];
      for (const m of rawMatches) {
        osMatches.push({
          name: m["@_name"] ?? "Unknown",
          accuracy: Number(m["@_accuracy"] ?? 0),
        });
      }
    }

    // Parse ports
    const ports: NmapPort[] = [];
    if (rawHost.ports?.port) {
      const rawPorts = Array.isArray(rawHost.ports.port)
        ? rawHost.ports.port
        : [rawHost.ports.port];
      for (const p of rawPorts) {
        const state = p.state?.["@_state"];
        if (state !== "open") continue;

        const port: NmapPort = {
          portId: Number(p["@_portid"]),
          protocol: p["@_protocol"] ?? "tcp",
          state,
        };

        if (p.service) {
          port.service = {
            name: p.service["@_name"] ?? "",
            product: p.service["@_product"],
            version: p.service["@_version"],
            extraInfo: p.service["@_extrainfo"],
          };
        }

        ports.push(port);
      }
    }

    hosts.push({
      ip,
      mac,
      hostname,
      status: "up",
      osMatch: osMatches.length > 0 ? osMatches : undefined,
      ports,
    });
  }

  return hosts;
}

export function classifyServiceTypeByPort(port: number): string {
  if (port === 22) return "remote-access";
  if (port === 3389 || port === 5900 || port === 5901) return "remote-access";
  if (port === 80 || port === 443 || (port >= 8080 && port <= 8090) || port === 8443)
    return "webserver";
  if (
    port === 3306 ||
    port === 5432 ||
    port === 1433 ||
    port === 1521 ||
    port === 27017
  )
    return "database";
  if (port === 6379) return "cache";
  if (port === 5672 || port === 15672) return "queue";
  if (port === 2375 || port === 2376 || port === 4243) return "container-runtime";
  if (port === 6443 || port === 10250) return "orchestrator";
  if (port === 9090 || port === 9200 || port === 9300) return "monitoring";
  if (port === 25 || port === 110 || port === 143 || port === 993 || port === 995)
    return "mail";
  if (port === 53) return "dns";
  if (port === 5985 || port === 5986) return "remote-access";
  if (port === 23) return "remote-access";
  return "other";
}

export function mapServiceEcosystem(
  product: string | undefined
): string | undefined {
  if (!product) return undefined;
  const lower = product.toLowerCase();
  if (lower.includes("openssh")) return "linux";
  if (lower.includes("nginx")) return "nginx";
  if (lower.includes("apache")) return "apache";
  if (lower.includes("mysql") || lower.includes("mariadb")) return "mysql";
  if (lower.includes("postgresql")) return "postgresql";
  if (lower.includes("redis")) return "redis";
  if (lower.includes("docker")) return "docker";
  if (lower.includes("iis") || lower.includes("microsoft")) return "windows";
  if (lower.includes("rabbitmq")) return "rabbitmq";
  if (lower.includes("mongodb")) return "mongodb";
  if (lower.includes("elasticsearch")) return "elasticsearch";
  return undefined;
}

export function mapNmapHostToInventory(host: NmapHost): HostInventory {
  const hostname = host.hostname ?? host.ip;

  // Best OS match
  let os = "Unknown";
  let osVersion = "";
  if (host.osMatch && host.osMatch.length > 0) {
    const best = host.osMatch.reduce((a, b) =>
      a.accuracy >= b.accuracy ? a : b
    );
    os = best.name;
    // Try to extract version from OS name
    const versionMatch = best.name.match(/(\d+[\d.]*)/);
    if (versionMatch) {
      osVersion = versionMatch[1];
    }
  }

  // Build packages from services with version detection
  const packages: PackageInfo[] = [];
  for (const p of host.ports) {
    if (p.service?.product && p.service?.version) {
      const ecosystem = mapServiceEcosystem(p.service.product) ?? "other";
      packages.push({
        name: p.service.product,
        installedVersion: p.service.version,
        packageManager: "nmap-detect",
        ecosystem,
      });
    }
  }

  // Build services from open ports
  const services: ServiceInfo[] = host.ports.map((p) => ({
    name: p.service?.product ?? p.service?.name ?? `port-${p.portId}`,
    serviceType: classifyServiceTypeByPort(p.portId),
    version: p.service?.version,
    port: p.portId,
    status: "running",
  }));

  // Detect platform
  const platform = detectPlatform(host);

  return {
    hostname,
    ip: host.ip,
    os,
    osVersion,
    arch: "",
    packages,
    services,
    connections: [],
    metadata: {
      scanSource: "nmap-network-discovery",
      platform,
      mac: host.mac,
      osMatches: host.osMatch,
    },
  };
}

export function detectPlatform(host: NmapHost): string {
  const openPorts = new Set(host.ports.map((p) => p.portId));
  const osName = host.osMatch?.[0]?.name?.toLowerCase() ?? "";

  // Check for Kubernetes (before Docker since k8s nodes may also have Docker)
  if (openPorts.has(6443) || openPorts.has(10250)) {
    return "kubernetes-node";
  }

  // Docker host
  if (openPorts.has(2375) || openPorts.has(2376) || openPorts.has(4243)) {
    return "docker-host";
  }

  // VMware ESXi — port 443 with vmware service
  if (openPorts.has(443)) {
    const svc443 = host.ports.find((p) => p.portId === 443);
    if (
      svc443?.service?.product?.toLowerCase().includes("vmware") ||
      svc443?.service?.name?.toLowerCase().includes("vmware")
    ) {
      return "vmware-esxi";
    }
  }

  // Windows server — by RDP or OS name
  if (openPorts.has(3389) || osName.includes("windows")) {
    return "windows-server";
  }

  // Windows via WinRM
  if (openPorts.has(5985) || openPorts.has(5986)) {
    return "windows-server";
  }

  // Linux server
  if (osName.includes("linux")) {
    return "linux-server";
  }

  // Network device — SNMP
  if (openPorts.has(161)) {
    return "network-device";
  }

  // Network device — telnet without SSH
  if (openPorts.has(23) && !openPorts.has(22)) {
    return "network-device";
  }

  return "unknown";
}

// ─── Progress parsing ───

/**
 * Parse nmap stderr output for human-readable progress messages.
 * Nmap --stats-every outputs lines like:
 *   "Stats: 0:01:23 elapsed; 5 hosts completed (3 up), 2 undergoing SYN Stealth Scan"
 *   "SYN Stealth Scan Timing: About 45.00% done; ETC: 21:55 (0:01:30 remaining)"
 * Nmap also outputs per-host completion:
 *   "Nmap scan report for 192.168.1.1"
 */
export function parseNmapProgress(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Stats line: "Stats: 0:01:23 elapsed; 5 hosts completed (3 up), ..."
  const statsMatch = trimmed.match(
    /^Stats:\s+([\d:]+)\s+elapsed;\s+(\d+)\s+hosts?\s+completed\s+\((\d+)\s+up\)/
  );
  if (statsMatch) {
    return `${statsMatch[1]} elapsed — ${statsMatch[2]} host(s) scanned, ${statsMatch[3]} up`;
  }

  // Timing/progress line: "... About 45.00% done; ETC: 21:55 (0:01:30 remaining)"
  const pctMatch = trimmed.match(
    /About\s+([\d.]+)%\s+done.*?\(([\d:]+)\s+remaining\)/
  );
  if (pctMatch) {
    return `${parseFloat(pctMatch[1]).toFixed(0)}% complete — ${pctMatch[2]} remaining`;
  }

  // Discovered open port: "Discovered open port 22/tcp on 192.168.1.1"
  const portMatch = trimmed.match(
    /^Discovered open port (\d+\/\w+) on ([\d.]+)/
  );
  if (portMatch) {
    return `Found open port ${portMatch[1]} on ${portMatch[2]}`;
  }

  // Scan phase initiation: "Initiating Connect Scan at 21:58"
  const initiatingMatch = trimmed.match(
    /^Initiating\s+(.+?)\s+at\s+/
  );
  if (initiatingMatch) {
    return `Starting ${initiatingMatch[1]}...`;
  }

  // Scan phase completion: "Completed Ping Scan at 21:58, 13.77s elapsed (256 total hosts)"
  const completedPhaseMatch = trimmed.match(
    /^Completed\s+(.+?)\s+at\s+[\d:]+,\s+([\d.]+s)\s+elapsed(?:\s+\((.+?)\))?/
  );
  if (completedPhaseMatch) {
    const detail = completedPhaseMatch[3] ? ` (${completedPhaseMatch[3]})` : "";
    return `Completed ${completedPhaseMatch[1]} in ${completedPhaseMatch[2]}${detail}`;
  }

  // Scanning hosts line: "Scanning 9 hosts [1000 ports/host]"
  const scanningMatch = trimmed.match(
    /^Scanning\s+(\d+)\s+hosts?\s+\[(.+?)\]/
  );
  if (scanningMatch) {
    return `Scanning ${scanningMatch[1]} host(s) [${scanningMatch[2]}]`;
  }

  // DNS resolution: "Initiating Parallel DNS resolution of 9 hosts."
  const dnsMatch = trimmed.match(
    /Parallel DNS resolution of (\d+) hosts/
  );
  if (dnsMatch) {
    return `Resolving DNS for ${dnsMatch[1]} host(s)...`;
  }

  // Completed host: "Completed ... Scan against 192.168.1.1"
  const completedMatch = trimmed.match(
    /^Completed\s+(.+?)\s+against\s+([\d.]+)/
  );
  if (completedMatch) {
    return `Completed ${completedMatch[1]} on ${completedMatch[2]}`;
  }

  return null;
}

// ─── Scanner class ───

export class NetworkDiscoveryScanner extends BaseScanner {
  async scan(config: ScanTargetConfig): Promise<ScanResult> {
    const discoveryConfig = config.connectionConfig as unknown as NetworkDiscoveryConfig;
    const onProgress = config.onProgress;
    const signal = config.signal;

    // Check if already cancelled
    if (signal?.aborted) throw new Error("Scan cancelled");

    // Validate subnets
    validateSubnets(discoveryConfig.subnets);

    // Determine if we should use sudo
    const useSudo = discoveryConfig.useSudo ?? (await this.canUseSudo());
    onProgress?.(useSudo ? "Running nmap with sudo (SYN scan + OS detection)" : "Running nmap without sudo (TCP connect scan)");

    // Build nmap args
    const nmapArgs = buildNmapArgs(discoveryConfig, useSudo);
    onProgress?.(`Scanning subnets: ${discoveryConfig.subnets.join(", ")}`);

    // Create temp directory for XML output
    const tmpDir = await mkdtemp(join(tmpdir(), "infrawatch-nmap-"));
    const xmlOutputPath = join(tmpDir, "scan-output.xml");

    // Add XML output flag
    const fullArgs = [...nmapArgs, "-oX", xmlOutputPath];

    const maxMinutes = discoveryConfig.scanTimeout ?? discoveryConfig.maxScanMinutes ?? 30;

    try {
      // Run nmap
      await this.runNmap(fullArgs, maxMinutes, useSudo, onProgress, signal);

      // Read and parse XML output
      onProgress?.("Nmap finished, parsing results...");
      const xmlContent = await readFile(xmlOutputPath, "utf-8");
      const nmapHosts = parseNmapXml(xmlContent);

      // Map to HostInventory
      const hosts = nmapHosts.map(mapNmapHostToInventory);
      onProgress?.(`Found ${hosts.length} live host(s) with ${hosts.reduce((s, h) => s + h.services.length, 0)} open port(s)`);

      return { hosts };
    } finally {
      // Clean up temp files
      try {
        await unlink(xmlOutputPath);
        await rmdir(tmpDir);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Check if we can run sudo without a password (e.g. in Docker container).
   */
  private canUseSudo(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      // Check if already running as root
      if (process.getuid?.() === 0) {
        resolve(false); // No sudo needed, already root
        return;
      }

      const proc = spawn("sudo", ["-n", "true"], {
        stdio: ["ignore", "ignore", "ignore"],
      });
      proc.on("close", (code) => resolve(code === 0));
      proc.on("error", () => resolve(false));

      // Don't wait forever
      setTimeout(() => {
        proc.kill();
        resolve(false);
      }, 3000);
    });
  }

  private runNmap(
    args: string[],
    maxMinutes: number,
    useSudo: boolean,
    onProgress?: (message: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error("Scan cancelled"));
        return;
      }

      const command = useSudo ? "sudo" : "nmap";
      const spawnArgs = useSudo ? ["nmap", ...args] : args;

      const proc = spawn(command, spawnArgs, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let cancelled = false;
      let stderr = "";
      let stderrBuffer = "";
      let stdoutBuffer = "";

      // Listen for abort signal to kill the nmap process
      const onAbort = () => {
        cancelled = true;
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!proc.killed) proc.kill("SIGKILL");
        }, 3000);
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      const processNmapOutput = (text: string, buffer: string): string => {
        buffer += text;
        const lines = buffer.split("\n");
        const remainder = lines.pop() ?? "";
        for (const line of lines) {
          const progressMsg = parseNmapProgress(line);
          if (progressMsg) onProgress!(progressMsg);
        }
        return remainder;
      };

      proc.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        if (onProgress) {
          stderrBuffer = processNmapOutput(text, stderrBuffer);
        }
      });

      // nmap -v outputs progress (scan phases, discovered ports) to stdout
      proc.stdout?.on("data", (chunk: Buffer) => {
        if (onProgress) {
          stdoutBuffer = processNmapOutput(chunk.toString(), stdoutBuffer);
        }
      });

      const timeout = setTimeout(() => {
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!proc.killed) proc.kill("SIGKILL");
        }, 5000);
        reject(
          new Error(
            `Nmap scan exceeded timeout of ${maxMinutes} minutes`
          )
        );
      }, maxMinutes * 60 * 1000);

      proc.on("close", (code) => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
        if (cancelled) {
          reject(new Error("Scan cancelled"));
        } else if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(
              `Nmap exited with code ${code}: ${stderr.slice(0, 500)}`
            )
          );
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
        reject(new Error(`Failed to start nmap: ${err.message}`));
      });
    });
  }
}
