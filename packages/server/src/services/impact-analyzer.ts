import type pg from "pg";

export interface DependencyNode {
  hostId: string;
  hostname: string;
  ip: string | null;
  port: number;
  service: string | null;
  process: string | null;
  connectionType: string;
}

export interface ImpactResult {
  hostId: string;
  hostname: string;
  directDependents: DependencyNode[];
  indirectDependents: DependencyNode[];
  directDependencies: DependencyNode[];
  riskLevel: "low" | "medium" | "high" | "critical";
  summary: string;
}

export class ImpactAnalyzer {
  constructor(private pool: pg.Pool) {}

  async analyzeImpact(hostId: string): Promise<ImpactResult> {
    // Get host info
    const hostResult = await this.pool.query<{ hostname: string }>(
      `SELECT hostname FROM hosts WHERE id = $1`,
      [hostId]
    );
    const hostname = hostResult.rows[0]?.hostname ?? "unknown";

    // Direct dependents: hosts that connect TO this host
    const directDependents = await this.getDirectDependents(hostId);

    // Direct dependencies: hosts that this host connects TO
    const directDependencies = await this.getDirectDependencies(hostId);

    // Indirect dependents: hosts that depend on hosts that depend on this host (2 hops)
    const indirectDependents = await this.getIndirectDependents(
      hostId,
      directDependents.map((d) => d.hostId)
    );

    // Risk level based on dependent count
    const totalDependents = directDependents.length + indirectDependents.length;
    let riskLevel: ImpactResult["riskLevel"];
    if (totalDependents >= 10) {
      riskLevel = "critical";
    } else if (totalDependents >= 5) {
      riskLevel = "high";
    } else if (totalDependents >= 2) {
      riskLevel = "medium";
    } else {
      riskLevel = "low";
    }

    const summary =
      totalDependents === 0
        ? `${hostname} has no known dependents.`
        : `${hostname} has ${directDependents.length} direct and ${indirectDependents.length} indirect dependent(s). Risk: ${riskLevel}.`;

    return {
      hostId,
      hostname,
      directDependents,
      indirectDependents,
      directDependencies,
      riskLevel,
      summary,
    };
  }

  private async getDirectDependents(hostId: string): Promise<DependencyNode[]> {
    const result = await this.pool.query<{
      host_id: string;
      hostname: string;
      ip_address: string | null;
      target_port: number;
      target_service: string | null;
      source_process: string | null;
      connection_type: string;
    }>(
      `SELECT DISTINCT
         hc.source_host_id AS host_id,
         h.hostname,
         h.ip_address,
         hc.target_port,
         hc.target_service,
         hc.source_process,
         hc.connection_type
       FROM host_connections hc
       JOIN hosts h ON h.id = hc.source_host_id
       WHERE hc.target_host_id = $1`,
      [hostId]
    );

    return result.rows.map((r) => ({
      hostId: r.host_id,
      hostname: r.hostname,
      ip: r.ip_address,
      port: r.target_port,
      service: r.target_service,
      process: r.source_process,
      connectionType: r.connection_type,
    }));
  }

  private async getDirectDependencies(hostId: string): Promise<DependencyNode[]> {
    const result = await this.pool.query<{
      host_id: string | null;
      hostname: string | null;
      ip_address: string | null;
      target_ip: string;
      target_port: number;
      target_service: string | null;
      source_process: string | null;
      connection_type: string;
    }>(
      `SELECT DISTINCT
         hc.target_host_id AS host_id,
         h.hostname,
         COALESCE(h.ip_address, hc.target_ip) AS ip_address,
         hc.target_ip,
         hc.target_port,
         hc.target_service,
         hc.source_process,
         hc.connection_type
       FROM host_connections hc
       LEFT JOIN hosts h ON h.id = hc.target_host_id
       WHERE hc.source_host_id = $1`,
      [hostId]
    );

    return result.rows.map((r) => ({
      hostId: r.host_id ?? "",
      hostname: r.hostname ?? r.target_ip,
      ip: r.ip_address,
      port: r.target_port,
      service: r.target_service,
      process: r.source_process,
      connectionType: r.connection_type,
    }));
  }

  private async getIndirectDependents(
    hostId: string,
    directHostIds: string[]
  ): Promise<DependencyNode[]> {
    if (directHostIds.length === 0) return [];

    const result = await this.pool.query<{
      host_id: string;
      hostname: string;
      ip_address: string | null;
      target_port: number;
      target_service: string | null;
      source_process: string | null;
      connection_type: string;
    }>(
      `SELECT DISTINCT
         hc.source_host_id AS host_id,
         h.hostname,
         h.ip_address,
         hc.target_port,
         hc.target_service,
         hc.source_process,
         hc.connection_type
       FROM host_connections hc
       JOIN hosts h ON h.id = hc.source_host_id
       WHERE hc.target_host_id = ANY($1)
         AND hc.source_host_id != $2
         AND hc.source_host_id != ALL($1)`,
      [directHostIds, hostId]
    );

    return result.rows.map((r) => ({
      hostId: r.host_id,
      hostname: r.hostname,
      ip: r.ip_address,
      port: r.target_port,
      service: r.target_service,
      process: r.source_process,
      connectionType: r.connection_type,
    }));
  }
}
