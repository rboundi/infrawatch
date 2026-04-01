import { useState, useEffect } from "react";
import { X, Plus, Trash2, Search } from "lucide-react";
import {
  useCreateGroup,
  useUpdateGroup,
  usePreviewRule,
  useNotificationChannels,
} from "../api/hooks";
import type { HostGroup } from "../api/types";

const RULE_TYPES = [
  { value: "hostname_contains", label: "Hostname contains" },
  { value: "hostname_prefix", label: "Hostname prefix" },
  { value: "hostname_suffix", label: "Hostname suffix" },
  { value: "hostname_regex", label: "Hostname regex" },
  { value: "ip_range", label: "IP range (CIDR)" },
  { value: "environment_equals", label: "Environment equals" },
  { value: "os_contains", label: "OS contains" },
  { value: "scan_target_equals", label: "Scan target ID" },
  { value: "tag_equals", label: "Tag equals (key=value)" },
  { value: "detected_platform_equals", label: "Platform equals" },
];

const SEVERITY_LEVELS = ["info", "low", "medium", "high", "critical"];

const PRESET_COLORS = [
  "#6366f1", "#ef4444", "#f59e0b", "#10b981", "#3b82f6",
  "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16", "#f97316",
];

interface RuleDraft {
  ruleType: string;
  ruleValue: string;
  priority: number;
  matchCount?: number;
}

interface Props {
  group: HostGroup | null;
  onClose: () => void;
}

export function GroupFormModal({ group, onClose }: Props) {
  const createGroup = useCreateGroup();
  const updateGroup = useUpdateGroup();
  const previewRule = usePreviewRule();
  const { data: channels = [] } = useNotificationChannels();

  const [name, setName] = useState(group?.name ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const [color, setColor] = useState(group?.color ?? "#6366f1");
  const [ownerName, setOwnerName] = useState(group?.ownerName ?? "");
  const [ownerEmail, setOwnerEmail] = useState(group?.ownerEmail ?? "");
  const [channelIds, setChannelIds] = useState<string[]>(group?.notificationChannelIds ?? []);
  const [severity, setSeverity] = useState(group?.alertSeverityThreshold ?? "info");
  const [rules, setRules] = useState<RuleDraft[]>([]);
  const [saving, setSaving] = useState(false);

  const addRule = () => {
    setRules([...rules, { ruleType: "hostname_contains", ruleValue: "", priority: 0 }]);
  };

  const removeRule = (idx: number) => {
    setRules(rules.filter((_, i) => i !== idx));
  };

  const updateRule = (idx: number, field: keyof RuleDraft, value: string | number) => {
    setRules(rules.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  };

  const previewRuleMatch = async (idx: number) => {
    const rule = rules[idx];
    if (!rule.ruleValue) return;
    try {
      const result = await previewRule.mutateAsync({
        ruleType: rule.ruleType,
        ruleValue: rule.ruleValue,
      });
      setRules(rules.map((r, i) => (i === idx ? { ...r, matchCount: result.matchCount } : r)));
    } catch {
      // ignore
    }
  };

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (group) {
        await updateGroup.mutateAsync({
          id: group.id,
          name: name.trim(),
          description: description || null,
          color,
          ownerName: ownerName || null,
          ownerEmail: ownerEmail || null,
          notificationChannelIds: channelIds,
          alertSeverityThreshold: severity,
        });
      } else {
        await createGroup.mutateAsync({
          name: name.trim(),
          description: description || null,
          color,
          ownerName: ownerName || null,
          ownerEmail: ownerEmail || null,
          notificationChannelIds: channelIds,
          alertSeverityThreshold: severity,
        });
      }
      onClose();
    } catch {
      // error displayed via toast or inline
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          className="absolute right-3 top-3 rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        >
          <X className="h-5 w-5" />
        </button>

        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          {group ? "Edit Group" : "Create Group"}
        </h2>

        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              placeholder="e.g., Production Web Servers"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
          </div>

          {/* Color */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Color
            </label>
            <div className="flex gap-2 flex-wrap">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`h-7 w-7 rounded-full border-2 ${
                    color === c ? "border-gray-900 dark:border-white" : "border-transparent"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-7 w-7 cursor-pointer rounded border-0"
              />
            </div>
          </div>

          {/* Owner */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Owner name
              </label>
              <input
                type="text"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Owner email
              </label>
              <input
                type="email"
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              />
            </div>
          </div>

          {/* Notification channels + severity threshold */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Notification channels
            </label>
            <div className="space-y-1.5 max-h-32 overflow-y-auto">
              {channels.length === 0 ? (
                <p className="text-xs text-gray-400">No channels configured</p>
              ) : (
                channels.map((ch) => (
                  <label key={ch.id} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={channelIds.includes(ch.id)}
                      onChange={(e) => {
                        setChannelIds(
                          e.target.checked
                            ? [...channelIds, ch.id]
                            : channelIds.filter((id) => id !== ch.id)
                        );
                      }}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                    {ch.name}
                    <span className="text-xs text-gray-400">({ch.channelType})</span>
                  </label>
                ))
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Alert severity threshold
            </label>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            >
              {SEVERITY_LEVELS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <p className="mt-0.5 text-xs text-gray-400">
              Only alerts at or above this severity will trigger group notifications.
            </p>
          </div>

          {/* Rules (only on create — editing rules is done in group detail) */}
          {!group && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Auto-assignment rules
                </label>
                <button
                  onClick={addRule}
                  className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
                >
                  <Plus className="h-3 w-3" /> Add rule
                </button>
              </div>

              {rules.map((rule, idx) => (
                <div key={idx} className="mb-2 flex gap-2 items-start">
                  <select
                    value={rule.ruleType}
                    onChange={(e) => updateRule(idx, "ruleType", e.target.value)}
                    className="w-40 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  >
                    {RULE_TYPES.map((rt) => (
                      <option key={rt.value} value={rt.value}>{rt.label}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={rule.ruleValue}
                    onChange={(e) => updateRule(idx, "ruleValue", e.target.value)}
                    placeholder="Value"
                    className="flex-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  />
                  <button
                    onClick={() => previewRuleMatch(idx)}
                    className="rounded p-1.5 text-gray-400 hover:text-indigo-500"
                    title="Preview matches"
                  >
                    <Search className="h-3.5 w-3.5" />
                  </button>
                  {rule.matchCount !== undefined && (
                    <span className="text-xs text-indigo-500 self-center whitespace-nowrap">
                      {rule.matchCount} match{rule.matchCount !== 1 ? "es" : ""}
                    </span>
                  )}
                  <button
                    onClick={() => removeRule(idx)}
                    className="rounded p-1.5 text-gray-400 hover:text-red-500"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 dark:border-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !name.trim()}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : group ? "Update" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
