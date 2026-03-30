import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseNmapXml,
  mapNmapHostToInventory,
  detectPlatform,
  classifyServiceTypeByPort,
  parseNmapProgress,
  validateSubnets,
} from "../scanners/network-discovery-scanner.js";
import type { NmapHost } from "../scanners/network-discovery-scanner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_XML = readFileSync(
  join(__dirname, "fixtures", "nmap-sample-output.xml"),
  "utf-8",
);

// ─── parseNmapXml — fixture-based tests ───

describe("parseNmapXml — fixture hosts", () => {
  const hosts = parseNmapXml(FIXTURE_XML);

  it("parses all 6 hosts from fixture", () => {
    expect(hosts).toHaveLength(6);
    expect(hosts.every((h) => h.status === "up")).toBe(true);
  });

  it("maps each host to HostInventory with correct platform", () => {
    for (const host of hosts) {
      const inv = mapNmapHostToInventory(host);
      expect(inv.hostname).toBeTruthy();
      expect(inv.ip).toBeTruthy();
      expect(inv.metadata.scanSource).toBe("nmap-network-discovery");
    }
  });

  it("detects platform for Linux server", () => {
    const linux = hosts.find((h) => h.ip === "192.168.1.10")!;
    expect(detectPlatform(linux)).toBe("linux-server");
  });

  it("detects platform for Windows server", () => {
    const win = hosts.find((h) => h.ip === "192.168.1.20")!;
    expect(detectPlatform(win)).toBe("windows-server");
  });

  it("detects platform for Docker host", () => {
    const docker = hosts.find((h) => h.ip === "192.168.1.30")!;
    expect(detectPlatform(docker)).toBe("docker-host");
  });

  it("detects platform for network device (switch)", () => {
    const sw = hosts.find((h) => h.ip === "192.168.1.1")!;
    expect(detectPlatform(sw)).toBe("network-device");
  });

  it("handles host with ambiguous OS matches", () => {
    const ambiguous = hosts.find((h) => h.ip === "192.168.1.40")!;
    expect(ambiguous.osMatch).toBeDefined();
    expect(ambiguous.osMatch!.length).toBeGreaterThan(1);

    // mapNmapHostToInventory should use the highest-accuracy match
    const inv = mapNmapHostToInventory(ambiguous);
    expect(inv.os).toBeTruthy();
    expect(inv.os).not.toBe("Unknown");
  });

  it("handles host with no OS detection", () => {
    const bare = hosts.find((h) => h.ip === "192.168.1.50")!;
    expect(bare.osMatch).toBeUndefined();

    const inv = mapNmapHostToInventory(bare);
    expect(inv.os).toBe("Unknown");
    expect(inv.hostname).toBe("192.168.1.50"); // uses IP as hostname
  });

  it("classifies service types correctly for all ports", () => {
    const linux = hosts.find((h) => h.ip === "192.168.1.10")!;
    const inv = mapNmapHostToInventory(linux);

    const sshSvc = inv.services.find((s) => s.port === 22);
    expect(sshSvc?.serviceType).toBe("remote-access");

    const httpSvc = inv.services.find((s) => s.port === 80);
    expect(httpSvc?.serviceType).toBe("webserver");

    const httpsSvc = inv.services.find((s) => s.port === 443);
    expect(httpsSvc?.serviceType).toBe("webserver");

    const pgSvc = inv.services.find((s) => s.port === 5432);
    expect(pgSvc?.serviceType).toBe("database");
  });
});

// ─── parseNmapXml — malformed and edge cases ───

