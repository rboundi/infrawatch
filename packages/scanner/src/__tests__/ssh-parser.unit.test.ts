import { describe, it, expect } from "vitest";
import {
  parseOsRelease,
  parseDpkgOutput,
  parseRpmOutput,
  parseApkOutput,
  parsePipOutput,
  parseNpmGlobalOutput,
  parseSystemctlOutput,
  parseNginxVersion,
  parseJavaVersion,
  parseDockerPs,
  dockerContainersToPackages,
  parseSsOutput,
} from "../scanners/parsers.js";

// ─── OS Detection — additional edge cases ───

describe("parseOsRelease — edge cases", () => {
  it("parses CentOS with quoted ID", () => {
    const input = 'ID="centos"\nVERSION_ID="7"\nPRETTY_NAME="CentOS Linux 7 (Core)"';
    const result = parseOsRelease(input);
    expect(result.id).toBe("centos");
    expect(result.versionId).toBe("7");
  });

  it("parses Alpine without quotes", () => {
    const input = "ID=alpine\nVERSION_ID=3.19.1";
    const result = parseOsRelease(input);
    expect(result.id).toBe("alpine");
    expect(result.versionId).toBe("3.19.1");
  });

  it("handles missing VERSION_ID gracefully", () => {
    const input = "ID=ubuntu\n";
    const result = parseOsRelease(input);
    expect(result.id).toBe("ubuntu");
    expect(result.versionId).toBe("unknown");
  });

  it("handles completely empty input", () => {
    const result = parseOsRelease("");
    expect(result.id).toBe("unknown");
    expect(result.versionId).toBe("unknown");
    expect(result.prettyName).toBe("unknown");
  });
});

// ─── Package Parsing — edge cases ───

describe("parseDpkgOutput — edge cases", () => {
  it("parses standard output", () => {
    const input = "nginx\t1.24.0-1ubuntu1\nopenssl\t3.0.2-0ubuntu1.12\n";
    const result = parseDpkgOutput(input);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("nginx");
    expect(result[0].installedVersion).toBe("1.24.0-1ubuntu1");
    expect(result[0].ecosystem).toBe("debian");
    expect(result[0].packageManager).toBe("apt");
  });

  it("handles empty version field", () => {
    const input = "broken-package\t\n";
    const result = parseDpkgOutput(input);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("broken-package");
    expect(result[0].installedVersion).toBe("");
  });

  it("handles very large package list (5000 packages)", () => {
    const lines: string[] = [];
    for (let i = 0; i < 5000; i++) {
      lines.push(`package-${i}\t${i}.0.0-1`);
    }
    const input = lines.join("\n");
    const result = parseDpkgOutput(input);
    expect(result).toHaveLength(5000);
    expect(result[4999].name).toBe("package-4999");
  });

  it("handles package names with special characters", () => {
    const input = "lib++-dev\t1.0\nc-sharp-compiler\t2.0\nname-scope-pkg\t3.0\n";
    const result = parseDpkgOutput(input);
    expect(result).toHaveLength(3);
    expect(result[0].name).toBe("lib++-dev");
    expect(result[1].name).toBe("c-sharp-compiler");
  });

  it("handles unicode in package names", () => {
    const input = "libüñíçödé\t1.0.0\n";
    const result = parseDpkgOutput(input);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("libüñíçödé");
  });

  it("skips lines with wrong separator (no tabs)", () => {
    const input = "package1 1.0.0\npackage2\t2.0.0\n";
    const result = parseDpkgOutput(input);
    // "package1 1.0.0" has no tab — only 1 part when split on tab
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("package2");
  });
});

describe("parseRpmOutput — edge cases", () => {
  it("parses rpm output", () => {
    const input = "nginx\t1.24.0-1.el9\nhttpd\t2.4.57-5.el9\n";
    const result = parseRpmOutput(input);
    expect(result).toHaveLength(2);
    expect(result[0].ecosystem).toBe("rhel");
    expect(result[0].packageManager).toBe("yum");
  });
});

describe("parseApkOutput — edge cases", () => {
  it("parses standard apk output", () => {
    const input = "nginx-1.24.0-r0 x86_64 {nginx} (BSD-2-Clause)\n";
    const result = parseApkOutput(input);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("nginx");
    expect(result[0].installedVersion).toBe("1.24.0-r0");
    expect(result[0].ecosystem).toBe("alpine");
  });

  it("skips lines that don't match the pattern", () => {
    const input = "WARNING: something went wrong\nnginx-1.24.0-r0 x86_64 {nginx} (BSD)\n";
    const result = parseApkOutput(input);
    expect(result).toHaveLength(1);
  });
});

describe("parseNpmGlobalOutput — edge cases", () => {
  it("parses standard npm JSON", () => {
    const input = '{"dependencies":{"npm":{"version":"10.2.3"},"typescript":{"version":"5.3.2"}}}';
    const result = parseNpmGlobalOutput(input);
    expect(result).toHaveLength(2);
    expect(result[0].ecosystem).toBe("npm");
  });

  it("handles npm error output gracefully", () => {
    const input = "npm ERR! some error\n";
    const result = parseNpmGlobalOutput(input);
    expect(result).toHaveLength(0);
  });

  it("handles missing dependencies key", () => {
    const input = '{"name":"root"}';
    const result = parseNpmGlobalOutput(input);
    expect(result).toHaveLength(0);
  });
});

