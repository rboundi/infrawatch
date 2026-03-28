import { useState } from "react";
import {
  FileText,
  Plus,
  Play,
  Download,
  Eye,
  Trash2,
  X,
  ChevronLeft,
  ChevronRight,
  ToggleLeft,
  ToggleRight,
  Clock,
} from "lucide-react";
import {
  useReportSchedules,
  useReportHistory,
  useCreateReportSchedule,
  useUpdateReportSchedule,
  useDeleteReportSchedule,
  useTriggerReportGeneration,
  useGenerateReportPreview,
} from "../api/hooks";
import { CardSkeleton, TableSkeleton } from "../components/Skeleton";
import { timeAgo } from "../components/timeago";
import type { ReportSchedule } from "../api/types";

const REPORT_TYPES = [
  { value: "weekly_summary", label: "Weekly Summary" },
  { value: "eol_report", label: "EOL Report" },
  { value: "alert_report", label: "Alert Report" },
  { value: "host_inventory", label: "Host Inventory" },
];

const SCHEDULE_PRESETS = [
  { value: "0 8 * * 1", label: "Weekly — Monday 8 AM" },
  { value: "0 8 1,15 * *", label: "Bi-weekly — 1st & 15th 8 AM" },
  { value: "0 8 1 * *", label: "Monthly — 1st 8 AM" },
  { value: "0 8 * * *", label: "Daily — 8 AM" },
  { value: "custom", label: "Custom cron..." },
];

function humanCron(cron: string): string {
  if (cron === "0 8 * * 1") return "Weekly Mon 8 AM";
  if (cron === "0 8 1,15 * *") return "Bi-weekly 8 AM";
  if (cron === "0 8 1 * *") return "Monthly 1st 8 AM";
  if (cron === "0 8 * * *") return "Daily 8 AM";
  return cron;
}

