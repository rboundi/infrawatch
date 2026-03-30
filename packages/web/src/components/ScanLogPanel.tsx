import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  Terminal,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
} from "lucide-react";
import { useScanLogs, useScanLogDetail } from "../api/hooks";
import { useScanLogStream } from "../hooks/useScanLogStream";
import { timeAgo } from "./timeago";
import type { ScanLog, ScanLogEntry } from "../api/types";

// ─── Level colors ───

const LEVEL_COLORS: Record<string, string> = {
  info: "text-gray-300",
  warn: "text-yellow-400",
  error: "text-red-400",
  success: "text-green-400",
};

const LEVEL_PREFIX: Record<string, string> = {
  info: "ℹ",
  warn: "⚠",
  error: "✖",
  success: "✔",
};

// ─── Main panel ───

interface ScanLogPanelProps {
  targetId: string;
  lastScanStatus: string;
  /** Set by parent when a manual scan is triggered */
  activeScanLogId: string | null;
}

export function ScanLogPanel({
  targetId,
  lastScanStatus,
  activeScanLogId,
}: ScanLogPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);

  // Auto-expand when a scan starts
  useEffect(() => {
    if (activeScanLogId) setExpanded(true);
  }, [activeScanLogId]);

  // Auto-expand if scan is running
  useEffect(() => {
    if (lastScanStatus === "running") setExpanded(true);
  }, [lastScanStatus]);

  return (
    <div className="border-t border-gray-100 dark:border-gray-700">
      {/* Toggle header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 px-4 py-2 text-xs font-medium text-gray-500 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-700/50"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        <Terminal className="h-3.5 w-3.5" />
        Scan Logs
      </button>

      {expanded && (
        <div className="px-4 pb-3">
          {/* Live stream if scan is running */}
          {(lastScanStatus === "running" || activeScanLogId) && (
            <LiveStream targetId={targetId} logId={activeScanLogId} />
          )}

          {/* Historical scan logs */}
          <ScanLogHistory
            targetId={targetId}
            page={historyPage}
            onPageChange={setHistoryPage}
          />
        </div>
      )}
    </div>
  );
}

// ─── Live stream ───

