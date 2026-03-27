import axios, { type AxiosInstance } from "axios";
import https from "node:https";
import { BaseScanner } from "../base-scanner.js";
import type {
  ScanResult,
  ScanTargetConfig,
  HostInventory,
  PackageInfo,
  ServiceInfo,
} from "../types.js";

export interface VmwareConnectionConfig {
  /** vCenter hostname or IP */
  host: string;
  username: string;
  password: string;
  /** Skip TLS certificate verification (for self-signed certs) */
  ignoreSslErrors?: boolean;
}

// ─── vSphere REST API response types ───

export interface VsphereVmSummary {
  vm: string;
  name: string;
  power_state: "POWERED_ON" | "POWERED_OFF" | "SUSPENDED";
  cpu_count?: number;
  memory_size_MiB?: number;
}

export interface VsphereVmDetail {
  guest_OS?: string;
  name: string;
  power_state: "POWERED_ON" | "POWERED_OFF" | "SUSPENDED";
  cpu?: { count: number };
  memory?: { size_MiB: number };
  disks?: Record<
    string,
    { capacity?: number; label?: string; type?: string }
  >;
  nics?: Record<
    string,
    {
      label?: string;
      mac_address?: string;
      backing?: { network?: string; type?: string };
      state?: string;
    }
  >;
  identity?: {
    name?: string;
    ip_address?: string;
    family?: string;
    full_name?: string;
    host_name?: string;
  };
  guest?: {
    full_name?: string;
    os_version?: string;
    ip_address?: string;
    host_name?: string;
  };
  hardware?: {
    version?: string;
  };
}

export interface VsphereVmToolsInfo {
  version_number?: number;
  version?: string;
  run_state?: "RUNNING" | "NOT_RUNNING";
  upgrade_policy?: string;
}

export interface VsphereHostSummary {
  host: string;
  name: string;
  connection_state: "CONNECTED" | "DISCONNECTED" | "NOT_RESPONDING";
  power_state: "POWERED_ON" | "POWERED_OFF" | "STANDBY";
}

export interface VsphereHostDetail {
  name?: string;
  product?: {
    name?: string;
    version?: string;
    build?: string;
    fullName?: string;
  };
}

// ─── Pure conversion helpers (testable) ───

export function vmToHostInventory(
  summary: VsphereVmSummary,
  detail: VsphereVmDetail | null,
  tools: VsphereVmToolsInfo | null,
  esxiHostName?: string
): HostInventory {
  const guestFullName =
    detail?.guest?.full_name ??
    detail?.identity?.full_name ??
    detail?.guest_OS ??
    "unknown";

  const guestVersion =
    detail?.guest?.os_version ?? "";

  const hostname =
    detail?.guest?.host_name ??
    detail?.identity?.host_name ??
    summary.name;

  const ip =
    detail?.guest?.ip_address ??
    detail?.identity?.ip_address ??
    "";

  const packages: PackageInfo[] = [];

  if (tools?.version) {
    packages.push({
      name: "vmware-tools",
      installedVersion: tools.version,
      packageManager: "vmware",
      ecosystem: "vmware",
    });
  }

  if (detail?.hardware?.version) {
    packages.push({
      name: "vmware-hardware",
      installedVersion: detail.hardware.version,
      packageManager: "vmware",
      ecosystem: "vmware",
    });
  }

  const services: ServiceInfo[] = [];
  if (tools) {
    services.push({
      name: "vmware-tools",
      serviceType: "monitoring",
      version: tools.version,
      status: tools.run_state === "RUNNING" ? "running" : "stopped",
    });
  }

  return {
    hostname,
    ip,
    os: guestFullName,
    osVersion: guestVersion,
    arch: "",
    packages,
    services,
    metadata: {
      vmId: summary.vm,
      vmName: summary.name,
      powerState: summary.power_state,
      cpuCount: detail?.cpu?.count ?? summary.cpu_count ?? 0,
      memoryMB: detail?.memory?.size_MiB ?? summary.memory_size_MiB ?? 0,
      esxiHost: esxiHostName,
      vmwareToolsVersion: tools?.version,
      vmwareToolsRunState: tools?.run_state,
      hardwareVersion: detail?.hardware?.version,
      scannedAt: new Date().toISOString(),
    },
  };
}

