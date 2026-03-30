import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { Shield, RefreshCw, TrendingUp, TrendingDown, Minus, ChevronDown } from "lucide-react";
import {
  useComplianceFleet,
  useComplianceHosts,
  useComplianceGroups,
  useComplianceEnvironments,
  useComplianceTrend,
  useRecalculateCompliance,
} from "../api/hooks";
import { CardSkeleton, TableSkeleton } from "../components/Skeleton";
import type { ComplianceHostScore, ComplianceScoreBreakdown } from "../api/types";

type Tab = "groups" | "environments";

const CLASS_COLORS: Record<string, string> = {
  excellent: "text-green-700 bg-green-100 dark:text-green-400 dark:bg-green-900/30",
  good: "text-blue-700 bg-blue-100 dark:text-blue-400 dark:bg-blue-900/30",
  fair: "text-yellow-700 bg-yellow-100 dark:text-yellow-400 dark:bg-yellow-900/30",
  poor: "text-orange-700 bg-orange-100 dark:text-orange-400 dark:bg-orange-900/30",
  critical: "text-red-700 bg-red-100 dark:text-red-400 dark:bg-red-900/30",
};

const SCORE_COLORS: Record<string, string> = {
  excellent: "#22c55e",
  good: "#3b82f6",
  fair: "#eab308",
  poor: "#f97316",
  critical: "#ef4444",
};

function classifyScore(score: number): string {
  if (score >= 90) return "excellent";
  if (score >= 70) return "good";
  if (score >= 50) return "fair";
  if (score >= 30) return "poor";
  return "critical";
}