describe("parsePipOutput — edge cases", () => {
  it("parses standard pip JSON", () => {
    const input = '[{"name":"requests","version":"2.31.0"},{"name":"flask","version":"3.0.0"}]';
    const result = parsePipOutput(input);
    expect(result).toHaveLength(2);
    expect(result[0].ecosystem).toBe("pypi");
  });

  it("handles empty array", () => {
    const result = parsePipOutput("[]");
    expect(result).toHaveLength(0);
  });
});

// ─── Service Detection — edge cases ───

describe("parseSystemctlOutput — edge cases", () => {
  it("parses standard running services", () => {
    const input =
      "nginx.service loaded active running A high performance web server\nsshd.service loaded active running OpenBSD Secure Shell server\n";
    const result = parseSystemctlOutput(input);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("nginx");
    expect(result[1].name).toBe("sshd");
  });

  it("skips non-service units", () => {
    const input = "system.slice\nnginx.service loaded active running nginx\n";
    const result = parseSystemctlOutput(input);
    expect(result).toHaveLength(1);
  });

  it("handles empty input", () => {
    expect(parseSystemctlOutput("")).toHaveLength(0);
  });
});

// ─── Version Parsers — edge cases ───

describe("parseNginxVersion — edge cases", () => {
  it("strips Ubuntu suffix", () => {
    expect(parseNginxVersion("nginx version: nginx/1.25.3 (Ubuntu)")).toBe("1.25.3");
  });

  it("returns undefined for no match", () => {
    expect(parseNginxVersion("some other output")).toBeUndefined();
  });
});

describe("parseJavaVersion — edge cases", () => {
  it("parses openjdk version", () => {
    const input = 'openjdk version "17.0.9" 2023-10-17\nOpenJDK Runtime Environment...';
    expect(parseJavaVersion(input)).toBe("17.0.9");
  });

  it("parses legacy java version", () => {
    expect(parseJavaVersion('java version "1.8.0_392"')).toBe("1.8.0_392");
  });

  it("returns undefined for no match", () => {
    expect(parseJavaVersion("command not found")).toBeUndefined();
  });
});

// ─── Docker PS — edge cases ───

describe("parseDockerPs — edge cases", () => {
  it("parses standard docker ps output", () => {
    const input = "abc123\tnginx:1.25\tweb-server\tUp 3 days\t0.0.0.0:80->80/tcp\n";
    const result = parseDockerPs(input);
    expect(result).toHaveLength(1);
    expect(result[0].image).toBe("nginx:1.25");
    expect(result[0].name).toBe("web-server");
  });

  it("handles empty output (no containers)", () => {
    expect(parseDockerPs("")).toHaveLength(0);
  });

  it("skips lines with insufficient fields", () => {
    const input = "abc123\tnginx\n";
    const result = parseDockerPs(input);
    expect(result).toHaveLength(0);
  });
});

describe("dockerContainersToPackages — edge cases", () => {
  it("handles image with no tag (defaults to latest)", () => {
    const containers = [
      { id: "abc", image: "myapp", name: "app", status: "Up", ports: "" },
    ];
    const result = dockerContainersToPackages(containers);
    expect(result[0].name).toBe("myapp");
    expect(result[0].installedVersion).toBe("latest");
  });

  it("handles image with tag", () => {
    const containers = [
      { id: "abc", image: "nginx:1.25", name: "web", status: "Up", ports: "" },
    ];
    const result = dockerContainersToPackages(containers);
    expect(result[0].name).toBe("nginx");
    expect(result[0].installedVersion).toBe("1.25");
  });
});

// ─── Connection Parsers ───

describe("parseSsOutput", () => {
  it("parses ss ESTAB format", () => {
    const input = "ESTAB 0 0 10.0.0.5:38462 10.0.0.1:5432 users:((\"node\",pid=1234,fd=5))";
    const result = parseSsOutput(input);
    expect(result).toHaveLength(1);
    expect(result[0].remoteIp).toBe("10.0.0.1");
    expect(result[0].remotePort).toBe(5432);
    expect(result[0].processName).toBe("node");
  });

  it("filters loopback connections", () => {
    const input = "ESTAB 0 0 127.0.0.1:5432 127.0.0.1:38462";
    const result = parseSsOutput(input);
    expect(result).toHaveLength(0);
  });

  it("filters ephemeral remote ports", () => {
    const input = "ESTAB 0 0 10.0.0.5:80 10.0.0.1:49152";
    const result = parseSsOutput(input);
    expect(result).toHaveLength(0);
  });

  it("handles empty output", () => {
    expect(parseSsOutput("")).toHaveLength(0);
  });

  it("deduplicates connections", () => {
    const input = [
      "ESTAB 0 0 10.0.0.5:38462 10.0.0.1:5432 users:((\"node\",pid=1234,fd=5))",
      "ESTAB 0 0 10.0.0.5:38462 10.0.0.1:5432 users:((\"node\",pid=1234,fd=6))",
    ].join("\n");
    const result = parseSsOutput(input);
    expect(result).toHaveLength(1);
  });
});
