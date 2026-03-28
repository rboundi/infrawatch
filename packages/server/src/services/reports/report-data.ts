import type pg from "pg";

export interface WeeklySummaryData {
  period: { start: string; end: string };
  overview: {
    totalHosts: number;
    activeHosts: number;
    staleHosts: number;
    totalPackages: number;
    totalServices: number;
    newHosts: number;
    decommissionedHosts: number;
  };
  alerts: {
    newBySeverity: Record<string, number>;
    resolved: number;
    topPackages: Array<{ packageName: string; count: number }>;
  };
  eol: {
    pastEol: number;
    upcomingEol: number;
    newItems: number;
  };
  changes: {
    total: number;
    byType: Record<string, number>;
    significant: Array<{ summary: string; eventType: string; hostname: string; createdAt: string }>;
  };
  staleHosts: Array<{ hostname: string; lastSeenAt: string }>;
  hostsByEnvironment: Array<{ environment: string; count: number }>;
  topOutdatedPackages: Array<{ packageName: string; currentVersion: string; availableVersion: string; hostCount: number }>;
}

export interface EolReportData {
  period: { start: string; end: string };
  summary: { pastEol: number; upcomingEol: number; within6Months: number; totalActive: number };
  byCategory: Array<{ category: string; count: number }>;
  alerts: Array<{
    productName: string; installedVersion: string; eolDate: string;
    daysPastEol: number; hostname: string; successorVersion: string | null;
    productCategory: string; status: string;
  }>;
  mostAffectedHosts: Array<{ hostname: string; eolCount: number }>;
}

export interface AlertReportData {
  period: { start: string; end: string };
  summary: { total: number; critical: number; high: number; medium: number; low: number; resolved: number };
  newAlerts: Array<{
    packageName: string; severity: string; hostname: string;
    currentVersion: string | null; availableVersion: string | null; createdAt: string;
  }>;
  topVulnerable: Array<{ packageName: string; severity: string; hostCount: number }>;
}

export interface HostInventoryData {
  generatedAt: string;
  summary: { totalHosts: number; active: number; stale: number; totalPackages: number; totalServices: number };
  hosts: Array<{
    hostname: string; ip: string | null; os: string | null; osVersion: string | null;
    status: string; lastSeenAt: string; packageCount: number; serviceCount: number;
    environmentTag: string | null;
  }>;
}

export type ReportData = WeeklySummaryData | EolReportData | AlertReportData | HostInventoryData;

