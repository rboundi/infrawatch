import { describe, it, expect } from "vitest";
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
} from "../scanners/parsers.js";

// ─── OS Discovery ───

describe("parseOsRelease", () => {
  it("parses Ubuntu os-release", () => {
    const input = `PRETTY_NAME="Ubuntu 22.04.3 LTS"
NAME="Ubuntu"
VERSION_ID="22.04"
VERSION="22.04.3 LTS (Jammy Jellyfish)"
ID=ubuntu
ID_LIKE=debian
HOME_URL="https://www.ubuntu.com/"
`;
    const result = parseOsRelease(input);
    expect(result.id).toBe("ubuntu");
    expect(result.versionId).toBe("22.04");
    expect(result.prettyName).toBe("Ubuntu 22.04.3 LTS");
  });

  it("parses Alpine os-release", () => {
    const input = `NAME="Alpine Linux"
ID=alpine
VERSION_ID=3.19.0
PRETTY_NAME="Alpine Linux v3.19"
`;
    const result = parseOsRelease(input);
    expect(result.id).toBe("alpine");
    expect(result.versionId).toBe("3.19.0");
  });

  it("returns unknown for empty input", () => {
    const result = parseOsRelease("");
    expect(result.id).toBe("unknown");
    expect(result.versionId).toBe("unknown");
  });
});

describe("parseUname", () => {
  it("parses architecture", () => {
    expect(parseUname("x86_64\n")).toBe("x86_64");
    expect(parseUname("aarch64\n")).toBe("aarch64");
  });
});

describe("parseHostname", () => {
  it("parses FQDN", () => {
    expect(parseHostname("web01.prod.example.com\n")).toBe(
      "web01.prod.example.com"
    );
  });
});

describe("parseHostnameIp", () => {
  it("parses first IP from hostname -I output", () => {
    expect(parseHostnameIp("10.0.1.5 172.17.0.1 \n")).toBe("10.0.1.5");
  });

  it("handles single IP", () => {
    expect(parseHostnameIp("192.168.1.100\n")).toBe("192.168.1.100");
  });
});

// ─── Package Discovery ───

describe("parseDpkgOutput", () => {
  it("parses dpkg tab-separated output", () => {
    const input = `curl\t7.88.1-10+deb12u5
git\t1:2.39.2-1.1
openssl\t3.0.11-1~deb12u2
`;
    const result = parseDpkgOutput(input);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      name: "curl",
      installedVersion: "7.88.1-10+deb12u5",
      packageManager: "apt",
      ecosystem: "debian",
    });
    expect(result[1].name).toBe("git");
  });

  it("handles empty input", () => {
    expect(parseDpkgOutput("")).toHaveLength(0);
  });
});

describe("parseRpmOutput", () => {
  it("parses rpm tab-separated output", () => {
    const input = `bash\t5.2.15-3.el9
openssl\t3.0.7-25.el9_3
curl\t7.76.1-26.el9
`;
    const result = parseRpmOutput(input);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      name: "bash",
      installedVersion: "5.2.15-3.el9",
      packageManager: "yum",
      ecosystem: "rhel",
    });
  });
});

describe("parseApkOutput", () => {
  it("parses apk list -I output", () => {
    const input = `busybox-1.36.1-r15 x86_64 {busybox} (GPL-2.0-only)
alpine-baselayout-3.4.3-r2 x86_64 {alpine-baselayout} (GPL-2.0-only)
musl-1.2.4_git20230717-r4 x86_64 {musl} (MIT)
`;
    const result = parseApkOutput(input);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      name: "busybox",
      installedVersion: "1.36.1-r15",
      packageManager: "apk",
      ecosystem: "alpine",
    });
    expect(result[2].name).toBe("musl");
  });
});

describe("parsePipOutput", () => {
  it("parses pip list JSON", () => {
    const input = JSON.stringify([
      { name: "requests", version: "2.31.0" },
      { name: "flask", version: "3.0.0" },
    ]);
    const result = parsePipOutput(input);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      name: "requests",
      installedVersion: "2.31.0",
      packageManager: "pip",
      ecosystem: "pypi",
    });
  });

  it("returns empty array for invalid JSON", () => {
    expect(parsePipOutput("not json")).toHaveLength(0);
  });
});

describe("parseNpmGlobalOutput", () => {
  it("parses npm list -g JSON", () => {
    const input = JSON.stringify({
      dependencies: {
        npm: { version: "10.2.4" },
        typescript: { version: "5.3.3" },
      },
    });
    const result = parseNpmGlobalOutput(input);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      name: "npm",
      installedVersion: "10.2.4",
      packageManager: "npm",
      ecosystem: "npm",
    });
  });

  it("returns empty for invalid JSON", () => {
    expect(parseNpmGlobalOutput("error")).toHaveLength(0);
  });
});

// ─── Service Discovery ───

