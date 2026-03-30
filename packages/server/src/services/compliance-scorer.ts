import type pg from "pg";
import type { Logger } from "pino";

export interface ScoreBreakdown {
  packageCurrency: { score: number; maxScore: number; upToDate: number; total: number };
  eolStatus: { score: number; maxScore: number; activeEolAlerts: number; worstEolDays: number | null };
  alertResolution: { score: number; maxScore: number; acknowledged: number; total: number };
  scanFreshness: { score: number; maxScore: number; lastSeenAt: string | null };
  serviceHealth: { score: number; maxScore: number; running: number; total: number };
}

type Classification = "excellent" | "good" | "fair" | "poor" | "critical";

function classify(score: number): Classification {
  if (score >= 90) return "excellent";
  if (score >= 70) return "good";
  if (score >= 50) return "fair";
  if (score >= 30) return "poor";
  return "critical";
}

export class ComplianceScorer {
  private timer: ReturnType<typeof setInterval> | null = null;
  private initialTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(
    private pool: pg.Pool,
    private logger: Logger
  ) {}

  start(): void {
    if (this.timer) return;
    this.logger.info("Compliance scorer starting");

    // Run initial calculation after a short delay (let other services start first)
    this.initialTimer = setTimeout(() => {
      this.initialTimer = null;
      this.calculateAllScores();
    }, 10_000);

    // Schedule daily at 2:00 AM
    const scheduleDaily = () => {
      const now = new Date();
      const next = new Date(now);
      next.setHours(2, 0, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      const delay = next.getTime() - now.getTime();

      this.timer = setTimeout(() => {
        this.calculateAllScores();
        // Then every 24h
        this.timer = setInterval(() => this.calculateAllScores(), 24 * 60 * 60 * 1000);
      }, delay) as unknown as ReturnType<typeof setInterval>;
    };
    scheduleDaily();
  }

  stop(): void {
    if (this.initialTimer) {
      clearTimeout(this.initialTimer);
      this.initialTimer = null;
    }
    if (this.timer) {
      clearTimeout(this.timer as unknown as ReturnType<typeof setTimeout>);
      clearInterval(this.timer);
      this.timer = null;
    }
    this.logger.info("Compliance scorer stopped");
  }

  // ─── On-demand recalculation (after scan or alert ack) ───

  async recalculateHost(hostId: string): Promise<void> {
    try {
      await this.calculateHostScore(hostId);
    } catch (err) {
      this.logger.error({ err, hostId }, "Failed to recalculate host compliance score");
    }
  }

  // ─── Full recalculation ───

  async calculateAllScores(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      // 1. Calculate all host scores
      const hostsResult = await this.pool.query<{ id: string }>(
        `SELECT id FROM hosts WHERE status != 'decommissioned'`
      );

      let calculated = 0;
      for (const row of hostsResult.rows) {
        await this.calculateHostScore(row.id);
        calculated++;
      }

      // 2. Aggregate to groups
      await this.aggregateGroupScores();

      // 3. Aggregate to environments
      await this.aggregateEnvironmentScores();

      // 4. Aggregate fleet score
      await this.aggregateFleetScore();

      // 5. Snapshot history
      await this.snapshotHistory();

      this.logger.info({ calculated }, "Compliance scores calculated for all entities");
    } catch (err) {
      this.logger.error({ err }, "Failed to calculate compliance scores");
    } finally {
      this.running = false;
    }
  }

  // ─── Per-host scoring ───

  async calculateHostScore(hostId: string): Promise<number> {
    const breakdown = await this.computeBreakdown(hostId);
    const score = Math.round(
      breakdown.packageCurrency.score +
      breakdown.eolStatus.score +
      breakdown.alertResolution.score +
      breakdown.scanFreshness.score +
      breakdown.serviceHealth.score
    );
    const classification = classify(score);

    // Get hostname for entity_name
    const hostResult = await this.pool.query<{ hostname: string }>(
      `SELECT hostname FROM hosts WHERE id = $1`, [hostId]
    );
    const hostname = hostResult.rows[0]?.hostname ?? "unknown";

    await this.pool.query(
      `INSERT INTO compliance_scores (entity_type, entity_id, entity_name, score, classification, breakdown, calculated_at)
       VALUES ('host', $1, $2, $3, $4, $5, NOW())
       ON CONFLICT (entity_type, entity_id) DO UPDATE SET
         entity_name = EXCLUDED.entity_name,
         score = EXCLUDED.score,
         classification = EXCLUDED.classification,
         breakdown = EXCLUDED.breakdown,
         calculated_at = NOW()`,
      [hostId, hostname, score, classification, JSON.stringify(breakdown)]
    );

    return score;
  }

