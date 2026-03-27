import { describe, it, expect } from "vitest";
import {
  vmToHostInventory,
  esxiHostToHostInventory,
} from "../scanners/vmware-scanner.js";
import type {
  VsphereVmSummary,
  VsphereVmDetail,
  VsphereVmToolsInfo,
  VsphereHostSummary,
  VsphereHostDetail,
} from "../scanners/vmware-scanner.js";

// ─── vmToHostInventory ───

describe("vmToHostInventory", () => {
  const baseSummary: VsphereVmSummary = {
    vm: "vm-123",
    name: "web-server-01",
    power_state: "POWERED_ON",
    cpu_count: 4,
    memory_size_MiB: 8192,
  };

  const baseDetail: VsphereVmDetail = {
    guest_OS: "RHEL_8_64",
    name: "web-server-01",
    power_state: "POWERED_ON",
    cpu: { count: 4 },
    memory: { size_MiB: 8192 },
    guest: {
      full_name: "Red Hat Enterprise Linux 8 (64-bit)",
      os_version: "8.9",
      ip_address: "10.0.1.50",
      host_name: "web-server-01.prod.local",
    },
    hardware: { version: "vmx-19" },
  };

  const baseTools: VsphereVmToolsInfo = {
    version_number: 12352,
    version: "12.3.5",
    run_state: "RUNNING",
  };

  it("converts a fully-populated VM", () => {
    const result = vmToHostInventory(
      baseSummary,
      baseDetail,
      baseTools,
      "esxi-host-01"
    );

    expect(result.hostname).toBe("web-server-01.prod.local");
    expect(result.ip).toBe("10.0.1.50");
    expect(result.os).toBe("Red Hat Enterprise Linux 8 (64-bit)");
    expect(result.osVersion).toBe("8.9");

    expect(result.packages).toHaveLength(2);
    expect(result.packages[0]).toEqual({
      name: "vmware-tools",
      installedVersion: "12.3.5",
      packageManager: "vmware",
      ecosystem: "vmware",
    });
    expect(result.packages[1]).toEqual({
      name: "vmware-hardware",
      installedVersion: "vmx-19",
      packageManager: "vmware",
      ecosystem: "vmware",
    });

    expect(result.services).toHaveLength(1);
    expect(result.services[0]).toEqual({
      name: "vmware-tools",
      serviceType: "monitoring",
      version: "12.3.5",
      status: "running",
    });

    expect(result.metadata.vmId).toBe("vm-123");
    expect(result.metadata.powerState).toBe("POWERED_ON");
    expect(result.metadata.cpuCount).toBe(4);
    expect(result.metadata.memoryMB).toBe(8192);
    expect(result.metadata.esxiHost).toBe("esxi-host-01");
  });

  it("uses VM name as hostname when guest hostname missing", () => {
    const detail: VsphereVmDetail = {
      ...baseDetail,
      guest: { full_name: "Ubuntu 22.04" },
    };
    const result = vmToHostInventory(baseSummary, detail, null);
    expect(result.hostname).toBe("web-server-01");
  });

  it("falls back to summary fields when detail is null", () => {
    const result = vmToHostInventory(baseSummary, null, null);
    expect(result.hostname).toBe("web-server-01");
    expect(result.os).toBe("unknown");
    expect(result.ip).toBe("");
    expect(result.packages).toHaveLength(0);
    expect(result.services).toHaveLength(0);
    expect(result.metadata.cpuCount).toBe(4);
    expect(result.metadata.memoryMB).toBe(8192);
  });

  it("handles tools with NOT_RUNNING state", () => {
    const tools: VsphereVmToolsInfo = {
      version: "11.0.0",
      run_state: "NOT_RUNNING",
    };
    const result = vmToHostInventory(baseSummary, baseDetail, tools);
    expect(result.services[0].status).toBe("stopped");
  });

  it("handles powered off VM", () => {
    const summary: VsphereVmSummary = {
      ...baseSummary,
      power_state: "POWERED_OFF",
    };
    const result = vmToHostInventory(summary, null, null);
    expect(result.metadata.powerState).toBe("POWERED_OFF");
  });

  it("uses identity fields as fallback for guest fields", () => {
    const detail: VsphereVmDetail = {
      name: "legacy-vm",
      power_state: "POWERED_ON",
      identity: {
        full_name: "Windows Server 2019",
        ip_address: "10.0.2.100",
        host_name: "legacy-vm.corp.local",
      },
    };
    const result = vmToHostInventory(
      { vm: "vm-456", name: "legacy-vm", power_state: "POWERED_ON" },
      detail,
      null
    );
    expect(result.hostname).toBe("legacy-vm.corp.local");
    expect(result.ip).toBe("10.0.2.100");
    expect(result.os).toBe("Windows Server 2019");
  });
});

// ─── esxiHostToHostInventory ───

describe("esxiHostToHostInventory", () => {
  it("converts a connected ESXi host with detail", () => {
    const summary: VsphereHostSummary = {
      host: "host-10",
      name: "esxi-host-01.dc.local",
      connection_state: "CONNECTED",
      power_state: "POWERED_ON",
    };
    const detail: VsphereHostDetail = {
      name: "esxi-host-01.dc.local",
      product: {
        name: "VMware ESXi",
        version: "8.0.2",
        build: "22380479",
        fullName: "VMware ESXi 8.0.2 build-22380479",
      },
    };

    const result = esxiHostToHostInventory(summary, detail);

    expect(result.hostname).toBe("esxi-host-01.dc.local");
    expect(result.os).toBe("VMware ESXi 8.0.2 build-22380479");
    expect(result.osVersion).toBe("8.0.2");
    expect(result.packages).toHaveLength(1);
    expect(result.packages[0]).toEqual({
      name: "esxi",
      installedVersion: "8.0.2 (build 22380479)",
      packageManager: "vmware",
      ecosystem: "vmware",
    });
    expect(result.services[0].status).toBe("running");
    expect(result.metadata.hostId).toBe("host-10");
    expect(result.metadata.connectionState).toBe("CONNECTED");
  });

  it("handles disconnected host with no detail", () => {
    const summary: VsphereHostSummary = {
      host: "host-20",
      name: "esxi-host-02",
      connection_state: "DISCONNECTED",
      power_state: "POWERED_ON",
    };

    const result = esxiHostToHostInventory(summary, null);

    expect(result.hostname).toBe("esxi-host-02");
    expect(result.os).toBe("VMware ESXi");
    expect(result.osVersion).toBe("unknown");
    expect(result.packages[0].installedVersion).toBe("unknown");
    expect(result.services[0].status).toBe("stopped");
  });

  it("handles detail without build number", () => {
    const summary: VsphereHostSummary = {
      host: "host-30",
      name: "esxi-03",
      connection_state: "CONNECTED",
      power_state: "POWERED_ON",
    };
    const detail: VsphereHostDetail = {
      product: {
        name: "VMware ESXi",
        version: "7.0.3",
      },
    };

    const result = esxiHostToHostInventory(summary, detail);
    expect(result.packages[0].installedVersion).toBe("7.0.3");
  });
});
