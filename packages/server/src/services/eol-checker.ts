import type pg from "pg";
import type { Logger } from "pino";
import { readFileSync } from "fs";
import { ChangeDetector } from "./change-detector.js";

interface EolDefinition {
  id: string;
  productName: string;
  productCategory: string;
  versionPattern: string;
  eolDate: string;
  successorVersion: string | null;
}

interface SeedEntry {
  productName: string;
  productCategory: string;
  versionPattern: string;
  eolDate: string;
  lts: boolean;
  successorVersion: string | null;
  sourceUrl: string;
  notes?: string;
}

/** Maps common package names to EOL product names */
const PACKAGE_NAME_MAP: Array<{
  patterns: RegExp[];
  productName: string;
  versionExtractor?: (pkgName: string, pkgVersion: string) => string | null;
}> = [
  {
    patterns: [/^postgresql[-_]?\d*/i, /^postgres/i, /^libpq/i],
    productName: "PostgreSQL",
    versionExtractor: (_name, ver) => extractMajor(ver),
  },
  {
    patterns: [/^mysql[-_]?(server|client|common)?/i, /^libmysql/i],
    productName: "MySQL",
    versionExtractor: (_name, ver) => extractMajorMinor(ver),
  },
  {
    patterns: [/^mariadb[-_]?(server|client|common)?/i, /^libmariadb/i],
    productName: "MariaDB",
    versionExtractor: (_name, ver) => extractMajorMinor(ver),
  },
  {
    patterns: [/^redis[-_]?(server|tools)?/i],
    productName: "Redis",
    versionExtractor: (_name, ver) => extractMajorMinor(ver),
  },
  {
    patterns: [/^mongo(db|s|d)?[-_]?(server|shell|tools)?$/i],
    productName: "MongoDB",
    versionExtractor: (_name, ver) => extractMajorMinor(ver),
  },
  {
    patterns: [/^nodejs$/i, /^node$/i, /^node\.?js/i],
    productName: "Node.js",
    versionExtractor: (_name, ver) => extractMajor(ver),
  },
  {
    patterns: [/^python3?\.?\d*/i],
    productName: "Python",
    versionExtractor: (name, ver) => {
      // python3.8 → "3.8", python3 version 3.8.x → "3.8"
      const nameMatch = name.match(/python(\d+\.\d+)/i);
      if (nameMatch) return nameMatch[1];
      return extractMajorMinor(ver);
    },
  },
  {
    patterns: [/^openjdk[-_]?\d*/i, /^java[-_]?\d*/i, /^jre[-_]?\d*/i, /^jdk[-_]?\d*/i],
    productName: "Java/OpenJDK",
    versionExtractor: (name, ver) => {
      const nameMatch = name.match(/(?:openjdk|java|jre|jdk)[-_]?(\d+)/i);
      if (nameMatch) return nameMatch[1];
      return extractMajor(ver);
    },
  },
  {
    patterns: [/^dotnet[-_]?(runtime|sdk|host)?/i, /^aspnetcore/i],
    productName: ".NET",
    versionExtractor: (_name, ver) => extractMajor(ver),
  },
  {
    patterns: [/^php\d*[-_]?(cli|fpm|common|cgi)?$/i, /^libapache2-mod-php/i],
    productName: "PHP",
    versionExtractor: (name, ver) => {
      const nameMatch = name.match(/php(\d+\.\d+)/i);
      if (nameMatch) return nameMatch[1];
      return extractMajorMinor(ver);
    },
  },
  {
    patterns: [/^tomcat\d*/i, /^apache-tomcat/i],
    productName: "Apache Tomcat",
    versionExtractor: (_name, ver) => extractMajorMinor(ver),
  },
];

/** Maps service names to EOL product names */
const SERVICE_NAME_MAP: Array<{
  patterns: RegExp[];
  productName: string;
  versionExtractor?: (svcName: string, svcVersion: string) => string | null;
}> = [
  {
    patterns: [/tomcat/i],
    productName: "Apache Tomcat",
    versionExtractor: (_name, ver) => extractMajorMinor(ver),
  },
  {
    patterns: [/redis/i],
    productName: "Redis",
    versionExtractor: (_name, ver) => extractMajorMinor(ver),
  },
  {
    patterns: [/postgres/i, /postgresql/i],
    productName: "PostgreSQL",
    versionExtractor: (_name, ver) => extractMajor(ver),
  },
  {
    patterns: [/mysql/i, /mysqld/i],
    productName: "MySQL",
    versionExtractor: (_name, ver) => extractMajorMinor(ver),
  },
  {
    patterns: [/mariadb/i],
    productName: "MariaDB",
    versionExtractor: (_name, ver) => extractMajorMinor(ver),
  },
  {
    patterns: [/mongod?/i],
    productName: "MongoDB",
    versionExtractor: (_name, ver) => extractMajorMinor(ver),
  },
];