  private async computeBreakdown(hostId: string): Promise<ScoreBreakdown> {
    // Run all 5 factor queries in parallel
    const [pkgResult, eolResult, alertResult, scanResult, svcResult] = await Promise.all([
      // 1. Package Currency (35 pts)
      this.pool.query<{ total: string; with_alerts: string }>(
        `SELECT
           COUNT(*) AS total,
           COUNT(DISTINCT a.package_name) AS with_alerts
         FROM discovered_packages dp
         LEFT JOIN alerts a ON a.host_id = dp.host_id
           AND a.package_name = dp.package_name
           AND a.acknowledged = false
         WHERE dp.host_id = $1 AND dp.removed_at IS NULL`,
        [hostId]
      ),
      // 2. EOL Status (25 pts)
      this.pool.query<{ active_count: string; worst_days: string | null }>(
        `SELECT
           COUNT(*) AS active_count,
           MAX(days_past_eol) AS worst_days
         FROM eol_alerts
         WHERE host_id = $1 AND status = 'active'`,
        [hostId]
      ),
      // 3. Alert Resolution (20 pts)
      this.pool.query<{ total: string; acknowledged: string }>(
        `SELECT
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE acknowledged = true) AS acknowledged
         FROM alerts
         WHERE host_id = $1 AND severity IN ('critical', 'high')`,
        [hostId]
      ),
      // 4. Scan Freshness (10 pts)
      this.pool.query<{ last_seen_at: string | null; scan_interval_hours: string | null }>(
        `SELECT h.last_seen_at,
                st.scan_interval_hours
         FROM hosts h
         LEFT JOIN scan_targets st ON st.id = h.scan_target_id
         WHERE h.id = $1`,
        [hostId]
      ),
      // 5. Service Health (10 pts)
      this.pool.query<{ total: string; running_count: string }>(
        `SELECT
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE status = 'running') AS running_count
         FROM services
         WHERE host_id = $1`,
        [hostId]
      ),
    ]);

    const totalPkgs = parseInt(pkgResult.rows[0].total, 10);
    const pkgsWithAlerts = parseInt(pkgResult.rows[0].with_alerts, 10);
    const upToDate = totalPkgs - pkgsWithAlerts;
    const packageCurrencyScore = totalPkgs === 0 ? 35 : 35 * (upToDate / totalPkgs);

    const activeEolAlerts = parseInt(eolResult.rows[0].active_count, 10);
    const worstEolDays = eolResult.rows[0].worst_days != null
      ? parseInt(eolResult.rows[0].worst_days, 10) : null;

    let eolScore: number;
    if (activeEolAlerts === 0) {
      eolScore = 25;
    } else if (worstEolDays !== null && worstEolDays > 0) {
      eolScore = 0;
    } else {
      eolScore = 15;
    }

    const totalCritHigh = parseInt(alertResult.rows[0].total, 10);
    const ackCritHigh = parseInt(alertResult.rows[0].acknowledged, 10);
    const alertScore = totalCritHigh === 0 ? 20 : 20 * (ackCritHigh / totalCritHigh);

    const lastSeenAt = scanResult.rows[0]?.last_seen_at ?? null;
    const intervalHours = parseInt(scanResult.rows[0]?.scan_interval_hours ?? "24", 10);
    let scanScore: number;
    if (!lastSeenAt) {
      scanScore = 0;
    } else {
      const hoursSince = (Date.now() - new Date(lastSeenAt).getTime()) / (1000 * 60 * 60);
      if (hoursSince <= intervalHours) {
        scanScore = 10;
      } else if (hoursSince <= intervalHours * 2) {
        scanScore = 7;
      } else if (hoursSince <= 24) {
        scanScore = 4;
      } else {
        scanScore = 0;
      }
    }

    const totalSvc = parseInt(svcResult.rows[0].total, 10);
    const runningSvc = parseInt(svcResult.rows[0].running_count, 10);
    const svcScore = totalSvc === 0 ? 10 : 10 * (runningSvc / totalSvc);

    return {
      packageCurrency: { score: Math.round(packageCurrencyScore * 10) / 10, maxScore: 35, upToDate, total: totalPkgs },
      eolStatus: { score: eolScore, maxScore: 25, activeEolAlerts, worstEolDays },
      alertResolution: { score: Math.round(alertScore * 10) / 10, maxScore: 20, acknowledged: ackCritHigh, total: totalCritHigh },
      scanFreshness: { score: scanScore, maxScore: 10, lastSeenAt },
      serviceHealth: { score: Math.round(svcScore * 10) / 10, maxScore: 10, running: runningSvc, total: totalSvc },
    };
  }

