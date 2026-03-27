import axios, { type AxiosInstance } from "axios";
import https from "node:https";
import { BaseScanner } from "../base-scanner.js";
import type {
  ScanResult,
  ScanTargetConfig,
  HostInventory,
  PackageInfo,
  ServiceInfo,
} from "../types.js";

export interface WinrmConnectionConfig {
  host: string;
  port?: number;
  username: string;
  password: string;
  useSsl?: boolean;
  ignoreSslErrors?: boolean;
}

// ─── WinRM SOAP helpers ───

const WINRM_CONTENT_TYPE =
  "application/soap+xml;charset=UTF-8";

function shellCreateEnvelope(
  host: string,
  messageId: string
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
  xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing"
  xmlns:wsman="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd"
  xmlns:rsp="http://schemas.microsoft.com/wbem/wsman/1/windows/shell">
  <s:Header>
    <wsa:To>http://${host}/wsman</wsa:To>
    <wsman:ResourceURI s:mustUnderstand="true">http://schemas.microsoft.com/wbem/wsman/1/windows/shell/cmd</wsman:ResourceURI>
    <wsa:ReplyTo><wsa:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</wsa:Address></wsa:ReplyTo>
    <wsa:Action s:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2004/09/transfer/Create</wsa:Action>
    <wsa:MessageID>uuid:${messageId}</wsa:MessageID>
    <wsman:MaxEnvelopeSize s:mustUnderstand="true">512000</wsman:MaxEnvelopeSize>
    <wsman:OperationTimeout>PT60S</wsman:OperationTimeout>
    <wsman:OptionSet>
      <wsman:Option Name="WINRS_NOPROFILE">TRUE</wsman:Option>
      <wsman:Option Name="WINRS_CODEPAGE">65001</wsman:Option>
    </wsman:OptionSet>
  </s:Header>
  <s:Body>
    <rsp:Shell>
      <rsp:InputStreams>stdin</rsp:InputStreams>
      <rsp:OutputStreams>stdout stderr</rsp:OutputStreams>
    </rsp:Shell>
  </s:Body>
</s:Envelope>`;
}

function commandEnvelope(
  host: string,
  shellId: string,
  command: string,
  messageId: string
): string {
  // Base64-encode PowerShell command for -EncodedCommand
  const encoded = Buffer.from(command, "utf16le").toString("base64");
  const fullCmd = `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
  xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing"
  xmlns:wsman="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd"
  xmlns:rsp="http://schemas.microsoft.com/wbem/wsman/1/windows/shell">
  <s:Header>
    <wsa:To>http://${host}/wsman</wsa:To>
    <wsman:ResourceURI s:mustUnderstand="true">http://schemas.microsoft.com/wbem/wsman/1/windows/shell/cmd</wsman:ResourceURI>
    <wsa:ReplyTo><wsa:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</wsa:Address></wsa:ReplyTo>
    <wsa:Action s:mustUnderstand="true">http://schemas.microsoft.com/wbem/wsman/1/windows/shell/Command</wsa:Action>
    <wsa:MessageID>uuid:${messageId}</wsa:MessageID>
    <wsman:MaxEnvelopeSize s:mustUnderstand="true">512000</wsman:MaxEnvelopeSize>
    <wsman:OperationTimeout>PT60S</wsman:OperationTimeout>
    <wsman:SelectorSet>
      <wsman:Selector Name="ShellId">${shellId}</wsman:Selector>
    </wsman:SelectorSet>
  </s:Header>
  <s:Body>
    <rsp:CommandLine>
      <rsp:Command>${escapeXml(fullCmd)}</rsp:Command>
    </rsp:CommandLine>
  </s:Body>
</s:Envelope>`;
}

function receiveEnvelope(
  host: string,
  shellId: string,
  commandId: string,
  messageId: string
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
  xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing"
  xmlns:wsman="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd"
  xmlns:rsp="http://schemas.microsoft.com/wbem/wsman/1/windows/shell">
  <s:Header>
    <wsa:To>http://${host}/wsman</wsa:To>
    <wsman:ResourceURI s:mustUnderstand="true">http://schemas.microsoft.com/wbem/wsman/1/windows/shell/cmd</wsman:ResourceURI>
    <wsa:ReplyTo><wsa:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</wsa:Address></wsa:ReplyTo>
    <wsa:Action s:mustUnderstand="true">http://schemas.microsoft.com/wbem/wsman/1/windows/shell/Receive</wsa:Action>
    <wsa:MessageID>uuid:${messageId}</wsa:MessageID>
    <wsman:MaxEnvelopeSize s:mustUnderstand="true">512000</wsman:MaxEnvelopeSize>
    <wsman:OperationTimeout>PT60S</wsman:OperationTimeout>
    <wsman:SelectorSet>
      <wsman:Selector Name="ShellId">${shellId}</wsman:Selector>
    </wsman:SelectorSet>
  </s:Header>
  <s:Body>
    <rsp:Receive>
      <rsp:DesiredStream CommandId="${commandId}">stdout stderr</rsp:DesiredStream>
    </rsp:Receive>
  </s:Body>
</s:Envelope>`;
}

