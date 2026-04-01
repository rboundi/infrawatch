import { useState, useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  Server,
  AlertTriangle,
  Radar,
  Check,
  GitCommitHorizontal,
  Hourglass,
  Shield,
  Activity,
  ChevronDown,
  ChevronRight,
  Package as PackageIcon,
  Bell,
  Cpu,
  Plus,
  Minus,
  RefreshCw,
  Settings2,
  ArrowUpDown,
  ServerCrash,
  Globe,
} from "lucide-react";
import {
  useOverviewStats,
  useAlerts,
  useAcknowledgeAlert,
  useChanges,
  useChangeSummary,
  useAlertsSummary,
  useEolAlerts,
  useComplianceFleet,
} from "../api/hooks";
import { SeverityBadge } from "../components/SeverityBadge";
import { CardSkeleton, TableSkeleton } from "../components/Skeleton";
import { timeAgo } from "../components/timeago";
import type { Alert, ChangeEvent } from "../api/types";

// ─── Score classification colors ───

const classColors: Record<string, string> = {
  excellent: "#22c55e",
  good: "#3b82f6",
  fair: "#eab308",
  poor: "#f97316",
  critical: "#ef4444",
};

const classLabel: Record<string, string> = {
  excellent: "Excellent",
  good: "Good",
  fair: "Fair",
  poor: "Poor",
  critical: "Critical",
};

// ─── Change event icon & color mapping ───

const eventIcons: Record<string, { icon: React.ElementType; color: string }> = {
  host_discovered: { icon: Plus, color: "text-green-500" },
  host_disappeared: { icon: ServerCrash, color: "text-red-500" },
  package_added: { icon: Plus, color: "text-blue-500" },
  package_removed: { icon: Minus, color: "text-orange-500" },
  package_updated: { icon: ArrowUpDown, color: "text-indigo-500" },
  service_added: { icon: Plus, color: "text-emerald-500" },
  service_removed: { icon: Minus, color: "text-rose-500" },
  service_changed: { icon: RefreshCw, color: "text-amber-500" },
  os_changed: { icon: Settings2, color: "text-purple-500" },
  ip_changed: { icon: Globe, color: "text-cyan-500" },
  eol_detected: { icon: Hourglass, color: "text-orange-500" },
};

const defaultEventIcon = { icon: GitCommitHorizontal, color: "text-gray-500" };

// ─── Time range helpers ───

type TimeRange = "24h" | "7d" | "30d";

function sinceDate(range: TimeRange): string {
  const d = new Date();
  if (range === "24h") d.setHours(d.getHours() - 24, 0, 0, 0);
  else if (range === "7d") { d.setDate(d.getDate() - 7); d.setHours(0, 0, 0, 0); }
  else { d.setDate(d.getDate() - 30); d.setHours(0, 0, 0, 0); }
  return d.toISOString();
}

// ─── Main Dashboard ───