describe("parseSystemctlOutput", () => {
  it("parses running services", () => {
    const input = `  UNIT                     LOAD   ACTIVE SUB     DESCRIPTION
  nginx.service            loaded active running A high performance web server
  sshd.service             loaded active running OpenSSH server daemon
  postgresql.service       loaded active running PostgreSQL database server
`;
    const result = parseSystemctlOutput(input);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ name: "nginx", fullName: "nginx.service" });
    expect(result[1]).toEqual({ name: "sshd", fullName: "sshd.service" });
    expect(result[2]).toEqual({
      name: "postgresql",
      fullName: "postgresql.service",
    });
  });

  it("skips non-service lines", () => {
    const result = parseSystemctlOutput("LOAD = Reflects...\n\n");
    expect(result).toHaveLength(0);
  });
});

describe("classifyServiceType", () => {
  it("classifies known services", () => {
    expect(classifyServiceType("nginx")).toBe("webserver");
    expect(classifyServiceType("apache2")).toBe("webserver");
    expect(classifyServiceType("httpd")).toBe("webserver");
    expect(classifyServiceType("postgresql")).toBe("database");
    expect(classifyServiceType("mysql")).toBe("database");
    expect(classifyServiceType("redis")).toBe("cache");
    expect(classifyServiceType("redis-server")).toBe("cache");
    expect(classifyServiceType("docker")).toBe("container-runtime");
    expect(classifyServiceType("rabbitmq")).toBe("queue");
    expect(classifyServiceType("prometheus")).toBe("monitoring");
    expect(classifyServiceType("tomcat")).toBe("appserver");
  });

  it("defaults to 'other' for unknown services", () => {
    expect(classifyServiceType("my-custom-app")).toBe("other");
  });
});

// ─── Version Parsers ───

describe("version parsers", () => {
  it("parseNginxVersion", () => {
    expect(parseNginxVersion("nginx version: nginx/1.24.0")).toBe("1.24.0");
    expect(parseNginxVersion("no match")).toBeUndefined();
  });

  it("parseApacheVersion", () => {
    expect(
      parseApacheVersion("Server version: Apache/2.4.57 (Ubuntu)")
    ).toBe("2.4.57");
  });

  it("parseJavaVersion", () => {
    expect(
      parseJavaVersion('openjdk version "17.0.8" 2023-07-18')
    ).toBe("17.0.8");
    expect(parseJavaVersion('java version "1.8.0_382"')).toBe("1.8.0_382");
  });

  it("parseTomcatVersion", () => {
    expect(
      parseTomcatVersion("Server version: Apache Tomcat/10.1.13")
    ).toBe("10.1.13");
  });

  it("parsePostgresVersion", () => {
    expect(parsePostgresVersion("psql (PostgreSQL) 16.1")).toBe("16.1");
  });

  it("parseMysqlVersion", () => {
    expect(
      parseMysqlVersion(
        "mysql  Ver 8.0.35-0ubuntu0.22.04.1 for Linux on x86_64"
      )
    ).toBe("8.0.35");
  });

  it("parseRedisVersion", () => {
    expect(
      parseRedisVersion(
        "Redis server v=7.2.3 sha=00000000:0 malloc=jemalloc-5.3.0 bits=64"
      )
    ).toBe("7.2.3");
  });

  it("parseDockerVersion", () => {
    expect(
      parseDockerVersion("Docker version 24.0.7, build afdd53b")
    ).toBe("24.0.7");
  });

  it("parseNodeVersion", () => {
    expect(parseNodeVersion("v20.10.0\n")).toBe("20.10.0");
  });
});

// ─── Docker Discovery ───

describe("parseDockerPs", () => {
  it("parses docker ps output", () => {
    const input = `abc123\tnginx:1.25\tmy-nginx\tUp 3 hours\t0.0.0.0:8080->80/tcp
def456\tredis:7.2\tmy-redis\tUp 3 hours\t0.0.0.0:6379->6379/tcp
`;
    const result = parseDockerPs(input);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: "abc123",
      image: "nginx:1.25",
      name: "my-nginx",
      status: "Up 3 hours",
      ports: "0.0.0.0:8080->80/tcp",
    });
  });
});

describe("dockerContainersToPackages", () => {
  it("converts containers to packages", () => {
    const containers = [
      {
        id: "abc",
        image: "nginx:1.25",
        name: "web",
        status: "Up",
        ports: "",
      },
      {
        id: "def",
        image: "redis",
        name: "cache",
        status: "Up",
        ports: "",
      },
    ];
    const result = dockerContainersToPackages(containers);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      name: "nginx",
      installedVersion: "1.25",
      packageManager: "docker",
      ecosystem: "docker",
    });
    expect(result[1].installedVersion).toBe("latest");
  });
});

describe("dockerContainersToServices", () => {
  it("converts containers to services with ports", () => {
    const containers = [
      {
        id: "abc",
        image: "nginx:1.25",
        name: "web",
        status: "Up 2 hours",
        ports: "0.0.0.0:8080->80/tcp",
      },
    ];
    const result = dockerContainersToServices(containers);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "docker:web",
      serviceType: "container-runtime",
      version: "nginx:1.25",
      port: 8080,
      status: "running",
    });
  });

  it("detects stopped containers", () => {
    const containers = [
      {
        id: "abc",
        image: "nginx:1.25",
        name: "web",
        status: "Exited (0) 2 hours ago",
        ports: "",
      },
    ];
    const result = dockerContainersToServices(containers);
    expect(result[0].status).toBe("stopped");
  });
});
