import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Search,
  ShieldAlert,
  Hourglass,
  Check,
  Shield,
  ChevronLeft,
  ChevronRight,
  Wrench,
  Circle,
} from "lucide-react";
import {
  useUnifiedAlerts,
  useUnifiedAlertsSummary,
  useAcknowledgeAlert,
  useAcknowledgeEolAlert,
  useExemptEolAlert,
  useAlertRemediation,
} from "../api/hooks";
import { RemediationInlinePanel } from "../components/RemediationPanel";
import { SeverityBadge } from "../components/SeverityBadge";
import { TableSkeleton } from "../components/Skeleton";
import { timeAgo } from "../components/timeago";
import type { UnifiedAlert, UnifiedAlertsParams } from "../api/types";

type Category = "all" | "vulnerability" | "eol";
type StatusFilter = "unacknowledged" | "acknowledged" | "all";
type Severity = "all" | "critical" | "high" | "medium" | "low" | "info";

const SEVERITY_OPTIONS: Severity[] = ["all", "critical", "high", "medium", "low", "info"];
const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "unacknowledged", label: "Open" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "all", label: "All" },
];

export function AlertsPage() {
  const [category, setCategory] = useState<Category>("all");
  const [severity, setSeverity] = useState<Severity>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("unacknowledged");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [exemptId, setExemptId] = useState<string | null>(null);
  const [exemptReason, setExemptReason] = useState("");

  const summary = useUnifiedAlertsSummary();
  const ackVuln = useAcknowledgeAlert();
  const ackEol = useAcknowledgeEolAlert();
  const exemptEol = useExemptEolAlert();

  const params: UnifiedAlertsParams = useMemo(() => {
    const p: UnifiedAlertsParams = { page, limit: 30, status: statusFilter };
    if (category !== "all") p.type = category;
    if (severity !== "all") p.severity = severity;
    if (search) p.search = search;
    return p;
  }, [category, severity, statusFilter, search, page]);

  const { data, isLoading } = useUnifiedAlerts(params);

  const handleAcknowledge = (alert: UnifiedAlert) => {
    if (alert.type === "vulnerability") {
      ackVuln.mutate({ id: alert.id });
    } else {
      ackEol.mutate({ id: alert.id });
    }
  };

  const handleExempt = () => {
    if (!exemptId || !exemptReason.trim()) return;
    exemptEol.mutate({ id: exemptId, exemptionReason: exemptReason.trim() }, {
      onSuccess: () => { setExemptId(null); setExemptReason(""); },
    });
  };

  const formatIssue = (a: UnifiedAlert) => {
    if (a.type === "vulnerability") {
      return (
        <span className="font-mono text-xs">
          {a.packageName}{" "}
          <span className="text-gray-500 dark:text-gray-400">{a.currentVersion ?? "?"}</span>
          <span className="mx-1 text-gray-400">→</span>
          <span className="text-emerald-700 dark:text-emerald-400">{a.availableVersion ?? "?"}</span>
        </span>
      );
    }
    return (
      <span className="text-xs">
        <span className="font-medium">{a.productName}</span>{" "}
        <span className="font-mono text-gray-500 dark:text-gray-400">{a.currentVersion}</span>
        <span className="mx-1 text-gray-400">—</span>
        <span className="text-orange-600 dark:text-orange-400">
          EOL {a.eolDate ? new Date(a.eolDate).toLocaleDateString() : "?"}
        </span>
      </span>
    );
  };

  const StatusIcon = ({ alert }: { alert: UnifiedAlert }) => {
    if (alert.status === "exempted") return <Shield className="h-3.5 w-3.5 text-purple-500" />;
    if (alert.acknowledged) return <Check className="h-3.5 w-3.5 text-green-500" />;
    return <Circle className="h-3 w-3 fill-current text-yellow-500" />;
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Alerts</h2>

      {/* ═══ SUMMARY BAR ═══ */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Severity pills */}
        <div className="flex gap-1">
          {SEVERITY_OPTIONS.map((s) => {
            const count = s === "all"
              ? summary.data?.total
              : summary.data?.bySeverity[s as keyof typeof summary.data.bySeverity];
            return (
              <button
                key={s}
                onClick={() => { setSeverity(s); setPage(1); }}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  severity === s
                    ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                    : "text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
                }`}
              >
                {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
                {count !== undefined && <span className="ml-1 opacity-70">{count}</span>}
              </button>
            );
          })}
        </div>

        <div className="h-4 w-px bg-gray-200 dark:bg-gray-700" />

        {/* Category toggle */}
        <div className="flex gap-1">
          {(
            [
              { value: "all", label: "All", count: summary.data?.total },
              { value: "vulnerability", label: "Vulnerabilities", count: summary.data?.byType.vulnerability },
              { value: "eol", label: "EOL", count: summary.data?.byType.eol },
            ] as const
          ).map((c) => (
            <button
              key={c.value}
              onClick={() => { setCategory(c.value); setPage(1); }}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                category === c.value
                  ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                  : "text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
              }`}
            >
              {c.label}
              {c.count !== undefined && <span className="ml-1 opacity-70">{c.count}</span>}
            </button>
          ))}
        </div>

        {summary.data && (
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {summary.data.unacknowledged} unacknowledged
          </span>
        )}
      </div>

      {/* ═══ FILTER BAR ═══ */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search package or hostname..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
          />
        </div>

        <div className="flex rounded-md border border-gray-300 dark:border-gray-600">
          {STATUS_OPTIONS.map((s) => (
            <button
              key={s.value}
              onClick={() => { setStatusFilter(s.value); setPage(1); }}
              className={`px-3 py-1.5 text-xs font-medium transition first:rounded-l-md last:rounded-r-md ${
                statusFilter === s.value
                  ? "bg-indigo-600 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* ═══ TABLE ═══ */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
        {isLoading ? (
          <div className="p-4"><TableSkeleton rows={10} /></div>
        ) : data && data.data.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:text-gray-400">
                    <th className="w-8 px-4 py-2.5"></th>
                    <th className="px-4 py-2.5">Severity</th>
                    <th className="px-4 py-2.5">Host</th>
                    <th className="px-4 py-2.5">Issue</th>
                    <th className="px-4 py-2.5">Age</th>
                    <th className="w-8 px-4 py-2.5"></th>
                    <th className="px-4 py-2.5">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {data.data.map((alert) => (
                    <AlertRow
                      key={`${alert.type}-${alert.id}`}
                      alert={alert}
                      expanded={expandedId === alert.id}
                      onToggleExpand={() => setExpandedId(expandedId === alert.id ? null : alert.id)}
                      onAcknowledge={() => handleAcknowledge(alert)}
                      onExempt={() => { setExemptId(alert.id); setExemptReason(""); }}
                      formatIssue={formatIssue}
                      StatusIcon={StatusIcon}
                      ackPending={ackVuln.isPending || ackEol.isPending}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {data.totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 dark:border-gray-700">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Showing {(data.page - 1) * 30 + 1}–{Math.min(data.page * 30, data.total)} of {data.total}
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage(Math.max(1, page - 1))}
                    disabled={page <= 1}
                    className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:text-gray-400 dark:hover:bg-gray-700"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="px-2 text-xs text-gray-600 dark:text-gray-400">
                    {data.page} / {data.totalPages}
                  </span>
                  <button
                    onClick={() => setPage(Math.min(data.totalPages, page + 1))}
                    disabled={page >= data.totalPages}
                    className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:text-gray-400 dark:hover:bg-gray-700"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="px-4 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
            No alerts found.
          </div>
        )}
      </div>

      {/* Exempt modal */}
      {exemptId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Exempt EOL Alert</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Provide a reason for exempting this alert.
            </p>
            <textarea
              value={exemptReason}
              onChange={(e) => setExemptReason(e.target.value)}
              placeholder="Exemption reason..."
              className="mt-3 w-full rounded-md border border-gray-300 bg-white p-3 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              rows={3}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setExemptId(null)}
                className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={handleExempt}
                disabled={!exemptReason.trim() || exemptEol.isPending}
                className="rounded-md bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
              >
                {exemptEol.isPending ? "Exempting..." : "Exempt"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Alert Row ───

function AlertRow({
  alert,
  expanded,
  onToggleExpand,
  onAcknowledge,
  onExempt,
  formatIssue,
  StatusIcon,
  ackPending,
}: {
  alert: UnifiedAlert;
  expanded: boolean;
  onToggleExpand: () => void;
  onAcknowledge: () => void;
  onExempt: () => void;
  formatIssue: (a: UnifiedAlert) => React.ReactNode;
  StatusIcon: React.ComponentType<{ alert: UnifiedAlert }>;
  ackPending: boolean;
}) {
  const remediation = useAlertRemediation(expanded && alert.type === "vulnerability" ? alert.id : null);

  return (
    <>
      <tr className="text-gray-700 dark:text-gray-300">
        <td className="px-4 py-2.5">
          {alert.type === "vulnerability" ? (
            <ShieldAlert className="h-4 w-4 text-red-400" />
          ) : (
            <Hourglass className="h-4 w-4 text-orange-400" />
          )}
        </td>
        <td className="px-4 py-2.5">
          <SeverityBadge severity={alert.severity} />
        </td>
        <td className="px-4 py-2.5">
          <Link
            to={`/hosts/${alert.hostId}`}
            className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
            onClick={(e) => e.stopPropagation()}
          >
            {alert.hostname}
          </Link>
        </td>
        <td className="px-4 py-2.5">{formatIssue(alert)}</td>
        <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400">
          {timeAgo(alert.createdAt)}
        </td>
        <td className="px-4 py-2.5">
          <StatusIcon alert={alert} />
        </td>
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-1">
            {!alert.acknowledged && (
              <button
                onClick={onAcknowledge}
                disabled={ackPending}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
                title="Acknowledge"
              >
                <Check className="h-3 w-3" /> Ack
              </button>
            )}
            {alert.type === "vulnerability" && (
              <button
                onClick={onToggleExpand}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/20"
                title="Show remediation"
              >
                <Wrench className="h-3 w-3" /> Fix
              </button>
            )}
            {alert.type === "eol" && !alert.acknowledged && alert.status !== "exempted" && (
              <button
                onClick={onExempt}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-purple-600 hover:bg-purple-50 dark:text-purple-400 dark:hover:bg-purple-900/20"
                title="Exempt"
              >
                <Shield className="h-3 w-3" /> Exempt
              </button>
            )}
          </div>
        </td>
      </tr>
      {expanded && alert.type === "vulnerability" && (
        <tr>
          <td colSpan={7} className="bg-gray-50 px-4 py-3 dark:bg-gray-900/50">
            <RemediationInlinePanel data={remediation.data} isLoading={remediation.isLoading} />
          </td>
        </tr>
      )}
    </>
  );
}