export function OverviewPage() {
  const navigate = useNavigate();
  const [timeRange, setTimeRange] = useState<TimeRange>("24h");
  const [complianceExpanded, setComplianceExpanded] = useState(false);
  const since = useMemo(() => sinceDate(timeRange), [timeRange]);

  // Data hooks — all fire in parallel
  const stats = useOverviewStats();
  const alertsSummary = useAlertsSummary();
  const compliance = useComplianceFleet();
  const recentAlerts = useAlerts({
    severity: "critical,high",
    acknowledged: "false",
    limit: 10,
    sortBy: "createdAt",
    order: "desc",
  });
  const eolAlerts = useEolAlerts({ status: "active", limit: 5 });
  const changes = useChanges({ limit: 20, page: 1, since });
  const changeSummary = useChangeSummary();
  const ackMutation = useAcknowledgeAlert();

  const handleAck = (alert: Alert) => ackMutation.mutate({ id: alert.id });

  // Derive top 3 most-changed hosts from change data
  const topChangedHosts = useMemo(() => {
    if (!changes.data?.data) return [];
    const counts = new Map<string, { hostname: string; hostId: string | null; count: number }>();
    for (const c of changes.data.data) {
      const key = c.hostname;
      const existing = counts.get(key);
      if (existing) existing.count++;
      else counts.set(key, { hostname: c.hostname, hostId: c.hostId, count: 1 });
    }
    return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 3);
  }, [changes.data]);

  // Health dot for scanner/agent card
  const healthDot = useMemo(() => {
    if (!stats.data) return null;
    const agent = stats.data.agentStatus;
    const hasOverdue = agent && (agent.stale + agent.offline) > 0;
    const noScan = !stats.data.lastScanAt;
    if (hasOverdue || noScan) return "bg-yellow-400";
    return "bg-green-400";
  }, [stats.data]);

  const hasEolData = eolAlerts.data && eolAlerts.data.data.length > 0;
  const hasAlertData = recentAlerts.data && recentAlerts.data.data.length > 0;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
        Dashboard
      </h2>

      {/* ═══ TOP ROW — 4 Metric Cards ═══ */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Fleet Compliance */}
        {compliance.isLoading ? (
          <CardSkeleton />
        ) : compliance.data ? (
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <button
              onClick={() => setComplianceExpanded(!complianceExpanded)}
              className="flex w-full items-start gap-3 text-left"
            >
              {/* SVG circular gauge */}
              <div className="relative flex-shrink-0">
                <svg width="56" height="56" viewBox="0 0 56 56">
                  <circle cx="28" cy="28" r="24" fill="none" stroke="currentColor" strokeWidth="4"
                    className="text-gray-100 dark:text-gray-700" />
                  <circle cx="28" cy="28" r="24" fill="none" strokeWidth="4"
                    stroke={classColors[compliance.data.classification] || "#6b7280"}
                    strokeLinecap="round"
                    strokeDasharray={`${(compliance.data.score / 100) * 150.8} 150.8`}
                    transform="rotate(-90 28 28)" />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-gray-900 dark:text-gray-100">
                  {compliance.data.score}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Fleet Compliance</p>
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium mt-0.5 ${
                  compliance.data.classification === "excellent" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
                  compliance.data.classification === "good" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" :
                  compliance.data.classification === "fair" ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" :
                  compliance.data.classification === "poor" ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" :
                  "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                }`}>
                  {classLabel[compliance.data.classification] || compliance.data.classification}
                </span>
                {/* 30-day sparkline */}
                {compliance.data.trend.length > 1 && (
                  <Sparkline data={compliance.data.trend.slice(-30).map((t) => t.score)} className="mt-2" />
                )}
              </div>
              <ChevronRight className={`mt-1 h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${complianceExpanded ? "rotate-90" : ""}`} />
            </button>

            {/* Expandable breakdown */}
            {complianceExpanded && (
              <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-3 dark:border-gray-700">
                {(["excellent", "good", "fair", "poor", "critical"] as const).map((c) => {
                  const count = compliance.data!.hostDistribution[c];
                  if (count === 0) return null;
                  return (
                    <div key={c} className="flex items-center gap-1">
                      <div className="h-2 w-2 rounded-full" style={{ backgroundColor: classColors[c] }} />
                      <span className="text-xs text-gray-600 dark:text-gray-300">{count} {c}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}

        {/* Card 2: Open Alerts */}
        {alertsSummary.isLoading ? (
          <CardSkeleton />
        ) : alertsSummary.data ? (
          <button
            onClick={() => navigate("/alerts")}
            className="rounded-lg border border-gray-200 bg-white p-5 text-left shadow-sm transition hover:border-indigo-200 hover:shadow dark:border-gray-700 dark:bg-gray-800 dark:hover:border-indigo-800"
          >
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-amber-50 p-2 dark:bg-amber-900/20">
                <Bell className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Open Alerts</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {alertsSummary.data.unacknowledged}
                </p>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {alertsSummary.data.critical > 0 && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-400">
                  {alertsSummary.data.critical} Critical
                </span>
              )}
              {alertsSummary.data.high > 0 && (
                <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-semibold text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                  {alertsSummary.data.high} High
                </span>
              )}
              {alertsSummary.data.medium > 0 && (
                <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-[11px] font-semibold text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                  {alertsSummary.data.medium} Medium
                </span>
              )}
            </div>
          </button>
        ) : (
          <CardSkeleton />
        )}

        {/* Card 3: Infrastructure */}
        {stats.isLoading ? (
          <CardSkeleton />
        ) : stats.data ? (
          <button
            onClick={() => navigate("/hosts")}
            className="rounded-lg border border-gray-200 bg-white p-5 text-left shadow-sm transition hover:border-indigo-200 hover:shadow dark:border-gray-700 dark:bg-gray-800 dark:hover:border-indigo-800"
          >
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-indigo-50 p-2 dark:bg-indigo-900/20">
                <Server className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Infrastructure</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {stats.data.totalHosts} <span className="text-sm font-normal text-gray-500 dark:text-gray-400">Hosts</span>
                </p>
              </div>
              {stats.data.staleHosts > 0 && (
                <AlertTriangle className="ml-auto h-4 w-4 text-amber-500" />
              )}
            </div>
            <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
              {stats.data.activeHosts} active · {stats.data.staleHosts} stale
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {stats.data.totalPackages.toLocaleString()} packages tracked
            </p>
          </button>
        ) : null}

        {/* Card 4: Scanner & Agent Status */}
        {stats.isLoading ? (
          <CardSkeleton />
        ) : stats.data ? (
          <button
            onClick={() => navigate("/setup/targets")}
            className="rounded-lg border border-gray-200 bg-white p-5 text-left shadow-sm transition hover:border-indigo-200 hover:shadow dark:border-gray-700 dark:bg-gray-800 dark:hover:border-indigo-800"
          >
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-purple-50 p-2 dark:bg-purple-900/20">
                <Activity className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Scanner & Agents</p>
              </div>
              {healthDot && <div className={`h-2.5 w-2.5 rounded-full ${healthDot}`} />}
            </div>
            <div className="mt-2 space-y-0.5">
              <p className="text-xs text-gray-600 dark:text-gray-300">
                <Radar className="mr-1 inline h-3 w-3" />
                {stats.data.scanTargets} targets{stats.data.lastScanAt ? `, last scan ${timeAgo(stats.data.lastScanAt)}` : ""}
              </p>
              {stats.data.agentStatus && (
                <p className="text-xs text-gray-600 dark:text-gray-300">
                  <Cpu className="mr-1 inline h-3 w-3" />
                  {stats.data.agentStatus.healthy} reporting
                  {(stats.data.agentStatus.stale + stats.data.agentStatus.offline) > 0 && (
                    <span className="text-amber-600 dark:text-amber-400">
                      , {stats.data.agentStatus.stale + stats.data.agentStatus.offline} overdue
                    </span>
                  )}
                </p>
              )}
            </div>
          </button>
        ) : null}
      </div>

      {/* ═══ MIDDLE — Change Feed ═══ */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Recent Changes
          </h3>
          <div className="flex gap-1">
            {(["24h", "7d", "30d"] as TimeRange[]).map((r) => (
              <button
                key={r}
                onClick={() => setTimeRange(r)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  timeRange === r
                    ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                    : "text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px]">
          {/* Left: change feed list */}
          <div className="border-r-0 lg:border-r border-gray-100 dark:border-gray-700">
            {changes.isLoading ? (
              <div className="p-4"><TableSkeleton rows={8} /></div>
            ) : changes.data && changes.data.data.length > 0 ? (
              <ul className="divide-y divide-gray-50 dark:divide-gray-700/50">
                {changes.data.data.map((event) => (
                  <ChangeRow key={event.id} event={event} />
                ))}
              </ul>
            ) : (
              <div className="px-4 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                No changes in the last {timeRange}.
              </div>
            )}
          </div>

          {/* Right: summary */}
          <div className="border-t border-gray-100 p-4 lg:border-t-0 dark:border-gray-700">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">Summary</p>
            {changeSummary.isLoading ? (
              <TableSkeleton rows={3} />
            ) : changeSummary.data ? (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  {Object.entries(changeSummary.data.byCategory).map(([cat, count]) =>
                    count > 0 ? (
                      <div key={cat} className="flex items-center justify-between text-xs">
                        <span className="capitalize text-gray-600 dark:text-gray-300">{cat}</span>
                        <span className="font-semibold text-gray-900 dark:text-gray-100">{count}</span>
                      </div>
                    ) : null
                  )}
                </div>
                {topChangedHosts.length > 0 && (
                  <>
                    <div className="border-t border-gray-100 pt-3 dark:border-gray-700">
                      <p className="mb-1.5 text-xs font-semibold text-gray-400 dark:text-gray-500">Most Changed</p>
                      {topChangedHosts.map((h) => (
                        <div key={h.hostname} className="flex items-center justify-between py-0.5">
                          {h.hostId ? (
                            <Link to={`/hosts/${h.hostId}`} className="truncate text-xs text-indigo-600 hover:underline dark:text-indigo-400">
                              {h.hostname}
                            </Link>
                          ) : (
                            <span className="truncate text-xs text-gray-600 dark:text-gray-300">{h.hostname}</span>
                          )}
                          <span className="ml-2 text-xs font-semibold text-gray-900 dark:text-gray-100">{h.count}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* ═══ BOTTOM — Attention Required ═══ */}
      <div className={`grid gap-4 ${hasAlertData && hasEolData ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"}`}>
        {/* Critical & High Alerts */}
        {(recentAlerts.isLoading || hasAlertData) && (
          <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Critical & High Alerts
              </h3>
              <Link to="/alerts" className="text-xs font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400">
                View all
              </Link>
            </div>
            {recentAlerts.isLoading ? (
              <div className="p-4"><TableSkeleton rows={5} /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:text-gray-400">
                      <th className="px-4 py-2">Severity</th>
                      <th className="px-4 py-2">Host</th>
                      <th className="px-4 py-2">Package</th>
                      <th className="px-4 py-2">Version</th>
                      <th className="px-4 py-2">Age</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {recentAlerts.data!.data.map((alert) => (
                      <tr key={alert.id} className="text-gray-700 dark:text-gray-300">
                        <td className="px-4 py-2.5"><SeverityBadge severity={alert.severity} /></td>
                        <td className="px-4 py-2.5 font-medium">{alert.hostname ?? "—"}</td>
                        <td className="px-4 py-2.5 font-mono text-xs">{alert.packageName}</td>
                        <td className="px-4 py-2.5 font-mono text-xs">
                          <span className="text-gray-500 dark:text-gray-400">{alert.currentVersion ?? "?"}</span>
                          <span className="mx-1 text-gray-400 dark:text-gray-500">→</span>
                          <span className="text-emerald-700 dark:text-emerald-400">{alert.availableVersion ?? "?"}</span>
                        </td>
                        <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">{timeAgo(alert.createdAt)}</td>
                        <td className="px-4 py-2.5">
                          <button
                            onClick={() => handleAck(alert)}
                            disabled={ackMutation.isPending}
                            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
                            title="Acknowledge"
                          >
                            <Check className="h-3 w-3" /> Ack
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* EOL Warnings */}
        {(eolAlerts.isLoading || hasEolData) && (
          <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                EOL Warnings
              </h3>
              <Link to="/alerts" className="text-xs font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400">
                View all
              </Link>
            </div>
            {eolAlerts.isLoading ? (
              <div className="p-4"><TableSkeleton rows={3} /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:text-gray-400">
                      <th className="px-4 py-2">Product</th>
                      <th className="px-4 py-2">Version</th>
                      <th className="px-4 py-2">EOL Date</th>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-4 py-2">Host</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {eolAlerts.data!.data.map((eol) => (
                      <tr key={eol.id} className="text-gray-700 dark:text-gray-300">
                        <td className="px-4 py-2.5 font-medium">{eol.productName}</td>
                        <td className="px-4 py-2.5 font-mono text-xs">{eol.installedVersion}</td>
                        <td className="px-4 py-2.5 text-xs">{new Date(eol.eolDate).toLocaleDateString()}</td>
                        <td className="px-4 py-2.5">
                          {eol.daysPastEol > 0 ? (
                            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-400">
                              {eol.daysPastEol}d overdue
                            </span>
                          ) : (
                            <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-[11px] font-semibold text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                              {Math.abs(eol.daysPastEol)}d remaining
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <Link to={`/hosts/${eol.hostId}`} className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
                            {eol.hostname}
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ───

function ChangeRow({ event }: { event: ChangeEvent }) {
  const { icon: Icon, color } = eventIcons[event.eventType] || defaultEventIcon;
  return (
    <li className="flex items-center gap-3 px-4 py-2">
      <Icon className={`h-4 w-4 flex-shrink-0 ${color}`} />
      <span className="min-w-0 flex-1 truncate text-sm text-gray-700 dark:text-gray-300">
        {event.summary}
      </span>
      {event.hostId && (
        <Link to={`/hosts/${event.hostId}`} className="hidden sm:block flex-shrink-0 truncate text-xs text-indigo-600 hover:underline dark:text-indigo-400 max-w-[120px]">
          {event.hostname}
        </Link>
      )}
      <span className="flex-shrink-0 whitespace-nowrap text-xs text-gray-400 dark:text-gray-500">
        {timeAgo(event.createdAt)}
      </span>
    </li>
  );
}

function Sparkline({ data, className = "" }: { data: number[]; className?: string }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const h = 20;
  const w = 80;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`).join(" ");
  return (
    <svg width={w} height={h} className={className}>
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-indigo-400 dark:text-indigo-500"
      />
    </svg>
  );
}