export function esxiHostToHostInventory(
  summary: VsphereHostSummary,
  detail: VsphereHostDetail | null
): HostInventory {
  const version = detail?.product?.version ?? "unknown";
  const build = detail?.product?.build ?? "";
  const fullVersion = build ? `${version} (build ${build})` : version;

  const packages: PackageInfo[] = [
    {
      name: "esxi",
      installedVersion: fullVersion,
      packageManager: "vmware",
      ecosystem: "vmware",
    },
  ];

  return {
    hostname: summary.name,
    ip: "",
    os: detail?.product?.fullName ?? detail?.product?.name ?? "VMware ESXi",
    osVersion: version,
    arch: "",
    packages,
    services: [
      {
        name: "esxi",
        serviceType: "other",
        version: fullVersion,
        status:
          summary.connection_state === "CONNECTED" ? "running" : "stopped",
      },
    ],
    metadata: {
      hostId: summary.host,
      connectionState: summary.connection_state,
      powerState: summary.power_state,
      productName: detail?.product?.name,
      productVersion: version,
      productBuild: build,
      scannedAt: new Date().toISOString(),
    },
  };
}

// ─── Scanner implementation ───

export class VmwareScanner extends BaseScanner {
  async scan(config: ScanTargetConfig): Promise<ScanResult> {
    const connConfig =
      config.connectionConfig as unknown as VmwareConnectionConfig;

    const httpsAgent = connConfig.ignoreSslErrors
      ? new https.Agent({ rejectUnauthorized: false })
      : undefined;

    const baseURL = `https://${connConfig.host}`;
    const client = axios.create({ baseURL, httpsAgent, timeout: 30_000 });

    // Authenticate
    let sessionToken: string;
    try {
      const resp = await client.post<string>("/api/session", null, {
        auth: {
          username: connConfig.username,
          password: connConfig.password,
        },
      });
      sessionToken = resp.data;
    } catch (err) {
      console.error("[vmware-scanner] Authentication failed:", err);
      throw new Error(
        `VMware authentication failed for ${connConfig.host}`
      );
    }

    // Set session header for all subsequent requests
    client.defaults.headers.common["vmware-api-session-id"] = sessionToken;

    try {
      return await this.discover(client);
    } finally {
      // Always clean up session
      try {
        await client.delete("/api/session");
      } catch {
        console.warn("[vmware-scanner] Failed to clean up session");
      }
    }
  }

  private async discover(client: AxiosInstance): Promise<ScanResult> {
    const hosts: HostInventory[] = [];

    // ─── ESXi hosts ───
    const esxiHostNames = new Map<string, string>();
    try {
      const hostListResp = await client.get<VsphereHostSummary[]>(
        "/api/vcenter/host"
      );

      for (const hostSummary of hostListResp.data ?? []) {
        esxiHostNames.set(hostSummary.host, hostSummary.name);

        let detail: VsphereHostDetail | null = null;
        try {
          const detailResp = await client.get<VsphereHostDetail>(
            `/api/vcenter/host/${hostSummary.host}`
          );
          detail = detailResp.data;
        } catch (err) {
          console.warn(
            `[vmware-scanner] Failed to get details for ESXi host "${hostSummary.name}":`,
            err
          );
        }

        hosts.push(esxiHostToHostInventory(hostSummary, detail));
      }
    } catch (err) {
      console.warn("[vmware-scanner] Failed to list ESXi hosts:", err);
    }

    // ─── Virtual Machines ───
    try {
      const vmListResp = await client.get<VsphereVmSummary[]>(
        "/api/vcenter/vm"
      );

      for (const vmSummary of vmListResp.data ?? []) {
        let detail: VsphereVmDetail | null = null;
        let tools: VsphereVmToolsInfo | null = null;

        try {
          const detailResp = await client.get<VsphereVmDetail>(
            `/api/vcenter/vm/${vmSummary.vm}`
          );
          detail = detailResp.data;
        } catch (err) {
          console.warn(
            `[vmware-scanner] Failed to get details for VM "${vmSummary.name}":`,
            err
          );
        }

        try {
          const toolsResp = await client.get<VsphereVmToolsInfo>(
            `/api/vcenter/vm/${vmSummary.vm}/tools`
          );
          tools = toolsResp.data;
        } catch (err) {
          // Tools endpoint may 404 if tools aren't installed
          console.warn(
            `[vmware-scanner] No tools info for VM "${vmSummary.name}"`
          );
        }

        // Try to resolve the ESXi host name from the host mapping
        // (vSphere detail doesn't directly include host in a simple field)
        const esxiHostName = undefined; // Would need /api/vcenter/vm/{vm} host field

        hosts.push(
          vmToHostInventory(vmSummary, detail, tools, esxiHostName)
        );
      }
    } catch (err) {
      console.warn("[vmware-scanner] Failed to list VMs:", err);
    }

    return { hosts };
  }
}
