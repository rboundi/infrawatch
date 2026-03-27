import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Search, ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useHosts } from "../api/hooks";
import { StatusBadge } from "../components/StatusBadge";
import { TableSkeleton } from "../components/Skeleton";
import { timeAgo, isOlderThan24h } from "../components/timeago";
import type { HostsParams } from "../api/types";

const STATUS_OPTIONS = ["all", "active", "stale", "decommissioned"] as const;

export function HostsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [environment, setEnvironment] = useState<string>("all");
  const [sortBy, setSortBy] = useState("hostname");
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);

  const params: HostsParams = useMemo(() => {
    const p: HostsParams = { page, limit: 25, sortBy, order };
    if (search) p.search = search;
    if (status !== "all") p.status = status;
    if (environment !== "all") p.environment = environment;
    return p;
  }, [search, status, environment, sortBy, order, page]);

  const { data, isLoading } = useHosts(params);

  // Get unique environments from current result set for filter dropdown
  const allHostsQuery = useHosts({ limit: 100 });
  const environments = useMemo(() => {
    if (!allHostsQuery.data) return [];
    const envs = new Set(
      allHostsQuery.data.data
        .map((h) => h.environmentTag)
        .filter((e): e is string => !!e)
    );
    return Array.from(envs).sort();
  }, [allHostsQuery.data]);

  const handleSort = (col: string) => {
    if (sortBy === col) {
      setOrder(order === "asc" ? "desc" : "asc");
    } else {
      setSortBy(col);
      setOrder("asc");
    }
    setPage(1);
  };

  const SortIcon = ({ col }: { col: string }) => {
    if (sortBy !== col)
      return <ChevronUp className="ml-1 inline h-3 w-3 opacity-0 group-hover:opacity-30" />;
    return order === "asc" ? (
      <ChevronUp className="ml-1 inline h-3 w-3" />
    ) : (
      <ChevronDown className="ml-1 inline h-3 w-3" />
    );
  };

  const StatusDot = ({ s }: { s: string }) => {
    const color =
      s === "active"
        ? "bg-green-500"
        : s === "stale"
          ? "bg-yellow-500"
          : "bg-red-500";
    return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
        Hosts
      </h2>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search hostname..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
          />
        </div>

        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-indigo-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s === "all" ? "All statuses" : s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>

        <select
          value={environment}
          onChange={(e) => {
            setEnvironment(e.target.value);
            setPage(1);
          }}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-indigo-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
        >
          <option value="all">All environments</option>
          {environments.map((env) => (
            <option key={env} value={env}>
              {env}
            </option>
          ))}
        </select>
      </div>

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
                    {[
                      { key: "hostname", label: "Hostname" },
                      { key: "ip", label: "IP" },
                      { key: "os", label: "OS" },
                      { key: "environment", label: "Environment" },
                      { key: "packageCount", label: "Packages" },
                      { key: "alerts", label: "Open Alerts" },
                      { key: "lastSeenAt", label: "Last Seen" },
                      { key: "status", label: "Status" },
                    ].map((col) => (
                      <th
                        key={col.key}
                        className="group cursor-pointer px-4 py-2.5 hover:text-gray-700 dark:hover:text-gray-200"
                        onClick={() => handleSort(col.key)}
                      >
                        {col.label}
                        <SortIcon col={col.key} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {data.data.map((host) => (
                    <tr
                      key={host.id}
                      onClick={() => navigate(`/hosts/${host.id}`)}
                      className="cursor-pointer text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700/50"
                    >
                      <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-gray-100">
                        {host.hostname}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-500 dark:text-gray-400">
                        {host.ip ?? "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        {host.os ? (
                          <span className="text-gray-700 dark:text-gray-300">
                            {host.os}
                            {host.osVersion ? ` ${host.osVersion}` : ""}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {host.environmentTag ? (
                          <span className="inline-flex rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                            {host.environmentTag}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-center">{host.packageCount}</td>
                      <td className="px-4 py-2.5 text-center">
                        <AlertCountCell count={host.openAlertCount} />
                      </td>
                      <td
                        className={`px-4 py-2.5 ${
                          isOlderThan24h(host.lastSeenAt)
                            ? "text-red-600 dark:text-red-400"
                            : "text-gray-500 dark:text-gray-400"
                        }`}
                      >
                        {timeAgo(host.lastSeenAt)}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <StatusDot s={host.status} />
                          <StatusBadge status={host.status} />
                        </div>
                      </td>
                    </tr>
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
          <div className="px-4 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
            No hosts found.
          </div>
        )}
      </div>
    </div>
  );
}

function AlertCountCell({ count }: { count: number }) {
  if (count === 0)
    return <span className="text-gray-400 dark:text-gray-500">0</span>;

  return (
    <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800 dark:bg-red-900/40 dark:text-red-300">
      {count}
    </span>
  );
}