function reportTypeLabel(type: string): string {
  return REPORT_TYPES.find((t) => t.value === type)?.label ?? type;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ReportsPage() {
  const [showForm, setShowForm] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);

  const schedules = useReportSchedules();
  const history = useReportHistory({ page: historyPage, limit: 15 });
  const createMutation = useCreateReportSchedule();
  const updateMutation = useUpdateReportSchedule();
  const deleteMutation = useDeleteReportSchedule();
  const triggerMutation = useTriggerReportGeneration();
  const previewMutation = useGenerateReportPreview();

  const handleToggle = (schedule: ReportSchedule) => {
    updateMutation.mutate({ id: schedule.id, enabled: !schedule.enabled });
  };

  const handleDelete = (id: string) => {
    if (confirm("Delete this schedule?")) {
      deleteMutation.mutate(id);
    }
  };

  const handleGenerate = (id: string) => {
    triggerMutation.mutate(id);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          Reports
        </h2>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          <Plus className="h-4 w-4" /> New Schedule
        </button>
      </div>

      {/* Schedules */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
          Schedules
        </h3>
        {schedules.isLoading ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => <CardSkeleton key={i} />)}
          </div>
        ) : schedules.data && schedules.data.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {schedules.data.map((s) => (
              <div
                key={s.id}
                className={`rounded-lg border bg-white p-4 shadow-sm dark:bg-gray-800 ${
                  s.enabled ? "border-gray-200 dark:border-gray-700" : "border-gray-200 opacity-60 dark:border-gray-700"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-medium text-gray-900 dark:text-gray-100">{s.name}</h4>
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      {reportTypeLabel(s.reportType)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleToggle(s)}
                      className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
                      title={s.enabled ? "Disable" : "Enable"}
                    >
                      {s.enabled
                        ? <ToggleRight className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                        : <ToggleLeft className="h-5 w-5" />}
                    </button>
                    <button
                      onClick={() => handleGenerate(s.id)}
                      disabled={triggerMutation.isPending}
                      className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
                      title="Generate Now"
                    >
                      <Play className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(s.id)}
                      disabled={deleteMutation.isPending}
                      className="rounded p-1 text-gray-500 hover:bg-red-50 hover:text-red-600 dark:text-gray-400 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" /> {humanCron(s.scheduleCron)}
                  </span>
                  {s.recipients.length > 0 && (
                    <span>{s.recipients.length} recipient{s.recipients.length > 1 ? "s" : ""}</span>
                  )}
                  {s.lastGeneratedAt && (
                    <span>
                      Last: {timeAgo(s.lastGeneratedAt)}
                      {s.lastGenerationStatus && (
                        <span className={s.lastGenerationStatus === "success" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
                          {" "}({s.lastGenerationStatus})
                        </span>
                      )}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
            No report schedules configured. Click "New Schedule" to get started.
          </div>
        )}
      </div>

      {/* History */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Report History
          </h3>
        </div>
        {history.isLoading ? (
          <div className="p-4"><TableSkeleton rows={5} /></div>
        ) : history.data && history.data.data.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:text-gray-400">
                    <th className="px-4 py-2">Report</th>
                    <th className="px-4 py-2">Type</th>
                    <th className="px-4 py-2">Period</th>
                    <th className="px-4 py-2">Generated</th>
                    <th className="px-4 py-2">Size</th>
                    <th className="px-4 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {history.data.data.map((r) => (
                    <tr key={r.id} className="text-gray-700 dark:text-gray-300">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-gray-400" />
                          <span className="font-medium">{r.title}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-xs">{reportTypeLabel(r.reportType)}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400">
                        {r.periodStart
                          ? `${new Date(r.periodStart).toLocaleDateString()} – ${new Date(r.periodEnd!).toLocaleDateString()}`
                          : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400">
                        {timeAgo(r.createdAt)}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400">
                        {formatBytes(r.fileSizeBytes)}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex gap-1">
                          <a
                            href={`/api/v1/reports/${r.id}/download`}
                            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
                            title="Download PDF"
                          >
                            <Download className="h-3 w-3" /> PDF
                          </a>
                          <button
                            onClick={() => {
                              previewMutation.mutate(
                                { reportType: r.reportType },
                                { onSuccess: (html) => setPreviewHtml(html) }
                              );
                            }}
                            disabled={previewMutation.isPending}
                            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
                            title="View HTML"
                          >
                            <Eye className="h-3 w-3" /> View
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {history.data.totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 dark:border-gray-700">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Page {history.data.page} of {history.data.totalPages}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                    disabled={history.data.page <= 1}
                    className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
                  >
                    <ChevronLeft className="h-4 w-4" /> Prev
                  </button>
                  <button
                    onClick={() => setHistoryPage((p) => p + 1)}
                    disabled={history.data.page >= history.data.totalPages}
                    className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
                  >
                    Next <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No reports generated yet. Create a schedule or trigger a manual generation.
          </div>
        )}
      </div>

      {/* Add Schedule Modal */}
      {showForm && (
        <ScheduleFormModal
          onClose={() => setShowForm(false)}
          onCreate={(data) => {
            createMutation.mutate(data, { onSuccess: () => setShowForm(false) });
          }}
          isPending={createMutation.isPending}
          onPreview={(reportType) => {
            previewMutation.mutate({ reportType }, { onSuccess: (html) => setPreviewHtml(html) });
          }}
        />
      )}

      {/* Preview Modal */}
      {previewHtml && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="relative mx-4 h-[85vh] w-full max-w-4xl rounded-lg bg-white shadow-xl dark:bg-gray-800">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Report Preview</h3>
              <button onClick={() => setPreviewHtml(null)} className="text-gray-500 hover:text-gray-700 dark:text-gray-400">
                <X className="h-5 w-5" />
              </button>
            </div>
            <iframe
              srcDoc={previewHtml}
              className="h-[calc(85vh-52px)] w-full rounded-b-lg"
              title="Report Preview"
              sandbox=""
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Schedule Form Modal ───

function ScheduleFormModal({
  onClose,
  onCreate,
  isPending,
  onPreview,
}: {
  onClose: () => void;
  onCreate: (data: {
    name: string; reportType: string; scheduleCron: string;
    recipients: string[]; filters?: Record<string, unknown>;
  }) => void;
  isPending: boolean;
  onPreview: (reportType: string) => void;
}) {
  const [name, setName] = useState("");
  const [reportType, setReportType] = useState("weekly_summary");
  const [schedulePreset, setSchedulePreset] = useState("0 8 * * 1");
  const [customCron, setCustomCron] = useState("");
  const [recipientInput, setRecipientInput] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);

  const cron = schedulePreset === "custom" ? customCron : schedulePreset;

  const addRecipient = () => {
    const email = recipientInput.trim();
    if (email && !recipients.includes(email)) {
      setRecipients([...recipients, email]);
      setRecipientInput("");
    }
  };

  const removeRecipient = (email: string) => {
    setRecipients(recipients.filter((r) => r !== email));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onCreate({ name: name.trim(), reportType, scheduleCron: cron, recipients });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-lg rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">New Report Schedule</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 dark:text-gray-400">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Weekly Infrastructure Report"
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Report Type</label>
            <select
              value={reportType}
              onChange={(e) => setReportType(e.target.value)}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            >
              {REPORT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Schedule</label>
            <select
              value={schedulePreset}
              onChange={(e) => setSchedulePreset(e.target.value)}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            >
              {SCHEDULE_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
            {schedulePreset === "custom" && (
              <input
                value={customCron}
                onChange={(e) => setCustomCron(e.target.value)}
                placeholder="0 8 * * 1"
                className="mt-2 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-mono text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              />
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Recipients</label>
            <div className="flex gap-2">
              <input
                value={recipientInput}
                onChange={(e) => setRecipientInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRecipient(); } }}
                placeholder="email@example.com"
                className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              />
              <button
                type="button"
                onClick={addRecipient}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Add
              </button>
            </div>
            {recipients.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {recipients.map((email) => (
                  <span
                    key={email}
                    className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300"
                  >
                    {email}
                    <button type="button" onClick={() => removeRecipient(email)} className="text-indigo-600 hover:text-indigo-800 dark:text-indigo-400">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => onPreview(reportType)}
              className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <Eye className="h-4 w-4" /> Preview
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isPending || !name.trim()}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                Create Schedule
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
