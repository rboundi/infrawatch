import { useState, useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  Search,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Radar,
  Cpu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  X,
  Server,
} from "lucide-react";
import { useHosts, useGroups, useComplianceHosts } from "../api/hooks";
import { StatusBadge } from "../components/StatusBadge";
import { TableSkeleton } from "../components/Skeleton";
import { GroupFormModal } from "../components/GroupFormModal";
import { timeAgo, isOlderThan24h } from "../components/timeago";
import type { HostsParams, HostGroup, ComplianceHostScore } from "../api/types";

// ─── Classification colors ───

const CLASS_COLORS: Record<string, string> = {
  excellent: "text-green-600 dark:text-green-400",
  good: "text-blue-600 dark:text-blue-400",
  fair: "text-yellow-600 dark:text-yellow-400",
  poor: "text-orange-600 dark:text-orange-400",
  critical: "text-red-600 dark:text-red-400",
};

const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "stale", label: "Stale" },
  { value: "decommissioned", label: "Decommissioned" },
] as const;

export function HostsPage() {
  const navigate = useNavigate();

  // Filter state
  const [panelOpen, setPanelOpen] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [selectedEnvs, setSelectedEnvs] = useState<string[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState("hostname");
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);

  // Group management modal
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [editGroup, setEditGroup] = useState<HostGroup | null>(null);

  // Data
  const { data: groupsData } = useGroups();
  const groups = groupsData?.data ?? [];

  // Build API params (server supports single groupId, so we pass first selected or omit)
  const params: HostsParams = useMemo(() => {
    const p: HostsParams = { page, limit: 25, sortBy, order };
    if (search) p.search = search;
    if (selectedStatus !== "all") p.status = selectedStatus;
    if (selectedGroups.length === 1) p.groupId = selectedGroups[0];
    // Environment: server supports single value
    if (selectedEnvs.length === 1) p.environment = selectedEnvs[0];
    return p;
  }, [search, selectedStatus, selectedGroups, selectedEnvs, sortBy, order, page]);

  const { data, isLoading } = useHosts(params);

  // Compliance scores
  const complianceQuery = useComplianceHosts({ limit: 200 });
  const complianceMap = useMemo(() => {
    const map = new Map<string, ComplianceHostScore>();
    if (complianceQuery.data?.data) {
      for (const s of complianceQuery.data.data) map.set(s.hostId, s);
    }
    return map;
  }, [complianceQuery.data]);

  // Get unique environments from full host set for filter options
  const allHostsQuery = useHosts({ limit: 200 });
  const environments = useMemo(() => {
    if (!allHostsQuery.data) return [];
    const envs = new Set(
      allHostsQuery.data.data.map((h) => h.environmentTag).filter((e): e is string => !!e),
    );
    return Array.from(envs).sort();
  }, [allHostsQuery.data]);

  // Source counts from current data
  const sourceCounts = useMemo(() => {
    if (!allHostsQuery.data) return { scanner: 0, agent: 0 };
    let scanner = 0;
    let agent = 0;
    for (const h of allHostsQuery.data.data) {
      if (h.reportingMethod === "agent") agent++;
      else scanner++;
    }
    return { scanner, agent };
  }, [allHostsQuery.data]);

  // Status counts
  const statusCounts = useMemo(() => {
    if (!allHostsQuery.data) return { active: 0, stale: 0, decommissioned: 0 };
    const c = { active: 0, stale: 0, decommissioned: 0 };
    for (const h of allHostsQuery.data.data) {
      if (h.status in c) c[h.status as keyof typeof c]++;
    }
    return c;
  }, [allHostsQuery.data]);

  // Client-side filters (for multi-group, multi-env, source — not supported by API)
  const filteredData = useMemo(() => {
    if (!data?.data) return [];
    let rows = data.data;
    // Multi-group filter (when > 1 group selected, API only supports 1)
    // We'd need host->group mapping for this — skip for now, single groupId works via API
    // Multi-env filter client-side
    if (selectedEnvs.length > 1) {
      rows = rows.filter((h) => h.environmentTag && selectedEnvs.includes(h.environmentTag));
    }
    // Source filter client-side
    if (selectedSources.length > 0 && selectedSources.length < 2) {
      rows = rows.filter((h) => {
        const method = h.reportingMethod ?? "scanner";
        return selectedSources.includes(method);
      });
    }
    return rows;
  }, [data, selectedEnvs, selectedSources]);

  // Active filter count
  const activeFilterCount = useMemo(() => {
    let c = 0;
    if (selectedStatus !== "all") c++;
    if (selectedGroups.length > 0) c++;
    if (selectedEnvs.length > 0) c++;
    if (selectedSources.length > 0) c++;
    return c;
  }, [selectedStatus, selectedGroups, selectedEnvs, selectedSources]);

  const clearAllFilters = () => {
    setSelectedStatus("all");
    setSelectedGroups([]);
    setSelectedEnvs([]);
    setSelectedSources([]);
    setPage(1);
  };

  const handleSort = (col: string) => {
    if (sortBy === col) setOrder(order === "asc" ? "desc" : "asc");
    else { setSortBy(col); setOrder("asc"); }
    setPage(1);
  };

  const toggleGroup = (id: string) => {
    setSelectedGroups((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id],
    );
    setPage(1);
  };

  const toggleEnv = (env: string) => {
    setSelectedEnvs((prev) =>
      prev.includes(env) ? prev.filter((e) => e !== env) : [...prev, env],
    );
    setPage(1);
  };

  const toggleSource = (src: string) => {
    setSelectedSources((prev) =>
      prev.includes(src) ? prev.filter((s) => s !== src) : [...prev, src],
    );
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

  const columns = [
    { key: "status", label: "" },
    { key: "hostname", label: "Hostname" },
    { key: "ip", label: "IP" },
    { key: "os", label: "OS" },
    { key: "compliance", label: "Compliance" },
    { key: "packageCount", label: "Packages" },
    { key: "alerts", label: "Alerts" },
    { key: "reportingMethod", label: "Source" },
    { key: "lastSeenAt", label: "Last Seen" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Hosts</h2>
        <button
          onClick={() => setPanelOpen(!panelOpen)}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
        >
          {panelOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
          {!panelOpen && activeFilterCount > 0 && (
            <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      <div className="flex gap-4">
        {/* ═══ LEFT FILTER PANEL ═══ */}
        {panelOpen && (
          <aside className="w-60 flex-shrink-0 space-y-4">
            {/* Clear all */}
            {activeFilterCount > 0 && (
              <button
                onClick={clearAllFilters}
                className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
              >
                <X className="h-3 w-3" /> Clear all filters
              </button>
            )}

            {/* Groups section */}
            <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  Groups
                </h4>
                <button
                  onClick={() => { setEditGroup(null); setShowGroupForm(true); }}
                  className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                  title="Manage Groups"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="space-y-0.5">
                <button
                  onClick={() => { setSelectedGroups([]); setPage(1); }}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs ${
                    selectedGroups.length === 0
                      ? "bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
                      : "text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-700/50"
                  }`}
                >
                  All Hosts
                </button>
                {groups.map((g) => (
                  <label
                    key={g.id}
                    className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-700/50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedGroups.includes(g.id)}
                      onChange={() => toggleGroup(g.id)}
                      className="h-3 w-3 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span
                      className="h-2 w-2 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: g.color || "#6366f1" }}
                    />
                    <span className="flex-1 truncate">{g.name}</span>
                    <span className="text-[10px] text-gray-400">{g.memberCount}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Status section */}
            <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                Status
              </h4>
              <div className="space-y-0.5">
                {STATUS_OPTIONS.map((s) => {
                  const count = s.value === "all" ? undefined : statusCounts[s.value as keyof typeof statusCounts];
                  return (
                    <label
                      key={s.value}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-700/50"
                    >
                      <input
                        type="radio"
                        name="status"
                        checked={selectedStatus === s.value}
                        onChange={() => { setSelectedStatus(s.value); setPage(1); }}
                        className="h-3 w-3 border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="flex-1">{s.label}</span>
                      {count !== undefined && (
                        <span className="text-[10px] text-gray-400">{count}</span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Environment section */}
            {environments.length > 0 && (
              <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  Environment
                </h4>
                <div className="space-y-0.5">
                  {environments.map((env) => (
                    <label
                      key={env}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-700/50"
                    >
                      <input
                        type="checkbox"
                        checked={selectedEnvs.includes(env)}
                        onChange={() => toggleEnv(env)}
                        className="h-3 w-3 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="flex-1 truncate">{env}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Source section */}
            <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                Source
              </h4>
              <div className="space-y-0.5">
                {[
                  { value: "scanner", label: "Scanner", count: sourceCounts.scanner },
                  { value: "agent", label: "Agent", count: sourceCounts.agent },
                ].map((src) => (
                  <label
                    key={src.value}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-700/50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedSources.includes(src.value)}
                      onChange={() => toggleSource(src.value)}
                      className="h-3 w-3 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="flex-1">{src.label}</span>
                    <span className="text-[10px] text-gray-400">{src.count}</span>
                  </label>
                ))}
              </div>
            </div>
          </aside>
        )}

        {/* ═══ MAIN CONTENT ═══ */}
        <div className="min-w-0 flex-1 space-y-3">
          {/* Search bar */}
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search hostname or IP..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
            />
          </div>

          {/* Table */}
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
            {isLoading ? (
              <div className="p-4"><TableSkeleton rows={8} /></div>
            ) : filteredData.length > 0 ? (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:text-gray-400">
                        {columns.map((col) => (
                          <th
                            key={col.key}
                            className="group cursor-pointer px-4 py-2.5 hover:text-gray-700 dark:hover:text-gray-200"
                            onClick={() => handleSort(col.key)}
                          >
                            {col.label}
                            {col.label && <SortIcon col={col.key} />}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {filteredData.map((host) => {
                        const comp = complianceMap.get(host.id);
                        return (
                          <tr
                            key={host.id}
                            onClick={() => navigate(`/hosts/${host.id}`)}
                            className="cursor-pointer text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700/50"
                          >
                            <td className="px-4 py-2.5">
                              <StatusDot s={host.status} />
                            </td>
                            <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-gray-100">
                              {host.hostname}
                            </td>
                            <td className="px-4 py-2.5 font-mono text-xs text-gray-500 dark:text-gray-400">
                              {host.ip ?? "—"}
                            </td>
                            <td className="px-4 py-2.5">
                              {host.os ? (
                                <span className="text-gray-700 dark:text-gray-300">
                                  {host.os}{host.osVersion ? ` ${host.osVersion}` : ""}
                                </span>
                              ) : (
                                <span className="text-gray-400">—</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              {comp ? (
                                <span className={`font-semibold ${CLASS_COLORS[comp.classification] || "text-gray-500"}`}>
                                  {comp.score}
                                </span>
                              ) : (
                                <span className="text-gray-400">—</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-center">{host.packageCount}</td>
                            <td className="px-4 py-2.5 text-center">
                              <AlertCountCell count={host.openAlertCount} />
                            </td>
                            <td className="px-4 py-2.5">
                              <SourceBadge method={host.reportingMethod} />
                            </td>
                            <td className={`px-4 py-2.5 ${isOlderThan24h(host.lastSeenAt) ? "text-red-600 dark:text-red-400" : "text-gray-500 dark:text-gray-400"}`}>
                              {timeAgo(host.lastSeenAt)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {data && data.totalPages > 1 && (
                  <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 dark:border-gray-700">
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Showing {(data.page - 1) * 25 + 1}–{Math.min(data.page * 25, data.total)} of {data.total}
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
              <div className="px-6 py-12 text-center">
                <Server className="mx-auto mb-3 h-8 w-8 text-gray-300 dark:text-gray-600" />
                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">No hosts found</p>
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  Add a scan target or deploy an agent to start discovering hosts.
                </p>
                <div className="mt-4 flex items-center justify-center">
                  <Link to="/setup/targets/new" className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700">
                    Add Scan Target
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Group form modal */}
      {showGroupForm && (
        <GroupFormModal
          group={editGroup}
          onClose={() => { setShowGroupForm(false); setEditGroup(null); }}
        />
      )}
    </div>
  );
}

// ─── Sub-components ───

function StatusDot({ s }: { s: string }) {
  const color = s === "active" ? "bg-green-500" : s === "stale" ? "bg-yellow-500" : "bg-red-500";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

function SourceBadge({ method }: { method?: string }) {
  if (method === "agent") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-teal-100 px-2 py-0.5 text-xs font-medium text-teal-700 dark:bg-teal-900/40 dark:text-teal-300">
        <Cpu className="h-3 w-3" /> Agent
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
      <Radar className="h-3 w-3" /> Scanner
    </span>
  );
}

function AlertCountCell({ count }: { count: number }) {
  if (count === 0) return <span className="text-gray-400 dark:text-gray-500">0</span>;
  return (
    <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800 dark:bg-red-900/40 dark:text-red-300">
      {count}
    </span>
  );
}
