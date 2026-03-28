import { useState } from "react";
import {
  Hourglass,
  AlertTriangle,
  Clock,
  CheckCircle,
  Search,
  ChevronLeft,
  ChevronRight,
  Check,
  ShieldOff,
  ExternalLink,
} from "lucide-react";
import {
  useEolAlerts,
  useEolAlertsSummary,
  useAcknowledgeEolAlert,
  useExemptEolAlert,
} from "../api/hooks";
import { CardSkeleton, TableSkeleton } from "../components/Skeleton";
import type { EolAlertsParams, EolAlert } from "../api/types";

const DAYS_RANGE_OPTIONS = [
  { value: "", label: "All" },
  { value: "past", label: "Past EOL" },
  { value: "upcoming", label: "Upcoming" },
];

function rowTint(daysPastEol: number): string {
  if (daysPastEol > 0) return "bg-red-50/50 dark:bg-red-900/10";
  if (daysPastEol >= -90) return "bg-orange-50/50 dark:bg-orange-900/10";
  return "";
}

function eolBadge(daysPastEol: number): { text: string; className: string } {
  if (daysPastEol > 0) {
    return {
      text: `${daysPastEol}d past EOL`,
      className: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
    };
  }
  const daysUntil = Math.abs(daysPastEol);
  if (daysUntil <= 90) {
    return {
      text: `${daysUntil}d until EOL`,
      className: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
    };
  }
  return {
    text: `${daysUntil}d until EOL`,
    className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  };
}