export function CompliancePage() {
  const fleet = useComplianceFleet();
  const trend = useComplianceTrend({ entityType: "fleet", days: 90 });
  const recalc = useRecalculateCompliance();
  const [tab, setTab] = useState<Tab>("groups");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Compliance
          </h2>
        </div>
        <button
          onClick={() => recalc.mutate()}
          disabled={recalc.isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${recalc.isPending ? "animate-spin" : ""}`} />
          Recalculate
        </button>
      </div>

      {/* Top: Fleet gauge + Trend + Distribution */}
      {fleet.isLoading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : fleet.data ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Fleet Score Gauge */}
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Fleet Compliance Score</p>
            <div className="mt-3 flex items-center justify-center">
              <ScoreGauge score={fleet.data.score} size={140} />
            </div>
            <div className="mt-3 text-center">
              <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${CLASS_COLORS[fleet.data.classification] ?? CLASS_COLORS.critical}`}>
                {fleet.data.classification}
              </span>
            </div>
          </div>

          {/* 90-day Trend */}
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">90-Day Trend</p>
            <div className="mt-3">
              {trend.data && trend.data.length > 1 ? (
                <TrendChart data={trend.data} />
              ) : (
                <div className="flex h-[140px] items-center justify-center text-xs text-gray-400 dark:text-gray-500">
                  Not enough data for trend
                </div>
              )}
            </div>
          </div>

          {/* Host Distribution */}
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Host Distribution</p>
            <DistributionBar distribution={fleet.data.hostDistribution} />
            <div className="mt-4 space-y-2">
              {(["excellent", "good", "fair", "poor", "critical"] as const).map((c) => (
                <div key={c} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: SCORE_COLORS[c] }} />
                    <span className="capitalize text-gray-600 dark:text-gray-400">{c}</span>
                  </div>
                  <span className="font-medium text-gray-900 dark:text-gray-100">
                    {fleet.data!.hostDistribution[c]}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {/* Tabs: By Group | By Environment */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center gap-4 border-b border-gray-200 px-4 dark:border-gray-700">
          {(["groups", "environments"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
                tab === t
                  ? "border-indigo-600 text-indigo-700 dark:border-indigo-400 dark:text-indigo-300"
                  : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              }`}
            >
              By {t === "groups" ? "Group" : "Environment"}
            </button>
          ))}
        </div>
        {tab === "groups" ? <GroupScoresTable /> : <EnvironmentScoresTable />}
      </div>

      {/* Worst hosts */}
      <WorstHostsTable />
    </div>
  );
}

// ─── Score Gauge (SVG circle) ───

function ScoreGauge({ score, size = 120 }: { score: number; size?: number }) {
  const radius = (size - 16) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = SCORE_COLORS[classifyScore(score)] ?? SCORE_COLORS.critical;

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        className="text-gray-100 dark:text-gray-700"
        strokeWidth={8}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={8}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        className="transition-all duration-1000"
      />
      <text
        x={size / 2}
        y={size / 2}
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-gray-900 dark:fill-gray-100"
        style={{ transform: "rotate(90deg)", transformOrigin: "center", fontSize: size * 0.28, fontWeight: 700 }}
      >
        {score}
      </text>
    </svg>
  );
}

// ─── Trend Chart (canvas sparkline) ───

function TrendChart({ data }: { data: Array<{ date: string; score: number }> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length < 2) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const padding = 4;
    const isDark = document.documentElement.classList.contains("dark");

    ctx.clearRect(0, 0, w, h);

    const scores = data.map((d) => d.score);
    const min = Math.max(Math.min(...scores) - 5, 0);
    const max = Math.min(Math.max(...scores) + 5, 100);
    const range = max - min || 1;

    // Draw line
    ctx.beginPath();
    ctx.strokeStyle = "#6366f1";
    ctx.lineWidth = 2;
    data.forEach((d, i) => {
      const x = padding + (i / (data.length - 1)) * (w - padding * 2);
      const y = h - padding - ((d.score - min) / range) * (h - padding * 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Fill area
    const lastX = padding + ((data.length - 1) / (data.length - 1)) * (w - padding * 2);
    ctx.lineTo(lastX, h - padding);
    ctx.lineTo(padding, h - padding);
    ctx.closePath();
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, isDark ? "rgba(99,102,241,0.3)" : "rgba(99,102,241,0.15)");
    gradient.addColorStop(1, "rgba(99,102,241,0)");
    ctx.fillStyle = gradient;
    ctx.fill();

    // Latest score dot
    const latestY = h - padding - ((scores[scores.length - 1] - min) / range) * (h - padding * 2);
    ctx.beginPath();
    ctx.arc(lastX, latestY, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#6366f1";
    ctx.fill();
  }, [data]);

  return <canvas ref={canvasRef} width={400} height={140} className="w-full" style={{ height: 140 }} />;
}

// ─── Distribution Bar ───

function DistributionBar({ distribution }: { distribution: Record<string, number> }) {
  const total = Object.values(distribution).reduce((a, b) => a + b, 0);
  if (total === 0) {
    return <div className="mt-3 h-4 rounded-full bg-gray-100 dark:bg-gray-700" />;
  }

  return (
    <div className="mt-3 flex h-4 overflow-hidden rounded-full">
      {(["excellent", "good", "fair", "poor", "critical"] as const).map((c) => {
        const pct = (distribution[c] / total) * 100;
        if (pct === 0) return null;
        return (
          <div
            key={c}
            style={{ width: `${pct}%`, backgroundColor: SCORE_COLORS[c] }}
            className="transition-all duration-500"
            title={`${c}: ${distribution[c]} (${Math.round(pct)}%)`}
          />
        );
      })}
    </div>
  );
}

// ─── Group Scores Table ───

function GroupScoresTable() {
  const { data, isLoading } = useComplianceGroups();

  if (isLoading) return <div className="p-4"><TableSkeleton rows={4} /></div>;
  if (!data || data.length === 0) {
    return <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">No group scores available.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:text-gray-400">
            <th className="px-4 py-2">Group</th>
            <th className="px-4 py-2">Score</th>
            <th className="px-4 py-2">Classification</th>
            <th className="px-4 py-2">Hosts</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {data.map((g) => (
            <tr key={g.groupId} className="text-gray-700 dark:text-gray-300">
              <td className="px-4 py-2.5 font-medium">
                <Link to={`/groups/${g.groupId}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                  {g.name}
                </Link>
              </td>
              <td className="px-4 py-2.5">
                <span className="text-lg font-bold" style={{ color: SCORE_COLORS[g.classification] ?? SCORE_COLORS.critical }}>
                  {g.score}
                </span>
              </td>
              <td className="px-4 py-2.5">
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${CLASS_COLORS[g.classification] ?? CLASS_COLORS.critical}`}>
                  {g.classification}
                </span>
              </td>
              <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">{g.hostCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Environment Scores Table ───

function EnvironmentScoresTable() {
  const { data, isLoading } = useComplianceEnvironments();

  if (isLoading) return <div className="p-4"><TableSkeleton rows={3} /></div>;
  if (!data || data.length === 0) {
    return <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">No environment scores available.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:text-gray-400">
            <th className="px-4 py-2">Environment</th>
            <th className="px-4 py-2">Score</th>
            <th className="px-4 py-2">Classification</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {data.map((e) => (
            <tr key={e.name} className="text-gray-700 dark:text-gray-300">
              <td className="px-4 py-2.5 font-medium">{e.name}</td>
              <td className="px-4 py-2.5">
                <span className="text-lg font-bold" style={{ color: SCORE_COLORS[e.classification] ?? SCORE_COLORS.critical }}>
                  {e.score}
                </span>
              </td>
              <td className="px-4 py-2.5">
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${CLASS_COLORS[e.classification] ?? CLASS_COLORS.critical}`}>
                  {e.classification}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Worst Hosts Table ───

function WorstHostsTable() {
  const { data, isLoading } = useComplianceHosts({ limit: 20 });

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Worst Scoring Hosts
        </h3>
      </div>

      {isLoading ? (
        <div className="p-4"><TableSkeleton rows={6} /></div>
      ) : data && data.data.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:text-gray-400">
                <th className="px-4 py-2">Host</th>
                <th className="px-4 py-2">Score</th>
                <th className="px-4 py-2">Classification</th>
                <th className="px-4 py-2">Worst Factor</th>
                <th className="px-4 py-2">Top Issues</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {data.data.map((host) => (
                <HostScoreRow key={host.hostId} host={host} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
          No compliance scores calculated yet.
        </div>
      )}
    </div>
  );
}

function HostScoreRow({ host }: { host: ComplianceHostScore }) {
  const [expanded, setExpanded] = useState(false);
  const breakdown = host.breakdown;
  const worstFactor = getWorstFactor(breakdown);
  const issues = getTopIssues(breakdown);

  return (
    <>
      <tr className="text-gray-700 dark:text-gray-300">
        <td className="px-4 py-2.5 font-medium">
          <Link to={`/hosts/${host.hostId}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
            {host.hostname}
          </Link>
        </td>
        <td className="px-4 py-2.5">
          <span className="text-lg font-bold" style={{ color: SCORE_COLORS[host.classification] ?? SCORE_COLORS.critical }}>
            {host.score}
          </span>
        </td>
        <td className="px-4 py-2.5">
          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${CLASS_COLORS[host.classification] ?? CLASS_COLORS.critical}`}>
            {host.classification}
          </span>
        </td>
        <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400">{worstFactor}</td>
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">{issues}</span>
            <button onClick={() => setExpanded(!expanded)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={5} className="bg-gray-50 px-4 py-3 dark:bg-gray-900/50">
            <BreakdownDetail breakdown={breakdown} />
          </td>
        </tr>
      )}
    </>
  );
}

function BreakdownDetail({ breakdown }: { breakdown: ComplianceScoreBreakdown }) {
  const factors = [
    { label: "Package Currency", ...breakdown.packageCurrency, detail: `${breakdown.packageCurrency.upToDate}/${breakdown.packageCurrency.total} up to date` },
    { label: "EOL Status", ...breakdown.eolStatus, detail: breakdown.eolStatus.activeEolAlerts > 0 ? `${breakdown.eolStatus.activeEolAlerts} active EOL alert(s)` : "No EOL issues" },
    { label: "Alert Resolution", ...breakdown.alertResolution, detail: `${breakdown.alertResolution.acknowledged}/${breakdown.alertResolution.total} critical/high acknowledged` },
    { label: "Scan Freshness", ...breakdown.scanFreshness, detail: breakdown.scanFreshness.lastSeenAt ? `Last seen: ${new Date(breakdown.scanFreshness.lastSeenAt).toLocaleDateString()}` : "Never scanned" },
    { label: "Service Health", ...breakdown.serviceHealth, detail: `${breakdown.serviceHealth.running}/${breakdown.serviceHealth.total} running` },
  ];

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
      {factors.map((f) => {
        const pct = f.maxScore > 0 ? (f.score / f.maxScore) * 100 : 100;
        const hint = pct < 50 ? getImprovementHint(f.label, breakdown) : null;
        return (
          <div key={f.label} className="rounded border border-gray-200 p-2 dark:border-gray-700">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-gray-700 dark:text-gray-300">{f.label}</span>
              <span className="font-bold" style={{ color: SCORE_COLORS[classifyScore(pct)] }}>
                {f.score}/{f.maxScore}
              </span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700">
              <div
                className="h-1.5 rounded-full transition-all"
                style={{ width: `${pct}%`, backgroundColor: SCORE_COLORS[classifyScore(pct)] }}
              />
            </div>
            <p className="mt-1 text-[10px] text-gray-500 dark:text-gray-400">{f.detail}</p>
            {hint && <p className="mt-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">{hint}</p>}
          </div>
        );
      })}
    </div>
  );
}

// ─── Helpers ───

function getWorstFactor(b: ComplianceScoreBreakdown): string {
  const factors = [
    { name: "Packages", ratio: b.packageCurrency.maxScore > 0 ? b.packageCurrency.score / b.packageCurrency.maxScore : 1 },
    { name: "EOL", ratio: b.eolStatus.maxScore > 0 ? b.eolStatus.score / b.eolStatus.maxScore : 1 },
    { name: "Alerts", ratio: b.alertResolution.maxScore > 0 ? b.alertResolution.score / b.alertResolution.maxScore : 1 },
    { name: "Scan", ratio: b.scanFreshness.maxScore > 0 ? b.scanFreshness.score / b.scanFreshness.maxScore : 1 },
    { name: "Services", ratio: b.serviceHealth.maxScore > 0 ? b.serviceHealth.score / b.serviceHealth.maxScore : 1 },
  ];
  factors.sort((a, b) => a.ratio - b.ratio);
  return factors[0].name;
}

function getTopIssues(b: ComplianceScoreBreakdown): string {
  const issues: string[] = [];
  if (b.eolStatus.activeEolAlerts > 0) issues.push(`${b.eolStatus.activeEolAlerts} EOL`);
  const unackAlerts = b.alertResolution.total - b.alertResolution.acknowledged;
  if (unackAlerts > 0) issues.push(`${unackAlerts} unresolved critical/high`);
  const outdated = b.packageCurrency.total - b.packageCurrency.upToDate;
  if (outdated > 0) issues.push(`${outdated} outdated pkg`);
  return issues.length > 0 ? issues.join(", ") : "No major issues";
}

function getImprovementHint(factor: string, b: ComplianceScoreBreakdown): string | null {
  switch (factor) {
    case "Package Currency": return `Update ${b.packageCurrency.total - b.packageCurrency.upToDate} outdated package(s) to improve`;
    case "EOL Status": return `Address ${b.eolStatus.activeEolAlerts} EOL alert(s) to improve`;
    case "Alert Resolution": return `Acknowledge ${b.alertResolution.total - b.alertResolution.acknowledged} critical/high alert(s) to improve`;
    case "Scan Freshness": return "Run a scan to update freshness score";
    case "Service Health": return `${b.serviceHealth.total - b.serviceHealth.running} service(s) not running`;
    default: return null;
  }
}
