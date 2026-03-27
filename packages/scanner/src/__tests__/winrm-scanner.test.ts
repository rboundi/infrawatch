import { describe, it, expect } from "vitest";
import {
  parseComputerInfo,
  parseInstalledPrograms,
  parseRunningServices,
  parseIisSites,
  parseDotNetVersion,
  mergeInstalledPrograms,
} from "../scanners/winrm-scanner.js";

// ─── parseComputerInfo ───

describe("parseComputerInfo", () => {
  it("parses valid JSON", () => {
    const json = JSON.stringify({
      CsName: "WEB-SERVER-01",
      WindowsVersion: "10.0.20348",
      OsArchitecture: "64-bit",
      WindowsBuildLabEx: "20348.1.amd64fre.fe_release.210507-1500",
    });
    const result = parseComputerInfo(json);
    expect(result.CsName).toBe("WEB-SERVER-01");
    expect(result.WindowsVersion).toBe("10.0.20348");
    expect(result.OsArchitecture).toBe("64-bit");
  });

  it("returns empty object for invalid JSON", () => {
    const result = parseComputerInfo("not json");
    expect(result).toEqual({});
  });
});

// ─── parseInstalledPrograms ───

describe("parseInstalledPrograms", () => {
  it("parses array of programs", () => {
    const json = JSON.stringify([
      { DisplayName: "Microsoft Visual C++ 2019", DisplayVersion: "14.29.30133" },
      { DisplayName: "Git", DisplayVersion: "2.43.0" },
      { DisplayName: null, DisplayVersion: "1.0" }, // should be filtered
    ]);
    const result = parseInstalledPrograms(json);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      name: "Microsoft Visual C++ 2019",
      installedVersion: "14.29.30133",
      packageManager: "msi",
      ecosystem: "windows",
    });
    expect(result[1].name).toBe("Git");
  });

  it("handles single object (not array)", () => {
    const json = JSON.stringify({
      DisplayName: "Node.js",
      DisplayVersion: "20.10.0",
    });
    const result = parseInstalledPrograms(json);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Node.js");
  });

  it("handles missing DisplayVersion", () => {
    const json = JSON.stringify([
      { DisplayName: "Some App" },
    ]);
    const result = parseInstalledPrograms(json);
    expect(result[0].installedVersion).toBe("unknown");
  });

  it("returns empty for invalid JSON", () => {
    expect(parseInstalledPrograms("error")).toHaveLength(0);
  });

  it("returns empty for empty array", () => {
    expect(parseInstalledPrograms("[]")).toHaveLength(0);
  });
});

// ─── parseRunningServices ───

describe("parseRunningServices", () => {
  it("parses services with correct type classification", () => {
    const json = JSON.stringify([
      { Name: "W3SVC", DisplayName: "World Wide Web Publishing Service" },
      { Name: "MSSQLSERVER", DisplayName: "SQL Server" },
      { Name: "Spooler", DisplayName: "Print Spooler" },
      { Name: "docker", DisplayName: "Docker Desktop Service" },
    ]);
    const result = parseRunningServices(json);
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual({
      name: "W3SVC",
      serviceType: "webserver",
      version: undefined,
      status: "running",
    });
    expect(result[1].serviceType).toBe("database");
    expect(result[2].serviceType).toBe("other");
    expect(result[3].serviceType).toBe("container-runtime");
  });

  it("handles single service object", () => {
    const json = JSON.stringify({ Name: "sshd", DisplayName: "OpenSSH" });
    const result = parseRunningServices(json);
    expect(result).toHaveLength(1);
  });

  it("filters entries without Name", () => {
    const json = JSON.stringify([{ DisplayName: "No name" }]);
    const result = parseRunningServices(json);
    expect(result).toHaveLength(0);
  });

  it("returns empty for invalid JSON", () => {
    expect(parseRunningServices("error")).toHaveLength(0);
  });
});

// ─── parseIisSites ───

describe("parseIisSites", () => {
  it("parses IIS sites", () => {
    const json = JSON.stringify([
      { Name: "Default Web Site", State: "Started" },
      { Name: "API Site", State: "Stopped" },
    ]);
    const result = parseIisSites(json);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      name: "Default Web Site",
      serviceType: "webserver",
      status: "running",
    });
    expect(result[1].status).toBe("stopped");
  });

  it("handles single site", () => {
    const json = JSON.stringify({ Name: "MySite", State: "Started" });
    const result = parseIisSites(json);
    expect(result).toHaveLength(1);
  });

  it("returns empty for empty array / error", () => {
    expect(parseIisSites("[]")).toHaveLength(0);
    expect(parseIisSites("error")).toHaveLength(0);
  });
});

// ─── parseDotNetVersion ───

describe("parseDotNetVersion", () => {
  it("parses .NET 8 version", () => {
    expect(parseDotNetVersion(".NET 8.0.1\r\n")).toBe(".NET 8.0.1");
  });

  it("parses .NET Framework version", () => {
    expect(parseDotNetVersion(".NET Framework 4.8.4614.0")).toBe(
      ".NET Framework 4.8.4614.0"
    );
  });

  it("returns undefined for non-.NET output", () => {
    expect(parseDotNetVersion("error text")).toBeUndefined();
    expect(parseDotNetVersion("")).toBeUndefined();
  });
});

// ─── mergeInstalledPrograms ───

describe("mergeInstalledPrograms", () => {
  it("de-duplicates programs across hives", () => {
    const hive64 = [
      { name: "Git", installedVersion: "2.43.0", packageManager: "msi", ecosystem: "windows" },
      { name: "Node.js", installedVersion: "20.10.0", packageManager: "msi", ecosystem: "windows" },
    ];
    const hive32 = [
      { name: "Git", installedVersion: "2.43.0", packageManager: "msi", ecosystem: "windows" },
      { name: "7-Zip", installedVersion: "23.01", packageManager: "msi", ecosystem: "windows" },
    ];
    const result = mergeInstalledPrograms(hive64, hive32);
    expect(result).toHaveLength(3);
    expect(result.map((p) => p.name)).toEqual(["Git", "Node.js", "7-Zip"]);
  });

  it("keeps different versions as separate entries", () => {
    const hive64 = [
      { name: "VC++ Runtime", installedVersion: "14.29", packageManager: "msi", ecosystem: "windows" },
    ];
    const hive32 = [
      { name: "VC++ Runtime", installedVersion: "14.36", packageManager: "msi", ecosystem: "windows" },
    ];
    const result = mergeInstalledPrograms(hive64, hive32);
    expect(result).toHaveLength(2);
  });

  it("handles empty inputs", () => {
    expect(mergeInstalledPrograms([], [])).toHaveLength(0);
  });
});
