import { useState, useMemo } from "react";
import {
  Search,
  Download,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  LogIn,
  LogOut,
  UserPlus,
  Settings,
  ShieldAlert,
  Bell,
  Plus,
  Check,
  CheckCheck,
  Lock,
  Unlock,
  Trash2,
  Eye,
  FileText,
  RefreshCw,
} from "lucide-react";
import {
  useAuditLog,
  useAuditUsers,
  type AuditLogFilters,
  type AuditLogEntry,
} from "../../api/admin-hooks";
import { useToast } from "../../components/Toast";
import { get } from "../../api/client";
import type { AuditLogResponse } from "../../api/admin-hooks";
import { TableSkeleton } from "../../components/Skeleton";

// ─── Time helpers ───

function formatAbsolute(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatRelative(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

// ─── Action config ───

interface ActionConfig {
  icon: React.ReactNode;
  label: string;
}

function getActionConfig(action: string): ActionConfig {
  switch (action) {
    case "user.login":
      return {
        icon: <LogIn className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />,
        label: "Logged in",
      };
    case "user.login_failed":
      return {
        icon: <Lock className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />,
        label: "Failed login",
      };
    case "user.logout":
      return {
        icon: <LogOut className="h-3.5 w-3.5 text-gray-500 dark:text-gray-400" />,
        label: "Logged out",
      };
    case "user.created":
      return {
        icon: <UserPlus className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />,
        label: "User created",
      };
    case "user.updated":
      return {
        icon: <Settings className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />,
        label: "User updated",
      };
    case "user.deleted":
      return {
        icon: <Trash2 className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />,
        label: "User deleted",
      };
    case "user.password_reset":
      return {
        icon: <Lock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />,
        label: "Password reset",
      };
    case "user.unlocked":
      return {
        icon: <Unlock className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />,
        label: "User unlocked",
      };
    case "scan_target.created":
      return {
        icon: <Plus className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />,
        label: "Target created",
      };
    case "scan_target.updated":
      return {
        icon: <Settings className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />,
        label: "Target updated",
      };
    case "scan_target.deleted":
      return {
        icon: <Trash2 className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />,
        label: "Target deleted",
      };
    case "scan_target.scanned":
      return {
        icon: <RefreshCw className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />,
        label: "Scan triggered",
      };
    case "alert.acknowledged":
      return {
        icon: <Check className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />,
        label: "Alert acknowledged",
      };
    case "alert.bulk_acknowledged":
      return {
        icon: <CheckCheck className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />,
        label: "Bulk acknowledged",
      };
    case "setting.updated":
      return {
        icon: <Settings className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />,
        label: "Setting updated",
      };
    case "settings.smtp_test":
      return {
        icon: <Bell className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />,
        label: "SMTP test",
      };
    case "notification_channel.created":
      return {
        icon: <Bell className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />,
        label: "Channel created",
      };
    case "notification_channel.updated":
      return {
        icon: <Bell className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />,
        label: "Channel updated",
      };
    case "notification_channel.deleted":
      return {
        icon: <Bell className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />,
        label: "Channel deleted",
      };
    default:
      return {
        icon: <Eye className="h-3.5 w-3.5 text-gray-400" />,
        label: action,
      };
  }
}

// ─── Detail renderer ───

function renderDetails(entry: AuditLogEntry): React.ReactNode {
  const { action, details } = entry;

  if (action === "setting.updated") {
    const key = details.key as string | undefined;
    const oldVal = details.oldValue;
    const newVal = details.newValue;
    if (key !== undefined) {
      return (
        <div className="space-y-1">
          <div className="font-mono text-xs text-gray-500 dark:text-gray-400">{key}</div>
          <div className="flex items-center gap-1.5 text-xs">
            <span className="rounded bg-red-100 px-1.5 py-0.5 font-mono text-red-700 dark:bg-red-900/30 dark:text-red-300">
              {String(oldVal ?? "—")}
            </span>
            <span className="text-gray-400">→</span>
            <span className="rounded bg-green-100 px-1.5 py-0.5 font-mono text-green-700 dark:bg-green-900/30 dark:text-green-300">
              {String(newVal ?? "—")}
            </span>
          </div>
        </div>
      );
    }
  }

  if (action === "alert.bulk_acknowledged") {
    const count = details.count as number | undefined;
    if (count !== undefined) {
      return (
        <span className="text-xs text-gray-600 dark:text-gray-400">
          {count} alert{count !== 1 ? "s" : ""} acknowledged
        </span>
      );
    }
  }

  const keys = Object.keys(details);
  if (keys.length === 0) return <span className="text-xs text-gray-400">—</span>;

  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-gray-50 px-2 py-1.5 font-mono text-xs text-gray-700 dark:bg-gray-900/50 dark:text-gray-300">
      {JSON.stringify(details, null, 2)}
    </pre>
  );
}

// ─── Action dropdown options ───

const ACTION_GROUPS = [
  {
    label: "Authentication",
    actions: [
      { value: "user.login", label: "Logged in" },
      { value: "user.login_failed", label: "Failed login" },
      { value: "user.logout", label: "Logged out" },
    ],
  },
  {
    label: "Users",
    actions: [
      { value: "user.created", label: "User created" },
      { value: "user.updated", label: "User updated" },
      { value: "user.deleted", label: "User deleted" },
      { value: "user.password_reset", label: "Password reset" },
      { value: "user.unlocked", label: "User unlocked" },
    ],
  },
  {
    label: "Scan Targets",
    actions: [
      { value: "scan_target.created", label: "Target created" },
      { value: "scan_target.updated", label: "Target updated" },
      { value: "scan_target.deleted", label: "Target deleted" },
      { value: "scan_target.scanned", label: "Scan triggered" },
    ],
  },
  {
    label: "Alerts",
    actions: [
      { value: "alert.acknowledged", label: "Alert acknowledged" },
      { value: "alert.bulk_acknowledged", label: "Bulk acknowledged" },
    ],
  },
  {
    label: "Notifications",
    actions: [
      { value: "notification_channel.created", label: "Channel created" },
      { value: "notification_channel.updated", label: "Channel updated" },
      { value: "notification_channel.deleted", label: "Channel deleted" },
    ],
  },
  {
    label: "Settings",
    actions: [
      { value: "setting.updated", label: "Setting updated" },
      { value: "settings.smtp_test", label: "SMTP test" },
    ],
  },
];

// ─── Date range presets ───

type DatePreset = "today" | "7days" | "30days" | "all";

function getDateRange(preset: DatePreset): { since?: string; until?: string } {
  if (preset === "all") return {};
  const now = new Date();
  const until = now.toISOString();
  if (preset === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { since: start.toISOString(), until };
  }
  if (preset === "7days") {
    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { since: start.toISOString(), until };
  }
  if (preset === "30days") {
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { since: start.toISOString(), until };
  }
  return {};
}

// ─── CSV export ───

function entriesToCsv(entries: AuditLogEntry[]): string {
  const headers = ["Timestamp", "User", "Action", "Entity Type", "Entity ID", "Details", "IP"];
  const rows = entries.map((e) => [
    formatAbsolute(e.createdAt),
    e.displayName ?? e.username,
    e.action,
    e.entityType ?? "",
    e.entityId ?? "",
    JSON.stringify(e.details),
    e.ipAddress ?? "",
  ]);
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n");
}

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ─── Row component ───

function AuditLogRow({ entry }: { entry: AuditLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const { icon, label } = getActionConfig(entry.action);
  const hasDetails = Object.keys(entry.details).length > 0;

  return (
    <>
      <tr className="text-gray-700 transition-colors hover:bg-gray-50/50 dark:text-gray-300 dark:hover:bg-gray-700/30">
        {/* Timestamp */}
        <td className="whitespace-nowrap px-3 py-2.5">
          <div className="text-xs font-medium text-gray-800 dark:text-gray-200">
            {formatAbsolute(entry.createdAt)}
          </div>
          <div className="text-xs text-gray-400 dark:text-gray-500">
            {formatRelative(entry.createdAt)}
          </div>
        </td>

        {/* User */}
        <td className="whitespace-nowrap px-3 py-2.5">
          {entry.userId === null ? (
            <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-400">
              System
            </span>
          ) : (
            <div>
              <div className="text-xs font-medium text-gray-800 dark:text-gray-200">
                {entry.displayName ?? entry.username}
              </div>
              {entry.displayName && (
                <div className="text-xs text-gray-400 dark:text-gray-500">
                  @{entry.username}
                </div>
              )}
            </div>
          )}
        </td>

        {/* Action */}
        <td className="whitespace-nowrap px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            {icon}
            <span className="text-xs font-medium">{label}</span>
          </div>
        </td>

        {/* Entity */}
        <td className="px-3 py-2.5">
          {entry.entityType ? (
            <div>
              <div className="text-xs font-medium capitalize text-gray-700 dark:text-gray-300">
                {entry.entityType.replace(/_/g, " ")}
              </div>
              {entry.entityId && (
                <div
                  className="max-w-[120px] truncate font-mono text-xs text-gray-400 dark:text-gray-500"
                  title={entry.entityId}
                >
                  {entry.entityId}
                </div>
              )}
            </div>
          ) : (
            <span className="text-xs text-gray-400">—</span>
          )}
        </td>

        {/* Details */}
        <td className="px-3 py-2.5">
          {hasDetails ? (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-900/20"
            >
              <FileText className="h-3 w-3" />
              {expanded ? "Hide" : "Show"}
              {expanded ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </button>
          ) : (
            <span className="text-xs text-gray-400">—</span>
          )}
        </td>

        {/* IP */}
        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-gray-500 dark:text-gray-400">
          {entry.ipAddress ?? "—"}
        </td>
      </tr>

      {/* Expanded details row */}
      {expanded && hasDetails && (
        <tr className="bg-gray-50/70 dark:bg-gray-800/50">
          <td colSpan={6} className="px-4 py-3">
            {renderDetails(entry)}
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Main page ───

const PAGE_LIMIT = 50;

export function AuditLogPage() {
  const { toast } = useToast();

  // Filters
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [selectedAction, setSelectedAction] = useState<string>("");
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [isExporting, setIsExporting] = useState(false);

  // Fetch users list for dropdown
  const { data: usersData } = useAuditUsers();
  const users = usersData?.data ?? [];

  // Build date range
  const dateRange = useMemo(() => getDateRange(datePreset), [datePreset]);

  // Build filters for API
  const filters: AuditLogFilters = useMemo(() => {
    const f: AuditLogFilters = { page, limit: PAGE_LIMIT };
    if (selectedUserId) f.userId = selectedUserId;
    if (selectedAction) f.action = selectedAction;
    if (dateRange.since) f.since = dateRange.since;
    if (dateRange.until) f.until = dateRange.until;
    return f;
  }, [page, selectedUserId, selectedAction, dateRange]);

  const { data, isLoading } = useAuditLog(filters);

  // Client-side search filtering (search by username, displayName, entityId, action label)
  const filteredEntries = useMemo(() => {
    if (!data?.data) return [];
    if (!search.trim()) return data.data;
    const q = search.toLowerCase();
    return data.data.filter(
      (e) =>
        (e.displayName ?? e.username).toLowerCase().includes(q) ||
        e.username.toLowerCase().includes(q) ||
        e.action.toLowerCase().includes(q) ||
        (e.entityType ?? "").toLowerCase().includes(q) ||
        (e.entityId ?? "").toLowerCase().includes(q) ||
        (e.ipAddress ?? "").toLowerCase().includes(q) ||
        getActionConfig(e.action).label.toLowerCase().includes(q)
    );
  }, [data, search]);

  const handlePreset = (preset: DatePreset) => {
    setDatePreset(preset);
    setPage(1);
  };

  const handleExport = async () => {
    if (!data || data.total === 0) {
      toast("No data to export", "info");
      return;
    }
    setIsExporting(true);
    try {
      const allEntries: AuditLogEntry[] = [];
      const totalPages = data.totalPages;
      for (let p = 1; p <= totalPages; p++) {
        const pageData = await get<AuditLogResponse>("/audit-log", {
          ...filters,
          page: p,
          limit: PAGE_LIMIT,
        } as Record<string, unknown>);
        allEntries.push(...pageData.data);
      }
      const csv = entriesToCsv(allEntries);
      const timestamp = new Date().toISOString().slice(0, 10);
      downloadCsv(csv, `audit-log-${timestamp}.csv`);
      toast(`Exported ${allEntries.length} entries`, "success");
    } catch {
      toast("Export failed", "error");
    } finally {
      setIsExporting(false);
    }
  };

  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const startEntry = total === 0 ? 0 : (page - 1) * PAGE_LIMIT + 1;
  const endEntry = Math.min(page * PAGE_LIMIT, total);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Audit Log</h2>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
            Track all administrative and user actions
          </p>
        </div>
        <button
          onClick={handleExport}
          disabled={isExporting || total === 0}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          <Download className="h-4 w-4" />
          {isExporting ? "Exporting..." : "Export CSV"}
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative min-w-[200px] flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search user, action, IP..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
          />
        </div>

        {/* User filter */}
        <select
          value={selectedUserId}
          onChange={(e) => {
            setSelectedUserId(e.target.value);
            setPage(1);
          }}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-indigo-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
        >
          <option value="">All Users</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName ?? u.username}
            </option>
          ))}
        </select>

        {/* Action filter */}
        <select
          value={selectedAction}
          onChange={(e) => {
            setSelectedAction(e.target.value);
            setPage(1);
          }}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-indigo-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
        >
          <option value="">All Actions</option>
          {ACTION_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.actions.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </optgroup>
          ))}
          <optgroup label="Other">
            <option value="__other__">Other</option>
          </optgroup>
        </select>

        {/* Date range presets */}
        <div className="inline-flex rounded-md border border-gray-300 dark:border-gray-600">
          {(
            [
              { key: "today" as DatePreset, label: "Today" },
              { key: "7days" as DatePreset, label: "7 Days" },
              { key: "30days" as DatePreset, label: "30 Days" },
              { key: "all" as DatePreset, label: "All" },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => handlePreset(key)}
              className={`px-3 py-1.5 text-xs font-medium first:rounded-l-md last:rounded-r-md ${
                datePreset === key
                  ? "bg-indigo-600 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
        {isLoading ? (
          <div className="p-4">
            <TableSkeleton rows={10} />
          </div>
        ) : filteredEntries.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:bg-gray-800/80 dark:text-gray-400">
                    <th className="px-3 py-2.5">Timestamp</th>
                    <th className="px-3 py-2.5">User</th>
                    <th className="px-3 py-2.5">Action</th>
                    <th className="px-3 py-2.5">Entity</th>
                    <th className="px-3 py-2.5">Details</th>
                    <th className="px-3 py-2.5">IP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {filteredEntries.map((entry) => (
                    <AuditLogRow key={entry.id} entry={entry} />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 dark:border-gray-700">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {total === 0
                  ? "No entries"
                  : `Showing ${startEntry}–${endEntry} of ${total} entries`}
                {search && filteredEntries.length < (data?.data.length ?? 0) && (
                  <span className="ml-1 text-indigo-600 dark:text-indigo-400">
                    ({filteredEntries.length} matching search)
                  </span>
                )}
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
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page >= totalPages}
                  className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:text-gray-400 dark:hover:bg-gray-700"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="px-4 py-12 text-center">
            <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-gray-300 dark:text-gray-600" />
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
              No audit log entries found
            </p>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              {selectedUserId || selectedAction || datePreset !== "all" || search
                ? "Try adjusting your filters to see more results."
                : "No actions have been logged yet."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
