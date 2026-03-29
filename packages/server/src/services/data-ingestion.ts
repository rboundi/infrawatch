import type pg from "pg";
import type { Logger } from "pino";
import type { ScanResult, HostInventory, PackageInfo, ServiceInfo } from "@infrawatch/scanner";
import { ChangeDetector } from "./change-detector.js";
import type { GroupAssignmentService } from "./group-assignment.js";

export interface IngestionStats {
  hostsUpserted: number;
  packagesFound: number;
  servicesFound: number;
}

export class DataIngestionService {
  private changeDetector: ChangeDetector;
  private groupAssignment?: GroupAssignmentService;

  constructor(
    private pool: pg.Pool,
    private logger: Logger
  ) {
    this.changeDetector = new ChangeDetector(pool, logger);
  }

  setGroupAssignment(service: GroupAssignmentService): void {
    this.groupAssignment = service;
  }

  /**
   * Process scan results and persist them to the database.
   * Each host is processed inside its own transaction for atomicity.
   */
  async processResults(
    scanTargetId: string,
    results: ScanResult
  ): Promise<IngestionStats> {
    let hostsUpserted = 0;
    let packagesFound = 0;
    let servicesFound = 0;

    for (const host of results.hosts) {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");

        const hostId = await this.upsertHost(client, scanTargetId, host);
        const pkgCount = await this.diffPackages(client, hostId, host.hostname, scanTargetId, host.packages);
        const svcCount = await this.upsertServices(client, hostId, host.hostname, scanTargetId, host.services);

        await client.query("COMMIT");

        // Evaluate group membership for this host (outside transaction)
        if (this.groupAssignment) {
          try {
            await this.groupAssignment.evaluateHost(hostId);
          } catch (err) {
            this.logger.warn({ err, hostId }, "Failed to evaluate group membership");
          }
        }

        hostsUpserted++;
        packagesFound += pkgCount;
        servicesFound += svcCount;
      } catch (err) {
        await client.query("ROLLBACK");
        this.logger.error(
          { err, hostname: host.hostname, scanTargetId },
          `Failed to process host "${host.hostname}"`
        );
      } finally {
        client.release();
      }
    }

    this.logger.info(
      { scanTargetId, hostsUpserted, packagesFound, servicesFound },
      `Ingestion complete: ${hostsUpserted} hosts, ${packagesFound} packages, ${servicesFound} services`
    );