describe("parseNmapXml — error handling", () => {
  it("handles completely empty XML", () => {
    expect(parseNmapXml("")).toHaveLength(0);
  });

  it("handles XML with no hosts", () => {
    const xml = '<?xml version="1.0"?><nmaprun></nmaprun>';
    expect(parseNmapXml(xml)).toHaveLength(0);
  });

  it("handles truncated XML (partial results)", () => {
    // Simulate partial scan that only has one complete host
    const xml = `<?xml version="1.0"?>
<nmaprun>
  <host>
    <status state="up"/>
    <address addr="10.0.0.1" addrtype="ipv4"/>
    <ports>
      <port protocol="tcp" portid="22">
        <state state="open"/>
        <service name="ssh"/>
      </port>
    </ports>
  </host>
</nmaprun>`;
    const hosts = parseNmapXml(xml);
    expect(hosts).toHaveLength(1);
    expect(hosts[0].ip).toBe("10.0.0.1");
    expect(hosts[0].ports).toHaveLength(1);
  });

  it("skips hosts that are down", () => {
    const xml = `<?xml version="1.0"?>
<nmaprun>
  <host><status state="down"/><address addr="10.0.0.1" addrtype="ipv4"/></host>
  <host><status state="up"/><address addr="10.0.0.2" addrtype="ipv4"/></host>
</nmaprun>`;
    const hosts = parseNmapXml(xml);
    expect(hosts).toHaveLength(1);
    expect(hosts[0].ip).toBe("10.0.0.2");
  });

  it("skips hosts without IPv4 address", () => {
    const xml = `<?xml version="1.0"?>
<nmaprun>
  <host>
    <status state="up"/>
    <address addr="AA:BB:CC:DD:EE:FF" addrtype="mac"/>
  </host>
</nmaprun>`;
    const hosts = parseNmapXml(xml);
    expect(hosts).toHaveLength(0);
  });

  it("extracts MAC address when present", () => {
    const xml = `<?xml version="1.0"?>
<nmaprun>
  <host>
    <status state="up"/>
    <address addr="10.0.0.1" addrtype="ipv4"/>
    <address addr="AA:BB:CC:DD:EE:FF" addrtype="mac"/>
  </host>
</nmaprun>`;
    const hosts = parseNmapXml(xml);
    expect(hosts[0].mac).toBe("AA:BB:CC:DD:EE:FF");
  });

  it("only includes open ports", () => {
    const xml = `<?xml version="1.0"?>
<nmaprun>
  <host>
    <status state="up"/>
    <address addr="10.0.0.1" addrtype="ipv4"/>
    <ports>
      <port protocol="tcp" portid="22"><state state="open"/></port>
      <port protocol="tcp" portid="23"><state state="closed"/></port>
      <port protocol="tcp" portid="80"><state state="filtered"/></port>
      <port protocol="tcp" portid="443"><state state="open"/></port>
    </ports>
  </host>
</nmaprun>`;
    const hosts = parseNmapXml(xml);
    expect(hosts[0].ports).toHaveLength(2);
    expect(hosts[0].ports.map((p) => p.portId)).toEqual([22, 443]);
  });
});

// ─── parseNmapProgress ───

describe("parseNmapProgress", () => {
  it("parses stats line", () => {
    const result = parseNmapProgress(
      "Stats: 0:01:23 elapsed; 5 hosts completed (3 up), 2 undergoing SYN Stealth Scan",
    );
    expect(result).toContain("0:01:23");
    expect(result).toContain("5");
    expect(result).toContain("3 up");
  });

  it("parses percentage progress", () => {
    const result = parseNmapProgress(
      "SYN Stealth Scan Timing: About 45.00% done; ETC: 21:55 (0:01:30 remaining)",
    );
    expect(result).toContain("45%");
    expect(result).toContain("0:01:30");
  });

  it("parses discovered open port", () => {
    const result = parseNmapProgress(
      "Discovered open port 22/tcp on 192.168.1.1",
    );
    expect(result).toContain("22/tcp");
    expect(result).toContain("192.168.1.1");
  });

  it("parses initiating scan phase", () => {
    const result = parseNmapProgress("Initiating Connect Scan at 21:58");
    expect(result).toContain("Connect Scan");
  });

  it("parses completed scan phase", () => {
    const result = parseNmapProgress(
      "Completed Ping Scan at 21:58, 13.77s elapsed (256 total hosts)",
    );
    expect(result).toContain("Ping Scan");
    expect(result).toContain("13.77s");
  });

  it("parses DNS resolution", () => {
    const result = parseNmapProgress(
      "Initiating Parallel DNS resolution of 9 hosts.",
    );
    expect(result).toContain("9 host(s)");
  });

  it("returns null for unrecognized lines", () => {
    expect(parseNmapProgress("")).toBeNull();
    expect(parseNmapProgress("random noise")).toBeNull();
  });
});

// ─── classifyServiceTypeByPort — comprehensive ───

describe("classifyServiceTypeByPort — comprehensive", () => {
  const expected: Record<number, string> = {
    22: "remote-access",
    23: "remote-access",
    25: "mail",
    53: "dns",
    80: "webserver",
    110: "mail",
    143: "mail",
    443: "webserver",
    993: "mail",
    995: "mail",
    1433: "database",
    1521: "database",
    2375: "container-runtime",
    2376: "container-runtime",
    3306: "database",
    3389: "remote-access",
    5432: "database",
    5672: "queue",
    5900: "remote-access",
    5985: "remote-access",
    6379: "cache",
    6443: "orchestrator",
    8080: "webserver",
    8443: "webserver",
    9090: "monitoring",
    9200: "monitoring",
    10250: "orchestrator",
    15672: "queue",
    27017: "database",
  };

  for (const [port, type] of Object.entries(expected)) {
    it(`port ${port} → ${type}`, () => {
      expect(classifyServiceTypeByPort(Number(port))).toBe(type);
    });
  }
});

// ─── validateSubnets — additional edge cases ───

describe("validateSubnets — additional", () => {
  it("rejects octet > 255", () => {
    expect(() => validateSubnets(["256.0.0.0/24"])).toThrow();
  });

  it("rejects /15 (too large)", () => {
    expect(() => validateSubnets(["10.0.0.0/15"])).toThrow(/too large/i);
  });

  it("accepts /16 boundary", () => {
    expect(() => validateSubnets(["10.0.0.0/16"])).not.toThrow();
  });
});
