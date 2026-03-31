import { useState } from "react";
import {
  useNotificationChannels,
  useCreateNotificationChannel,
  useUpdateNotificationChannel,
  useDeleteNotificationChannel,
  useTestNotificationChannel,
  useNotificationLog,
  useNotificationLogStats,
} from "../api/hooks";
import type { NotificationChannel, NotificationLogEntry } from "../api/types";

const CHANNEL_TYPES = [
  { value: "ms_teams", label: "Microsoft Teams", icon: "🟦" },
  { value: "slack", label: "Slack", icon: "🟪" },
  { value: "generic_webhook", label: "Generic Webhook", icon: "🔗" },
  { value: "email", label: "Email", icon: "📧" },
] as const;

const CHANNEL_TYPE_MAP: Record<string, { label: string; icon: string }> = Object.fromEntries(
  CHANNEL_TYPES.map((t) => [t.value, { label: t.label, icon: t.icon }])
);

const SEVERITIES = ["info", "low", "medium", "high", "critical"] as const;

const EVENT_TYPES = [
  { value: "alert_created", label: "Alerts" },
  { value: "eol_detected", label: "EOL" },
  { value: "host_disappeared", label: "Host Offline" },
  { value: "scan_failed", label: "Scan Failures" },
  { value: "daily_digest", label: "Daily Digest" },
];

const WEBHOOK_HELP: Record<string, string> = {
  ms_teams: 'Paste Incoming Webhook URL from Teams channel > ... > Connectors > Incoming Webhook',
  slack: 'Paste Webhook URL from Slack app config',
  generic_webhook: 'Any URL accepting POST with JSON',
  email: '',
};

export function NotificationsPage() {
  const { data: channels, isLoading } = useNotificationChannels();
  const { data: logStats } = useNotificationLogStats();
  const [showForm, setShowForm] = useState(false);
  const [editChannel, setEditChannel] = useState<NotificationChannel | null>(null);
  const [showLog, setShowLog] = useState(false);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Notifications</h2>
        <button
          onClick={() => { setEditChannel(null); setShowForm(true); }}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          + Add Channel
        </button>
      </div>

      {/* Stats bar */}
      {logStats && (
        <div className="flex gap-4">
          <StatBadge label="Sent (24h)" value={logStats.sent24h} color="green" />
          <StatBadge label="Failed (24h)" value={logStats.failed24h} color="red" />
          <StatBadge label="Throttled (24h)" value={logStats.throttled24h} color="yellow" />
        </div>
      )}

      {/* Channel cards */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Channels</h3>
        {isLoading && <p className="text-gray-500">Loading...</p>}
        {channels && channels.length === 0 && (
          <div className="rounded-lg border border-gray-200 p-8 text-center text-gray-500 dark:border-gray-700 dark:text-gray-400">
            No notification channels configured. Click "Add Channel" to get started.
          </div>
        )}
        {channels?.map((ch) => (
          <ChannelCard
            key={ch.id}
            channel={ch}
            onEdit={() => { setEditChannel(ch); setShowForm(true); }}
          />
        ))}
      </div>

      {/* Notification log (collapsible) */}
      <div>
        <button
          onClick={() => setShowLog(!showLog)}
          className="flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <span className={`transition-transform ${showLog ? "rotate-90" : ""}`}>&#9654;</span>
          Notification Log
        </button>
        {showLog && <NotificationLogSection />}
      </div>

      {/* Modal */}
      {showForm && (
        <ChannelFormModal
          channel={editChannel}
          onClose={() => { setShowForm(false); setEditChannel(null); }}
        />
      )}
    </div>
  );
}

// ─── Channel Card ───

