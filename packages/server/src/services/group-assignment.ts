import type pg from "pg";
import type { Logger } from "pino";

interface HostRow {
  id: string;
  hostname: string;
  ip_address: string | null;
  os: string | null;
  environment_tag: string | null;
  scan_target_id: string | null;
  detected_platform: string | null;
}

interface RuleRow {
  id: string;
  host_group_id: string;
  rule_type: string;
  rule_value: string;
  priority: number;
}

interface TagRow {
  tag_key: string;
  tag_value: string | null;
}

export class GroupAssignmentService {
  constructor(
    private pool: pg.Pool,
    private logger: Logger
  ) {}

  /**
   * Evaluate all rules for a single host and update memberships.
   * Never removes manual memberships — only manages rule-based ones.
   */
  async evaluateHost(hostId: string): Promise<{ added: string[]; removed: string[] }> {
    const hostResult = await this.pool.query<HostRow>(
      `SELECT id, hostname, ip_address, os, environment_tag, scan_target_id, detected_platform
       FROM hosts WHERE id = $1`,
      [hostId]
    );
    if (hostResult.rows.length === 0) return { added: [], removed: [] };
    const host = hostResult.rows[0];

    // Get all rules ordered by priority DESC
    const rulesResult = await this.pool.query<RuleRow>(
      `SELECT id, host_group_id, rule_type, rule_value, priority
       FROM host_group_rules ORDER BY priority DESC`
    );

    // Get host tags
    const tagsResult = await this.pool.query<TagRow>(
      `SELECT tag_key, tag_value FROM host_tags WHERE host_id = $1`,
      [hostId]
    );
    const tags = tagsResult.rows;

    // Determine which groups this host should belong to via rules
    const matchedRules = new Map<string, string>(); // groupId -> ruleId
    for (const rule of rulesResult.rows) {
      if (matchedRules.has(rule.host_group_id)) continue; // already matched by higher priority rule
      if (this.matchesRule(host, tags, rule)) {
        matchedRules.set(rule.host_group_id, rule.id);
      }
    }

    // Get current rule-based memberships
    const currentResult = await this.pool.query<{ host_group_id: string }>(
      `SELECT host_group_id FROM host_group_members
       WHERE host_id = $1 AND assigned_by = 'rule'`,
      [hostId]
    );
    const currentGroupIds = new Set(currentResult.rows.map((r) => r.host_group_id));

    const added: string[] = [];
    const removed: string[] = [];

    // Add new rule-based memberships
    for (const [groupId, ruleId] of matchedRules) {
      if (!currentGroupIds.has(groupId)) {
        await this.pool.query(
          `INSERT INTO host_group_members (host_id, host_group_id, assigned_by, rule_id)
           VALUES ($1, $2, 'rule', $3)
           ON CONFLICT (host_id, host_group_id) DO NOTHING`,
          [hostId, groupId, ruleId]
        );
        added.push(groupId);
      }
    }

    // Remove stale rule-based memberships (not matched anymore)
    for (const groupId of currentGroupIds) {
      if (!matchedRules.has(groupId)) {
        await this.pool.query(
          `DELETE FROM host_group_members
           WHERE host_id = $1 AND host_group_id = $2 AND assigned_by = 'rule'`,
          [hostId, groupId]
        );
        removed.push(groupId);
      }
    }

    return { added, removed };
  }

  /**
   * Re-evaluate all hosts against all rules.
   */
  async evaluateAllHosts(): Promise<{ added: number; removed: number }> {
    const hosts = await this.pool.query<{ id: string }>("SELECT id FROM hosts");
    let totalAdded = 0;
    let totalRemoved = 0;

    for (const host of hosts.rows) {
      const result = await this.evaluateHost(host.id);
      totalAdded += result.added.length;
      totalRemoved += result.removed.length;
    }

    this.logger.info({ totalAdded, totalRemoved }, "Re-evaluated all host group memberships");
    return { added: totalAdded, removed: totalRemoved };
  }

