import type pg from "pg";
import type { Logger } from "pino";
import type { ScanResult, HostInventory, PackageInfo, ServiceInfo } from "@infrawatch/scanner";

export interface IngestionStats {
  hostsUpserted: number;
  packagesFound: number;
  servicesFound: number;
}

export class DataIngestionService {
  constructor(
    private pool: pg.Pool,
    private logger: Logger
  ) {}

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
        const pkgCount = await this.diffPackages(client, hostId, host.packages);
        const svcCount = await this.upsertServices(client, hostId, host.services);

        await client.query("COMMIT");

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
    return result.rows[0].id;
  }

  // ─── Package diff ───

  private async diffPackages(
    client: pg.PoolClient,
    hostId: string,
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

    const existingByKey = new Map<string, { id: string; installed_version: string }>();
    for (const row of existingResult.rows) {
      const key = `${row.package_name}::${row.package_manager}`;
      existingByKey.set(key, { id: row.id, installed_version: row.installed_version });
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
      } else {
        // Existing — update last_detected_at and version if changed
        if (existing.installed_version !== pkg.installedVersion) {
          await client.query(
            `UPDATE discovered_packages
             SET installed_version = $1, last_detected_at = NOW()
             WHERE id = $2`,
            [pkg.installedVersion, existing.id]
          );
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
      }
    }

    return scannedPackages.length;
  }

  // ─── Service upsert ───

  private async upsertServices(
    client: pg.PoolClient,
    hostId: string,
    services: ServiceInfo[]
  ): Promise<number> {
    for (const svc of services) {
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
    }
    return services.length;
  }
}
