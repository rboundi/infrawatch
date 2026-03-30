import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildNmapArgs,
  parseNmapXml,
  mapNmapHostToInventory,
  detectPlatform,
  classifyServiceTypeByPort,
  mapServiceEcosystem,
  validateSubnets,
  INFRASTRUCTURE_PORTS,
} from "../scanners/network-discovery-scanner.js";
import type {
  NetworkDiscoveryConfig,
  NmapHost,
} from "../scanners/network-discovery-scanner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_XML = readFileSync(
  join(__dirname, "fixtures", "nmap-sample-output.xml"),
  "utf-8"
);

// ─── buildNmapArgs ───

describe("buildNmapArgs", () => {
  it("builds default args (polite, infrastructure ports, OS+version detection)", () => {
    const config: NetworkDiscoveryConfig = {
      subnets: ["192.168.1.0/24"],
    };
    const args = buildNmapArgs(config, true);

    expect(args).toContain("-sS");
    expect(args).toContain("-T2");
    expect(args).toContain("-O");
    expect(args).toContain("--osscan-guess");
    expect(args).toContain("-sV");
    expect(args).toContain("--version-intensity");
    expect(args).toContain("-p");
    expect(args).toContain(INFRASTRUCTURE_PORTS);
    expect(args).toContain("--max-retries");
    expect(args).toContain("--min-rate");
    expect(args).toContain("192.168.1.0/24");
  });

  it("builds stealthy profile without min-rate", () => {
    const config: NetworkDiscoveryConfig = {
      subnets: ["10.0.0.0/24"],
      scanProfile: "stealthy",
    };
    const args = buildNmapArgs(config, true);

    expect(args).toContain("-T1");
    expect(args).not.toContain("--min-rate");
    expect(args).toContain("--max-retries");
  });

  it("builds full port scan", () => {
    const config: NetworkDiscoveryConfig = {
      subnets: ["192.168.1.0/24"],
      portProfile: "full",
    };
    const args = buildNmapArgs(config, true);

    expect(args).toContain("-p-");
    expect(args).not.toContain(INFRASTRUCTURE_PORTS);
  });

  it("builds custom ports", () => {
    const config: NetworkDiscoveryConfig = {
      subnets: ["192.168.1.0/24"],
      portProfile: "custom",
      customPorts: "80,443,8080",
    };
    const args = buildNmapArgs(config, true);

    expect(args).toContain("-p");
    expect(args).toContain("80,443,8080");
  });

  it("includes exclude hosts", () => {
    const config: NetworkDiscoveryConfig = {
      subnets: ["192.168.1.0/24"],
      excludeHosts: ["192.168.1.1", "192.168.1.2"],
    };
    const args = buildNmapArgs(config, true);

    expect(args).toContain("--exclude");
    expect(args).toContain("192.168.1.1,192.168.1.2");
  });

  it("includes script scanning when enabled", () => {
    const config: NetworkDiscoveryConfig = {
      subnets: ["192.168.1.0/24"],
      enableScriptScan: true,
    };
    const args = buildNmapArgs(config, true);

    expect(args).toContain("--script");
    expect(args).toContain(
      "ssl-cert,http-title,ssh-hostkey,smb-os-discovery,vmware-version"
    );
  });

  it("builds aggressive with all options", () => {
    const config: NetworkDiscoveryConfig = {
      subnets: ["10.0.0.0/24", "172.16.0.0/24"],
      scanProfile: "aggressive",
      portProfile: "full",
      enableOsDetection: true,
      enableVersionDetection: true,
      enableScriptScan: true,
      excludeHosts: ["10.0.0.1"],
    };
    const args = buildNmapArgs(config, true);

    expect(args).toContain("-T4");
    expect(args).toContain("-p-");
    expect(args).toContain("-O");
    expect(args).toContain("-sV");
    expect(args).toContain("--script");
    expect(args).toContain("--exclude");
    expect(args).toContain("--min-rate");
    expect(args).toContain("10.0.0.0/24");
    expect(args).toContain("172.16.0.0/24");
  });
});

// ─── parseNmapXml ───