function deleteShellEnvelope(
  host: string,
  shellId: string,
  messageId: string
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
  xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing"
  xmlns:wsman="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd">
  <s:Header>
    <wsa:To>http://${host}/wsman</wsa:To>
    <wsman:ResourceURI s:mustUnderstand="true">http://schemas.microsoft.com/wbem/wsman/1/windows/shell/cmd</wsman:ResourceURI>
    <wsa:ReplyTo><wsa:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</wsa:Address></wsa:ReplyTo>
    <wsa:Action s:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2004/09/transfer/Delete</wsa:Action>
    <wsa:MessageID>uuid:${messageId}</wsa:MessageID>
    <wsman:MaxEnvelopeSize s:mustUnderstand="true">512000</wsman:MaxEnvelopeSize>
    <wsman:OperationTimeout>PT60S</wsman:OperationTimeout>
    <wsman:SelectorSet>
      <wsman:Selector Name="ShellId">${shellId}</wsman:Selector>
    </wsman:SelectorSet>
  </s:Header>
  <s:Body/>
</s:Envelope>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function uuid(): string {
  return crypto.randomUUID();
}

/** Extract a value between XML tags using a simple regex */
function extractXmlValue(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<[^>]*${tag}[^>]*>([^<]*)<`, "i");
  const match = xml.match(re);
  return match?.[1];
}

/** Extract base64-encoded stdout streams from Receive response */
function extractStreamOutput(xml: string): string {
  const streamRegex =
    /<rsp:Stream[^>]*Name="stdout"[^>]*>([^<]+)<\/rsp:Stream>/gi;
  let output = "";
  let match;
  while ((match = streamRegex.exec(xml)) !== null) {
    output += Buffer.from(match[1], "base64").toString("utf-8");
  }
  return output;
}

/** Extract CommandId from command response */
function extractCommandId(xml: string): string | undefined {
  const match = xml.match(/<rsp:CommandId>([^<]+)<\/rsp:CommandId>/i);
  return match?.[1];
}

/** Extract ShellId from create response */
function extractShellId(xml: string): string | undefined {
  const match = xml.match(
    /<rsp:ShellId>([^<]+)<\/rsp:ShellId>/i
  );
  // Also check Selector with ShellId
  if (match) return match[1];
  const selectorMatch = xml.match(
    /Selector Name="ShellId">([^<]+)</i
  );
  return selectorMatch?.[1];
}

/** Check if the Receive response indicates command completion */
function isCommandDone(xml: string): boolean {
  return xml.includes("CommandState") && xml.includes("Done");
}

// ─── Pure parsing helpers (testable) ───

export interface WinComputerInfo {
  CsName?: string;
  WindowsVersion?: string;
  OsArchitecture?: string;
  WindowsBuildLabEx?: string;
}

export interface WinInstalledProgram {
  DisplayName?: string;
  DisplayVersion?: string;
}

export interface WinRunningService {
  Name?: string;
  DisplayName?: string;
}

export interface WinIisSite {
  Name?: string;
  State?: string;
  Bindings?: Array<{ bindingInformation?: string; protocol?: string }> | string;
}

export function parseComputerInfo(json: string): WinComputerInfo {
  try {
    return JSON.parse(json) as WinComputerInfo;
  } catch {
    return {};
  }
}

export function parseInstalledPrograms(json: string): PackageInfo[] {
  try {
    let items = JSON.parse(json) as WinInstalledProgram | WinInstalledProgram[];
    if (!Array.isArray(items)) items = [items];

    return items
      .filter((p) => p.DisplayName)
      .map((p) => ({
        name: p.DisplayName!,
        installedVersion: p.DisplayVersion ?? "unknown",
        packageManager: "msi",
        ecosystem: "windows",
      }));
  } catch {
    return [];
  }
}

export function parseRunningServices(json: string): ServiceInfo[] {
  try {
    let items = JSON.parse(json) as WinRunningService | WinRunningService[];
    if (!Array.isArray(items)) items = [items];

    return items
      .filter((s) => s.Name)
      .map((s) => ({
        name: s.Name!,
        serviceType: classifyWindowsService(s.Name!),
        version: undefined,
        status: "running",
      }));
  } catch {
    return [];
  }
}

export function parseIisSites(json: string): ServiceInfo[] {
  try {
    let sites = JSON.parse(json) as WinIisSite | WinIisSite[];
    if (!Array.isArray(sites)) sites = [sites];

    return sites
      .filter((s) => s.Name)
      .map((s) => ({
        name: s.Name!,
        serviceType: "webserver" as const,
        status: s.State === "Started" ? "running" : "stopped",
      }));
  } catch {
    return [];
  }
}

export function parseDotNetVersion(output: string): string | undefined {
  // e.g. ".NET 8.0.1" or ".NET Framework 4.8.4614.0"
  const trimmed = output.trim();
  if (trimmed.startsWith(".NET")) return trimmed;
  return undefined;
}

function classifyWindowsService(name: string): string {
  const lower = name.toLowerCase();
  if (lower === "w3svc" || lower === "iisadmin" || lower === "was")
    return "webserver";
  if (lower.includes("sql")) return "database";
  if (lower.includes("redis") || lower.includes("memcache")) return "cache";
  if (lower.includes("rabbit") || lower.includes("msmq")) return "queue";
  if (lower.includes("docker")) return "container-runtime";
  return "other";
}

/**
 * De-duplicate installed programs from the two registry hives.
 */
export function mergeInstalledPrograms(
  hive64: PackageInfo[],
  hive32: PackageInfo[]
): PackageInfo[] {
  const seen = new Set<string>();
  const merged: PackageInfo[] = [];

  for (const pkg of [...hive64, ...hive32]) {
    const key = `${pkg.name}::${pkg.installedVersion}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(pkg);
  }

  return merged;
}