function ChannelCard({ channel, onEdit }: { channel: NotificationChannel; onEdit: () => void }) {
  const updateMutation = useUpdateNotificationChannel();
  const deleteMutation = useDeleteNotificationChannel();
  const testMutation = useTestNotificationChannel();

  const typeInfo = CHANNEL_TYPE_MAP[channel.channelType] ?? { label: channel.channelType, icon: "?" };
  const filterSummary = buildFilterSummary(channel.filters);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{typeInfo.icon}</span>
          <div>
            <h4 className="font-semibold text-gray-900 dark:text-gray-100">{channel.name}</h4>
            <p className="text-xs text-gray-500 dark:text-gray-400">{typeInfo.label}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Enabled toggle */}
          <button
            onClick={() => updateMutation.mutate({ id: channel.id, enabled: !channel.enabled })}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${channel.enabled ? "bg-indigo-600" : "bg-gray-300 dark:bg-gray-600"}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${channel.enabled ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        </div>
      </div>

      {/* Filter summary */}
      {filterSummary && (
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          Filters: {filterSummary}
        </p>
      )}

      {/* Last sent status */}
      <div className="mt-2 flex items-center gap-2 text-xs">
        {channel.lastStatus && (
          <span className={`inline-block h-2 w-2 rounded-full ${channel.lastStatus === "sent" ? "bg-green-500" : "bg-red-500"}`} />
        )}
        {channel.lastSentAt ? (
          <span className="text-gray-500 dark:text-gray-400">
            Last sent: {new Date(channel.lastSentAt).toLocaleString()}
          </span>
        ) : (
          <span className="text-gray-400">Never sent</span>
        )}
        {channel.lastStatus === "failed" && channel.lastError && (
          <span className="text-red-500 truncate max-w-xs" title={channel.lastError}>
            {channel.lastError}
          </span>
        )}
      </div>

      {/* Action buttons */}
      <div className="mt-3 flex gap-2">
        <button
          onClick={() => testMutation.mutate(channel.id)}
          disabled={testMutation.isPending}
          className="rounded border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          {testMutation.isPending ? "Sending..." : "Test"}
        </button>
        {testMutation.data && (
          <span className={`self-center text-xs ${testMutation.data.success ? "text-green-600" : "text-red-600"}`}>
            {testMutation.data.message}
          </span>
        )}
        <button
          onClick={onEdit}
          className="rounded border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          Edit
        </button>
        <button
          onClick={() => {
            if (confirm(`Delete channel "${channel.name}"?`)) {
              deleteMutation.mutate(channel.id);
            }
          }}
          className="rounded border border-red-300 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

// ─── Channel Form Modal ───

function ChannelFormModal({ channel, onClose }: { channel: NotificationChannel | null; onClose: () => void }) {
  const createMutation = useCreateNotificationChannel();
  const updateMutation = useUpdateNotificationChannel();
  const testMutation = useTestNotificationChannel();

  const [name, setName] = useState(channel?.name ?? "");
  const [channelType, setChannelType] = useState<string>(channel?.channelType ?? "ms_teams");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [recipients, setRecipients] = useState<string[]>((channel?.config?.recipients as string[]) ?? []);
  const [recipientInput, setRecipientInput] = useState("");
  const [minSeverity, setMinSeverity] = useState<string>(channel?.filters?.minSeverity ?? "");
  const [eventTypes, setEventTypes] = useState<string[]>(channel?.filters?.eventTypes ?? []);
  const [error, setError] = useState("");

  const isEdit = !!channel;

  const handleSubmit = async () => {
    setError("");
    const filters: Record<string, unknown> = {};
    if (minSeverity) filters.minSeverity = minSeverity;
    if (eventTypes.length > 0) filters.eventTypes = eventTypes;

    const config: Record<string, unknown> = {};
    if (channelType === "email") config.recipients = recipients;

    try {
      if (isEdit) {
        await updateMutation.mutateAsync({
          id: channel.id,
          name,
          channelType,
          ...(channelType !== "email" && webhookUrl ? { webhookUrl } : {}),
          config,
          filters,
        });
      } else {
        await createMutation.mutateAsync({
          name,
          channelType,
          ...(channelType !== "email" ? { webhookUrl } : {}),
          config,
          filters,
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    }
  };

  const toggleEventType = (et: string) => {
    setEventTypes((prev) => prev.includes(et) ? prev.filter((e) => e !== et) : [...prev, et]);
  };

  const addRecipient = () => {
    const email = recipientInput.trim();
    if (email && !recipients.includes(email)) {
      setRecipients([...recipients, email]);
      setRecipientInput("");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-lg font-bold text-gray-900 dark:text-gray-100">
          {isEdit ? "Edit Channel" : "Add Notification Channel"}
        </h3>

        {error && <div className="mb-3 rounded bg-red-100 p-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">{error}</div>}

        {/* Name */}
        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mb-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
          placeholder="e.g. Ops Team - Teams"
        />

        {/* Type */}
        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Type</label>
        <div className="mb-3 grid grid-cols-4 gap-2">
          {CHANNEL_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setChannelType(t.value)}
              className={`flex flex-col items-center rounded-lg border p-2 text-xs ${channelType === t.value
                ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
                : "border-gray-200 text-gray-600 hover:border-gray-300 dark:border-gray-600 dark:text-gray-400"
              }`}
            >
              <span className="text-lg">{t.icon}</span>
              <span className="mt-1">{t.label}</span>
            </button>
          ))}
        </div>

        {/* Webhook URL */}
        {channelType !== "email" && (
          <>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Webhook URL</label>
            <input
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              className="mb-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              placeholder="https://..."
            />
            <p className="mb-3 text-xs text-gray-400">{WEBHOOK_HELP[channelType]}</p>
          </>
        )}

        {/* Email recipients */}
        {channelType === "email" && (
          <>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Recipients</label>
            <div className="mb-1 flex gap-2">
              <input
                value={recipientInput}
                onChange={(e) => setRecipientInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addRecipient())}
                className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                placeholder="email@example.com"
              />
              <button type="button" onClick={addRecipient} className="rounded bg-gray-200 px-3 text-sm dark:bg-gray-600 dark:text-gray-200">Add</button>
            </div>
            <div className="mb-3 flex flex-wrap gap-1">
              {recipients.map((r) => (
                <span key={r} className="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5 text-xs dark:bg-gray-700 dark:text-gray-300">
                  {r}
                  <button onClick={() => setRecipients(recipients.filter((x) => x !== r))} className="text-gray-400 hover:text-red-500">&times;</button>
                </span>
              ))}
            </div>
          </>
        )}

        {/* Filters: min severity */}
        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Minimum Severity</label>
        <select
          value={minSeverity}
          onChange={(e) => setMinSeverity(e.target.value)}
          className="mb-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
        >
          <option value="">All severities</option>
          {SEVERITIES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>

        {/* Filters: event types */}
        <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Event Types</label>
        <div className="mb-4 flex flex-wrap gap-2">
          {EVENT_TYPES.map((et) => (
            <label key={et.value} className="flex items-center gap-1 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={eventTypes.includes(et.value)}
                onChange={() => toggleEventType(et.value)}
                className="rounded border-gray-300"
              />
              {et.label}
            </label>
          ))}
        </div>

        {/* Actions */}
        <div className="flex justify-between">
          <div>
            {isEdit && (
              <button
                onClick={() => testMutation.mutate(channel.id)}
                disabled={testMutation.isPending}
                className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300"
              >
                {testMutation.isPending ? "Sending..." : "Send Test"}
              </button>
            )}
            {testMutation.data && (
              <span className={`ml-2 text-xs ${testMutation.data.success ? "text-green-600" : "text-red-600"}`}>
                {testMutation.data.message}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 dark:border-gray-600 dark:text-gray-300">
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
              className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {isEdit ? "Save" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Notification Log Section ───

function NotificationLogSection() {
  const [page, setPage] = useState(1);
  const { data: logData, isLoading } = useNotificationLog({ page, limit: 15 });

  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      {isLoading && <p className="p-4 text-gray-500">Loading log...</p>}
      {logData && logData.data.length === 0 && (
        <p className="p-4 text-center text-gray-500 dark:text-gray-400">No notification log entries yet.</p>
      )}
      {logData && logData.data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
              <tr>
                <th className="px-4 py-2 font-medium text-gray-600 dark:text-gray-400">Time</th>
                <th className="px-4 py-2 font-medium text-gray-600 dark:text-gray-400">Channel</th>
                <th className="px-4 py-2 font-medium text-gray-600 dark:text-gray-400">Event</th>
                <th className="px-4 py-2 font-medium text-gray-600 dark:text-gray-400">Status</th>
                <th className="px-4 py-2 font-medium text-gray-600 dark:text-gray-400">Code</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {logData.data.map((entry: NotificationLogEntry) => (
                <tr key={entry.id}>
                  <td className="px-4 py-2 text-gray-500 dark:text-gray-400">
                    {new Date(entry.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-gray-900 dark:text-gray-100">
                    {entry.channelName ?? entry.channelId.slice(0, 8)}
                  </td>
                  <td className="px-4 py-2 text-gray-700 dark:text-gray-300">{entry.eventType}</td>
                  <td className="px-4 py-2">
                    <StatusBadge status={entry.status} />
                  </td>
                  <td className="px-4 py-2 text-gray-500 dark:text-gray-400">
                    {entry.responseCode ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {logData && logData.totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-gray-200 px-4 py-2 dark:border-gray-700">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="text-sm text-indigo-600 disabled:text-gray-400"
          >
            Previous
          </button>
          <span className="text-xs text-gray-500">Page {page} of {logData.totalPages}</span>
          <button
            disabled={page >= logData.totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="text-sm text-indigo-600 disabled:text-gray-400"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ───

function StatBadge({ label, value, color }: { label: string; value: number; color: "green" | "red" | "yellow" }) {
  const colors = {
    green: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    red: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    yellow: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  };
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-medium ${colors[color]}`}>
      {label}: {value}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls = {
    sent: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    failed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    throttled: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  }[status] ?? "bg-gray-100 text-gray-700";

  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>;
}

function buildFilterSummary(filters: NotificationChannel["filters"]): string {
  const parts: string[] = [];
  if (filters.minSeverity) parts.push(`>= ${filters.minSeverity}`);
  if (filters.eventTypes?.length) parts.push(filters.eventTypes.join(", "));
  if (filters.environments?.length) parts.push(`env: ${filters.environments.join(", ")}`);
  return parts.join(" | ");
}
