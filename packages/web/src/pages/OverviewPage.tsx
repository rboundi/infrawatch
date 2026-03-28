import {
  Server,
  Package,
  AlertTriangle,
  Radar,
  AlertCircle,
  Check,
  GitCommitHorizontal,
} from "lucide-react";
import { useOverviewStats, useAlerts, useAcknowledgeAlert, useChanges } from "../api/hooks";
import { SeverityBadge } from "../components/SeverityBadge";
import { CardSkeleton, TableSkeleton } from "../components/Skeleton";
import { timeAgo } from "../components/timeago";
import type { Alert } from "../api/types";

export function OverviewPage() {
  const stats = useOverviewStats();
  const recentAlerts = useAlerts({
    severity: "critical,high",
    acknowledged: "false",
    limit: 10,
    sortBy: "createdAt",
    order: "desc",
  });
  const ackMutation = useAcknowledgeAlert();
  const recentChanges = useChanges({ limit: 8, page: 1 });

  const handleAck = (alert: Alert) => {
    ackMutation.mutate({ id: alert.id });
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
        Dashboard
      </h2>

      {/* Stats cards */}
      {stats.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : stats.data ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={Server}
            label="Total Hosts"
            value={stats.data.totalHosts}
            sub={`${stats.data.activeHosts} active · ${stats.data.staleHosts} stale`}
            iconColor="text-indigo-600 dark:text-indigo-400"
          />
          <StatCard
            icon={Package}
            label="Packages Tracked"
            value={stats.data.totalPackages}
            iconColor="text-emerald-600 dark:text-emerald-400"
          />
          <StatCard
            icon={AlertTriangle}
            label="Open Alerts"
            value={stats.data.totalAlerts}
            sub={
              stats.data.criticalAlerts > 0
                ? `${stats.data.criticalAlerts} critical`
                : undefined
            }
            subColor={stats.data.criticalAlerts > 0 ? "text-red-600 dark:text-red-400" : undefined}
            iconColor="text-amber-600 dark:text-amber-400"
          />
          <StatCard
            icon={Radar}
            label="Scan Targets"
            value={stats.data.scanTargets}
            sub={
              stats.data.lastScanAt
                ? `Last scan ${timeAgo(stats.data.lastScanAt)}`
                : "No scans yet"
            }
            iconColor="text-purple-600 dark:text-purple-400"
          />
        </div>
      ) : null}

      {/* Stale hosts warning */}
      {stats.data && stats.data.staleHosts > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 dark:border-yellow-800 dark:bg-yellow-900/20">
          <AlertCircle className="h-5 w-5 flex-shrink-0 text-yellow-600 dark:text-yellow-400" />
          <p className="text-sm text-yellow-800 dark:text-yellow-300">
            <strong>{stats.data.staleHosts} host(s)</strong> haven't reported in
            over 24 hours and are marked as stale.
          </p>
        </div>
      )}

      {/* Recent critical/high alerts */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Recent Critical & High Alerts
          </h3>
        </div>

        {recentAlerts.isLoading ? (
          <div className="p-4">
            <TableSkeleton rows={5} />
          </div>
        ) : recentAlerts.data && recentAlerts.data.data.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  <th className="px-4 py-2">Severity</th>
                  <th className="px-4 py-2">Host</th>
                  <th className="px-4 py-2">Package</th>
                  <th className="px-4 py-2">Version</th>
                  <th className="px-4 py-2">When</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {recentAlerts.data.data.map((alert) => (
                  <tr
                    key={alert.id}
                    className="text-gray-700 dark:text-gray-300"
                  >
                    <td className="px-4 py-2.5">
                      <SeverityBadge severity={alert.severity} />
                    </td>
                    <td className="px-4 py-2.5 font-medium">
                      {alert.hostname ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs">
                      {alert.packageName}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs">
                      <span className="text-gray-500 dark:text-gray-400">
                        {alert.currentVersion ?? "?"}
                      </span>
                      <span className="mx-1 text-gray-400 dark:text-gray-500">
                        →
                      </span>
                      <span className="text-emerald-700 dark:text-emerald-400">
                        {alert.availableVersion ?? "?"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">
                      {timeAgo(alert.createdAt)}
                    </td>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => handleAck(alert)}
                        disabled={ackMutation.isPending}
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
                        title="Acknowledge"
                      >
                        <Check className="h-3 w-3" />
                        Ack
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No critical or high alerts. All clear.
          </div>
        )}
      </div>

      {/* Recent changes */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Recent Changes
          </h3>
          <a
            href="/changes"
            className="text-xs font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
          >
            View all
          </a>
        </div>

        {recentChanges.isLoading ? (
          <div className="p-4">
            <TableSkeleton rows={4} />
          </div>
        ) : recentChanges.data && recentChanges.data.data.length > 0 ? (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {recentChanges.data.data.map((event) => (
              <li key={event.id} className="flex items-center gap-3 px-4 py-2.5">
                <GitCommitHorizontal className="h-4 w-4 flex-shrink-0 text-indigo-500 dark:text-indigo-400" />
                <span className="min-w-0 flex-1 truncate text-sm text-gray-700 dark:text-gray-300">
                  {event.summary}
                </span>
                <span className="whitespace-nowrap text-xs text-gray-400 dark:text-gray-500">
                  {timeAgo(event.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No changes recorded yet.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Stat card component ───

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  subColor,
  iconColor,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  sub?: string;
  subColor?: string;
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
      {sub && (
        <p
          className={`mt-2 text-xs ${subColor ?? "text-gray-500 dark:text-gray-400"}`}
        >
          {sub}
        </p>
      )}
    </div>
  );
}