describe("parseNmapXml", () => {
  const hosts = parseNmapXml(FIXTURE_XML);

  it("parses all 6 hosts", () => {
    expect(hosts).toHaveLength(6);
  });

  it("extracts correct IPs", () => {
    const ips = hosts.map((h) => h.ip);
    expect(ips).toContain("192.168.1.10");
    expect(ips).toContain("192.168.1.20");
    expect(ips).toContain("192.168.1.30");
    expect(ips).toContain("192.168.1.1");
    expect(ips).toContain("192.168.1.40");
    expect(ips).toContain("192.168.1.50");
  });

  it("extracts hostnames from PTR records", () => {
    const linuxHost = hosts.find((h) => h.ip === "192.168.1.10")!;
    expect(linuxHost.hostname).toBe("webserver.local");

    const winHost = hosts.find((h) => h.ip === "192.168.1.20")!;
    expect(winHost.hostname).toBe("dc01.corp.local");

    const dockerHost = hosts.find((h) => h.ip === "192.168.1.30")!;
    expect(dockerHost.hostname).toBe("docker-host.local");
  });

  it("extracts OS information", () => {
    const linuxHost = hosts.find((h) => h.ip === "192.168.1.10")!;
    expect(linuxHost.osMatch).toBeDefined();
    expect(linuxHost.osMatch![0].name).toBe("Linux 5.15 - 6.1");
    expect(linuxHost.osMatch![0].accuracy).toBe(98);

    const winHost = hosts.find((h) => h.ip === "192.168.1.20")!;
    expect(winHost.osMatch![0].name).toBe("Microsoft Windows Server 2022");
  });

  it("extracts open ports with service info", () => {
    const linuxHost = hosts.find((h) => h.ip === "192.168.1.10")!;
    expect(linuxHost.ports).toHaveLength(4);

    const sshPort = linuxHost.ports.find((p) => p.portId === 22)!;
    expect(sshPort.service?.product).toBe("OpenSSH");
    expect(sshPort.service?.version).toBe("8.9p1");
    expect(sshPort.state).toBe("open");

    const pgPort = linuxHost.ports.find((p) => p.portId === 5432)!;
    expect(pgPort.service?.product).toBe("PostgreSQL");
    expect(pgPort.service?.version).toBe("15.4");
  });

  it("handles missing hostnames", () => {
    const networkDevice = hosts.find((h) => h.ip === "192.168.1.1")!;
    expect(networkDevice.hostname).toBeUndefined();

    const ambiguous = hosts.find((h) => h.ip === "192.168.1.40")!;
    expect(ambiguous.hostname).toBeUndefined();

    const bare = hosts.find((h) => h.ip === "192.168.1.50")!;
    expect(bare.hostname).toBeUndefined();
  });

  it("handles missing OS matches", () => {
    const bare = hosts.find((h) => h.ip === "192.168.1.50")!;
    expect(bare.osMatch).toBeUndefined();
  });
});

// ─── mapNmapHostToInventory ───

