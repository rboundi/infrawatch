import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  ArrowLeft,
  Users,
  Shield,
  Plus,
  Trash2,
  RefreshCw,
  Search,
  AlertTriangle,
} from "lucide-react";
import {
  useGroupDetail,
  useAddGroupRule,
  useDeleteGroupRule,
  useEvaluateGroup,
  usePreviewRule,
  useRemoveGroupMembers,
  useAlerts,
  useHosts,
} from "../api/hooks";
import type { HostGroupRule } from "../api/types";

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

export function GroupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: group, isLoading } = useGroupDetail(id ?? null);
  const [activeTab, setActiveTab] = useState<"hosts" | "alerts" | "rules">("hosts");

  if (isLoading) {
    return <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading...</div>;
  }

  if (!group) {
    return <div className="text-center py-12 text-gray-500 dark:text-gray-400">Group not found.</div>;
  }

  return (
    <div>
      {/* Back link */}
      <button
        onClick={() => navigate("/groups")}
        className="mb-4 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
      >
        <ArrowLeft className="h-4 w-4" /> Back to groups
      </button>

      {/* Header */}
      <div className="mb-6 rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-start gap-3">
          <div
            className="h-10 w-10 rounded-lg flex items-center justify-center text-white font-bold text-lg"
            style={{ backgroundColor: group.color || "#6366f1" }}
          >
            {group.name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{group.name}</h1>
            {group.description && (
              <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{group.description}</p>
            )}
            <div className="mt-2 flex flex-wrap gap-4 text-xs text-gray-500 dark:text-gray-400">
              {group.ownerName && <span>Owner: {group.ownerName}</span>}
              <span className="flex items-center gap-1">
                <Users className="h-3.5 w-3.5" /> {group.memberCount} hosts
              </span>
              <span className="flex items-center gap-1">
                <Shield className="h-3.5 w-3.5" /> {group.ruleCount} rules
              </span>
              {group.channels.length > 0 && (
                <span>Notifies: {group.channels.map((c) => c.name).join(", ")}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {(["hosts", "alerts", "rules"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px ${
              activeTab === tab
                ? "border-indigo-500 text-indigo-600 dark:text-indigo-400"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "hosts" && <HostsTab groupId={id!} members={group.members} />}
      {activeTab === "alerts" && <AlertsTab groupId={id!} />}
      {activeTab === "rules" && <RulesTab groupId={id!} rules={group.rules} />}
    </div>
  );
}

// ─── Hosts Tab ───

function HostsTab({
  groupId,
  members,
}: {
  groupId: string;
  members: import("../api/types").HostGroupMember[];
}) {
  const removeMember = useRemoveGroupMembers();

  return (
    <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 overflow-hidden">
      {members.length === 0 ? (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">No hosts in this group.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700/50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-500 dark:text-gray-400">Hostname</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500 dark:text-gray-400">IP</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500 dark:text-gray-400">OS</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500 dark:text-gray-400">Status</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500 dark:text-gray-400">Assigned</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500 dark:text-gray-400">Alerts</th>
              <th className="px-4 py-2 text-right font-medium text-gray-500 dark:text-gray-400">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {members.map((m) => (
              <tr key={m.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                <td className="px-4 py-2">
                  <Link
                    to={`/hosts/${m.id}`}
                    className="text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    {m.hostname}
                  </Link>
                </td>
                <td className="px-4 py-2 text-gray-500 dark:text-gray-400">{m.ip ?? "—"}</td>
                <td className="px-4 py-2 text-gray-500 dark:text-gray-400">{m.os ?? "—"}</td>
                <td className="px-4 py-2">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                      m.status === "active"
                        ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                        : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                    }`}
                  >
                    {m.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400">{m.assignedBy}</td>
                <td className="px-4 py-2">
                  {m.openAlertCount > 0 && (
                    <span className="flex items-center gap-1 text-yellow-600 dark:text-yellow-400 text-xs">
                      <AlertTriangle className="h-3 w-3" /> {m.openAlertCount}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  {m.assignedBy === "manual" && (
                    <button
                      onClick={() => removeMember.mutate({ groupId, hostIds: [m.id] })}
                      className="text-gray-400 hover:text-red-500"
                      title="Remove from group"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── Alerts Tab ───

function AlertsTab({ groupId }: { groupId: string }) {
  const { data, isLoading } = useAlerts({ groupId, limit: 50 });
  const alerts = data?.data ?? [];

  if (isLoading) return <div className="text-center py-8 text-gray-500">Loading...</div>;

  return (
    <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 overflow-hidden">
      {alerts.length === 0 ? (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">No open alerts for this group.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700/50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-500 dark:text-gray-400">Severity</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500 dark:text-gray-400">Host</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500 dark:text-gray-400">Package</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500 dark:text-gray-400">Current</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500 dark:text-gray-400">Available</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500 dark:text-gray-400">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {alerts.map((a) => (
              <tr key={a.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                <td className="px-4 py-2">
                  <SeverityBadge severity={a.severity} />
                </td>
                <td className="px-4 py-2 text-gray-700 dark:text-gray-300">{a.hostname ?? "—"}</td>
                <td className="px-4 py-2 font-mono text-xs text-gray-700 dark:text-gray-300">{a.packageName}</td>
                <td className="px-4 py-2 font-mono text-xs text-gray-500 dark:text-gray-400">{a.currentVersion}</td>
                <td className="px-4 py-2 font-mono text-xs text-green-600 dark:text-green-400">{a.availableVersion}</td>
                <td className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400">
                  {new Date(a.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── Rules Tab ───

function RulesTab({ groupId, rules }: { groupId: string; rules: HostGroupRule[] }) {
  const addRule = useAddGroupRule();
  const deleteRule = useDeleteGroupRule();
  const evaluate = useEvaluateGroup();
  const preview = usePreviewRule();

  const [newRuleType, setNewRuleType] = useState("hostname_contains");
  const [newRuleValue, setNewRuleValue] = useState("");
  const [newRulePriority, setNewRulePriority] = useState(0);
  const [previewCount, setPreviewCount] = useState<number | null>(null);

  const handleAdd = async () => {
    if (!newRuleValue.trim()) return;
    await addRule.mutateAsync({
      groupId,
      ruleType: newRuleType,
      ruleValue: newRuleValue.trim(),
      priority: newRulePriority,
    });
    setNewRuleValue("");
    setPreviewCount(null);
  };

  const handlePreview = async () => {
    if (!newRuleValue.trim()) return;
    const result = await preview.mutateAsync({
      ruleType: newRuleType,
      ruleValue: newRuleValue.trim(),
    });
    setPreviewCount(result.matchCount);
  };

  return (
    <div className="space-y-4">
      {/* Add rule form */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Add Rule</h3>
        <div className="flex gap-2 items-end flex-wrap">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Type</label>
            <select
              value={newRuleType}
              onChange={(e) => setNewRuleType(e.target.value)}
              className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            >
              {RULE_TYPES.map((rt) => (
                <option key={rt.value} value={rt.value}>{rt.label}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-gray-500 mb-1">Value</label>
            <input
              type="text"
              value={newRuleValue}
              onChange={(e) => { setNewRuleValue(e.target.value); setPreviewCount(null); }}
              className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              placeholder="e.g., web-prod"
            />
          </div>
          <div className="w-20">
            <label className="block text-xs text-gray-500 mb-1">Priority</label>
            <input
              type="number"
              value={newRulePriority}
              onChange={(e) => setNewRulePriority(parseInt(e.target.value, 10) || 0)}
              className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
          </div>
          <button
            onClick={handlePreview}
            className="flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <Search className="h-3.5 w-3.5" /> Preview
          </button>
          <button
            onClick={handleAdd}
            disabled={!newRuleValue.trim()}
            className="flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
          {previewCount !== null && (
            <span className="text-sm text-indigo-600 dark:text-indigo-400">
              {previewCount} host{previewCount !== 1 ? "s" : ""} match
            </span>
          )}
        </div>
      </div>

      {/* Re-evaluate button */}
      <div className="flex justify-end">
        <button
          onClick={() => evaluate.mutate(groupId)}
          disabled={evaluate.isPending}
          className="flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${evaluate.isPending ? "animate-spin" : ""}`} />
          Re-evaluate rules
        </button>
      </div>

      {/* Current rules list */}
      <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 overflow-hidden">
        {rules.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">No rules configured.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-500 dark:text-gray-400">Type</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500 dark:text-gray-400">Value</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500 dark:text-gray-400">Priority</th>
                <th className="px-4 py-2 text-right font-medium text-gray-500 dark:text-gray-400">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {rules.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  <td className="px-4 py-2 text-gray-700 dark:text-gray-300">
                    {RULE_TYPES.find((rt) => rt.value === r.ruleType)?.label ?? r.ruleType}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-700 dark:text-gray-300">{r.ruleValue}</td>
                  <td className="px-4 py-2 text-gray-500 dark:text-gray-400">{r.priority}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => deleteRule.mutate({ groupId, ruleId: r.id })}
                      className="text-gray-400 hover:text-red-500"
                      title="Delete rule"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    critical: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    high: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
    medium: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
    low: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    info: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300",
  };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${colors[severity] ?? colors.info}`}>
      {severity}
    </span>
  );
}
