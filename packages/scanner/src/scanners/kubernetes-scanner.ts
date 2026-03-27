import * as k8s from "@kubernetes/client-node";
import { BaseScanner } from "../base-scanner.js";
import type {
  ScanResult,
  ScanTargetConfig,
  HostInventory,
  PackageInfo,
  ServiceInfo,
} from "../types.js";

export interface KubernetesConnectionConfig {
  /** Base64-encoded kubeconfig YAML content */
  kubeconfig?: string;
  /** Context name to use from kubeconfig */
  context?: string;
  /** Use in-cluster service account auth */
  inCluster?: boolean;
}

// ─── Parsing helpers (pure, testable) ───

export interface ContainerImageRef {
  fullImage: string;
  name: string;
  tag: string;
}

/**
 * Parse a container image string into name + tag.
 * Examples:
 *   "nginx:1.25"          -> { name: "nginx", tag: "1.25" }
 *   "registry.io/app"     -> { name: "registry.io/app", tag: "latest" }
 *   "gcr.io/proj/img:v2"  -> { name: "gcr.io/proj/img", tag: "v2" }
 *   "img@sha256:abc..."   -> { name: "img", tag: "sha256:abc..." }
 */
export function parseImageRef(image: string): ContainerImageRef {
  // Handle digest references (image@sha256:...)
  if (image.includes("@")) {
    const [name, digest] = image.split("@");
    return { fullImage: image, name: name ?? image, tag: digest ?? "unknown" };
  }

  // Handle tag references — be careful with registry ports like registry:5000/img:tag
  const lastColon = image.lastIndexOf(":");
  const lastSlash = image.lastIndexOf("/");

  if (lastColon > lastSlash && lastColon !== -1) {
    return {
      fullImage: image,
      name: image.slice(0, lastColon),
      tag: image.slice(lastColon + 1),
    };
  }

  return { fullImage: image, name: image, tag: "latest" };
}

/**
 * De-duplicate container images across pods/deployments, returning unique PackageInfo entries.
 */
export function imagesToPackages(images: ContainerImageRef[]): PackageInfo[] {
  const seen = new Set<string>();
  const packages: PackageInfo[] = [];

  for (const img of images) {
    const key = `${img.name}:${img.tag}`;
    if (seen.has(key)) continue;
    seen.add(key);

    packages.push({
      name: img.name,
      installedVersion: img.tag,
      packageManager: "docker",
      ecosystem: "docker",
    });
  }

  return packages;
}

/**
 * Build ServiceInfo entries from K8s service specs.
 */
export interface K8sServiceSummary {
  name: string;
  namespace: string;
  type: string;
  ports: Array<{ port: number; targetPort: number | string; protocol: string }>;
  selectors: Record<string, string>;
}

export function k8sServiceToServiceInfo(svc: K8sServiceSummary): ServiceInfo {
  const port = svc.ports[0]?.port;
  return {
    name: `${svc.namespace}/${svc.name}`,
    serviceType: svc.type === "LoadBalancer" || svc.type === "NodePort"
      ? "webserver"
      : "other",
    port,
    status: "running",
  };
}

/**
 * Build ServiceInfo entries from K8s ingress specs.
 */
export interface K8sIngressSummary {
  name: string;
  namespace: string;
  hosts: string[];
  paths: string[];
}

export function k8sIngressToServiceInfo(ing: K8sIngressSummary): ServiceInfo {
  return {
    name: `${ing.namespace}/${ing.name}`,
    serviceType: "webserver",
    version: ing.hosts.join(", "),
    port: 443,
    status: "running",
  };
}

// ─── Scanner implementation ───