// ─── Scanner implementation ───

export class WinrmScanner extends BaseScanner {
  async scan(config: ScanTargetConfig): Promise<ScanResult> {
    const connConfig =
      config.connectionConfig as unknown as WinrmConnectionConfig;

    const useSsl = connConfig.useSsl ?? false;
    const port = connConfig.port ?? (useSsl ? 5986 : 5985);
    const protocol = useSsl ? "https" : "http";
    const baseURL = `${protocol}://${connConfig.host}:${port}/wsman`;

    const httpsAgent =
      useSsl && connConfig.ignoreSslErrors
        ? new https.Agent({ rejectUnauthorized: false })
        : undefined;

    const client = axios.create({
      baseURL,
      httpsAgent,
      timeout: 60_000,
      headers: { "Content-Type": WINRM_CONTENT_TYPE },
      auth: {
        username: connConfig.username,
        password: connConfig.password,
      },
    });

    // Create a shell
    const createResp = await client.post(
      "",
      shellCreateEnvelope(connConfig.host, uuid())
    );
    const shellId = extractShellId(createResp.data);
    if (!shellId) {
      throw new Error("Failed to create WinRM shell — no ShellId in response");
    }

    try {
      return await this.discover(client, connConfig.host, shellId);
    } finally {
      // Always clean up the shell
      try {
        await client.post(
          "",
          deleteShellEnvelope(connConfig.host, shellId, uuid())
        );
      } catch {
        console.warn("[winrm-scanner] Failed to delete shell");
      }
    }
  }

