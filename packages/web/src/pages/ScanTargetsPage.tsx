import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Plus,
  Play,
  Square,
  Pencil,
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Ban,
  Zap,
} from "lucide-react";
import {
  useScanTargets,
  useTriggerScan,
  useCancelScan,
  useDeleteTarget,
  useUpdateTarget,
  useTestConnection,
} from "../api/hooks";
import { CardSkeleton } from "../components/Skeleton";
import { timeAgo } from "../components/timeago";
import { ScanLogPanel } from "../components/ScanLogPanel";
import type { ScanTarget } from "../api/types";

const TYPE_COLORS: Record<string, string> = {
  ssh_linux: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  winrm: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  kubernetes: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300",
  aws: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  vmware: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  docker: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300",
  network_discovery: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
};

const TYPE_LABELS: Record<string, string> = {
  ssh_linux: "SSH (Linux)",
  winrm: "WinRM",
  kubernetes: "Kubernetes",
  aws: "AWS",
  vmware: "VMware",
  docker: "Docker",
  network_discovery: "Network Discovery",
};

export function ScanTargetsPage() {
  const { data: targets, isLoading } = useScanTargets();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          Scan Targets
        </h2>
        <Link
          to="/targets/new"
          className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          <Plus className="h-4 w-4" />
          Add Target
        </Link>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : targets && targets.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {targets.map((t) => (
            <TargetCard key={t.id} target={t} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white px-6 py-12 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <Zap className="mx-auto mb-3 h-8 w-8 text-gray-300 dark:text-gray-600" />
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
            No scan targets configured
          </p>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
            Add a target to start discovering your infrastructure.
          </p>
          <Link
            to="/targets/new"
            className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4" />
            Add Target
          </Link>
        </div>
      )}
    </div>
  );
}

// ─── Target card ───

function TargetCard({ target }: { target: ScanTarget }) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [activeScanLogId, setActiveScanLogId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    latencyMs: number;
  } | null>(null);

  const triggerScan = useTriggerScan();
  const cancelScan = useCancelScan();
  const deleteMutation = useDeleteTarget();
  const updateMutation = useUpdateTarget();
  const testMutation = useTestConnection();

  const isRunning = target.lastScanStatus === "running";

  const handleToggleEnabled = () => {
    updateMutation.mutate({ id: target.id, enabled: !target.enabled });
  };

  const handleScanNow = () => {
    triggerScan.mutate(target.id, {
      onSuccess: (data) => {
        setActiveScanLogId(data.scanLogId);
      },
    });
  };

  const handleTest = () => {
    setTestResult(null);
    testMutation.mutate(target.id, {
      onSuccess: (result) => setTestResult(result),
    });
  };

  const handleDelete = () => {
    deleteMutation.mutate(target.id, {
      onSuccess: () => setShowDeleteConfirm(false),
    });
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      {/* Header */}
      <div className="border-b border-gray-100 px-4 py-3 dark:border-gray-700">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-gray-900 dark:text-gray-100">
              {target.name}
            </h3>
            <span
              className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                TYPE_COLORS[target.type] ?? "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400"
              }`}
            >
              {TYPE_LABELS[target.type] ?? target.type}
            </span>
          </div>
          <StatusIndicator status={target.lastScanStatus} />
        </div>
      </div>

      {/* Body */}
      <div className="space-y-2 px-4 py-3 text-sm">
        <div className="flex justify-between text-gray-500 dark:text-gray-400">
          <span>Last scanned</span>
          <span className="font-medium text-gray-700 dark:text-gray-300">
            {target.lastScannedAt ? timeAgo(target.lastScannedAt) : "Never"}
          </span>
        </div>
        <div className="flex justify-between text-gray-500 dark:text-gray-400">
          <span>Interval</span>
          <span className="font-medium text-gray-700 dark:text-gray-300">
            Every {target.scanIntervalHours}h
          </span>
        </div>

        {/* Error message */}
        {target.lastScanStatus === "failed" && target.lastScanError && (
          <div className="rounded bg-red-50 px-2.5 py-1.5 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-400">
            <p className="truncate" title={target.lastScanError}>
              {target.lastScanError}
            </p>
          </div>
        )}

        {/* Test result */}
        {testResult && (
          <div
            className={`rounded px-2.5 py-1.5 text-xs ${
              testResult.success
                ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                : "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
            }`}
          >
            {testResult.success ? "Connected" : "Failed"}: {testResult.message} ({testResult.latencyMs}ms)
          </div>
        )}

        {/* Enabled toggle */}
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-gray-500 dark:text-gray-400">Enabled</span>
          <button
            onClick={handleToggleEnabled}
            disabled={updateMutation.isPending}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              target.enabled
                ? "bg-indigo-600"
                : "bg-gray-300 dark:bg-gray-600"
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                target.enabled ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 border-t border-gray-100 px-3 py-2 dark:border-gray-700">
        {isRunning ? (
          <button
            onClick={() => cancelScan.mutate(target.id)}
            disabled={cancelScan.isPending}
            className="inline-flex items-center gap-1 rounded px-2 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40 dark:text-red-400 dark:hover:bg-red-900/20"
            title="Stop Scan"
          >
            {cancelScan.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Square className="h-3.5 w-3.5" />
            )}
            Stop
          </button>
        ) : (
          <button
            onClick={handleScanNow}
            disabled={triggerScan.isPending}
            className="inline-flex items-center gap-1 rounded px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-400 dark:hover:bg-gray-700"
            title="Scan Now"
          >
            {triggerScan.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            Scan
          </button>
        )}
        <button
          onClick={handleTest}
          disabled={testMutation.isPending}
          className="inline-flex items-center gap-1 rounded px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-400 dark:hover:bg-gray-700"
          title="Test Connection"
        >
          {testMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Zap className="h-3.5 w-3.5" />
          )}
          Test
        </button>
        <Link
          to={`/targets/${target.id}/edit`}
          className="inline-flex items-center gap-1 rounded px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
          title="Edit"
        >
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </Link>
        <button
          onClick={() => setShowDeleteConfirm(true)}
          className="ml-auto inline-flex items-center gap-1 rounded px-2 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
          title="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Scan log panel */}
      <ScanLogPanel
        targetId={target.id}
        lastScanStatus={target.lastScanStatus}
        activeScanLogId={activeScanLogId}
      />

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="border-t border-red-200 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-900/20">
          <p className="text-xs text-red-800 dark:text-red-300">
            Delete <strong>{target.name}</strong>? This cannot be undone.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              className="rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </button>
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="rounded border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Status indicator ───

function StatusIndicator({ status }: { status: string }) {
  switch (status) {
    case "success":
      return (
        <div className="flex items-center gap-1.5" title="Last scan succeeded">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
          </span>
          <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
        </div>
      );
    case "failed":
      return (
        <div className="flex items-center gap-1.5" title="Last scan failed">
          <span className="inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
          <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
        </div>
      );
    case "running":
      return (
        <div className="flex items-center gap-1.5" title="Scan running">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600 dark:text-blue-400" />
        </div>
      );
    case "cancelled":
      return (
        <div className="flex items-center gap-1.5" title="Scan cancelled">
          <span className="inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
          <Ban className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        </div>
      );
    default:
      return (
        <div className="flex items-center gap-1.5" title="Pending">
          <span className="inline-flex h-2.5 w-2.5 rounded-full bg-gray-400" />
          <Clock className="h-4 w-4 text-gray-400" />
        </div>
      );
  }
}