describe("mapNmapHostToInventory", () => {
  const hosts = parseNmapXml(FIXTURE_XML);

  it("maps Linux server correctly", () => {
    const linuxHost = hosts.find((h) => h.ip === "192.168.1.10")!;
    const inventory = mapNmapHostToInventory(linuxHost);

    expect(inventory.hostname).toBe("webserver.local");
    expect(inventory.ip).toBe("192.168.1.10");
    expect(inventory.os).toBe("Linux 5.15 - 6.1");

    // Packages from detected services
    expect(inventory.packages.length).toBeGreaterThanOrEqual(3);
    const sshPkg = inventory.packages.find((p) => p.name === "OpenSSH");
    expect(sshPkg).toBeDefined();
    expect(sshPkg!.installedVersion).toBe("8.9p1");
    expect(sshPkg!.ecosystem).toBe("linux");

    const nginxPkg = inventory.packages.find((p) => p.name === "nginx");
    expect(nginxPkg).toBeDefined();
    expect(nginxPkg!.ecosystem).toBe("nginx");

    // Services
    expect(inventory.services).toHaveLength(4);
    const sshSvc = inventory.services.find((s) => s.port === 22)!;
    expect(sshSvc.serviceType).toBe("remote-access");
    const httpSvc = inventory.services.find((s) => s.port === 80)!;
    expect(httpSvc.serviceType).toBe("webserver");
    const pgSvc = inventory.services.find((s) => s.port === 5432)!;
    expect(pgSvc.serviceType).toBe("database");
  });

  it("maps Windows server correctly", () => {
    const winHost = hosts.find((h) => h.ip === "192.168.1.20")!;
    const inventory = mapNmapHostToInventory(winHost);

    expect(inventory.hostname).toBe("dc01.corp.local");
    expect(inventory.os).toContain("Windows");

    const rdpSvc = inventory.services.find((s) => s.port === 3389)!;
    expect(rdpSvc.serviceType).toBe("remote-access");

    const httpSvc = inventory.services.find((s) => s.port === 80)!;
    expect(httpSvc.serviceType).toBe("webserver");
  });

  it("uses IP when hostname is missing", () => {
    const bare = hosts.find((h) => h.ip === "192.168.1.50")!;
    const inventory = mapNmapHostToInventory(bare);

    expect(inventory.hostname).toBe("192.168.1.50");
  });

  it("sets correct serviceType classifications for all services", () => {
    const dockerHost = hosts.find((h) => h.ip === "192.168.1.30")!;
    const inventory = mapNmapHostToInventory(dockerHost);

    const dockerSvc = inventory.services.find((s) => s.port === 2376)!;
    expect(dockerSvc.serviceType).toBe("container-runtime");

    const proxySvc = inventory.services.find((s) => s.port === 8080)!;
    expect(proxySvc.serviceType).toBe("webserver");
  });
});

// ─── detectPlatform ───

describe("detectPlatform", () => {
  const makeHost = (
    ports: number[],
    osName?: string,
    services?: Partial<Record<number, { name?: string; product?: string }>>
  ): NmapHost => ({
    ip: "10.0.0.1",
    status: "up",
    osMatch: osName ? [{ name: osName, accuracy: 90 }] : undefined,
    ports: ports.map((portId) => ({
      portId,
      protocol: "tcp",
      state: "open",
      service: services?.[portId]
        ? {
            name: services[portId]!.name ?? "",
            product: services[portId]!.product,
          }
        : { name: "" },
    })),
  });

  it("detects linux-server", () => {
    expect(detectPlatform(makeHost([22, 80], "Linux 5.15"))).toBe(
      "linux-server"
    );
  });

  it("detects windows-server by RDP port", () => {
    expect(detectPlatform(makeHost([3389, 445]))).toBe("windows-server");
  });

  it("detects windows-server by OS name", () => {
    expect(
      detectPlatform(makeHost([80, 445], "Microsoft Windows Server 2022"))
    ).toBe("windows-server");
  });

  it("detects docker-host by port 2376", () => {
    expect(detectPlatform(makeHost([22, 2376], "Linux 5.15"))).toBe(
      "docker-host"
    );
  });

  it("detects network-device by SNMP", () => {
    expect(detectPlatform(makeHost([161], "Cisco IOS"))).toBe(
      "network-device"
    );
  });

  it("detects network-device by telnet without SSH", () => {
    expect(detectPlatform(makeHost([23]))).toBe("network-device");
  });

  it("detects kubernetes-node by port 6443", () => {
    expect(detectPlatform(makeHost([22, 6443, 10250], "Linux 5.15"))).toBe(
      "kubernetes-node"
    );
  });

  it("returns unknown for bare host", () => {
    expect(detectPlatform(makeHost([22]))).toBe("unknown");
  });

  it("detects vmware-esxi with port 443 and vmware service", () => {
    expect(
      detectPlatform(
        makeHost([443], "VMware ESXi 7.0", {
          443: { name: "https", product: "VMware vCenter" },
        })
      )
    ).toBe("vmware-esxi");
  });
});

// ─── classifyServiceTypeByPort ───