function statusBadge(status: string): { text: string; className: string } {
  switch (status) {
    case "acknowledged":
      return { text: "Acknowledged", className: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" };
    case "exempted":
      return { text: "Exempted", className: "bg-gray-100 text-gray-700 dark:bg-gray-700/40 dark:text-gray-300" };
    case "resolved":
      return { text: "Resolved", className: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300" };
    default:
      return { text: "Active", className: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" };
  }
}

export function EolPage() {
  const [params, setParams] = useState<EolAlertsParams>({ page: 1, limit: 30 });
  const [search, setSearch] = useState("");
  const [exemptModal, setExemptModal] = useState<{ id: string } | null>(null);
  const [exemptReason, setExemptReason] = useState("");

  const alerts = useEolAlerts(params);
  const summary = useEolAlertsSummary();
  const ackMutation = useAcknowledgeEolAlert();
  const exemptMutation = useExemptEolAlert();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setParams((p) => ({ ...p, search: search || undefined, page: 1 }));
  };

  const handleAck = (alert: EolAlert) => {
    ackMutation.mutate({ id: alert.id });
  };

  const handleExempt = () => {
    if (!exemptModal || !exemptReason.trim()) return;
    exemptMutation.mutate(
      { id: exemptModal.id, exemptionReason: exemptReason.trim() },
      { onSuccess: () => { setExemptModal(null); setExemptReason(""); } }
    );
  };

  const setPage = (page: number) => setParams((p) => ({ ...p, page }));

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
        EOL Tracker
      </h2>

      {/* Summary cards */}
      {summary.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)}
        </div>
      ) : summary.data ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            icon={AlertTriangle}
            label="Past EOL"
            value={summary.data.pastEol}
            iconColor="text-red-600 dark:text-red-400"
            bgColor="border-red-200 dark:border-red-800"
          />
          <SummaryCard
            icon={Clock}
            label="Within 90 Days"
            value={summary.data.upcomingEol}
            iconColor="text-orange-600 dark:text-orange-400"
            bgColor="border-orange-200 dark:border-orange-800"
          />
          <SummaryCard
            icon={Hourglass}
            label="Within 6 Months"
            value={summary.data.within6Months}
            iconColor="text-yellow-600 dark:text-yellow-400"
            bgColor="border-yellow-200 dark:border-yellow-800"
          />
          <SummaryCard
            icon={CheckCircle}
            label="Total Active"
            value={summary.data.totalActive}
            iconColor="text-gray-600 dark:text-gray-400"
          />
        </div>
      ) : null}

      {/* Category donut breakdown */}
      {summary.data && summary.data.byCategory.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
              By Category
            </h3>
            <div className="flex flex-wrap gap-3">
              {summary.data.byCategory.map((c) => (
                <div key={c.category} className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-700">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300 capitalize">
                    {c.category}
                  </span>
                  <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-bold text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300">
                    {c.count}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
              Most Affected Hosts
            </h3>
            {summary.data.mostAffectedHosts.length > 0 ? (
              <div className="space-y-2">
                {summary.data.mostAffectedHosts.slice(0, 5).map((h) => (
                  <div key={h.id} className="flex items-center justify-between text-sm">
                    <a
                      href={`/hosts/${h.id}`}
                      className="font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
                    >
                      {h.hostname}
                    </a>
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-800 dark:bg-red-900/40 dark:text-red-300">
                      {h.eolCount} EOL
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">No affected hosts.</p>
            )}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search product or host..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-md border border-gray-300 bg-white py-1.5 pl-9 pr-3 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-500"
            />
          </div>
          <button
            type="submit"
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Search
          </button>
        </form>

        <select
          value={params.daysRange ?? ""}
          onChange={(e) =>
            setParams((p) => ({ ...p, daysRange: e.target.value || undefined, page: 1 }))
          }
          className="rounded-md border border-gray-300 bg-white py-1.5 px-3 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
        >
          {DAYS_RANGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <select
          value={params.status ?? ""}
          onChange={(e) =>
            setParams((p) => ({ ...p, status: e.target.value || undefined, page: 1 }))
          }
          className="rounded-md border border-gray-300 bg-white py-1.5 px-3 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
        >
          <option value="">Active (default)</option>
          <option value="active">Active</option>
          <option value="acknowledged">Acknowledged</option>
          <option value="exempted">Exempted</option>
          <option value="resolved">Resolved</option>
          <option value="active,acknowledged,exempted,resolved">All Statuses</option>
        </select>
      </div>

      {/* Alerts table */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
        {alerts.isLoading ? (
          <div className="p-4"><TableSkeleton rows={10} /></div>
        ) : alerts.data && alerts.data.data.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:text-gray-400">
                    <th className="px-4 py-2">Product</th>
                    <th className="px-4 py-2">Version</th>
                    <th className="px-4 py-2">EOL Date</th>
                    <th className="px-4 py-2">Days</th>
                    <th className="px-4 py-2">Host</th>
                    <th className="px-4 py-2">Successor</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {alerts.data.data.map((alert) => {
                    const badge = eolBadge(alert.daysPastEol);
                    const sBadge = statusBadge(alert.status);

                    return (
                      <tr key={alert.id} className={`text-gray-700 dark:text-gray-300 ${rowTint(alert.daysPastEol)}`}>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{alert.productName}</span>
                            {alert.sourceUrl && (
                              <a
                                href={alert.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-gray-400 hover:text-indigo-500"
                                title="EOL source"
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                          <span className="text-xs text-gray-500 dark:text-gray-400 capitalize">
                            {alert.productCategory}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs">{alert.installedVersion}</td>
                        <td className="px-4 py-2.5 text-xs">
                          {new Date(alert.eolDate).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${badge.className}`}>
                            {badge.text}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <a
                            href={`/hosts/${alert.hostId}`}
                            className="font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
                          >
                            {alert.hostname}
                          </a>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-emerald-700 dark:text-emerald-400">
                          {alert.successorVersion ?? "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${sBadge.className}`}>
                            {sBadge.text}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          {alert.status === "active" && (
                            <div className="flex gap-1">
                              <button
                                onClick={() => handleAck(alert)}
                                disabled={ackMutation.isPending}
                                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
                                title="Acknowledge"
                              >
                                <Check className="h-3 w-3" />
                                Ack
                              </button>
                              <button
                                onClick={() => { setExemptModal({ id: alert.id }); setExemptReason(""); }}
                                className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
                                title="Exempt"
                              >
                                <ShieldOff className="h-3 w-3" />
                                Exempt
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {alerts.data.totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 dark:border-gray-700">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Page {alerts.data.page} of {alerts.data.totalPages} ({alerts.data.total} alerts)
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage(alerts.data!.page - 1)}
                    disabled={alerts.data.page <= 1}
                    className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
                  >
                    <ChevronLeft className="h-4 w-4" /> Prev
                  </button>
                  <button
                    onClick={() => setPage(alerts.data!.page + 1)}
                    disabled={alerts.data.page >= alerts.data.totalPages}
                    className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
                  >
                    Next <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No EOL alerts found. Your infrastructure looks up to date!
          </div>
        )}
      </div>

      {/* Exemption modal */}
      {exemptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Exempt EOL Alert
            </h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Provide a reason for exempting this EOL alert.
            </p>
            <textarea
              value={exemptReason}
              onChange={(e) => setExemptReason(e.target.value)}
              placeholder="e.g., Legacy app with planned migration in Q3..."
              className="mt-3 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              rows={3}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setExemptModal(null)}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={handleExempt}
                disabled={!exemptReason.trim() || exemptMutation.isPending}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                Exempt
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  iconColor,
  bgColor,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  iconColor?: string;
  bgColor?: string;
}) {
  return (
    <div className={`rounded-lg border bg-white p-5 shadow-sm dark:bg-gray-800 ${bgColor ?? "border-gray-200 dark:border-gray-700"}`}>
      <div className="flex items-center gap-3">
        <div className={`rounded-lg bg-gray-50 p-2 dark:bg-gray-700 ${iconColor ?? "text-gray-600"}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {value.toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
}
