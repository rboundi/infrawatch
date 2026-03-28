import { useState } from "react";
import {
  GitCommitHorizontal,
  Server,
  Package,
  Cog,
  Monitor,
  Search,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  Clock,
} from "lucide-react";
import { useChanges, useChangeSummary, useChangeTrends } from "../api/hooks";
import { CardSkeleton, TableSkeleton } from "../components/Skeleton";
import { timeAgo } from "../components/timeago";
import type { ChangesParams } from "../api/types";

const CATEGORIES = [
  { value: "", label: "All" },
  { value: "host", label: "Host" },
  { value: "package", label: "Package" },
  { value: "service", label: "Service" },
  { value: "config", label: "Config" },
];

const EVENT_TYPES = [
  { value: "", label: "All Events" },
  { value: "host_discovered", label: "Host Discovered" },
  { value: "host_disappeared", label: "Host Disappeared" },
  { value: "package_added", label: "Package Added" },
  { value: "package_removed", label: "Package Removed" },
  { value: "package_updated", label: "Package Updated" },
  { value: "service_added", label: "Service Added" },
  { value: "service_removed", label: "Service Removed" },
  { value: "service_changed", label: "Service Changed" },
  { value: "os_changed", label: "OS Changed" },
  { value: "ip_changed", label: "IP Changed" },
  { value: "eol_detected", label: "EOL Detected" },
];

const categoryIcons: Record<string, React.ElementType> = {
  host: Server,
  package: Package,
  service: Cog,
  config: Monitor,
};

const eventColors: Record<string, string> = {
  host_discovered: "text-emerald-600 dark:text-emerald-400",
  host_disappeared: "text-red-600 dark:text-red-400",
  package_added: "text-emerald-600 dark:text-emerald-400",
  package_removed: "text-red-600 dark:text-red-400",
  package_updated: "text-blue-600 dark:text-blue-400",
  service_added: "text-emerald-600 dark:text-emerald-400",
  service_removed: "text-red-600 dark:text-red-400",
  service_changed: "text-amber-600 dark:text-amber-400",
  os_changed: "text-purple-600 dark:text-purple-400",
  ip_changed: "text-purple-600 dark:text-purple-400",
  eol_detected: "text-orange-600 dark:text-orange-400",
};

const eventBadgeColors: Record<string, string> = {
  host_discovered: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  host_disappeared: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  package_added: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  package_removed: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  package_updated: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  service_added: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  service_removed: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  service_changed: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  os_changed: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  ip_changed: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  eol_detected: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
};

