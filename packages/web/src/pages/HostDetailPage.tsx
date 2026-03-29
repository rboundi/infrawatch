import { useState, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  Search,
  ChevronLeft,
  ChevronRight,
  Clock,
  Server,
  Package,
  Cog,
  Hourglass,
  Wrench,
  Layers,
  Tag,
  Plus,
  X,
} from "lucide-react";
import { useHost, useHostPackages, useHostHistory, useEolAlerts, useHostRemediation, useCreateHostTag, useDeleteHostTag } from "../api/hooks";
import { HostRemediationPanel } from "../components/RemediationPanel";
import { StatusBadge } from "../components/StatusBadge";
import { SeverityBadge } from "../components/SeverityBadge";
import { TableSkeleton, Skeleton } from "../components/Skeleton";
import { timeAgo, isOlderThan24h } from "../components/timeago";
import type { HostDetail, ServiceInfo, ScanLog } from "../api/types";

type Tab = "packages" | "services";

export function HostDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: host, isLoading } = useHost(id);
  const eolAlerts = useEolAlerts({ hostId: id, status: "active", limit: 10 });
  const [showRemediation, setShowRemediation] = useState(false);
  const remediation = useHostRemediation(showRemediation ? id ?? null : null);

  if (isLoading) return <HostDetailSkeleton />;
  if (!host) {
    return (
      <div className="py-12 text-center text-gray-500 dark:text-gray-400">
        Host not found.
      </div>
    );
  }

  const hasOpenAlerts = host.openAlertCount > 0;

  return (
    <div className="space-y-6">
      <HostHeader host={host} />

      {/* Remediation Plan button */}
      {hasOpenAlerts && (
        <button
          onClick={() => setShowRemediation(true)}
          className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 dark:hover:bg-emerald-900/30"
        >
          <Wrench className="h-4 w-4" />
          Remediation Plan ({host.openAlertCount} open alert{host.openAlertCount !== 1 ? "s" : ""})
        </button>
      )}

      {showRemediation && (
        <HostRemediationPanel
          plan={remediation.data}
          isLoading={remediation.isLoading}
          onClose={() => setShowRemediation(false)}
        />
      )}

      {/* EOL warning banner */}
      {eolAlerts.data && eolAlerts.data.data.length > 0 && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 dark:border-orange-800 dark:bg-orange-900/20">
          <div className="flex items-center gap-2 mb-2">
            <Hourglass className="h-4 w-4 text-orange-600 dark:text-orange-400" />
            <span className="text-sm font-semibold text-orange-800 dark:text-orange-300">
              {eolAlerts.data.data.length} End-of-Life Warning{eolAlerts.data.data.length > 1 ? "s" : ""}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {eolAlerts.data.data.map((a) => (
              <span
                key={a.id}
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  a.daysPastEol > 0
                    ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
                    : "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300"
                }`}
              >
                {a.productName} {a.installedVersion}
                {a.daysPastEol > 0
                  ? ` — ${a.daysPastEol}d past EOL`
                  : ` — ${Math.abs(a.daysPastEol)}d until EOL`}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_320px]">
        <TabSection host={host} eolAlerts={eolAlerts.data?.data ?? []} />
        <ScanHistorySection hostId={host.id} />
      </div>
    </div>
  );
}

// ─── Header ───

function HostHeader({ host }: { host: HostDetail }) {
  return (
    <div>
      <Link
        to="/hosts"
        className="mb-3 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to hosts
      </Link>

      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <Server className="h-5 w-5 text-gray-400" />
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                {host.hostname}
              </h2>
              <StatusBadge status={host.status} />
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
              {host.os && (
                <span className="inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                  {host.os} {host.osVersion ?? ""}
                </span>
              )}
              {host.arch && (
                <span className="inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                  {host.arch}
                </span>
              )}
              {host.ip && (
                <span className="font-mono text-xs">{host.ip}</span>
              )}
              {host.environmentTag && (
                <span className="inline-flex items-center rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                  {host.environmentTag}
                </span>
              )}
            </div>

            {/* Group badges */}
            {host.groups && host.groups.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-gray-400" />
                {host.groups.map((g) => (
                  <a
                    key={g.id}
                    href={`/groups/${g.id}`}
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-white"
                    style={{ backgroundColor: g.color || "#6366f1" }}
                  >
                    {g.name}
                    {g.assignedBy === "rule" && (
                      <span className="opacity-70 text-[10px]">(auto)</span>
                    )}
                  </a>
                ))}
              </div>
            )}

            {/* Tags */}
            {host.tags && host.tags.length > 0 && (
              <HostTagsDisplay hostId={host.id} tags={host.tags} />
            )}
          </div>

          <div className="flex flex-col items-end gap-1 text-xs text-gray-500 dark:text-gray-400">
            <span>
              First seen:{" "}
              <span className="font-medium text-gray-700 dark:text-gray-300">
                {new Date(host.firstSeenAt).toLocaleDateString()}
              </span>
            </span>
            <span>
              Last seen:{" "}
              <span
                className={`font-medium ${
                  isOlderThan24h(host.lastSeenAt)
                    ? "text-red-600 dark:text-red-400"
                    : "text-gray-700 dark:text-gray-300"
                }`}
              >
                {timeAgo(host.lastSeenAt)}
              </span>
            </span>
            {host.scanTargetName && (
              <span>
                Target:{" "}
                <span className="font-medium text-gray-700 dark:text-gray-300">
                  {host.scanTargetName}
                </span>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Host Tags Display ───

function HostTagsDisplay({ hostId, tags }: { hostId: string; tags: import("../api/types").HostTag[] }) {
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const createTag = useCreateHostTag();
  const deleteTag = useDeleteHostTag();

  const handleAdd = async () => {
    if (!newKey.trim()) return;
    await createTag.mutateAsync({ hostId, key: newKey.trim(), value: newValue || undefined });
    setNewKey("");
    setNewValue("");
    setAdding(false);
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <Tag className="h-3.5 w-3.5 text-gray-400" />
      {tags.map((t) => (
        <span
          key={t.id}
          className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-xs dark:bg-gray-700"
        >
          <span className="font-medium text-gray-700 dark:text-gray-300">{t.key}</span>
          {t.value && <span className="text-gray-500 dark:text-gray-400">: {t.value}</span>}
          <button
            onClick={() => deleteTag.mutate({ hostId, tagKey: t.key })}
            className="ml-0.5 text-gray-400 hover:text-red-500"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      {adding ? (
        <span className="inline-flex items-center gap-1">
          <input
            type="text"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="key"
            className="w-16 rounded border border-gray-300 px-1 py-0.5 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            autoFocus
          />
          <input
            type="text"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="value"
            className="w-20 rounded border border-gray-300 px-1 py-0.5 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <button onClick={handleAdd} className="text-green-500 hover:text-green-600">
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => setAdding(false)} className="text-gray-400 hover:text-gray-600">
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-0.5 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500 hover:text-gray-700 dark:bg-gray-700 dark:hover:text-gray-300"
        >
          <Plus className="h-3 w-3" /> Add tag
        </button>
      )}
    </div>
  );
}

// ─── Tab section ───

function TabSection({ host, eolAlerts }: { host: HostDetail; eolAlerts: import("../api/types").EolAlert[] }) {
  const [tab, setTab] = useState<Tab>("packages");

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      {/* Tab headers */}
      <div className="flex border-b border-gray-200 dark:border-gray-700">
        <TabButton
          active={tab === "packages"}
          onClick={() => setTab("packages")}
          icon={Package}
          label="Packages"
          count={host.packageCount}
        />
        <TabButton
          active={tab === "services"}
          onClick={() => setTab("services")}
          icon={Cog}
          label="Services"
          count={host.services.length}
        />
      </div>

      {/* Tab content */}
      {tab === "packages" ? (
        <PackagesTab hostId={host.id} alerts={host.recentAlerts} eolAlerts={eolAlerts} />
      ) : (
        <ServicesTab services={host.services} />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
        active
          ? "border-indigo-600 text-indigo-700 dark:border-indigo-400 dark:text-indigo-300"
          : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
      <span
        className={`rounded-full px-1.5 py-0.5 text-xs ${
          active
            ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
            : "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

// ─── Packages tab ───

function PackagesTab({
  hostId,
  alerts,
  eolAlerts,
}: {
  hostId: string;
  alerts: HostDetail["recentAlerts"];
  eolAlerts: import("../api/types").EolAlert[];
}) {
  const [search, setSearch] = useState("");
  const [ecosystem, setEcosystem] = useState("all");
  const [updatesOnly, setUpdatesOnly] = useState(false);
  const [page, setPage] = useState(1);

  const params = useMemo(() => {
    const p: Record<string, unknown> = { page, limit: 25 };
    if (search) p.search = search;
    if (ecosystem !== "all") p.ecosystem = ecosystem;
    if (updatesOnly) p.hasUpdate = "true";
    return p;
  }, [search, ecosystem, updatesOnly, page]);

  const { data, isLoading } = useHostPackages(hostId, params);

  // Build set of package names with critical/high alerts
  const alertedPackages = useMemo(() => {
    const set = new Set<string>();
    for (const a of alerts) {
      if (
        !a.acknowledged &&
        (a.severity === "critical" || a.severity === "high")
      ) {
        set.add(a.packageName);
      }
    }
    return set;
  }, [alerts]);

  // Build map of EOL product names (lowercased) for badge lookup
  const eolProducts = useMemo(() => {
    const map = new Map<string, { daysPastEol: number; productName: string }>();
    for (const a of eolAlerts) {
      map.set(a.productName.toLowerCase(), { daysPastEol: a.daysPastEol, productName: a.productName });
    }
    return map;
  }, [eolAlerts]);

  // Collect ecosystems from the data
  const ecosystems = useMemo(() => {
    if (!data) return [];
    const set = new Set(
      data.data.map((p) => p.ecosystem).filter((e): e is string => !!e)
    );
    return Array.from(set).sort();
  }, [data]);

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3 dark:border-gray-700">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search packages..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full rounded-md border border-gray-300 bg-white py-1.5 pl-8 pr-3 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>

        <select
          value={ecosystem}
          onChange={(e) => {
            setEcosystem(e.target.value);
            setPage(1);
          }}
          className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-700 focus:border-indigo-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
        >
          <option value="all">All ecosystems</option>
          {ecosystems.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400">
          <input
            type="checkbox"
            checked={updatesOnly}
            onChange={(e) => {
              setUpdatesOnly(e.target.checked);
              setPage(1);
            }}
            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          Updates only
        </label>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="p-4">
          <TableSkeleton rows={6} />
        </div>
      ) : data && data.data.length > 0 ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  <th className="px-4 py-2">Package Name</th>
                  <th className="px-4 py-2">Installed</th>
                  <th className="px-4 py-2">Latest</th>
                  <th className="px-4 py-2">Ecosystem</th>
                  <th className="px-4 py-2">Manager</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {data.data.map((pkg) => {
                  const hasAlert = alertedPackages.has(pkg.packageName);
                  const borderColor = hasAlert
                    ? "border-l-2 border-l-red-500"
                    : "border-l-2 border-l-transparent";

                  return (
                    <tr
                      key={pkg.id}
                      className={`text-gray-700 dark:text-gray-300 ${borderColor}`}
                    >
                      <td className="px-4 py-2.5 font-medium">{pkg.packageName}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-500 dark:text-gray-400">
                        {pkg.installedVersion ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs">
                        {pkg.updateAvailable ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                            <ArrowUpRight className="h-3 w-3" />
                            available
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {pkg.ecosystem ? (
                          <span className="inline-flex rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                            {pkg.ecosystem}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400">
                        {pkg.packageManager ?? "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap items-center gap-1">
                          {hasAlert ? (
                            <SeverityBadge severity="high" />
                          ) : pkg.updateAvailable ? (
                            <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                              update
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800 dark:bg-green-900/40 dark:text-green-300">
                              current
                            </span>
                          )}
                          {(() => {
                            // Check if this package name matches any EOL product
                            const pkgLower = pkg.packageName.toLowerCase();
                            for (const [product, eol] of eolProducts) {
                              if (pkgLower.includes(product.toLowerCase().replace(/[/.]/g, "")) || product.toLowerCase().includes(pkgLower.replace(/[-_\d]/g, ""))) {
                                return (
                                  <span
                                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                                      eol.daysPastEol > 0
                                        ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
                                        : "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300"
                                    }`}
                                  >
                                    <Hourglass className="h-3 w-3" />
                                    EOL
                                  </span>
                                );
                              }
                            }
                            return null;
                          })()}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {data.totalPages > 1 && (
            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              total={data.total}
              pageSize={25}
              onPageChange={setPage}
            />
          )}
        </>
      ) : (
        <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
          No packages found.
        </div>
      )}
    </div>
  );
}

// ─── Services tab ───

function ServicesTab({ services }: { services: ServiceInfo[] }) {
  const ServiceDot = ({ status }: { status: string }) => {
    const color =
      status === "running"
        ? "bg-green-500"
        : status === "stopped"
          ? "bg-red-500"
          : "bg-gray-400";
    return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
  };

  if (services.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
        No services discovered.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:text-gray-400">
            <th className="px-4 py-2">Service Name</th>
            <th className="px-4 py-2">Type</th>
            <th className="px-4 py-2">Version</th>
            <th className="px-4 py-2">Port</th>
            <th className="px-4 py-2">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {services.map((svc) => (
            <tr key={svc.id} className="text-gray-700 dark:text-gray-300">
              <td className="px-4 py-2.5 font-medium">{svc.serviceName}</td>
              <td className="px-4 py-2.5">
                {svc.serviceType ? (
                  <span className="inline-flex rounded bg-purple-50 px-1.5 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                    {svc.serviceType}
                  </span>
                ) : (
                  <span className="text-gray-400">—</span>
                )}
              </td>
              <td className="px-4 py-2.5 font-mono text-xs text-gray-500 dark:text-gray-400">
                {svc.version ?? "—"}
              </td>
              <td className="px-4 py-2.5 font-mono text-xs text-gray-500 dark:text-gray-400">
                {svc.port ?? "—"}
              </td>
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-1.5">
                  <ServiceDot status={svc.status} />
                  <span className="text-xs">{svc.status}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Scan history sidebar ───

function ScanHistorySection({ hostId }: { hostId: string }) {
  const { data, isLoading } = useHostHistory(hostId);

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <Clock className="h-4 w-4 text-gray-400" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Scan History
        </h3>
      </div>

      {isLoading ? (
        <div className="p-4">
          <TableSkeleton rows={4} />
        </div>
      ) : data && data.data.length > 0 ? (
        <ul className="divide-y divide-gray-100 dark:divide-gray-700">
          {data.data.slice(0, 15).map((log) => (
            <ScanLogItem key={log.id} log={log} />
          ))}
        </ul>
      ) : (
        <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
          No scan history.
        </div>
      )}
    </div>
  );
}

function ScanLogItem({ log }: { log: ScanLog }) {
  const durationMs =
    log.completedAt && log.startedAt
      ? new Date(log.completedAt).getTime() - new Date(log.startedAt).getTime()
      : null;

  const durationStr = durationMs
    ? durationMs > 60_000
      ? `${(durationMs / 60_000).toFixed(1)}m`
      : `${(durationMs / 1000).toFixed(1)}s`
    : null;

  return (
    <li className="px-4 py-3">
      <div className="flex items-center justify-between">
        <StatusBadge status={log.status} />
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {timeAgo(log.startedAt)}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
        <span>{log.hostsDiscovered} hosts</span>
        <span>{log.packagesDiscovered} pkgs</span>
        {durationStr && <span>{durationStr}</span>}
      </div>
      {log.errorMessage && (
        <p className="mt-1 truncate text-xs text-red-600 dark:text-red-400">
          {log.errorMessage}
        </p>
      )}
    </li>
  );
}

// ─── Shared pagination ───

function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPageChange: (p: number) => void;
}) {
  return (
    <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 dark:border-gray-700">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)}{" "}
        of {total}
      </p>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:text-gray-400 dark:hover:bg-gray-700"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="px-2 text-xs text-gray-600 dark:text-gray-400">
          {page} / {totalPages}
        </span>
        <button
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:text-gray-400 dark:hover:bg-gray-700"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ─── Loading skeleton ───

function HostDetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-5 w-32" />
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <Skeleton className="mb-3 h-7 w-48" />
        <div className="flex gap-2">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-5 w-24" />
        </div>
      </div>
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="p-4">
          <TableSkeleton rows={8} />
        </div>
      </div>
    </div>
  );
}
