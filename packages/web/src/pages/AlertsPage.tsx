import { useState, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Search,
  ShieldAlert,
  AlertTriangle,
  Info,
  Check,
  CheckCheck,
  ExternalLink,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  useAlerts,
  useAlertsSummary,
  useAcknowledgeAlert,
  useBulkAcknowledgeAlerts,
} from "../api/hooks";
import { SeverityBadge } from "../components/SeverityBadge";
import { TableSkeleton, Skeleton } from "../components/Skeleton";
import { timeAgo } from "../components/timeago";
import type { Alert, AlertsParams } from "../api/types";

const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
const DATE_RANGES = [
  { label: "All time", value: "" },
  { label: "Last 24h", value: "24h" },
  { label: "Last 7 days", value: "7d" },
  { label: "Last 30 days", value: "30d" },
] as const;

export function AlertsPage() {
  // Filters
  const [search, setSearch] = useState("");
  const [selectedSeverities, setSelectedSeverities] = useState<Set<string>>(new Set());
  const [ackFilter, setAckFilter] = useState<"all" | "false" | "true">("all");
  const [dateRange, setDateRange] = useState("");
  const [page, setPage] = useState(1);

  // Bulk selection
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Acknowledge modal
  const [ackModal, setAckModal] = useState<{ alertId: string } | null>(null);
  const [ackNotes, setAckNotes] = useState("");

  // Summary
  const summary = useAlertsSummary();

  // Build query params
  const params: AlertsParams = useMemo(() => {
    const p: AlertsParams = { page, limit: 25, sortBy: "createdAt", order: "desc" };
    if (search) p.search = search;
    if (selectedSeverities.size > 0) p.severity = Array.from(selectedSeverities).join(",");
    if (ackFilter !== "all") p.acknowledged = ackFilter;
    return p;
  }, [search, selectedSeverities, ackFilter, dateRange, page]);

  const { data, isLoading } = useAlerts(params);
  const ackMutation = useAcknowledgeAlert();
  const bulkAckMutation = useBulkAcknowledgeAlerts();

  // Toggle severity filter
  const toggleSeverity = useCallback((sev: string) => {
    setSelectedSeverities((prev) => {
      const next = new Set(prev);
      if (next.has(sev)) next.delete(sev);
      else next.add(sev);
      return next;
    });
    setPage(1);
  }, []);

  // Selection helpers
  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (!data) return;
    const unacked = data.data.filter((a) => !a.acknowledged);
    if (selected.size === unacked.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(unacked.map((a) => a.id)));
    }
  };

  // Single acknowledge
  const handleAck = (alert: Alert) => {
    setAckModal({ alertId: alert.id });
    setAckNotes("");
  };

  const confirmAck = () => {
    if (!ackModal) return;
    ackMutation.mutate(
      { id: ackModal.alertId, notes: ackNotes || undefined },
      { onSuccess: () => setAckModal(null) }
    );
  };

  // Bulk acknowledge
  const handleBulkAck = () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    bulkAckMutation.mutate({ alertIds: ids }, {
      onSuccess: () => setSelected(new Set()),
    });
  };

  const unackedInPage = data?.data.filter((a) => !a.acknowledged) ?? [];

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
        Alerts
      </h2>

      {/* Summary bar */}
      {summary.isLoading ? (
        <div className="flex gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-20" />
          ))}
        </div>
      ) : summary.data ? (
        <SummaryBar
          summary={summary.data}
          selectedSeverities={selectedSeverities}
          onToggle={toggleSeverity}
        />
      ) : null}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search package name..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
          />
        </div>

        {/* Ack status toggle */}
        <div className="inline-flex rounded-md border border-gray-300 dark:border-gray-600">
          {(
            [
              { key: "all", label: "All" },
              { key: "false", label: "Unacknowledged" },
              { key: "true", label: "Acknowledged" },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => { setAckFilter(key); setPage(1); }}
              className={`px-3 py-1.5 text-xs font-medium first:rounded-l-md last:rounded-r-md ${
                ackFilter === key
                  ? "bg-indigo-600 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Date range */}
        <select
          value={dateRange}
          onChange={(e) => { setDateRange(e.target.value); setPage(1); }}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-indigo-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
        >
          {DATE_RANGES.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2.5 dark:border-indigo-800 dark:bg-indigo-900/20">
          <span className="text-sm font-medium text-indigo-800 dark:text-indigo-300">
            {selected.size} selected
          </span>
          <button
            onClick={handleBulkAck}
            disabled={bulkAckMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Acknowledge Selected ({selected.size})
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="ml-auto text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            Clear
          </button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
        {isLoading ? (
          <div className="p-4">
            <TableSkeleton rows={8} />
          </div>
        ) : data && data.data.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:text-gray-400">
                    <th className="px-3 py-2.5 w-10">
                      <input
                        type="checkbox"
                        checked={
                          unackedInPage.length > 0 &&
                          selected.size === unackedInPage.length
                        }
                        onChange={toggleSelectAll}
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                    </th>
                    <th className="px-3 py-2.5">Severity</th>
                    <th className="px-3 py-2.5">Host</th>
                    <th className="px-3 py-2.5">Package</th>
                    <th className="px-3 py-2.5">Version</th>
                    <th className="px-3 py-2.5">Created</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {data.data.map((alert) => (
                    <AlertRow
                      key={alert.id}
                      alert={alert}
                      isSelected={selected.has(alert.id)}
                      onToggleSelect={() => toggleSelect(alert.id)}
                      onAcknowledge={() => handleAck(alert)}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {data.totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 dark:border-gray-700">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Showing {(data.page - 1) * 25 + 1}–
                  {Math.min(data.page * 25, data.total)} of {data.total}
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
          <div className="px-4 py-12 text-center">
            <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-gray-300 dark:text-gray-600" />
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
              No alerts match your filters
            </p>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              {selectedSeverities.size > 0 || search || ackFilter !== "all"
                ? "Try adjusting your filters to see more results."
                : "All clear — no alerts have been generated yet."}
            </p>
          </div>
        )}
      </div>

      {/* Acknowledge modal */}
      {ackModal && (
        <AckModal
          onConfirm={confirmAck}
          onCancel={() => setAckModal(null)}
          notes={ackNotes}
          onNotesChange={setAckNotes}
          isPending={ackMutation.isPending}
        />
      )}
    </div>
  );
}

// ─── Summary bar ───

function SummaryBar({
  summary,
  selectedSeverities,
  onToggle,
}: {
  summary: import("../api/types").AlertsSummary;
  selectedSeverities: Set<string>;
  onToggle: (sev: string) => void;
}) {
  const items: { key: string; count: number; color: string; activeColor: string }[] = [
    {
      key: "critical",
      count: summary.critical,
      color: "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400",
      activeColor: "ring-2 ring-red-500",
    },
    {
      key: "high",
      count: summary.high,
      color: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-900/20 dark:text-orange-400",
      activeColor: "ring-2 ring-orange-500",
    },
    {
      key: "medium",
      count: summary.medium,
      color: "border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400",
      activeColor: "ring-2 ring-yellow-500",
    },
    {
      key: "low",
      count: summary.low,
      color: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-400",
      activeColor: "ring-2 ring-blue-500",
    },
    {
      key: "info",
      count: summary.info,
      color: "border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400",
      activeColor: "ring-2 ring-gray-500",
    },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
        {summary.total} total · {summary.unacknowledged} open
      </span>
      <span className="text-gray-300 dark:text-gray-600">|</span>
      {items.map((item) => (
        <button
          key={item.key}
          onClick={() => onToggle(item.key)}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-all ${item.color} ${
            selectedSeverities.has(item.key) ? item.activeColor : ""
          }`}
        >
          {item.key}
          <span className="font-bold">{item.count}</span>
        </button>
      ))}
    </div>
  );
}

