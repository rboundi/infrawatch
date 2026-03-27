import type { BaseScanner } from "./base-scanner.js";
import { SshLinuxScanner } from "./scanners/ssh-linux-scanner.js";
import { KubernetesScanner } from "./scanners/kubernetes-scanner.js";
import { AwsScanner } from "./scanners/aws-scanner.js";
import { VmwareScanner } from "./scanners/vmware-scanner.js";
import { DockerScanner } from "./scanners/docker-scanner.js";
import { WinrmScanner } from "./scanners/winrm-scanner.js";
import { NetworkDiscoveryScanner } from "./scanners/network-discovery-scanner.js";

const SCANNER_MAP: Record<string, new () => BaseScanner> = {
  ssh_linux: SshLinuxScanner,
  kubernetes: KubernetesScanner,
  aws: AwsScanner,
  vmware: VmwareScanner,
  docker: DockerScanner,
  winrm: WinrmScanner,
  network_discovery: NetworkDiscoveryScanner,
};

export const SUPPORTED_SCANNER_TYPES = Object.keys(SCANNER_MAP);

export function createScanner(type: string): BaseScanner {
  const ScannerClass = SCANNER_MAP[type];
  if (!ScannerClass) {
    throw new Error(
      `Unknown scanner type "${type}". Supported types: ${SUPPORTED_SCANNER_TYPES.join(", ")}`
    );
  }
  return new ScannerClass();
}
