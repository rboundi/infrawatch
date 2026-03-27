export interface ScanResult {
  hosts: HostInventory[];
}

export interface HostInventory {
  hostname: string;
  ip: string;
  os: string;
  osVersion: string;
  arch: string;
  packages: PackageInfo[];
  services: ServiceInfo[];
  metadata: Record<string, unknown>;
}

export interface PackageInfo {
  name: string;
  installedVersion: string;
  packageManager: string;
  ecosystem: string;
}

export interface ServiceInfo {
  name: string;
  serviceType: string;
  version?: string;
  port?: number;
  status: string;
}

export interface ScanTargetConfig {
  type: string;
  connectionConfig: Record<string, unknown>;
}