function extractMajor(version: string): string | null {
  const m = version.match(/^(\d+)/);
  return m ? m[1] : null;
}

function extractMajorMinor(version: string): string | null {
  const m = version.match(/^(\d+\.\d+)/);
  return m ? m[1] : null;
}

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const EOL_WINDOW_DAYS = 90;

export class EolChecker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private changeDetector: ChangeDetector;

  constructor(
    private pool: pg.Pool,
    private logger: Logger
  ) {
    this.changeDetector = new ChangeDetector(pool, logger);
  }

  /** Seed definitions from JSON on first run */
  async seedDefinitions(): Promise<void> {
    try {
      const countResult = await this.pool.query("SELECT COUNT(*)::int AS c FROM eol_definitions");
      if (countResult.rows[0].c > 0) {
        this.logger.debug("EOL definitions already seeded, skipping");
        return;
      }

      let data: SeedEntry[];
      try {
        const raw = readFileSync(new URL("../data/eol-definitions.json", import.meta.url), "utf-8");
        data = JSON.parse(raw);
      } catch {
        this.logger.warn("Could not read eol-definitions.json, skipping seed");
        return;
      }

      let count = 0;
      for (const entry of data) {
        await this.pool.query(
          `INSERT INTO eol_definitions (product_name, product_category, version_pattern, eol_date, lts, successor_version, source_url, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (product_name, version_pattern) DO NOTHING`,
          [
            entry.productName,
            entry.productCategory,
            entry.versionPattern,
            entry.eolDate,
            entry.lts ?? false,
            entry.successorVersion ?? null,
            entry.sourceUrl ?? null,
            entry.notes ?? null,
          ]
        );
        count++;
      }
      this.logger.info({ count }, `Seeded ${count} EOL definitions`);
    } catch (err) {
      this.logger.error({ err }, "Failed to seed EOL definitions");
    }
  }

  start(): void {
    if (this.timer) return;
    this.logger.info("EOL checker starting");
    // Run after a short delay to let migrations finish
    setTimeout(() => this.check(), 5000);
    this.timer = setInterval(() => this.check(), CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.logger.info("EOL checker stopped");
  }

  async check(): Promise<void> {
    try {
      // 1. Load all EOL definitions
      const defsResult = await this.pool.query<{
        id: string;
        product_name: string;
        product_category: string;
        version_pattern: string;
        eol_date: string;
        successor_version: string | null;
      }>("SELECT id, product_name, product_category, version_pattern, eol_date, successor_version FROM eol_definitions");

      const definitions: EolDefinition[] = defsResult.rows.map((r) => ({
        id: r.id,
        productName: r.product_name,
        productCategory: r.product_category,
        versionPattern: r.version_pattern,
        eolDate: r.eol_date,
        successorVersion: r.successor_version,
      }));

      // Build lookup by product name
      const defsByProduct = new Map<string, EolDefinition[]>();
      for (const def of definitions) {
        const key = def.productName.toLowerCase();
        const arr = defsByProduct.get(key) ?? [];
        arr.push(def);
        defsByProduct.set(key, arr);
      }

      // 2. Query hosts with OS info, packages, and services
      const hostsResult = await this.pool.query<{
        id: string;
        hostname: string;
        os: string | null;
        os_version: string | null;
        scan_target_id: string | null;
      }>("SELECT id, hostname, os, os_version, scan_target_id FROM hosts WHERE status = 'active'");

      const now = new Date();
      const windowDate = new Date(now.getTime() + EOL_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      let alertsCreated = 0;
      let alertsResolved = 0;

      // Track all matched (host_id, def_id) to know what's still active
      const activeMatches = new Set<string>();

      for (const host of hostsResult.rows) {
        const matches: Array<{ defId: string; productName: string; installedVersion: string; eolDate: string; successorVersion: string | null }> = [];

        // OS matching
        if (host.os && host.os_version) {
          const osMatches = this.matchOs(host.os, host.os_version, defsByProduct);
          matches.push(...osMatches);
        }

        // Package matching
        const pkgResult = await this.pool.query<{
          package_name: string;
          installed_version: string;
        }>(
          "SELECT package_name, installed_version FROM discovered_packages WHERE host_id = $1 AND removed_at IS NULL",
          [host.id]
        );

        for (const pkg of pkgResult.rows) {
          const pkgMatches = this.matchPackage(pkg.package_name, pkg.installed_version, defsByProduct);
          matches.push(...pkgMatches);
        }

        // Service matching
        const svcResult = await this.pool.query<{
          service_name: string;
          version: string | null;
        }>(
          "SELECT service_name, version FROM services WHERE host_id = $1",
          [host.id]
        );

        for (const svc of svcResult.rows) {
          if (!svc.version) continue;
          const svcMatches = this.matchService(svc.service_name, svc.version, defsByProduct);
          matches.push(...svcMatches);
        }

        // 4. For each match where EOL is past or within 90 days
        for (const match of matches) {
          const eolDate = new Date(match.eolDate);
          if (eolDate > windowDate) continue; // not in window

          const daysPastEol = Math.floor((now.getTime() - eolDate.getTime()) / (24 * 60 * 60 * 1000));
          const key = `${host.id}::${match.defId}`;
          activeMatches.add(key);

          const upsertResult = await this.pool.query(
            `INSERT INTO eol_alerts (host_id, eol_definition_id, product_name, installed_version, eol_date, days_past_eol, successor_version)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (host_id, eol_definition_id) DO UPDATE SET
               installed_version = EXCLUDED.installed_version,
               days_past_eol = EXCLUDED.days_past_eol,
               eol_date = EXCLUDED.eol_date,
               successor_version = EXCLUDED.successor_version
             RETURNING (xmax = 0) AS is_new`,
            [host.id, match.defId, match.productName, match.installedVersion, match.eolDate, daysPastEol, match.successorVersion]
          );

          if (upsertResult.rows[0].is_new) {
            alertsCreated++;
            // Emit change event for new alerts
            try {
              await this.changeDetector.recordChangeDirect({
                hostId: host.id,
                hostname: host.hostname,
                eventType: "eol_detected" as string,
                category: "config",
                summary: `EOL detected on ${host.hostname}: ${match.productName} ${match.installedVersion} (EOL ${match.eolDate})`,
                details: {
                  productName: match.productName,
                  installedVersion: match.installedVersion,
                  eolDate: match.eolDate,
                  daysPastEol,
                  successorVersion: match.successorVersion,
                },
                scanTargetId: host.scan_target_id,
              });
            } catch {
              // change_events may not accept eol_detected yet, that's ok
            }
          }
        }
      }

      // 5. Resolve alerts where software no longer detected
      const existingAlerts = await this.pool.query<{
        id: string;
        host_id: string;
        eol_definition_id: string;
      }>("SELECT id, host_id, eol_definition_id FROM eol_alerts WHERE status = 'active'");

      for (const alert of existingAlerts.rows) {
        const key = `${alert.host_id}::${alert.eol_definition_id}`;
        if (!activeMatches.has(key)) {
          await this.pool.query(
            "UPDATE eol_alerts SET status = 'resolved' WHERE id = $1",
            [alert.id]
          );
          alertsResolved++;
        }
      }

      if (alertsCreated > 0 || alertsResolved > 0) {
        this.logger.info({ alertsCreated, alertsResolved }, "EOL check complete");
      } else {
        this.logger.debug("EOL check complete, no changes");
      }
    } catch (err) {
      this.logger.error({ err }, "EOL check failed");
    }
  }

  private matchOs(
    os: string,
    osVersion: string,
    defsByProduct: Map<string, EolDefinition[]>
  ): Array<{ defId: string; productName: string; installedVersion: string; eolDate: string; successorVersion: string | null }> {
    const results: Array<{ defId: string; productName: string; installedVersion: string; eolDate: string; successorVersion: string | null }> = [];
    const osLower = os.toLowerCase();

    // Ubuntu: os="Ubuntu", os_version="18.04.6" -> match "18.04"
    if (osLower.includes("ubuntu")) {
      const ver = osVersion.match(/^(\d+\.\d+)/)?.[1];
      if (ver) {
        const defs = defsByProduct.get("ubuntu") ?? [];
        const match = defs.find((d) => d.versionPattern === ver);
        if (match) results.push({ defId: match.id, productName: match.productName, installedVersion: ver, eolDate: match.eolDate, successorVersion: match.successorVersion });
      }
    }

    // Debian: os="Debian GNU/Linux", os_version="10" -> match "10"
    if (osLower.includes("debian")) {
      const ver = osVersion.match(/^(\d+)/)?.[1];
      if (ver) {
        const defs = defsByProduct.get("debian") ?? [];
        const match = defs.find((d) => d.versionPattern === ver);
        if (match) results.push({ defId: match.id, productName: match.productName, installedVersion: ver, eolDate: match.eolDate, successorVersion: match.successorVersion });
      }
    }

    // CentOS
    if (osLower.includes("centos")) {
      const ver = osVersion.match(/^(\d+)/)?.[1];
      if (ver) {
        const isStream = osLower.includes("stream");
        const product = isStream ? "centos stream" : "centos";
        const defs = defsByProduct.get(product) ?? [];
        const match = defs.find((d) => d.versionPattern === ver);
        if (match) results.push({ defId: match.id, productName: match.productName, installedVersion: ver, eolDate: match.eolDate, successorVersion: match.successorVersion });
      }
    }

    // RHEL: "Red Hat Enterprise Linux"
    if (osLower.includes("red hat") || osLower.includes("rhel")) {
      const ver = osVersion.match(/^(\d+)/)?.[1];
      if (ver) {
        const defs = defsByProduct.get("rhel") ?? [];
        const match = defs.find((d) => d.versionPattern === ver);
        if (match) results.push({ defId: match.id, productName: match.productName, installedVersion: ver, eolDate: match.eolDate, successorVersion: match.successorVersion });
      }
    }

    // Alpine
    if (osLower.includes("alpine")) {
      const ver = osVersion.match(/^(\d+\.\d+)/)?.[1];
      if (ver) {
        const defs = defsByProduct.get("alpine") ?? [];
        const match = defs.find((d) => d.versionPattern === ver);
        if (match) results.push({ defId: match.id, productName: match.productName, installedVersion: ver, eolDate: match.eolDate, successorVersion: match.successorVersion });
      }
    }

    // Windows Server
    if (osLower.includes("windows server") || osLower.includes("windows_server")) {
      // Try to extract year like 2019, 2022, 2012R2
      const ver = (os + " " + osVersion).match(/(?:windows\s*server\s*)(\d{4}(?:R2)?)/i)?.[1];
      if (ver) {
        const defs = defsByProduct.get("windows server") ?? [];
        const match = defs.find((d) => d.versionPattern === ver);
        if (match) results.push({ defId: match.id, productName: match.productName, installedVersion: ver, eolDate: match.eolDate, successorVersion: match.successorVersion });
      }
    }

    return results;
  }

  private matchPackage(
    pkgName: string,
    installedVersion: string,
    defsByProduct: Map<string, EolDefinition[]>
  ): Array<{ defId: string; productName: string; installedVersion: string; eolDate: string; successorVersion: string | null }> {
    const results: Array<{ defId: string; productName: string; installedVersion: string; eolDate: string; successorVersion: string | null }> = [];

    for (const mapping of PACKAGE_NAME_MAP) {
      if (!mapping.patterns.some((p) => p.test(pkgName))) continue;

      const version = mapping.versionExtractor
        ? mapping.versionExtractor(pkgName, installedVersion)
        : extractMajor(installedVersion);

      if (!version) continue;

      const defs = defsByProduct.get(mapping.productName.toLowerCase()) ?? [];
      const match = defs.find((d) => d.versionPattern === version);
      if (match) {
        results.push({
          defId: match.id,
          productName: match.productName,
          installedVersion: version,
          eolDate: match.eolDate,
          successorVersion: match.successorVersion,
        });
      }
      break; // only match first mapping
    }

    return results;
  }

  private matchService(
    svcName: string,
    version: string,
    defsByProduct: Map<string, EolDefinition[]>
  ): Array<{ defId: string; productName: string; installedVersion: string; eolDate: string; successorVersion: string | null }> {
    const results: Array<{ defId: string; productName: string; installedVersion: string; eolDate: string; successorVersion: string | null }> = [];

    for (const mapping of SERVICE_NAME_MAP) {
      if (!mapping.patterns.some((p) => p.test(svcName))) continue;

      const extractedVersion = mapping.versionExtractor
        ? mapping.versionExtractor(svcName, version)
        : extractMajor(version);

      if (!extractedVersion) continue;

      const defs = defsByProduct.get(mapping.productName.toLowerCase()) ?? [];
      const match = defs.find((d) => d.versionPattern === extractedVersion);
      if (match) {
        results.push({
          defId: match.id,
          productName: match.productName,
          installedVersion: extractedVersion,
          eolDate: match.eolDate,
          successorVersion: match.successorVersion,
        });
      }
      break;
    }

    return results;
  }
}
