import type pg from "pg";
import type { Logger } from "pino";
import semver from "semver";
import { fetchWellKnownVersion, VERSION_SOURCES } from "./version-sources.js";
import type { NotificationService } from "./notifications/notification-service.js";
import type { SettingsService } from "./settings-service.js";

interface PackageGroup {
  package_name: string;
  ecosystem: string;
}

interface LatestVersionResult {
  packageName: string;
  ecosystem: string;
  latestVersion: string | null;
  cveIds: string[];
  cveCount: number;
  sourceUrl?: string;
}

export class VersionChecker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private stopping = false;
  private notificationService?: NotificationService;
  private settings?: SettingsService;

  constructor(
    private pool: pg.Pool,
    private logger: Logger,
  ) {}

  setSettings(settings: SettingsService): void {
    this.settings = settings;
  }

  private get checkIntervalMs(): number {
    return (this.settings?.get<number>("version_check_interval_hours") ?? 12) * 60 * 60 * 1000;
  }

  setNotificationService(ns: NotificationService): void {
    this.notificationService = ns;
  }

  start(): void {
    if (this.timer || this.startupTimer) return;

    const intervalMs = this.checkIntervalMs;
    const initialDelayMs = 60_000;

    this.logger.info(
      { checkIntervalMs: intervalMs, initialDelayMs },
      "Version checker scheduled"
    );

    // First run after initial delay (don't block startup)
    this.startupTimer = setTimeout(() => {
      this.startupTimer = null;
      this.run();
      this.timer = setInterval(() => this.run(), this.checkIntervalMs);
    }, initialDelayMs);
  }

  stop(): void {
    this.stopping = true;
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.logger.info("Version checker stopped");
  }

  private async run(): Promise<void> {
    if (this.running || this.stopping) return;
    this.running = true;

    this.logger.info("Version check starting...");
    let packagesChecked = 0;
    let alertsCreated = 0;

    try {
      // 1. Get all unique (package_name, ecosystem) pairs
      const groups = await this.getPackageGroups();
      this.logger.info({ count: groups.length }, "Unique packages to check");

      // 2. Group by ecosystem and check
      const byEcosystem = new Map<string, PackageGroup[]>();
      for (const g of groups) {
        const eco = g.ecosystem || "unknown";
        if (!byEcosystem.has(eco)) byEcosystem.set(eco, []);
        byEcosystem.get(eco)!.push(g);
      }

      for (const [ecosystem, packages] of byEcosystem) {
        if (this.stopping) break;

        const results = await this.checkEcosystem(ecosystem, packages);
        for (const result of results) {
          if (this.stopping) break;
          if (result.latestVersion) {
            await this.upsertKnownVersion(result);
            packagesChecked++;
          }
        }
      }

      // 3. Generate alerts
      if (!this.stopping) {
        alertsCreated = await this.generateAlerts();
      }

      // 4. Send aggregated notification if there were new alerts
      if (alertsCreated > 0 && this.notificationService) {
        await this.sendAlertDigestNotification(alertsCreated).catch((err) =>
          this.logger.error({ err }, "Failed to send version alert notification")
        );
      }

      this.logger.info(
        { packagesChecked, alertsCreated },
        `Version check complete: ${packagesChecked} packages checked, ${alertsCreated} new alerts created`
      );
    } catch (err) {
      this.logger.error({ err }, "Version check failed");
    } finally {
      this.running = false;
    }
  }

  private async sendAlertDigestNotification(alertsCreated: number): Promise<void> {
    // Query summary of recently created critical/high alerts
    const result = await this.pool.query<{ severity: string; cnt: string }>(
      `SELECT severity, COUNT(*) AS cnt
       FROM alerts
       WHERE created_at > NOW() - INTERVAL '1 hour'
         AND severity IN ('critical', 'high')
       GROUP BY severity`
    );

    const bySeverity: Record<string, number> = {};
    for (const row of result.rows) {
      bySeverity[row.severity] = parseInt(row.cnt, 10);
    }

    const critical = bySeverity.critical ?? 0;
    const high = bySeverity.high ?? 0;

    if (critical === 0 && high === 0) return; // only notify for critical/high

    await this.notificationService!.notify({
      eventType: "alert_created",
      severity: critical > 0 ? "critical" : "high",
      title: `${alertsCreated} New Version Alerts`,
      summary: `Version check found ${alertsCreated} new alerts (${critical} critical, ${high} high).`,
      details: {
        alertsBySeverity: bySeverity,
        affectedHostCount: alertsCreated,
      },
    });
  }

  private async getPackageGroups(): Promise<PackageGroup[]> {
    const result = await this.pool.query<PackageGroup>(
      `SELECT DISTINCT package_name, ecosystem
       FROM discovered_packages
       WHERE removed_at IS NULL AND ecosystem IS NOT NULL
       ORDER BY ecosystem, package_name`
    );
    return result.rows;
  }

  private async checkEcosystem(
    ecosystem: string,
    packages: PackageGroup[]
  ): Promise<LatestVersionResult[]> {
    switch (ecosystem) {
      case "npm":
        return this.checkNpmPackages(packages);
      case "pypi":
        return this.checkPypiPackages(packages);
      case "docker":
        return this.checkDockerImages(packages);
      case "debian":
      case "ubuntu":
      case "rhel":
      case "alpine":
        // OS package version checking is complex — mark as checked for now
        return this.checkOsPackages(ecosystem, packages);
      default:
        // Try well-known software check
        return this.checkWellKnown(packages);
    }
  }

  // ─── npm ───

  private async checkNpmPackages(packages: PackageGroup[]): Promise<LatestVersionResult[]> {
    const results: LatestVersionResult[] = [];

    for (const pkg of packages) {
      if (this.stopping) break;
      try {
        const data = await this.fetchJson(
          `https://registry.npmjs.org/${encodeURIComponent(pkg.package_name)}/latest`
        );
        const version = (data as { version?: string })?.version ?? null;

        results.push({
          packageName: pkg.package_name,
          ecosystem: "npm",
          latestVersion: version,
          cveIds: [],
          cveCount: 0,
          sourceUrl: `https://www.npmjs.com/package/${pkg.package_name}`,
        });
      } catch {
        this.logger.debug({ package: pkg.package_name }, "npm version check failed");
      }
    }

    return results;
  }

  // ─── PyPI ───

  private async checkPypiPackages(packages: PackageGroup[]): Promise<LatestVersionResult[]> {
    const results: LatestVersionResult[] = [];

    for (const pkg of packages) {
      if (this.stopping) break;
      try {
        const data = await this.fetchJson(
          `https://pypi.org/pypi/${encodeURIComponent(pkg.package_name)}/json`
        );
        const version = (data as { info?: { version?: string } })?.info?.version ?? null;

        results.push({
          packageName: pkg.package_name,
          ecosystem: "pypi",
          latestVersion: version,
          cveIds: [],
          cveCount: 0,
          sourceUrl: `https://pypi.org/project/${pkg.package_name}/`,
        });
      } catch {
        this.logger.debug({ package: pkg.package_name }, "PyPI version check failed");
      }
    }

    return results;
  }

  // ─── Docker Hub ───

  private async checkDockerImages(packages: PackageGroup[]): Promise<LatestVersionResult[]> {
    const results: LatestVersionResult[] = [];

    for (const pkg of packages) {
      if (this.stopping) break;
      try {
        const image = pkg.package_name;
        // Determine if official or namespaced image
        const isOfficial = !image.includes("/");
        const url = isOfficial
          ? `https://hub.docker.com/v2/repositories/library/${image}/tags/?page_size=10&ordering=-last_updated`
          : `https://hub.docker.com/v2/repositories/${image}/tags/?page_size=10&ordering=-last_updated`;

        const data = await this.fetchJson(url);
        const tags = (data as { results?: Array<{ name: string }> })?.results ?? [];

        // Find the latest semver tag that isn't "latest"
        const semverTags = tags
          .map((t) => t.name)
          .filter((name) => name !== "latest" && semver.valid(semver.coerce(name)))
          .sort((a, b) => {
            const sa = semver.coerce(a);
            const sb = semver.coerce(b);
            if (!sa || !sb) return 0;
            return semver.rcompare(sa, sb);
          });

        const latestVersion = semverTags.length > 0 ? semverTags[0] : null;

        results.push({
          packageName: image,
          ecosystem: "docker",
          latestVersion,
          cveIds: [],
          cveCount: 0,
          sourceUrl: isOfficial
            ? `https://hub.docker.com/_/${image}`
            : `https://hub.docker.com/r/${image}`,
        });
      } catch {
        this.logger.debug({ package: pkg.package_name }, "Docker Hub version check failed");
      }
    }

    return results;
  }

  // ─── OS packages (placeholder for MVP) ───

  private async checkOsPackages(
    ecosystem: string,
    packages: PackageGroup[]
  ): Promise<LatestVersionResult[]> {
    // OS package version checking is complex and varies by distro.
    // For MVP, we mark packages as checked (timestamp update) but don't compare versions.
    // Future enhancement: integrate with distro security trackers.
    this.logger.info(
      { ecosystem, count: packages.length },
      `OS package version checking for ${ecosystem} is a future enhancement — marking ${packages.length} packages as checked`
    );

    const results: LatestVersionResult[] = [];
    for (const pkg of packages) {
      // Upsert with null latest_version just to track the check timestamp
      results.push({
        packageName: pkg.package_name,
        ecosystem,
        latestVersion: null,
        cveIds: [],
        cveCount: 0,
      });
    }
    return results;
  }

  // ─── Well-known software ───

  private async checkWellKnown(packages: PackageGroup[]): Promise<LatestVersionResult[]> {
    const results: LatestVersionResult[] = [];

    for (const pkg of packages) {
      if (this.stopping) break;

      // Check if package name matches a well-known software key
      const normalizedName = pkg.package_name.toLowerCase().replace(/[-_\s]/g, "");
      const matchKey = Object.keys(VERSION_SOURCES).find((key) => {
        const normalizedKey = key.toLowerCase().replace(/[-_\s]/g, "");
        return normalizedName.includes(normalizedKey) || normalizedKey.includes(normalizedName);
      });

      if (matchKey) {
        try {
          const result = await fetchWellKnownVersion(matchKey, (url) => this.fetchJson(url));
          if (result.version) {
            results.push({
              packageName: pkg.package_name,
              ecosystem: pkg.ecosystem,
              latestVersion: result.version,
              cveIds: result.cveIds,
              cveCount: result.cveCount,
            });
          }
        } catch {
          this.logger.debug({ package: pkg.package_name, matchKey }, "Well-known version check failed");
        }
      }
    }

    return results;
  }

  // ─── Upsert known_latest_versions ───

  private async upsertKnownVersion(result: LatestVersionResult): Promise<void> {
    if (!result.latestVersion) return;

    await this.pool.query(
      `INSERT INTO known_latest_versions (package_name, ecosystem, latest_version, latest_checked_at, cve_ids, cve_count, source_url)
       VALUES ($1, $2, $3, NOW(), $4, $5, $6)
       ON CONFLICT (package_name, ecosystem)
       DO UPDATE SET
         latest_version = EXCLUDED.latest_version,
         latest_checked_at = NOW(),
         cve_ids = EXCLUDED.cve_ids,
         cve_count = EXCLUDED.cve_count,
         source_url = COALESCE(EXCLUDED.source_url, known_latest_versions.source_url)`,
      [
        result.packageName,
        result.ecosystem,
        result.latestVersion,
        result.cveIds,
        result.cveCount,
        result.sourceUrl ?? null,
      ]
    );
  }

  // ─── Alert generation ───

  private async generateAlerts(): Promise<number> {
    // Find discovered packages that have a known latest version different from installed
    const result = await this.pool.query<{
      host_id: string;
      package_id: string;
      package_name: string;
      installed_version: string;
      latest_version: string;
      cve_count: number;
      cve_ids: string[];
    }>(
      `SELECT
         dp.host_id,
         dp.id AS package_id,
         dp.package_name,
         dp.installed_version,
         klv.latest_version,
         klv.cve_count,
         klv.cve_ids
       FROM discovered_packages dp
       JOIN known_latest_versions klv
         ON klv.package_name = dp.package_name
         AND klv.ecosystem = dp.ecosystem
       WHERE dp.removed_at IS NULL
         AND klv.latest_version IS NOT NULL
         AND dp.installed_version IS NOT NULL
         AND dp.installed_version != klv.latest_version
         -- Exclude packages that already have an unacknowledged alert for this version
         AND NOT EXISTS (
           SELECT 1 FROM alerts a
           WHERE a.host_id = dp.host_id
             AND a.package_name = dp.package_name
             AND a.available_version = klv.latest_version
             AND a.acknowledged = false
         )`
    );

    let alertsCreated = 0;

    for (const row of result.rows) {
      const severity = this.determineSeverity(
        row.installed_version,
        row.latest_version,
        row.cve_count
      );

      try {
        await this.pool.query(
          `INSERT INTO alerts (host_id, package_id, package_name, current_version, available_version, severity)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT DO NOTHING`,
          [
            row.host_id,
            row.package_id,
            row.package_name,
            row.installed_version,
            row.latest_version,
            severity,
          ]
        );
        alertsCreated++;
      } catch (err) {
        this.logger.debug(
          { err, packageName: row.package_name, hostId: row.host_id },
          "Failed to create alert (may already exist)"
        );
      }
    }

    return alertsCreated;
  }

  /**
   * Determine alert severity based on version difference and CVE data.
   */
  private determineSeverity(
    installed: string,
    latest: string,
    cveCount: number
  ): string {
    // CVE-based severity takes priority
    if (cveCount >= 5) return "critical";
    if (cveCount >= 1) return "high";

    // Try semver comparison
    const installedSemver = semver.coerce(installed);
    const latestSemver = semver.coerce(latest);

    if (installedSemver && latestSemver && semver.lt(installedSemver, latestSemver)) {
      const majorDiff = latestSemver.major - installedSemver.major;
      const minorDiff = latestSemver.minor - installedSemver.minor;

      if (majorDiff > 0) return "high";
      if (minorDiff > 0) return "medium";
      return "low"; // patch difference
    }

    // Non-semver: simple string mismatch → info
    if (installed !== latest) return "info";

    return "info";
  }

  // ─── HTTP helper ───

  private async fetchJson(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "infrawatch/0.1.0",
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }

      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }
}