  /**
   * Evaluate all hosts for a specific group (when rules change).
   */
  async evaluateGroup(groupId: string): Promise<{ added: number; removed: number }> {
    const rulesResult = await this.pool.query<RuleRow>(
      `SELECT id, host_group_id, rule_type, rule_value, priority
       FROM host_group_rules WHERE host_group_id = $1 ORDER BY priority DESC`,
      [groupId]
    );

    const hosts = await this.pool.query<HostRow>(
      `SELECT id, hostname, ip_address, os, environment_tag, scan_target_id, detected_platform
       FROM hosts`
    );

    let added = 0;
    let removed = 0;

    for (const host of hosts.rows) {
      const tagsResult = await this.pool.query<TagRow>(
        `SELECT tag_key, tag_value FROM host_tags WHERE host_id = $1`,
        [host.id]
      );

      let matched = false;
      let matchedRuleId: string | null = null;
      for (const rule of rulesResult.rows) {
        if (this.matchesRule(host, tagsResult.rows, rule)) {
          matched = true;
          matchedRuleId = rule.id;
          break;
        }
      }

      if (matched) {
        const res = await this.pool.query(
          `INSERT INTO host_group_members (host_id, host_group_id, assigned_by, rule_id)
           VALUES ($1, $2, 'rule', $3)
           ON CONFLICT (host_id, host_group_id) DO NOTHING`,
          [host.id, groupId, matchedRuleId]
        );
        if (res.rowCount && res.rowCount > 0) added++;
      } else {
        const res = await this.pool.query(
          `DELETE FROM host_group_members
           WHERE host_id = $1 AND host_group_id = $2 AND assigned_by = 'rule'`,
          [host.id, groupId]
        );
        if (res.rowCount && res.rowCount > 0) removed++;
      }
    }

    this.logger.info({ groupId, added, removed }, "Re-evaluated group memberships");
    return { added, removed };
  }

  /**
   * Count how many hosts would match a specific rule.
   */
  async previewRule(ruleType: string, ruleValue: string): Promise<number> {
    const hosts = await this.pool.query<HostRow>(
      `SELECT id, hostname, ip_address, os, environment_tag, scan_target_id, detected_platform
       FROM hosts`
    );

    let count = 0;
    for (const host of hosts.rows) {
      const tagsResult = await this.pool.query<TagRow>(
        `SELECT tag_key, tag_value FROM host_tags WHERE host_id = $1`,
        [host.id]
      );
      const fakeRule: RuleRow = {
        id: "preview",
        host_group_id: "preview",
        rule_type: ruleType,
        rule_value: ruleValue,
        priority: 0,
      };
      if (this.matchesRule(host, tagsResult.rows, fakeRule)) count++;
    }
    return count;
  }

  // ─── Rule matching ───

  private matchesRule(host: HostRow, tags: TagRow[], rule: RuleRow): boolean {
    const val = rule.rule_value;
    switch (rule.rule_type) {
      case "hostname_contains":
        return !!host.hostname && host.hostname.toLowerCase().includes(val.toLowerCase());

      case "hostname_prefix":
        return !!host.hostname && host.hostname.toLowerCase().startsWith(val.toLowerCase());

      case "hostname_suffix":
        return !!host.hostname && host.hostname.toLowerCase().endsWith(val.toLowerCase());

      case "hostname_regex":
        try {
          return !!host.hostname && new RegExp(val, "i").test(host.hostname);
        } catch {
          return false;
        }

      case "ip_range":
        return !!host.ip_address && this.ipInCidr(host.ip_address, val);

      case "environment_equals":
        return !!host.environment_tag && host.environment_tag.toLowerCase() === val.toLowerCase();

      case "os_contains":
        return !!host.os && host.os.toLowerCase().includes(val.toLowerCase());

      case "scan_target_equals":
        return host.scan_target_id === val;

      case "tag_equals": {
        const [key, ...rest] = val.split("=");
        const tagVal = rest.join("=");
        return tags.some(
          (t) =>
            t.tag_key.toLowerCase() === key.toLowerCase() &&
            (t.tag_value ?? "").toLowerCase() === tagVal.toLowerCase()
        );
      }

      case "detected_platform_equals":
        return !!host.detected_platform && host.detected_platform.toLowerCase() === val.toLowerCase();

      default:
        return false;
    }
  }

  private ipInCidr(ip: string, cidr: string): boolean {
    try {
      const [cidrIp, prefixStr] = cidr.split("/");
      if (!cidrIp) return false;
      const prefix = parseInt(prefixStr ?? "32", 10);
      if (isNaN(prefix) || prefix < 0 || prefix > 32) return false;

      const ipNum = this.ipToNum(ip);
      const cidrNum = this.ipToNum(cidrIp);
      if (ipNum === null || cidrNum === null) return false;

      const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
      return (ipNum & mask) === (cidrNum & mask);
    } catch {
      return false;
    }
  }

  private ipToNum(ip: string): number | null {
    const parts = ip.split(".");
    if (parts.length !== 4) return null;
    let num = 0;
    for (const part of parts) {
      const n = parseInt(part, 10);
      if (isNaN(n) || n < 0 || n > 255) return null;
      num = (num << 8) | n;
    }
    return num >>> 0;
  }
}