function LiveStream({
  targetId,
  logId,
}: {
  targetId: string;
  logId: string | null;
}) {
  const qc = useQueryClient();
  const { entries, isStreaming, status } = useScanLogStream(targetId, logId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // When stream completes, refresh scan logs history and targets list
  useEffect(() => {
    if (status) {
      qc.invalidateQueries({ queryKey: ["targets", targetId, "scan-logs"] });
      qc.invalidateQueries({ queryKey: ["targets"] });
    }
  }, [status, qc, targetId]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, autoScroll]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 40);
  };

  if (!logId && entries.length === 0) {
    return (
      <div className="mb-2 flex items-center gap-2 rounded bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Waiting for scan to start...
      </div>
    );
  }

  return (
    <div className="mb-2">
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {isStreaming ? (
            <>
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
              </span>
              <span className="text-xs font-medium text-green-600 dark:text-green-400">
                Live
              </span>
            </>
          ) : status ? (
            <span
              className={`text-xs font-medium ${
                status === "success"
                  ? "text-green-600 dark:text-green-400"
                  : "text-red-600 dark:text-red-400"
              }`}
            >
              {status === "success" ? "Completed" : "Failed"}
            </span>
          ) : null}
        </div>
        {!autoScroll && isStreaming && (
          <button
            onClick={() => setAutoScroll(true)}
            className="text-xs text-indigo-500 hover:text-indigo-700"
          >
            ↓ Follow
          </button>
        )}
      </div>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="max-h-48 overflow-y-auto rounded bg-gray-900 px-3 py-2 font-mono text-xs leading-relaxed"
      >
        {entries.map((entry) => (
          <LogLine key={entry.id} entry={entry} />
        ))}
        {isStreaming && entries.length > 0 && (
          <div className="flex items-center gap-1 text-gray-500">
            <Loader2 className="h-3 w-3 animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Log line ───

function LogLine({ entry }: { entry: ScanLogEntry }) {
  const time = new Date(entry.timestamp).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div className={`${LEVEL_COLORS[entry.level] ?? "text-gray-300"}`}>
      <span className="text-gray-500">[{time}]</span>{" "}
      <span>{LEVEL_PREFIX[entry.level] ?? "·"}</span> {entry.message}
    </div>
  );
}

// ─── Scan log history ───

function ScanLogHistory({
  targetId,
  page,
  onPageChange,
}: {
  targetId: string;
  page: number;
  onPageChange: (p: number) => void;
}) {
  const { data, isLoading } = useScanLogs(targetId, { page, limit: 5 });
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="py-2 text-center text-xs text-gray-400">
        Loading scan history...
      </div>
    );
  }

  if (!data || data.data.length === 0) {
    return (
      <div className="py-2 text-center text-xs text-gray-400 dark:text-gray-500">
        No scan history yet
      </div>
    );
  }

  return (
    <div>
      <h4 className="mb-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
        History
      </h4>
      <div className="space-y-1">
        {data.data.map((log) => (
          <ScanLogRow
            key={log.id}
            log={log}
            targetId={targetId}
            isExpanded={expandedLogId === log.id}
            onToggle={() =>
              setExpandedLogId(expandedLogId === log.id ? null : log.id)
            }
          />
        ))}
      </div>

      {/* Pagination */}
      {data.totalPages > 1 && (
        <div className="mt-2 flex items-center justify-center gap-2">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className="rounded px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-700"
          >
            ← Prev
          </button>
          <span className="text-xs text-gray-400">
            {page} / {data.totalPages}
          </span>
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= data.totalPages}
            className="rounded px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-700"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Individual scan log row ───

function ScanLogRow({
  log,
  targetId,
  isExpanded,
  onToggle,
}: {
  log: ScanLog;
  targetId: string;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const duration =
    log.completedAt && log.startedAt
      ? ((new Date(log.completedAt).getTime() -
          new Date(log.startedAt).getTime()) /
          1000).toFixed(1) + "s"
      : "—";

  return (
    <div className="rounded border border-gray-100 dark:border-gray-700">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-gray-50 dark:hover:bg-gray-700/50"
      >
        <ScanLogStatusIcon status={log.status} />
        <span className="flex-1 text-gray-600 dark:text-gray-300">
          {timeAgo(log.startedAt)}
        </span>
        <span className="text-gray-400">{duration}</span>
        {log.hostsDiscovered > 0 && (
          <span className="text-gray-400">
            {log.hostsDiscovered}h / {log.packagesDiscovered}p
          </span>
        )}
        {isExpanded ? (
          <ChevronDown className="h-3 w-3 text-gray-400" />
        ) : (
          <ChevronRight className="h-3 w-3 text-gray-400" />
        )}
      </button>

      {isExpanded && (
        <ExpandedLogEntries targetId={targetId} logId={log.id} />
      )}
    </div>
  );
}

// ─── Expanded log entries ───

function ExpandedLogEntries({
  targetId,
  logId,
}: {
  targetId: string;
  logId: string;
}) {
  const { data, isLoading } = useScanLogDetail(targetId, logId);

  if (isLoading) {
    return (
      <div className="border-t border-gray-100 px-2.5 py-2 text-xs text-gray-400 dark:border-gray-700">
        Loading...
      </div>
    );
  }

  if (!data?.entries || data.entries.length === 0) {
    return (
      <div className="border-t border-gray-100 px-2.5 py-2 text-xs text-gray-400 dark:border-gray-700">
        No log entries
        {data?.errorMessage && (
          <div className="mt-1 text-red-400">{data.errorMessage}</div>
        )}
      </div>
    );
  }

  return (
    <div className="border-t border-gray-100 dark:border-gray-700">
      <div className="max-h-36 overflow-y-auto rounded-b bg-gray-900 px-2.5 py-1.5 font-mono text-xs leading-relaxed">
        {data.entries.map((entry) => (
          <LogLine key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  );
}

// ─── Status icon ───

function ScanLogStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "success":
      return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
    case "failed":
      return <XCircle className="h-3.5 w-3.5 text-red-500" />;
    case "running":
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />;
    default:
      return <Clock className="h-3.5 w-3.5 text-gray-400" />;
  }
}
