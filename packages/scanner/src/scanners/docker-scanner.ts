import Docker from "dockerode";
import type { ContainerInfo } from "dockerode";
import { BaseScanner } from "../base-scanner.js";
import type {
  ScanResult,
  ScanTargetConfig,
  HostInventory,
  PackageInfo,
  ServiceInfo,
} from "../types.js";

export interface DockerConnectionConfig {
  host?: string;
  port?: number;
  ca?: string;
  cert?: string;
  key?: string;
  socketPath?: string;
}

// ─── Pure helpers (testable) ───

export interface DockerContainerSummary {
  id: string;
  name: string;
  image: string;
  imageTag: string;
  state: string;
  status: string;
  ports: Array<{ hostPort?: number; containerPort: number; protocol: string }>;
  created: string;
}

/**
 * Normalize a Dockerode ContainerInfo into our summary type.
 */
export function normalizeContainer(c: ContainerInfo): DockerContainerSummary {
  // Container names have leading "/" in Docker API
  const name = (c.Names?.[0] ?? "").replace(/^\//, "") || c.Id.slice(0, 12);

  // Parse image into name + tag
  const fullImage = c.Image ?? "";
  let image = fullImage;
  let imageTag = "latest";

  if (fullImage.includes("@")) {
    // Digest ref
    const [img, digest] = fullImage.split("@");
    image = img ?? fullImage;
    imageTag = digest ?? "unknown";
  } else {
    const lastColon = fullImage.lastIndexOf(":");
    const lastSlash = fullImage.lastIndexOf("/");
    if (lastColon > lastSlash && lastColon !== -1) {
      image = fullImage.slice(0, lastColon);
      imageTag = fullImage.slice(lastColon + 1);
    }
  }

  const ports = (c.Ports ?? []).map((p) => ({
    hostPort: p.PublicPort,
    containerPort: p.PrivatePort,
    protocol: p.Type ?? "tcp",
  }));

  return {
    id: c.Id,
    name,
    image,
    imageTag,
    state: c.State ?? "unknown",
    status: c.Status ?? "unknown",
    ports,
    created: new Date((c.Created ?? 0) * 1000).toISOString(),
  };
}

/**
 * De-duplicate container images into PackageInfo entries.
 */
export function containersToPackages(
  containers: DockerContainerSummary[]
): PackageInfo[] {
  const seen = new Set<string>();
  const packages: PackageInfo[] = [];

  for (const c of containers) {
    const key = `${c.image}:${c.imageTag}`;
    if (seen.has(key)) continue;
    seen.add(key);

    packages.push({
      name: c.image,
      installedVersion: c.imageTag,
      packageManager: "docker",
      ecosystem: "docker",
    });
  }

  return packages;
}

/**
 * Convert running containers into ServiceInfo entries.
 */
export function containersToServices(
  containers: DockerContainerSummary[]
): ServiceInfo[] {
  return containers
    .filter((c) => c.state === "running")
    .map((c) => {
      const hostPort = c.ports.find((p) => p.hostPort)?.hostPort;
      return {
        name: c.name,
        serviceType: "container-runtime" as const,
        version: `${c.image}:${c.imageTag}`,
        port: hostPort,
        status: "running",
      };
    });
}

export interface DockerHostInfo {
  os: string;
  kernelVersion: string;
  totalMemory: number;
  cpus: number;
  dockerVersion: string;
  totalContainers: number;
  runningContainers: number;
  images: number;
}

export function buildHostInventory(
  hostIdentifier: string,
  hostInfo: DockerHostInfo,
  containers: DockerContainerSummary[]
): HostInventory {
  const packages = containersToPackages(containers);

  // Add Docker daemon itself as a package
  packages.unshift({
    name: "docker-engine",
    installedVersion: hostInfo.dockerVersion,
    packageManager: "docker",
    ecosystem: "docker",
  });

  return {
    hostname: hostIdentifier,
    ip: "",
    os: hostInfo.os,
    osVersion: hostInfo.kernelVersion,
    arch: "",
    packages,
    services: containersToServices(containers),
    connections: [],
    metadata: {
      dockerVersion: hostInfo.dockerVersion,
      totalContainers: hostInfo.totalContainers,
      runningContainers: hostInfo.runningContainers,
      images: hostInfo.images,
      totalMemoryMB: Math.round(hostInfo.totalMemory / 1024 / 1024),
      cpus: hostInfo.cpus,
      scannedAt: new Date().toISOString(),
    },
  };
}

// ─── Scanner implementation ───

export class DockerScanner extends BaseScanner {
  async scan(config: ScanTargetConfig): Promise<ScanResult> {
    const connConfig =
      config.connectionConfig as unknown as DockerConnectionConfig;

    const docker = this.createClient(connConfig);
    const hostIdentifier = connConfig.host ?? connConfig.socketPath ?? "docker-host";

    // Gather info concurrently
    const [containerList, version, info] = await Promise.all([
      docker.listContainers({ all: true }),
      docker.version(),
      docker.info(),
    ]);

    const containers = containerList.map(normalizeContainer);

    const hostInfo: DockerHostInfo = {
      os: info.OperatingSystem ?? "unknown",
      kernelVersion: info.KernelVersion ?? "unknown",
      totalMemory: info.MemTotal ?? 0,
      cpus: info.NCPU ?? 0,
      dockerVersion: version.Version ?? "unknown",
      totalContainers: info.Containers ?? 0,
      runningContainers: info.ContainersRunning ?? 0,
      images: info.Images ?? 0,
    };

    const host = buildHostInventory(hostIdentifier, hostInfo, containers);

    return { hosts: [host] };
  }

  private createClient(config: DockerConnectionConfig): Docker {
    if (config.socketPath) {
      return new Docker({ socketPath: config.socketPath });
    }

    const opts: Docker.DockerOptions = {
      host: config.host ?? "localhost",
      port: config.port ?? 2376,
      protocol: "https" as const,
    };

    if (config.ca || config.cert || config.key) {
      opts.ca = config.ca;
      opts.cert = config.cert;
      opts.key = config.key;
    }

    return new Docker(opts);
  }
}