describe("classifyServiceTypeByPort", () => {
  it("classifies SSH as remote-access", () => {
    expect(classifyServiceTypeByPort(22)).toBe("remote-access");
  });

  it("classifies HTTP as webserver", () => {
    expect(classifyServiceTypeByPort(80)).toBe("webserver");
  });

  it("classifies HTTPS as webserver", () => {
    expect(classifyServiceTypeByPort(443)).toBe("webserver");
  });

  it("classifies 8080 as webserver", () => {
    expect(classifyServiceTypeByPort(8080)).toBe("webserver");
  });

  it("classifies MySQL as database", () => {
    expect(classifyServiceTypeByPort(3306)).toBe("database");
  });

  it("classifies PostgreSQL as database", () => {
    expect(classifyServiceTypeByPort(5432)).toBe("database");
  });

  it("classifies Redis as cache", () => {
    expect(classifyServiceTypeByPort(6379)).toBe("cache");
  });

  it("classifies Docker API as container-runtime", () => {
    expect(classifyServiceTypeByPort(2375)).toBe("container-runtime");
    expect(classifyServiceTypeByPort(2376)).toBe("container-runtime");
  });

  it("classifies K8s API as orchestrator", () => {
    expect(classifyServiceTypeByPort(6443)).toBe("orchestrator");
    expect(classifyServiceTypeByPort(10250)).toBe("orchestrator");
  });

  it("classifies RDP as remote-access", () => {
    expect(classifyServiceTypeByPort(3389)).toBe("remote-access");
  });

  it("classifies unknown port as other", () => {
    expect(classifyServiceTypeByPort(12345)).toBe("other");
  });

  it("classifies RabbitMQ as queue", () => {
    expect(classifyServiceTypeByPort(5672)).toBe("queue");
  });

  it("classifies Elasticsearch as monitoring", () => {
    expect(classifyServiceTypeByPort(9200)).toBe("monitoring");
  });

  it("classifies SMTP as mail", () => {
    expect(classifyServiceTypeByPort(25)).toBe("mail");
  });
});

// ─── mapServiceEcosystem ───

describe("mapServiceEcosystem", () => {
  it("maps OpenSSH to linux", () => {
    expect(mapServiceEcosystem("OpenSSH")).toBe("linux");
  });

  it("maps nginx to nginx", () => {
    expect(mapServiceEcosystem("nginx")).toBe("nginx");
  });

  it("maps PostgreSQL to postgresql", () => {
    expect(mapServiceEcosystem("PostgreSQL")).toBe("postgresql");
  });

  it("maps Microsoft IIS to windows", () => {
    expect(mapServiceEcosystem("Microsoft IIS httpd")).toBe("windows");
  });

  it("returns undefined for unknown product", () => {
    expect(mapServiceEcosystem("SomeRandomService")).toBeUndefined();
  });

  it("returns undefined for undefined input", () => {
    expect(mapServiceEcosystem(undefined)).toBeUndefined();
  });
});

// ─── validateSubnets ───

describe("validateSubnets", () => {
  it("accepts valid /24 subnet", () => {
    expect(() => validateSubnets(["192.168.1.0/24"])).not.toThrow();
  });

  it("accepts valid /16 subnet", () => {
    expect(() => validateSubnets(["10.0.0.0/16"])).not.toThrow();
  });

  it("rejects /8 subnet (too large)", () => {
    expect(() => validateSubnets(["10.0.0.0/8"])).toThrow(
      /too large/i
    );
  });

  it("rejects invalid CIDR format", () => {
    expect(() => validateSubnets(["not-a-cidr"])).toThrow(
      /invalid subnet format/i
    );
  });

  it("accepts IP range format", () => {
    expect(() => validateSubnets(["192.168.1.1-50"])).not.toThrow();
  });

  it("rejects empty subnets array", () => {
    expect(() => validateSubnets([])).toThrow(/at least one subnet/i);
  });

  it("accepts multiple valid subnets", () => {
    expect(() =>
      validateSubnets(["192.168.1.0/24", "10.0.0.0/16"])
    ).not.toThrow();
  });
});
