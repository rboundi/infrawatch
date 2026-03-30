import { describe, it, expect } from "vitest";
import {
  generateRemediation,
  type AlertContext,
} from "../services/remediation-generator.js";

function makeCtx(overrides: Partial<AlertContext> = {}): AlertContext {
  return {
    alertId: "00000000-0000-0000-0000-000000000001",
    hostId: "00000000-0000-0000-0000-000000000002",
    hostname: "web-01",
    os: overrides.os ?? "Ubuntu",
    osVersion: overrides.osVersion ?? "22.04",
    packageName: overrides.packageName ?? "nginx",
    currentVersion: overrides.currentVersion ?? "1.24.0",
    availableVersion: overrides.availableVersion ?? "1.25.3",
    ecosystem: overrides.ecosystem ?? "debian",
    packageManager: overrides.packageManager ?? "apt",
    services: overrides.services ?? [],
  };
}

// ─────────────────────────────────────────────
// Debian / apt
// ─────────────────────────────────────────────
describe("Remediation — apt (Debian/Ubuntu)", () => {
  it("should generate correct apt commands for debian package", () => {
    const result = generateRemediation(makeCtx({
      packageName: "openssl",
      availableVersion: "3.0.12",
      ecosystem: "debian",
    }));

    const cmds = result.commands.map((c) => c.command);
    expect(cmds).toContain("sudo apt-get update");
    expect(cmds.some((c) => c.includes("sudo apt-get install --only-upgrade openssl"))).toBe(true);
  });
});

// ─────────────────────────────────────────────
// RHEL / yum
// ─────────────────────────────────────────────
describe("Remediation — yum (RHEL)", () => {
  it("should generate correct yum command", () => {
    const result = generateRemediation(makeCtx({
      packageName: "httpd",
      ecosystem: "rhel",
      packageManager: "yum",
      os: "CentOS",
      availableVersion: "2.4.58",
    }));

    const cmds = result.commands.map((c) => c.command);
    expect(cmds.some((c) => c.includes("sudo yum update httpd"))).toBe(true);
  });
});

// ─────────────────────────────────────────────
// Docker
// ─────────────────────────────────────────────
describe("Remediation — Docker", () => {
  it("should generate correct docker pull command", () => {
    const result = generateRemediation(makeCtx({
      packageName: "nginx",
      ecosystem: "docker",
      packageManager: null,
      currentVersion: "1.24.0",
      availableVersion: "1.25.3",
    }));

    const cmds = result.commands.map((c) => c.command);
    expect(cmds.some((c) => c.includes("docker pull nginx:1.25.3"))).toBe(true);
    expect(cmds.some((c) => c.includes("docker stop"))).toBe(true);
    expect(cmds.some((c) => c.includes("docker run"))).toBe(true);
  });
});

// ─────────────────────────────────────────────
// Kubernetes
// ─────────────────────────────────────────────
describe("Remediation — Kubernetes", () => {
  it("should generate kubectl set image command", () => {
    const result = generateRemediation(makeCtx({
      packageName: "myapp",
      ecosystem: "kubernetes",
      packageManager: null,
      availableVersion: "2.0.0",
    }));

    const cmds = result.commands.map((c) => c.command);
    expect(cmds.some((c) => c.includes("kubectl set image deployment/"))).toBe(true);
  });
});

// ─────────────────────────────────────────────
// Service restart detection
// ─────────────────────────────────────────────
describe("Remediation — service restart detection", () => {
  it("should detect nginx service restart requirement", () => {
    const result = generateRemediation(makeCtx({
      packageName: "nginx",
      services: [
        { serviceName: "nginx", status: "running" },
        { serviceName: "sshd", status: "running" },
      ],
    }));

    expect(result.requiresRestart).toBe(true);
    expect(result.affectedServices).toContain("nginx");
    // Should not include sshd (package is nginx, not openssh)
    expect(result.affectedServices).not.toContain("sshd");
  });
});

// ─────────────────────────────────────────────
// Reboot detection
// ─────────────────────────────────────────────
describe("Remediation — reboot detection", () => {
  it("should detect reboot requirement for linux-image packages", () => {
    const result = generateRemediation(makeCtx({
      packageName: "linux-image-5.15.0-91-generic",
      ecosystem: "debian",
    }));

    expect(result.warnings.some((w) => w.toLowerCase().includes("reboot"))).toBe(true);
    expect(result.commands.some((c) => c.command === "sudo reboot")).toBe(true);
    expect(result.estimatedDowntime).toBe("minutes");
  });

  it("should detect reboot requirement for glibc", () => {
    const result = generateRemediation(makeCtx({
      packageName: "glibc",
      ecosystem: "rhel",
      packageManager: "yum",
      os: "CentOS",
    }));

    expect(result.warnings.some((w) => w.toLowerCase().includes("reboot"))).toBe(true);
  });
});
