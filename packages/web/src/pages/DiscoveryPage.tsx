import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Monitor,
  Terminal,
  AppWindow,
  Container,
  Network,
  Router,
  HelpCircle,
  ChevronDown,
  ChevronRight,
  Check,
  ArrowUpRight,
  Minus,
  X,
  Search,
  Loader2,
} from "lucide-react";
import {
  useDiscoveryResults,
  usePromoteDiscovery,
  useDismissDiscovery,
  useScanTargets,
} from "../api/hooks";
import { TableSkeleton, Skeleton } from "../components/Skeleton";
import { timeAgo } from "../components/timeago";
import type { DiscoveryResult, DiscoveryParams } from "../api/types";

// ─── Platform config ───

const PLATFORMS = [
  { value: "linux-server", label: "Linux", icon: Terminal, color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
  { value: "windows-server", label: "Windows", icon: AppWindow, color: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" },
  { value: "docker-host", label: "Docker", icon: Container, color: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300" },
  { value: "kubernetes-node", label: "K8s", icon: Network, color: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300" },
  { value: "network-device", label: "Network", icon: Router, color: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  { value: "vmware-esxi", label: "ESXi", icon: Monitor, color: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300" },
  { value: "unknown", label: "Unknown", icon: HelpCircle, color: "bg-gray-100 text-gray-700 dark:bg-gray-700/40 dark:text-gray-300" },
] as const;

const PLATFORM_MAP = Object.fromEntries(PLATFORMS.map((p) => [p.value, p]));

const PLATFORM_OPTIONS = [
  { value: "", label: "All Platforms" },
  { value: "linux-server", label: "Linux Server" },
  { value: "windows-server", label: "Windows Server" },
  { value: "docker-host", label: "Docker Host" },
  { value: "kubernetes-node", label: "Kubernetes Node" },
  { value: "network-device", label: "Network Device" },
  { value: "vmware-esxi", label: "VMware ESXi" },
  { value: "unknown", label: "Unknown" },
];

// ─── Page ───

export function DiscoveryPage() {
  const [platform, setPlatform] = useState("");
  const [hasPort, setHasPort] = useState("");
  const [search, setSearch] = useState("");
  const [showOnlyNew, setShowOnlyNew] = useState(false);
  const [page, setPage] = useState(1);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [promoteRow, setPromoteRow] = useState<string | null>(null);

  const params: DiscoveryParams = useMemo(() => {
    const p: DiscoveryParams = { page, limit: 25 };
    if (platform) p.platform = platform;
    if (hasPort) p.hasPort = parseInt(hasPort, 10) || undefined;
    if (search.trim()) p.search = search.trim();
    if (showOnlyNew) {
      p.dismissed = "false";
    }
    return p;
  }, [platform, hasPort, search, showOnlyNew, page]);

  const { data, isLoading } = useDiscoveryResults(params);
  const results = data?.data ?? [];
  const totalPages = data?.totalPages ?? 1;

  // Filter client-side for "only new" (no hostId) since API might not support it directly
  const filteredResults = showOnlyNew ? results.filter((r) => !r.hostId) : results;

  // Platform summary counts from current results
  const platformCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of (data?.data ?? [])) {
      const p = r.detectedPlatform ?? "unknown";
      counts[p] = (counts[p] ?? 0) + 1;
    }
    return counts;
  }, [data]);

  const totalCount = data?.total ?? 0;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
        Network Discovery
      </h2>

      {/* Platform summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <SummaryCard
          label="Total IPs"
          count={totalCount}
          icon={Monitor}
          active={platform === ""}
          onClick={() => { setPlatform(""); setPage(1); }}
        />
        {PLATFORMS.map((p) => (
          <SummaryCard
            key={p.value}
            label={p.label}
            count={platformCounts[p.value] ?? 0}
            icon={p.icon}
            active={platform === p.value}
            onClick={() => { setPlatform(platform === p.value ? "" : p.value); setPage(1); }}
          />
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <select
          value={platform}
          onChange={(e) => { setPlatform(e.target.value); setPage(1); }}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
        >
          {PLATFORM_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <input
          type="number"
          placeholder="Port #"
          value={hasPort}
          onChange={(e) => { setHasPort(e.target.value); setPage(1); }}
          className="w-24 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:placeholder-gray-500"
        />

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="IP or hostname"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-48 rounded-md border border-gray-300 py-1.5 pl-8 pr-3 text-sm text-gray-700 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:placeholder-gray-500"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <button
            type="button"
            onClick={() => { setShowOnlyNew(!showOnlyNew); setPage(1); }}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              showOnlyNew ? "bg-indigo-600" : "bg-gray-300 dark:bg-gray-600"
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                showOnlyNew ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </button>
          Show only new
        </label>
      </div>

      {/* Table */}
      {isLoading ? (
        <TableSkeleton rows={8} />
      ) : filteredResults.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white px-6 py-12 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <Monitor className="mx-auto mb-3 h-8 w-8 text-gray-300 dark:text-gray-600" />
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
            No discovery results yet.
          </p>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
            Add a Network Discovery scan target to start scanning your network.
          </p>
          <Link
            to="/setup/targets/new"
            className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Add Scan Target
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 shadow-sm dark:border-gray-700">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="w-8 px-3 py-3" />
                <th className="px-3 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">IP Address</th>
                <th className="px-3 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Hostname</th>
                <th className="px-3 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Platform</th>
                <th className="px-3 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">OS</th>
                <th className="px-3 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Open Ports</th>
                <th className="px-3 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Key Services</th>
                <th className="px-3 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Discovered</th>
                <th className="px-3 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Status</th>
                <th className="px-3 py-3 text-right text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900">
              {filteredResults.map((r) => (
                <DiscoveryRow
                  key={r.id}
                  result={r}
                  expanded={expandedRow === r.id}
                  onToggleExpand={() => setExpandedRow(expandedRow === r.id ? null : r.id)}
                  promoteOpen={promoteRow === r.id}
                  onTogglePromote={() => setPromoteRow(promoteRow === r.id ? null : r.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Page {page} of {totalPages} ({totalCount} results)
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page <= 1}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Previous
            </button>
            <button
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page >= totalPages}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Summary card ───

function SummaryCard({
  label,
  count,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  count: number;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border p-3 text-left transition-all ${
        active
          ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500 dark:border-indigo-400 dark:bg-indigo-900/20"
          : "border-gray-200 bg-white hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600"
      }`}
    >
      <Icon className={`mb-1 h-4 w-4 ${active ? "text-indigo-600 dark:text-indigo-400" : "text-gray-400"}`} />
      <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{count}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
    </button>
  );
}

// ─── Platform badge ───

function PlatformBadge({ platform }: { platform: string | null }) {
  const p = PLATFORM_MAP[platform ?? "unknown"] ?? PLATFORM_MAP["unknown"];
  const Icon = p.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${p.color}`}>
      <Icon className="h-3 w-3" />
      {p.label}
    </span>
  );
}

// ─── Status icon ───

function StatusIcon({ result }: { result: DiscoveryResult }) {
  if (result.hostId) {
    return (
      <span title="Linked to host" className="text-green-600 dark:text-green-400">
        <Check className="h-4 w-4" />
      </span>
    );
  }
  if (result.autoPromoted) {
    return (
      <span title="Auto-promoted" className="text-blue-600 dark:text-blue-400">
        <ArrowUpRight className="h-4 w-4" />
      </span>
    );
  }
  return (
    <span title="New" className="text-gray-400">
      <Minus className="h-4 w-4" />
    </span>
  );
}

// ─── Discovery row ───

function DiscoveryRow({
  result,
  expanded,
  onToggleExpand,
  promoteOpen,
  onTogglePromote,
}: {
  result: DiscoveryResult;
  expanded: boolean;
  onToggleExpand: () => void;
  promoteOpen: boolean;
  onTogglePromote: () => void;
}) {
  const dismissMutation = useDismissDiscovery();
  const topServices = result.openPorts
    .filter((p) => p.service)
    .slice(0, 3)
    .map((p) => p.service);

  return (
    <>
      <tr className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
        {/* Expand toggle */}
        <td className="px-3 py-2">
          {result.openPorts.length > 0 && (
            <button onClick={onToggleExpand} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          )}
        </td>
        <td className="px-3 py-2 text-sm font-mono text-gray-900 dark:text-gray-100">{result.ipAddress}</td>
        <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">{result.hostname ?? "-"}</td>
        <td className="px-3 py-2"><PlatformBadge platform={result.detectedPlatform} /></td>
        <td className="max-w-[160px] truncate px-3 py-2 text-sm text-gray-700 dark:text-gray-300" title={result.osMatch ?? undefined}>{result.osMatch ?? "-"}</td>
        <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">{result.openPorts.length}</td>
        <td className="px-3 py-2">
          <div className="flex flex-wrap gap-1">
            {topServices.length > 0 ? topServices.map((s, i) => (
              <span key={i} className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                {s}
              </span>
            )) : <span className="text-xs text-gray-400">-</span>}
          </div>
        </td>
        <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">{timeAgo(result.createdAt)}</td>
        <td className="px-3 py-2"><StatusIcon result={result} /></td>
        <td className="px-3 py-2 text-right">
          <div className="flex items-center justify-end gap-1">
            {result.hostId && (
              <Link
                to={`/hosts/${result.hostId}`}
                className="rounded px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-900/20"
              >
                View Host
              </Link>
            )}
            {!result.hostId && result.detectedPlatform === "linux-server" && (
              <button
                onClick={onTogglePromote}
                className="rounded px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/20"
              >
                Promote SSH
              </button>
            )}
            {!result.hostId && result.detectedPlatform === "windows-server" && (
              <button
                onClick={onTogglePromote}
                className="rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20"
              >
                Promote WinRM
              </button>
            )}
            {!result.dismissed && (
              <button
                onClick={() => dismissMutation.mutate(result.id)}
                disabled={dismissMutation.isPending}
                className="rounded px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
                title="Dismiss"
              >
                {dismissMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
              </button>
            )}
          </div>
        </td>
      </tr>

      {/* Promote inline form */}
      {promoteOpen && (
        <tr>
          <td colSpan={10} className="bg-gray-50 px-6 py-3 dark:bg-gray-800/50">
            <PromoteForm
              result={result}
              promoteType={result.detectedPlatform === "windows-server" ? "winrm" : "ssh_linux"}
              onClose={onTogglePromote}
            />
          </td>
        </tr>
      )}

      {/* Expanded ports table */}
      {expanded && (
        <tr>
          <td colSpan={10} className="bg-gray-50 px-6 py-3 dark:bg-gray-800/50">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
                  <th className="pb-2 text-left">Port</th>
                  <th className="pb-2 text-left">Protocol</th>
                  <th className="pb-2 text-left">State</th>
                  <th className="pb-2 text-left">Service</th>
                  <th className="pb-2 text-left">Product</th>
                  <th className="pb-2 text-left">Version</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {result.openPorts.map((p, i) => (
                  <tr key={i}>
                    <td className="py-1.5 font-mono text-gray-900 dark:text-gray-100">{p.port}</td>
                    <td className="py-1.5 text-gray-600 dark:text-gray-400">{p.protocol}</td>
                    <td className="py-1.5">
                      <span className={`inline-flex rounded-full px-1.5 py-0.5 text-xs font-medium ${
                        p.state === "open"
                          ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                          : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400"
                      }`}>
                        {p.state}
                      </span>
                    </td>
                    <td className="py-1.5 text-gray-700 dark:text-gray-300">{p.service || "-"}</td>
                    <td className="py-1.5 text-gray-700 dark:text-gray-300">{p.product || "-"}</td>
                    <td className="py-1.5 text-gray-700 dark:text-gray-300">{p.version || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Promote form ───

function PromoteForm({
  result,
  promoteType,
  onClose,
}: {
  result: DiscoveryResult;
  promoteType: string;
  onClose: () => void;
}) {
  const { data: targets } = useScanTargets();
  const promoteMutation = usePromoteDiscovery();
  const [templateId, setTemplateId] = useState("");
  const [name, setName] = useState(result.hostname ?? result.ipAddress);

  const compatibleTargets = (targets ?? []).filter(
    (t) => t.type === promoteType
  );

  const handlePromote = () => {
    if (!templateId) return;
    promoteMutation.mutate(
      { id: result.id, type: promoteType, templateTargetId: templateId, name },
      { onSuccess: onClose }
    );
  };

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
          Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-48 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
          Credential Template ({promoteType === "ssh_linux" ? "SSH" : "WinRM"} target)
        </label>
        {compatibleTargets.length === 0 ? (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            No {promoteType === "ssh_linux" ? "SSH" : "WinRM"} targets exist. Create one first.
          </p>
        ) : (
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="w-56 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
          >
            <option value="">Select a template...</option>
            {compatibleTargets.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        )}
      </div>
      <button
        onClick={handlePromote}
        disabled={!templateId || promoteMutation.isPending}
        className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {promoteMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        Promote
      </button>
      <button
        onClick={onClose}
        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
      >
        Cancel
      </button>
    </div>
  );
}