export async function gatherWeeklySummaryData(
  pool: pg.Pool,
  periodStart: Date,
  periodEnd: Date,
  _filters?: Record<string, unknown>
): Promise<WeeklySummaryData> {
  const ps = periodStart.toISOString();
  const pe = periodEnd.toISOString();

  // Overview
  const overviewResult = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM hosts)::int AS total_hosts,
      (SELECT COUNT(*) FROM hosts WHERE status = 'active')::int AS active_hosts,
      (SELECT COUNT(*) FROM hosts WHERE status = 'stale')::int AS stale_hosts,
      (SELECT COUNT(*) FROM discovered_packages WHERE removed_at IS NULL)::int AS total_packages,
      (SELECT COUNT(*) FROM services)::int AS total_services
  `);
  const ov = overviewResult.rows[0];

  // New/decommissioned hosts in period
  const hostChanges = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE event_type = 'host_discovered')::int AS new_hosts,
       COUNT(*) FILTER (WHERE event_type = 'host_disappeared')::int AS decommissioned
     FROM change_events
     WHERE created_at BETWEEN $1 AND $2`,
    [ps, pe]
  );
  const hc = hostChanges.rows[0];

  // Alerts by severity
  const alertsBySev = await pool.query(
    `SELECT severity, COUNT(*)::int AS count
     FROM alerts WHERE created_at BETWEEN $1 AND $2
     GROUP BY severity`,
    [ps, pe]
  );
  const newBySeverity: Record<string, number> = {};
  for (const r of alertsBySev.rows) newBySeverity[r.severity] = r.count;

  const resolvedResult = await pool.query(
    `SELECT COUNT(*)::int AS count FROM alerts
     WHERE acknowledged = true AND acknowledged_at BETWEEN $1 AND $2`,
    [ps, pe]
  );

  // Top packages with alerts
  const topPkgs = await pool.query(
    `SELECT package_name, COUNT(*)::int AS count
     FROM alerts WHERE created_at BETWEEN $1 AND $2
     GROUP BY package_name ORDER BY count DESC LIMIT 10`,
    [ps, pe]
  );

  // EOL summary
  const eolSummary = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'active' AND days_past_eol > 0)::int AS past_eol,
      COUNT(*) FILTER (WHERE status = 'active' AND days_past_eol <= 0 AND days_past_eol >= -90)::int AS upcoming_eol
    FROM eol_alerts
  `);
  const newEolResult = await pool.query(
    `SELECT COUNT(*)::int AS count FROM eol_alerts WHERE created_at BETWEEN $1 AND $2`,
    [ps, pe]
  );

  // Changes
  const changesSummary = await pool.query(
    `SELECT COUNT(*)::int AS total FROM change_events WHERE created_at BETWEEN $1 AND $2`,
    [ps, pe]
  );
  const changesByType = await pool.query(
    `SELECT event_type, COUNT(*)::int AS count
     FROM change_events WHERE created_at BETWEEN $1 AND $2
     GROUP BY event_type ORDER BY count DESC`,
    [ps, pe]
  );
  const byType: Record<string, number> = {};
  for (const r of changesByType.rows) byType[r.event_type] = r.count;

  const significantChanges = await pool.query(
    `SELECT summary, event_type, hostname, created_at
     FROM change_events WHERE created_at BETWEEN $1 AND $2
     ORDER BY created_at DESC LIMIT 20`,
    [ps, pe]
  );

  // Stale hosts
  const staleHosts = await pool.query(
    `SELECT hostname, last_seen_at FROM hosts WHERE status = 'stale' ORDER BY last_seen_at ASC LIMIT 20`
  );

  // Hosts by environment
  const hostsByEnv = await pool.query(
    `SELECT COALESCE(environment_tag, 'untagged') AS environment, COUNT(*)::int AS count
     FROM hosts GROUP BY environment_tag ORDER BY count DESC`
  );

  // Top outdated packages
  const topOutdated = await pool.query(
    `SELECT a.package_name, a.current_version, a.available_version, COUNT(DISTINCT a.host_id)::int AS host_count
     FROM alerts a
     WHERE a.acknowledged = false AND a.severity IN ('critical', 'high')
     GROUP BY a.package_name, a.current_version, a.available_version
     ORDER BY host_count DESC LIMIT 10`
  );

  return {
    period: { start: ps, end: pe },
    overview: {
      totalHosts: ov.total_hosts, activeHosts: ov.active_hosts, staleHosts: ov.stale_hosts,
      totalPackages: ov.total_packages, totalServices: ov.total_services,
      newHosts: hc.new_hosts, decommissionedHosts: hc.decommissioned,
    },
    alerts: {
      newBySeverity,
      resolved: resolvedResult.rows[0].count,
      topPackages: topPkgs.rows.map((r) => ({ packageName: r.package_name, count: r.count })),
    },
    eol: {
      pastEol: eolSummary.rows[0].past_eol,
      upcomingEol: eolSummary.rows[0].upcoming_eol,
      newItems: newEolResult.rows[0].count,
    },
    changes: {
      total: changesSummary.rows[0].total,
      byType,
      significant: significantChanges.rows.map((r) => ({
        summary: r.summary, eventType: r.event_type, hostname: r.hostname, createdAt: r.created_at,
      })),
    },
    staleHosts: staleHosts.rows.map((r) => ({ hostname: r.hostname, lastSeenAt: r.last_seen_at })),
    hostsByEnvironment: hostsByEnv.rows.map((r) => ({ environment: r.environment, count: r.count })),
    topOutdatedPackages: topOutdated.rows.map((r) => ({
      packageName: r.package_name, currentVersion: r.current_version,
      availableVersion: r.available_version, hostCount: r.host_count,
    })),
  };
}

export async function gatherEolReportData(
  pool: pg.Pool,
  periodStart: Date,
  periodEnd: Date,
  _filters?: Record<string, unknown>
): Promise<EolReportData> {
  const summary = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE ea.status = 'active' AND ea.days_past_eol > 0)::int AS past_eol,
      COUNT(*) FILTER (WHERE ea.status = 'active' AND ea.days_past_eol <= 0 AND ea.days_past_eol >= -90)::int AS upcoming_eol,
      COUNT(*) FILTER (WHERE ea.status = 'active' AND ea.days_past_eol <= 0 AND ea.days_past_eol >= -180)::int AS within_6_months,
      COUNT(*) FILTER (WHERE ea.status = 'active')::int AS total_active
    FROM eol_alerts ea
  `);

  const byCategory = await pool.query(`
    SELECT ed.product_category AS category, COUNT(*)::int AS count
    FROM eol_alerts ea JOIN eol_definitions ed ON ed.id = ea.eol_definition_id
    WHERE ea.status = 'active' GROUP BY ed.product_category ORDER BY count DESC
  `);

  const alerts = await pool.query(`
    SELECT ea.product_name, ea.installed_version, ea.eol_date, ea.days_past_eol,
           h.hostname, ea.successor_version, ed.product_category, ea.status
    FROM eol_alerts ea
    JOIN hosts h ON h.id = ea.host_id
    JOIN eol_definitions ed ON ed.id = ea.eol_definition_id
    WHERE ea.status IN ('active', 'acknowledged')
    ORDER BY ea.days_past_eol DESC LIMIT 100
  `);

  const affected = await pool.query(`
    SELECT h.hostname, COUNT(*)::int AS eol_count
    FROM eol_alerts ea JOIN hosts h ON h.id = ea.host_id
    WHERE ea.status = 'active' GROUP BY h.hostname ORDER BY eol_count DESC LIMIT 10
  `);

  const row = summary.rows[0];
  return {
    period: { start: periodStart.toISOString(), end: periodEnd.toISOString() },
    summary: { pastEol: row.past_eol, upcomingEol: row.upcoming_eol, within6Months: row.within_6_months, totalActive: row.total_active },
    byCategory: byCategory.rows.map((r) => ({ category: r.category, count: r.count })),
    alerts: alerts.rows.map((r) => ({
      productName: r.product_name, installedVersion: r.installed_version, eolDate: r.eol_date,
      daysPastEol: r.days_past_eol, hostname: r.hostname, successorVersion: r.successor_version,
      productCategory: r.product_category, status: r.status,
    })),
    mostAffectedHosts: affected.rows.map((r) => ({ hostname: r.hostname, eolCount: r.eol_count })),
  };
}