function formatEventType(eventType: string): string {
  return eventType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ChangesPage() {
  const [params, setParams] = useState<ChangesParams>({
    page: 1,
    limit: 30,
  });
  const [search, setSearch] = useState("");

  const changes = useChanges(params);
  const summary = useChangeSummary();
  const trends = useChangeTrends();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setParams((p) => ({ ...p, search: search || undefined, page: 1 }));
  };

  const setPage = (page: number) => setParams((p) => ({ ...p, page }));

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
        Change Feed
      </h2>

      {/* Summary cards */}
      {summary.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : summary.data ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            icon={Clock}
            label="Last 24 Hours"
            value={summary.data.last24h}
            iconColor="text-blue-600 dark:text-blue-400"
          />
          <SummaryCard
            icon={TrendingUp}
            label="Last 7 Days"
            value={summary.data.last7d}
            iconColor="text-indigo-600 dark:text-indigo-400"
          />
          <SummaryCard
            icon={GitCommitHorizontal}
            label="Total Events"
            value={summary.data.total}
            iconColor="text-gray-600 dark:text-gray-400"
          />
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <p className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">
              By Category
            </p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <span className="text-gray-600 dark:text-gray-400">
                Host: <strong className="text-gray-900 dark:text-gray-100">{summary.data.byCategory.host}</strong>
              </span>
              <span className="text-gray-600 dark:text-gray-400">
                Package: <strong className="text-gray-900 dark:text-gray-100">{summary.data.byCategory.package}</strong>
              </span>
              <span className="text-gray-600 dark:text-gray-400">
                Service: <strong className="text-gray-900 dark:text-gray-100">{summary.data.byCategory.service}</strong>
              </span>
              <span className="text-gray-600 dark:text-gray-400">
                Config: <strong className="text-gray-900 dark:text-gray-100">{summary.data.byCategory.config}</strong>
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {/* Trend mini-chart */}
      {trends.data && trends.data.trends.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
            Changes Per Day (Last 30 Days)
          </h3>
          <div className="flex items-end gap-1" style={{ height: 80 }}>
            {(() => {
              const maxCount = Math.max(...trends.data.trends.map((t) => t.count), 1);
              return trends.data.trends.map((t, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-t bg-indigo-500 dark:bg-indigo-400 transition-all"
                  style={{
                    height: `${Math.max((t.count / maxCount) * 100, 2)}%`,
                    minHeight: 2,
                  }}
                  title={`${t.date}: ${t.count} changes`}
                />
              ));
            })()}
          </div>
          <div className="mt-1 flex justify-between text-xs text-gray-400">
            <span>30d ago</span>
            <span>Today</span>
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
              placeholder="Search changes..."
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
          value={params.category ?? ""}
          onChange={(e) =>
            setParams((p) => ({ ...p, category: e.target.value || undefined, page: 1 }))
          }
          className="rounded-md border border-gray-300 bg-white py-1.5 px-3 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>

        <select
          value={params.eventType ?? ""}
          onChange={(e) =>
            setParams((p) => ({ ...p, eventType: e.target.value || undefined, page: 1 }))
          }
          className="rounded-md border border-gray-300 bg-white py-1.5 px-3 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
        >
          {EVENT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {/* Change events list */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
        {changes.isLoading ? (
          <div className="p-4">
            <TableSkeleton rows={10} />
          </div>
        ) : changes.data && changes.data.data.length > 0 ? (
          <>
            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
              {changes.data.data.map((event) => {
                const Icon = categoryIcons[event.category] ?? GitCommitHorizontal;
                const color = eventColors[event.eventType] ?? "text-gray-600 dark:text-gray-400";
                const badgeColor =
                  eventBadgeColors[event.eventType] ??
                  "bg-gray-100 text-gray-700 dark:bg-gray-700/40 dark:text-gray-300";

                return (
                  <li key={event.id} className="flex items-start gap-3 px-4 py-3">
                    <div className={`mt-0.5 rounded-lg bg-gray-50 p-1.5 dark:bg-gray-700 ${color}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${badgeColor}`}
                        >
                          {formatEventType(event.eventType)}
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {event.hostname}
                        </span>
                      </div>
                      <p className="mt-0.5 text-sm text-gray-700 dark:text-gray-300">
                        {event.summary}
                      </p>
                    </div>
                    <span className="whitespace-nowrap text-xs text-gray-400 dark:text-gray-500">
                      {timeAgo(event.createdAt)}
                    </span>
                  </li>
                );
              })}
            </ul>

            {/* Pagination */}
            {changes.data.totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 dark:border-gray-700">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Page {changes.data.page} of {changes.data.totalPages} ({changes.data.total} events)
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage(changes.data!.page - 1)}
                    disabled={changes.data.page <= 1}
                    className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                  >
                    <ChevronLeft className="h-4 w-4" /> Prev
                  </button>
                  <button
                    onClick={() => setPage(changes.data!.page + 1)}
                    disabled={changes.data.page >= changes.data.totalPages}
                    className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                  >
                    Next <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No changes recorded yet. Changes will appear here after scans detect differences.
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  iconColor,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  iconColor?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center gap-3">
        <div
          className={`rounded-lg bg-gray-50 p-2 dark:bg-gray-700 ${iconColor ?? "text-gray-600"}`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
            {label}
          </p>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {value.toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
}