  // ─── Aggregation ───

  private async aggregateGroupScores(): Promise<void> {
    const result = await this.pool.query<{ group_id: string; group_name: string; avg_score: string }>(
      `SELECT hg.id AS group_id, hg.name AS group_name, COALESCE(AVG(cs.score), 0) AS avg_score
       FROM host_groups hg
       JOIN host_group_members hgm ON hgm.host_group_id = hg.id
       JOIN compliance_scores cs ON cs.entity_type = 'host' AND cs.entity_id = hgm.host_id
       GROUP BY hg.id, hg.name`
    );

    for (const row of result.rows) {
      const score = Math.round(parseFloat(row.avg_score));
      await this.pool.query(
        `INSERT INTO compliance_scores (entity_type, entity_id, entity_name, score, classification, breakdown, calculated_at)
         VALUES ('group', $1, $2, $3, $4, '{}', NOW())
         ON CONFLICT (entity_type, entity_id) DO UPDATE SET
           entity_name = EXCLUDED.entity_name,
           score = EXCLUDED.score,
           classification = EXCLUDED.classification,
           calculated_at = NOW()`,
        [row.group_id, row.group_name, score, classify(score)]
      );
    }
  }

  private async aggregateEnvironmentScores(): Promise<void> {
    const result = await this.pool.query<{ env: string; avg_score: string }>(
      `SELECT
         COALESCE(ht.tag_value, 'untagged') AS env,
         AVG(cs.score) AS avg_score
       FROM compliance_scores cs
       JOIN hosts h ON h.id = cs.entity_id AND cs.entity_type = 'host'
       LEFT JOIN host_tags ht ON ht.host_id = h.id AND ht.tag_key = 'environment'
       GROUP BY COALESCE(ht.tag_value, 'untagged')`
    );

    for (const row of result.rows) {
      const score = Math.round(parseFloat(row.avg_score));
      await this.pool.query(
        `INSERT INTO compliance_scores (entity_type, entity_id, entity_name, score, classification, breakdown, calculated_at)
         VALUES ('environment', NULL, $1, $2, $3, '{}'::jsonb, NOW())
         ON CONFLICT (entity_type, entity_name) WHERE entity_id IS NULL DO UPDATE SET
           score = EXCLUDED.score,
           classification = EXCLUDED.classification,
           calculated_at = NOW()`,
        [row.env, score, classify(score)]
      );
    }
  }

  private async aggregateFleetScore(): Promise<void> {
    const result = await this.pool.query<{ avg_score: string }>(
      `SELECT COALESCE(AVG(score), 0) AS avg_score FROM compliance_scores WHERE entity_type = 'host'`
    );
    const score = Math.round(parseFloat(result.rows[0].avg_score));
    const classification = classify(score);

    await this.pool.query(
      `INSERT INTO compliance_scores (entity_type, entity_id, entity_name, score, classification, breakdown, calculated_at)
       VALUES ('fleet', NULL, 'fleet', $1, $2, '{}'::jsonb, NOW())
       ON CONFLICT (entity_type, entity_name) WHERE entity_id IS NULL DO UPDATE SET
         score = EXCLUDED.score,
         classification = EXCLUDED.classification,
         calculated_at = NOW()`,
      [score, classification]
    );
  }

  private async snapshotHistory(): Promise<void> {
    const today = new Date().toISOString().split("T")[0];

    // Snapshot all current scores
    await this.pool.query(
      `INSERT INTO compliance_score_history (entity_type, entity_id, entity_name, score, classification, snapshot_date)
       SELECT entity_type, entity_id, entity_name, score, classification, $1::date
       FROM compliance_scores
       ON CONFLICT DO NOTHING`,
      [today]
    );
  }
}