  private async runPsCommand(
    client: AxiosInstance,
    host: string,
    shellId: string,
    command: string,
    label: string
  ): Promise<string | undefined> {
    try {
      // Send command
      const cmdResp = await client.post(
        "",
        commandEnvelope(host, shellId, command, uuid())
      );
      const commandId = extractCommandId(cmdResp.data);
      if (!commandId) {
        console.warn(`[winrm-scanner] No CommandId for "${label}"`);
        return undefined;
      }

      // Receive output (poll until done)
      let output = "";
      for (let i = 0; i < 20; i++) {
        const recvResp = await client.post(
          "",
          receiveEnvelope(host, shellId, commandId, uuid())
        );
        output += extractStreamOutput(recvResp.data);
        if (isCommandDone(recvResp.data)) break;
      }

      return output;
    } catch (err) {
      console.warn(`[winrm-scanner] Command "${label}" failed:`, err);
      return undefined;
    }
  }

  private async discover(
    client: AxiosInstance,
    host: string,
    shellId: string
  ): Promise<ScanResult> {
    // ─── Computer Info ───
    const computerInfoRaw = await this.runPsCommand(
      client,
      host,
      shellId,
      "Get-ComputerInfo | Select-Object CsName, WindowsVersion, OsArchitecture, WindowsBuildLabEx | ConvertTo-Json",
      "computer-info"
    );
    const computerInfo = computerInfoRaw
      ? parseComputerInfo(computerInfoRaw)
      : ({} as WinComputerInfo);

    // ─── Installed Programs (both registry hives) ───
    const programs64Raw = await this.runPsCommand(
      client,
      host,
      shellId,
      "Get-ItemProperty HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* | Select-Object DisplayName, DisplayVersion | ConvertTo-Json",
      "programs-64"
    );
    const programs32Raw = await this.runPsCommand(
      client,
      host,
      shellId,
      "Get-ItemProperty HKLM:\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* | Select-Object DisplayName, DisplayVersion | ConvertTo-Json",
      "programs-32"
    );

    const progs64 = programs64Raw
      ? parseInstalledPrograms(programs64Raw)
      : [];
    const progs32 = programs32Raw
      ? parseInstalledPrograms(programs32Raw)
      : [];
    const packages = mergeInstalledPrograms(progs64, progs32);

    // ─── Running Services ───
    const servicesRaw = await this.runPsCommand(
      client,
      host,
      shellId,
      "Get-Service | Where-Object {$_.Status -eq 'Running'} | Select-Object Name, DisplayName | ConvertTo-Json",
      "services"
    );
    const services = servicesRaw ? parseRunningServices(servicesRaw) : [];

    // ─── Windows Features (Server only) ───
    const featuresRaw = await this.runPsCommand(
      client,
      host,
      shellId,
      "try { Get-WindowsFeature | Where-Object {$_.Installed} | Select-Object Name, DisplayName | ConvertTo-Json } catch { '[]' }",
      "features"
    );
    if (featuresRaw) {
      const featurePackages = parseInstalledPrograms(featuresRaw);
      for (const fp of featurePackages) {
        fp.packageManager = "windows-feature";
        packages.push(fp);
      }
    }

    // ─── IIS Sites ───
    const iisRaw = await this.runPsCommand(
      client,
      host,
      shellId,
      "try { Import-Module WebAdministration -ErrorAction Stop; Get-IISSite | ConvertTo-Json } catch { '[]' }",
      "iis"
    );
    if (iisRaw) {
      services.push(...parseIisSites(iisRaw));
    }

    // ─── .NET Version ───
    const dotnetRaw = await this.runPsCommand(
      client,
      host,
      shellId,
      "[System.Runtime.InteropServices.RuntimeInformation]::FrameworkDescription",
      "dotnet-version"
    );
    const dotnetVersion = dotnetRaw
      ? parseDotNetVersion(dotnetRaw)
      : undefined;

    if (dotnetVersion) {
      packages.push({
        name: ".NET Runtime",
        installedVersion: dotnetVersion,
        packageManager: "dotnet",
        ecosystem: "windows",
      });
    }

    return {
      hosts: [
        {
          hostname: computerInfo.CsName ?? host,
          ip: "",
          os: "Windows",
          osVersion: computerInfo.WindowsVersion ?? "unknown",
          arch: computerInfo.OsArchitecture ?? "unknown",
          packages,
          services,
          metadata: {
            buildLab: computerInfo.WindowsBuildLabEx,
            scannedAt: new Date().toISOString(),
          },
        },
      ],
    };
  }
}