export async function gatherAlertReportData(
  pool: pg.Pool,
  periodStart: Date,
  periodEnd: Date,
  _filters?: Record<string, unknown>
): Promise<AlertReportData> {
  const ps = periodStart.toISOString();
  const pe = periodEnd.toISOString();

  const summary = await pool.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE severity = 'critical')::int AS critical,
       COUNT(*) FILTER (WHERE severity = 'high')::int AS high,
       COUNT(*) FILTER (WHERE severity = 'medium')::int AS medium,
       COUNT(*) FILTER (WHERE severity = 'low')::int AS low
     FROM alerts WHERE created_at BETWEEN $1 AND $2`,
    [ps, pe]
  );
  const resolved = await pool.query(
    `SELECT COUNT(*)::int AS count FROM alerts WHERE acknowledged = true AND acknowledged_at BETWEEN $1 AND $2`,
    [ps, pe]
  );

  const newAlerts = await pool.query(
    `SELECT a.package_name, a.severity, h.hostname, a.current_version, a.available_version, a.created_at
     FROM alerts a JOIN hosts h ON h.id = a.host_id
     WHERE a.created_at BETWEEN $1 AND $2
     ORDER BY CASE a.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, a.created_at DESC
     LIMIT 50`,
    [ps, pe]
  );

  const topVulnerable = await pool.query(
    `SELECT a.package_name, a.severity, COUNT(DISTINCT a.host_id)::int AS host_count
     FROM alerts a WHERE a.created_at BETWEEN $1 AND $2
     GROUP BY a.package_name, a.severity
     ORDER BY host_count DESC LIMIT 15`,
    [ps, pe]
  );

  const s = summary.rows[0];
  return {
    period: { start: ps, end: pe },
    summary: { total: s.total, critical: s.critical, high: s.high, medium: s.medium, low: s.low, resolved: resolved.rows[0].count },
    newAlerts: newAlerts.rows.map((r) => ({
      packageName: r.package_name, severity: r.severity, hostname: r.hostname,
      currentVersion: r.current_version, availableVersion: r.available_version, createdAt: r.created_at,
    })),
    topVulnerable: topVulnerable.rows.map((r) => ({
      packageName: r.package_name, severity: r.severity, hostCount: r.host_count,
    })),
  };
}

export async function gatherHostInventoryData(
  pool: pg.Pool,
  _filters?: Record<string, unknown>
): Promise<HostInventoryData> {
  const summary = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM hosts)::int AS total_hosts,
      (SELECT COUNT(*) FROM hosts WHERE status = 'active')::int AS active,
      (SELECT COUNT(*) FROM hosts WHERE status = 'stale')::int AS stale,
      (SELECT COUNT(*) FROM discovered_packages WHERE removed_at IS NULL)::int AS total_packages,
      (SELECT COUNT(*) FROM services)::int AS total_services
  `);

  const hosts = await pool.query(`
    SELECT h.hostname, h.ip_address, h.os, h.os_version, h.status, h.last_seen_at, h.environment_tag,
           (SELECT COUNT(*) FROM discovered_packages dp WHERE dp.host_id = h.id AND dp.removed_at IS NULL)::int AS package_count,
           (SELECT COUNT(*) FROM services s WHERE s.host_id = h.id)::int AS service_count
    FROM hosts h ORDER BY h.hostname ASC
  `);

  const s = summary.rows[0];
  return {
    generatedAt: new Date().toISOString(),
    summary: { totalHosts: s.total_hosts, active: s.active, stale: s.stale, totalPackages: s.total_packages, totalServices: s.total_services },
    hosts: hosts.rows.map((r) => ({
      hostname: r.hostname, ip: r.ip_address, os: r.os, osVersion: r.os_version,
      status: r.status, lastSeenAt: r.last_seen_at, packageCount: r.package_count,
      serviceCount: r.service_count, environmentTag: r.environment_tag,
    })),
  };
}