    return { hostsUpserted, packagesFound, servicesFound };
  }

  // ─── Host upsert ───

  private async upsertHost(
    client: pg.PoolClient,
    scanTargetId: string,
    host: HostInventory
  ): Promise<string> {
    // Fetch existing host state before upsert
    const prev = await client.query<{
      id: string;
      ip_address: string | null;
      os: string | null;
      os_version: string | null;
    }>(
      `SELECT id, ip_address, os, os_version FROM hosts WHERE hostname = $1 AND scan_target_id = $2`,
      [host.hostname, scanTargetId]
    );

    const result = await client.query(
      `INSERT INTO hosts (scan_target_id, hostname, ip_address, os, os_version, architecture, metadata, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (hostname, scan_target_id) DO UPDATE SET
         ip_address = EXCLUDED.ip_address,
         os = EXCLUDED.os,
         os_version = EXCLUDED.os_version,
         architecture = EXCLUDED.architecture,
         metadata = EXCLUDED.metadata,
         last_seen_at = NOW(),
         status = 'active'
       RETURNING id`,
      [
        scanTargetId,
        host.hostname,
        host.ip,
        host.os,
        host.osVersion,
        host.arch,
        JSON.stringify(host.metadata),
      ]
    );

    const hostId = result.rows[0].id;

    if (prev.rowCount === 0) {
      // New host discovered
      await this.changeDetector.recordChange(client, {
        hostId,
        hostname: host.hostname,
        eventType: "host_discovered",
        category: "host",
        summary: `New host discovered: ${host.hostname} (${host.os ?? "unknown OS"})`,
        details: { ip: host.ip, os: host.os, osVersion: host.osVersion, arch: host.arch },
        scanTargetId,
      });
    } else {
      const old = prev.rows[0];
      if (old.ip_address && host.ip && old.ip_address !== host.ip) {
        await this.changeDetector.recordChange(client, {
          hostId,
          hostname: host.hostname,
          eventType: "ip_changed",
          category: "config",
          summary: `IP changed on ${host.hostname}: ${old.ip_address} → ${host.ip}`,
          details: { oldIp: old.ip_address, newIp: host.ip },
          scanTargetId,
        });
      }
      const oldOs = `${old.os ?? ""} ${old.os_version ?? ""}`.trim();
      const newOs = `${host.os ?? ""} ${host.osVersion ?? ""}`.trim();
      if (oldOs && newOs && oldOs !== newOs) {
        await this.changeDetector.recordChange(client, {
          hostId,
          hostname: host.hostname,
          eventType: "os_changed",
          category: "config",
          summary: `OS changed on ${host.hostname}: ${oldOs} → ${newOs}`,
          details: { oldOs: old.os, oldOsVersion: old.os_version, newOs: host.os, newOsVersion: host.osVersion },
          scanTargetId,
        });
      }
    }

    return hostId;
  }

  // ─── Package diff ───

  private async diffPackages(
    client: pg.PoolClient,
    hostId: string,
    hostname: string,
    scanTargetId: string,
    scannedPackages: PackageInfo[]
  ): Promise<number> {
    // Get current active packages from DB
    const existingResult = await client.query<{
      id: string;
      package_name: string;
      installed_version: string;
      package_manager: string;
      ecosystem: string;
    }>(
      `SELECT id, package_name, installed_version, package_manager, ecosystem
       FROM discovered_packages
       WHERE host_id = $1 AND removed_at IS NULL`,
      [hostId]
    );

    const existingByKey = new Map<string, { id: string; installed_version: string; package_name: string }>();
    for (const row of existingResult.rows) {
      const key = `${row.package_name}::${row.package_manager}`;
      existingByKey.set(key, { id: row.id, installed_version: row.installed_version, package_name: row.package_name });
    }

    const scannedKeys = new Set<string>();

    // Process scanned packages: insert new, update existing
    for (const pkg of scannedPackages) {
      const key = `${pkg.name}::${pkg.packageManager}`;
      scannedKeys.add(key);

      const existing = existingByKey.get(key);

      if (!existing) {
        // New package — insert
        await client.query(
          `INSERT INTO discovered_packages
             (host_id, package_name, installed_version, package_manager, ecosystem, first_detected_at, last_detected_at)
           VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
          [hostId, pkg.name, pkg.installedVersion, pkg.packageManager, pkg.ecosystem]
        );
        await this.changeDetector.recordChange(client, {
          hostId,
          hostname,
          eventType: "package_added",
          category: "package",
          summary: `New package on ${hostname}: ${pkg.name} ${pkg.installedVersion}`,
          details: { packageName: pkg.name, version: pkg.installedVersion, ecosystem: pkg.ecosystem },
          scanTargetId,
        });
      } else {
        // Existing — update last_detected_at and version if changed
        if (existing.installed_version !== pkg.installedVersion) {
          await client.query(
            `UPDATE discovered_packages
             SET installed_version = $1, last_detected_at = NOW()
             WHERE id = $2`,
            [pkg.installedVersion, existing.id]
          );
          await this.changeDetector.recordChange(client, {
            hostId,
            hostname,
            eventType: "package_updated",
            category: "package",
            summary: `Package updated on ${hostname}: ${pkg.name} ${existing.installed_version} → ${pkg.installedVersion}`,
            details: {
              packageName: pkg.name,
              oldVersion: existing.installed_version,
              newVersion: pkg.installedVersion,
              ecosystem: pkg.ecosystem,
            },
            scanTargetId,
          });
        } else {
          await client.query(
            `UPDATE discovered_packages SET last_detected_at = NOW() WHERE id = $1`,
            [existing.id]
          );
        }
      }
    }

    // Mark removed packages: in DB but not in scan results
    for (const [key, existing] of existingByKey) {
      if (!scannedKeys.has(key)) {
        await client.query(
          `UPDATE discovered_packages SET removed_at = NOW() WHERE id = $1`,
          [existing.id]
        );
        await this.changeDetector.recordChange(client, {
          hostId,
          hostname,
          eventType: "package_removed",
          category: "package",
          summary: `Package removed from ${hostname}: ${existing.package_name} ${existing.installed_version}`,
          details: { packageName: existing.package_name, version: existing.installed_version },
          scanTargetId,
        });
      }
    }

    return scannedPackages.length;
  }

  // ─── Service upsert ───

  private async upsertServices(
    client: pg.PoolClient,
    hostId: string,
    hostname: string,
    scanTargetId: string,
    services: ServiceInfo[]
  ): Promise<number> {
    // Get existing services for change detection
    const existingResult = await client.query<{
      service_name: string;
      version: string | null;
      port: number | null;
      status: string;
    }>(
      `SELECT service_name, version, port, status FROM services WHERE host_id = $1`,
      [hostId]
    );
    const existingByName = new Map<string, { version: string | null; port: number | null; status: string }>();
    for (const row of existingResult.rows) {
      existingByName.set(row.service_name, { version: row.version, port: row.port, status: row.status });
    }

    const scannedNames = new Set<string>();

    for (const svc of services) {
      scannedNames.add(svc.name);
      const existing = existingByName.get(svc.name);

      await client.query(
        `INSERT INTO services (host_id, service_name, service_type, version, port, status, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (host_id, service_name)
         DO UPDATE SET
           service_type = EXCLUDED.service_type,
           version = EXCLUDED.version,
           port = EXCLUDED.port,
           status = EXCLUDED.status,
           last_seen_at = NOW()`,
        [hostId, svc.name, svc.serviceType, svc.version ?? null, svc.port ?? null, svc.status]
      );

      if (!existing) {
        await this.changeDetector.recordChange(client, {
          hostId,
          hostname,
          eventType: "service_added",
          category: "service",
          summary: `New service on ${hostname}: ${svc.name}${svc.version ? ` ${svc.version}` : ""}`,
          details: { serviceName: svc.name, version: svc.version, port: svc.port, status: svc.status },
          scanTargetId,
        });
      } else {
        const versionChanged = (existing.version ?? null) !== (svc.version ?? null);
        const statusChanged = existing.status !== svc.status;
        if (versionChanged || statusChanged) {
          await this.changeDetector.recordChange(client, {
            hostId,
            hostname,
            eventType: "service_changed",
            category: "service",
            summary: `Service changed on ${hostname}: ${svc.name}${versionChanged ? ` ${existing.version ?? "?"} → ${svc.version ?? "?"}` : ""}${statusChanged ? ` (${existing.status} → ${svc.status})` : ""}`,
            details: {
              serviceName: svc.name,
              oldVersion: existing.version,
              newVersion: svc.version,
              oldStatus: existing.status,
              newStatus: svc.status,
            },
            scanTargetId,
          });
        }
      }
    }

    // Detect removed services
    for (const [name] of existingByName) {
      if (!scannedNames.has(name)) {
        await this.changeDetector.recordChange(client, {
          hostId,
          hostname,
          eventType: "service_removed",
          category: "service",
          summary: `Service removed from ${hostname}: ${name}`,
          details: { serviceName: name },
          scanTargetId,
        });
      }
    }

    return services.length;
  }
}