// ─── Alert row ───

function SeverityIcon({ severity }: { severity: string }) {
  switch (severity) {
    case "critical":
      return <ShieldAlert className="h-4 w-4 text-red-600 dark:text-red-400" />;
    case "high":
      return <AlertTriangle className="h-4 w-4 text-orange-600 dark:text-orange-400" />;
    default:
      return <Info className="h-4 w-4 text-gray-400" />;
  }
}

function AlertRow({
  alert,
  isSelected,
  onToggleSelect,
  onAcknowledge,
}: {
  alert: Alert;
  isSelected: boolean;
  onToggleSelect: () => void;
  onAcknowledge: () => void;
}) {
  return (
    <tr
      className={`text-gray-700 transition-colors dark:text-gray-300 ${
        isSelected ? "bg-indigo-50/50 dark:bg-indigo-900/10" : ""
      }`}
    >
      <td className="px-3 py-2.5">
        {!alert.acknowledged && (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggleSelect}
            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
        )}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <SeverityIcon severity={alert.severity} />
          <SeverityBadge severity={alert.severity} />
        </div>
      </td>
      <td className="px-3 py-2.5 font-medium">
        {alert.hostname ?? "—"}
      </td>
      <td className="px-3 py-2.5 font-mono text-xs">
        {alert.packageName}
      </td>
      <td className="px-3 py-2.5 font-mono text-xs">
        <span className="text-gray-500 dark:text-gray-400">
          {alert.currentVersion ?? "?"}
        </span>
        <span className="mx-1 text-gray-400 dark:text-gray-500">→</span>
        <span className="text-emerald-700 dark:text-emerald-400">
          {alert.availableVersion ?? "?"}
        </span>
      </td>
      <td className="px-3 py-2.5 text-gray-500 dark:text-gray-400">
        {timeAgo(alert.createdAt)}
      </td>
      <td className="px-3 py-2.5">
        {alert.acknowledged ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/40 dark:text-green-300">
            <Check className="h-3 w-3" />
            Ack'd
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
            Open
          </span>
        )}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          {!alert.acknowledged && (
            <button
              onClick={onAcknowledge}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
              title="Acknowledge"
            >
              <Check className="h-3 w-3" />
              Ack
            </button>
          )}
          <Link
            to={`/hosts/${alert.hostId}`}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-900/20"
            title="View Host"
          >
            <ExternalLink className="h-3 w-3" />
            Host
          </Link>
        </div>
      </td>
    </tr>
  );
}

// ─── Acknowledge modal ───

function AckModal({
  onConfirm,
  onCancel,
  notes,
  onNotesChange,
  isPending,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  notes: string;
  onNotesChange: (v: string) => void;
  isPending: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="mx-4 w-full max-w-md rounded-lg border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Acknowledge Alert
          </h3>
          <button
            onClick={onCancel}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          Add optional notes about this acknowledgment.
        </p>

        <textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="Notes (optional)..."
          rows={3}
          className="mt-3 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-500"
        />

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            {isPending ? "Acknowledging..." : "Acknowledge"}
          </button>
        </div>
      </div>
    </div>
  );
}