export class KubernetesScanner extends BaseScanner {
  async scan(config: ScanTargetConfig): Promise<ScanResult> {
    const connConfig = config.connectionConfig as unknown as KubernetesConnectionConfig;
    const kc = this.buildKubeConfig(connConfig);

    const coreApi = kc.makeApiClient(k8s.CoreV1Api);
    const appsApi = kc.makeApiClient(k8s.AppsV1Api);
    const networkingApi = kc.makeApiClient(k8s.NetworkingV1Api);

    // Get cluster version
    const versionApi = kc.makeApiClient(k8s.VersionApi);
    let clusterVersion = "unknown";
    try {
      const versionInfo = await versionApi.getCode();
      clusterVersion = `${versionInfo.major}.${versionInfo.minor}`;
    } catch (err) {
      console.warn("[k8s-scanner] Failed to get cluster version:", err);
    }

    // List namespaces
    let namespaces: string[] = [];
    try {
      const nsResponse = await coreApi.listNamespace();
      namespaces = (nsResponse.items ?? [])
        .map((ns) => ns.metadata?.name)
        .filter((n): n is string => !!n);
    } catch (err) {
      console.warn("[k8s-scanner] Failed to list namespaces (RBAC?):", err);
      return { hosts: [] };
    }

    const hosts: HostInventory[] = [];

    for (const ns of namespaces) {
      try {
        const nsHosts = await this.scanNamespace(
          ns,
          clusterVersion,
          coreApi,
          appsApi,
          networkingApi
        );
        hosts.push(...nsHosts);
      } catch (err) {
        console.warn(
          `[k8s-scanner] Failed to scan namespace "${ns}" (RBAC?):`,
          err
        );
        // Continue with next namespace
      }
    }

    return { hosts };
  }

  private buildKubeConfig(config: KubernetesConnectionConfig): k8s.KubeConfig {
    const kc = new k8s.KubeConfig();

    if (config.inCluster) {
      kc.loadFromCluster();
    } else if (config.kubeconfig) {
      const decoded = Buffer.from(config.kubeconfig, "base64").toString("utf-8");
      kc.loadFromString(decoded);
    } else {
      kc.loadFromDefault();
    }

    if (config.context) {
      kc.setCurrentContext(config.context);
    }

    return kc;
  }

  private async scanNamespace(
    namespace: string,
    clusterVersion: string,
    coreApi: k8s.CoreV1Api,
    appsApi: k8s.AppsV1Api,
    networkingApi: k8s.NetworkingV1Api
  ): Promise<HostInventory[]> {
    // ─── Deployments ───
    const deploymentsResp = await appsApi.listNamespacedDeployment({ namespace });
    const deployments = deploymentsResp.items ?? [];

    // ─── Pods ───
    const podsResp = await coreApi.listNamespacedPod({ namespace });
    const pods = podsResp.items ?? [];

    // ─── Services ───
    const servicesResp = await coreApi.listNamespacedService({ namespace });
    const k8sServices = (servicesResp.items ?? []).map((svc): K8sServiceSummary => ({
      name: svc.metadata?.name ?? "unknown",
      namespace,
      type: svc.spec?.type ?? "ClusterIP",
      ports: (svc.spec?.ports ?? []).map((p) => ({
        port: p.port,
        targetPort: (p.targetPort as number | string) ?? p.port,
        protocol: p.protocol ?? "TCP",
      })),
      selectors: (svc.spec?.selector as Record<string, string>) ?? {},
    }));

    // ─── Ingresses ───
    let k8sIngresses: K8sIngressSummary[] = [];
    try {
      const ingressResp = await networkingApi.listNamespacedIngress({ namespace });
      k8sIngresses = (ingressResp.items ?? []).map((ing): K8sIngressSummary => {
        const rules = ing.spec?.rules ?? [];
        return {
          name: ing.metadata?.name ?? "unknown",
          namespace,
          hosts: rules.map((r) => r.host).filter((h): h is string => !!h),
          paths: rules.flatMap(
            (r) =>
              r.http?.paths?.map((p) => p.path).filter((p): p is string => !!p) ?? []
          ),
        };
      });
    } catch {
      // Ingress API may not be available or RBAC may block it
      console.warn(
        `[k8s-scanner] Failed to list ingresses in "${namespace}", skipping`
      );
    }

    // Build pod image map keyed by owner (deployment) name
    const podImagesByOwner = new Map<string, ContainerImageRef[]>();
    const podMetadataByOwner = new Map<
      string,
      Array<{ podName: string; status: string; restarts: number }>
    >();

    for (const pod of pods) {
      // Find owning deployment via ReplicaSet -> Deployment chain
      const ownerName = this.findDeploymentOwner(pod) ?? "__standalone__";

      const images = (pod.spec?.containers ?? [])
        .map((c) => c.image)
        .filter((img): img is string => !!img)
        .map(parseImageRef);

      const initImages = (pod.spec?.initContainers ?? [])
        .map((c) => c.image)
        .filter((img): img is string => !!img)
        .map(parseImageRef);

      const existing = podImagesByOwner.get(ownerName) ?? [];
      podImagesByOwner.set(ownerName, [...existing, ...images, ...initImages]);

      const restarts = (pod.status?.containerStatuses ?? []).reduce(
        (sum, cs) => sum + (cs.restartCount ?? 0),
        0
      );

      const podMeta = podMetadataByOwner.get(ownerName) ?? [];
      podMeta.push({
        podName: pod.metadata?.name ?? "unknown",
        status: pod.status?.phase ?? "Unknown",
        restarts,
      });
      podMetadataByOwner.set(ownerName, podMeta);
    }

    // One HostInventory per deployment
    const hosts: HostInventory[] = [];

    for (const deployment of deployments) {
      const deployName = deployment.metadata?.name ?? "unknown";
      const fullName = `${namespace}/${deployName}`;

      // Collect images from deployment spec
      const specImages = (deployment.spec?.template?.spec?.containers ?? [])
        .map((c) => c.image)
        .filter((img): img is string => !!img)
        .map(parseImageRef);

      const initSpecImages = (deployment.spec?.template?.spec?.initContainers ?? [])
        .map((c) => c.image)
        .filter((img): img is string => !!img)
        .map(parseImageRef);

      // Merge with pod-level images
      const podImages = podImagesByOwner.get(deployName) ?? [];
      const allImages = [...specImages, ...initSpecImages, ...podImages];
      const packages = imagesToPackages(allImages);

      // Match services by label selector
      const deployLabels = deployment.spec?.template?.metadata?.labels ?? {};
      const matchingServices = k8sServices.filter((svc) =>
        Object.entries(svc.selectors).every(
          ([key, val]) => (deployLabels as Record<string, string>)[key] === val
        )
      );

      const services: ServiceInfo[] = matchingServices.map(k8sServiceToServiceInfo);

      // Add matching ingresses
      for (const ing of k8sIngresses) {
        services.push(k8sIngressToServiceInfo(ing));
      }

      const podMeta = podMetadataByOwner.get(deployName) ?? [];

      hosts.push({
        hostname: fullName,
        ip: "",
        os: "kubernetes",
        osVersion: clusterVersion,
        arch: "",
        packages,
        services,
        metadata: {
          namespace,
          deploymentName: deployName,
          replicas: deployment.spec?.replicas ?? 0,
          availableReplicas: deployment.status?.availableReplicas ?? 0,
          pods: podMeta,
          scannedAt: new Date().toISOString(),
        },
      });
    }

    return hosts;
  }

  /**
   * Attempt to find the deployment name that owns a pod
   * via the ownerReferences chain (Pod -> ReplicaSet -> Deployment).
   */
  private findDeploymentOwner(pod: k8s.V1Pod): string | undefined {
    const owners = pod.metadata?.ownerReferences ?? [];
    for (const owner of owners) {
      if (owner.kind === "ReplicaSet") {
        // ReplicaSet names follow pattern: <deployment-name>-<hash>
        const rsName = owner.name;
        const lastDash = rsName.lastIndexOf("-");
        if (lastDash > 0) {
          return rsName.slice(0, lastDash);
        }
        return rsName;
      }
    }
    return undefined;
  }
}
