import { useState } from "react";
import {
  Plus,
  Copy,
  Check,
  X,
  RefreshCw,
  Trash2,
  ChevronDown,
  ChevronUp,
  Terminal,
  AlertTriangle,
  Clock,
  Shield,
  Server,
  Activity,
  Filter,
} from "lucide-react";
import {
  useAgentTokens,
  useAgentToken,
  useAgentHealth,
  useCreateAgentToken,
  useUpdateAgentToken,
  useRevokeAgentToken,
  useRotateAgentToken,
} from "../../api/agent-hooks";
import type {
  AgentToken,
  AgentHealthHost,
  CreateAgentTokenData,
} from "../../api/agent-hooks";
import { useToast } from "../../components/Toast";
const useToastHelper = () => {
  const { toast } = useToast();
  return {
    success: (msg: string) => toast(msg, "success"),
    error: (msg: string) => toast(msg, "error"),
  };
};
import { TableSkeleton } from "../../components/Skeleton";
import { timeAgo } from "../../components/timeago";

// ─── Modal ───

function Modal({
  open,
  onClose,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className={`mx-4 w-full ${wide ? "max-w-2xl" : "max-w-md"} rounded-lg border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-700 dark:bg-gray-800`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

// ─── Token display (one-time) ───

function CopyableToken({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-900/20">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-sm text-amber-800 dark:text-amber-200">
            Copy this token now. It cannot be retrieved again.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 rounded-md border border-gray-300 bg-gray-50 p-3 font-mono text-sm dark:border-gray-600 dark:bg-gray-900">
        <code className="flex-1 select-all break-all text-gray-900 dark:text-gray-100">
          {token}
        </code>
        <button
          onClick={handleCopy}
          className="flex-shrink-0 rounded p-1 text-gray-500 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-700"
          title="Copy token"
        >
          {copied ? (
            <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Scope badge ───

function ScopeBadge({ scope }: { scope: string }) {
  return scope === "fleet" ? (
    <span className="inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
      Fleet
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-400">
      Single
    </span>
  );
}

function StatusBadgeInline({ active }: { active: boolean }) {
  return active ? (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-400">
      <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
      Active
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
      <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
      Revoked
    </span>
  );
}

// ─── Create Token Modal ───

function CreateTokenModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<"single" | "fleet">("single");
  const [environmentTag, setEnvironmentTag] = useState("");
  const [expiresIn, setExpiresIn] = useState("never");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const createMutation = useCreateAgentToken();
  const toast = useToastHelper();

  const handleCreate = async () => {
    const data: CreateAgentTokenData = {
      name: name.trim(),
      scope,
    };
    if (description.trim()) data.description = description.trim();
    if (environmentTag.trim()) data.environmentTag = environmentTag.trim();
    if (expiresIn !== "never") {
      const days = parseInt(expiresIn, 10);
      const d = new Date();
      d.setDate(d.getDate() + days);
      data.expiresAt = d.toISOString();
    }

    try {
      const result = await createMutation.mutateAsync(data);
      setCreatedToken(result.token);
      toast.success(`Token "${name}" created`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create token");
    }
  };

  const handleClose = () => {
    setName("");
    setDescription("");
    setScope("single");
    setEnvironmentTag("");
    setExpiresIn("never");
    setCreatedToken(null);
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {createdToken ? "Token Created" : "Create Agent Token"}
          </h3>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <X className="h-5 w-5" />
          </button>
        </div>

        {createdToken ? (
          <div className="space-y-4">
            <CopyableToken token={createdToken} />
            <button
              onClick={handleClose}
              className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. prod-web-servers"
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Description
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description"
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Scope
                </label>
                <select
                  value={scope}
                  onChange={(e) => setScope(e.target.value as "single" | "fleet")}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-indigo-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
                >
                  <option value="single">Single host</option>
                  <option value="fleet">Fleet (multi-host)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Expires
                </label>
                <select
                  value={expiresIn}
                  onChange={(e) => setExpiresIn(e.target.value)}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-indigo-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
                >
                  <option value="never">Never</option>
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                  <option value="180">180 days</option>
                  <option value="365">1 year</option>
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Environment Tag
              </label>
              <input
                type="text"
                value={environmentTag}
                onChange={(e) => setEnvironmentTag(e.target.value)}
                placeholder="e.g. production, staging"
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-500"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={handleClose}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!name.trim() || createMutation.isPending}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {createMutation.isPending ? "Creating..." : "Create Token"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ─── Token Detail Modal ───

function TokenDetailModal({
  tokenId,
  onClose,
}: {
  tokenId: string | null;
  onClose: () => void;
}) {
  const { data: token, isLoading } = useAgentToken(tokenId ?? undefined);
  const rotateMutation = useRotateAgentToken();
  const revokeMutation = useRevokeAgentToken();
  const toast = useToastHelper();
  const [rotatedToken, setRotatedToken] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  if (!tokenId) return null;

  const handleRotate = async () => {
    try {
      const result = await rotateMutation.mutateAsync(tokenId);
      setRotatedToken(result.token);
      toast.success("Token rotated successfully");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to rotate token");
    }
  };

  const handleRevoke = async () => {
    try {
      await revokeMutation.mutateAsync(tokenId);
      toast.success("Token revoked");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke token");
    }
  };

  const handleClose = () => {
    setRotatedToken(null);
    setConfirmRevoke(false);
    onClose();
  };

  return (
    <Modal open={!!tokenId} onClose={handleClose} wide>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Token Details
          </h3>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <X className="h-5 w-5" />
          </button>
        </div>

        {isLoading ? (
          <TableSkeleton rows={4} />
        ) : token ? (
          <div className="space-y-4">
            {rotatedToken && <CopyableToken token={rotatedToken} />}

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div>
                <dt className="font-medium text-gray-500 dark:text-gray-400">Name</dt>
                <dd className="text-gray-900 dark:text-gray-100">{token.name}</dd>
              </div>
              <div>
                <dt className="font-medium text-gray-500 dark:text-gray-400">Status</dt>
                <dd><StatusBadgeInline active={token.isActive} /></dd>
              </div>
              <div>
                <dt className="font-medium text-gray-500 dark:text-gray-400">Scope</dt>
                <dd><ScopeBadge scope={token.scope} /></dd>
              </div>
              <div>
                <dt className="font-medium text-gray-500 dark:text-gray-400">Reports</dt>
                <dd className="text-gray-900 dark:text-gray-100">{token.reportCount}</dd>
              </div>
              <div>
                <dt className="font-medium text-gray-500 dark:text-gray-400">Hosts</dt>
                <dd className="text-gray-900 dark:text-gray-100">{token.hostCount}</dd>
              </div>
              <div>
                <dt className="font-medium text-gray-500 dark:text-gray-400">Last Used</dt>
                <dd className="text-gray-900 dark:text-gray-100">
                  {token.lastUsedAt ? timeAgo(token.lastUsedAt) : "Never"}
                </dd>
              </div>
              {token.lockedHostname && (
                <div>
                  <dt className="font-medium text-gray-500 dark:text-gray-400">Locked Host</dt>
                  <dd className="text-gray-900 dark:text-gray-100">{token.lockedHostname}</dd>
                </div>
              )}
              {token.environmentTag && (
                <div>
                  <dt className="font-medium text-gray-500 dark:text-gray-400">Environment</dt>
                  <dd>
                    <span className="inline-flex rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                      {token.environmentTag}
                    </span>
                  </dd>
                </div>
              )}
              {token.lastUsedIp && (
                <div>
                  <dt className="font-medium text-gray-500 dark:text-gray-400">Last IP</dt>
                  <dd className="font-mono text-xs text-gray-900 dark:text-gray-100">{token.lastUsedIp}</dd>
                </div>
              )}
              {token.expiresAt && (
                <div>
                  <dt className="font-medium text-gray-500 dark:text-gray-400">Expires</dt>
                  <dd className="text-gray-900 dark:text-gray-100">{new Date(token.expiresAt).toLocaleDateString()}</dd>
                </div>
              )}
              {token.description && (
                <div className="col-span-2">
                  <dt className="font-medium text-gray-500 dark:text-gray-400">Description</dt>
                  <dd className="text-gray-900 dark:text-gray-100">{token.description}</dd>
                </div>
              )}
              <div>
                <dt className="font-medium text-gray-500 dark:text-gray-400">Created</dt>
                <dd className="text-gray-900 dark:text-gray-100">{new Date(token.createdAt).toLocaleDateString()}</dd>
              </div>
            </dl>

            {/* Actions */}
            {token.isActive && (
              <div className="flex gap-3 border-t border-gray-200 pt-4 dark:border-gray-700">
                <button
                  onClick={handleRotate}
                  disabled={rotateMutation.isPending}
                  className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {rotateMutation.isPending ? "Rotating..." : "Rotate"}
                </button>
                {confirmRevoke ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-red-600 dark:text-red-400">Revoke this token?</span>
                    <button
                      onClick={handleRevoke}
                      disabled={revokeMutation.isPending}
                      className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
                    >
                      {revokeMutation.isPending ? "Revoking..." : "Confirm"}
                    </button>
                    <button
                      onClick={() => setConfirmRevoke(false)}
                      className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmRevoke(true)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Revoke
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-500">Token not found.</p>
        )}
      </div>
    </Modal>
  );
}

// ─── Setup Instructions ───

// ─── Agent Health Section ───

const HEALTH_COLORS: Record<string, string> = {
  healthy: "text-green-600 dark:text-green-400",
  stale: "text-amber-600 dark:text-amber-400",
  offline: "text-red-600 dark:text-red-400",
};

const HEALTH_DOT_COLORS: Record<string, string> = {
  healthy: "bg-green-500",
  stale: "bg-amber-500",
  offline: "bg-red-500",
};

function AgentHealthSection() {
  const { data, isLoading } = useAgentHealth();
  const [showUnhealthyOnly, setShowUnhealthyOnly] = useState(false);

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
          <Activity className="h-4 w-4" />
          Agent Health
        </h3>
        <TableSkeleton rows={3} />
      </div>
    );
  }

  if (!data || data.summary.total === 0) return null;

  const filteredHosts = showUnhealthyOnly
    ? data.hosts.filter((h) => h.healthStatus !== "healthy")
    : data.hosts;

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3 dark:border-gray-700">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
          <Activity className="h-4 w-4" />
          Agent Health
          <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">
            {data.summary.healthy} healthy · {data.summary.stale} stale · {data.summary.offline} offline
          </span>
        </h3>
        <button
          onClick={() => setShowUnhealthyOnly(!showUnhealthyOnly)}
          className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
            showUnhealthyOnly
              ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
              : "text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
          }`}
        >
          <Filter className="h-3 w-3" />
          {showUnhealthyOnly ? "Showing unhealthy" : "Show unhealthy only"}
        </button>
      </div>

      {filteredHosts.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:text-gray-400">
                <th className="px-4 py-2.5">Hostname</th>
                <th className="px-4 py-2.5">Agent Version</th>
                <th className="px-4 py-2.5">Last Report</th>
                <th className="px-4 py-2.5">Report IP</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Token</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {filteredHosts.map((host) => (
                <tr
                  key={host.id}
                  className="text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700/50"
                >
                  <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-gray-100">
                    {host.hostname}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-500 dark:text-gray-400">
                    {host.agentVersion ?? "—"}
                  </td>
                  <td className={`px-4 py-2.5 ${HEALTH_COLORS[host.healthStatus]}`}>
                    {timeAgo(host.lastSeenAt)}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-500 dark:text-gray-400">
                    {host.lastReportIp ?? "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${HEALTH_COLORS[host.healthStatus]}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${HEALTH_DOT_COLORS[host.healthStatus]}`} />
                      {host.healthStatus.charAt(0).toUpperCase() + host.healthStatus.slice(1)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400">
                    {host.tokenName ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
          {showUnhealthyOnly ? "All agents are healthy." : "No agent hosts found."}
        </div>
      )}
    </div>
  );
}

// ─── Setup Instructions ───

function SetupInstructions({ serverUrl }: { serverUrl: string }) {
  const [platform, setPlatform] = useState<"linux" | "windows">("linux");
  const [copied, setCopied] = useState(false);

  const baseUrl = serverUrl || window.location.origin;

  const linuxInstall = `# Download and install the agent
curl -fsSL ${baseUrl}/api/v1/agent/install/linux | sudo bash

# Configure the agent
sudo nano /usr/local/bin/infrawatch-agent.conf
# Set "url" to: ${baseUrl}
# Set "token" to your agent token

# Test it
sudo /usr/local/bin/infrawatch-agent.sh`;

  const windowsInstall = `# Download the agent files (run as Administrator)
Invoke-WebRequest -Uri "${baseUrl}/api/v1/agent/install/windows" -OutFile Install-InfraWatchAgent.ps1
Invoke-WebRequest -Uri "${baseUrl}/api/v1/agent/script/windows" -OutFile infrawatch-agent.ps1

# Install
.\\Install-InfraWatchAgent.ps1

# Configure
notepad C:\\ProgramData\\InfraWatch\\agent.conf
# Set "url" to: ${baseUrl}
# Set "token" to your agent token

# Test it
powershell -ExecutionPolicy Bypass -File "C:\\ProgramData\\InfraWatch\\infrawatch-agent.ps1"`;

  const instructions = platform === "linux" ? linuxInstall : windowsInstall;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(instructions);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
        <Terminal className="h-4 w-4" />
        Agent Setup Instructions
      </h3>

      <div className="mb-3 flex gap-1 rounded-md bg-gray-100 p-0.5 dark:bg-gray-700">
        <button
          onClick={() => setPlatform("linux")}
          className={`flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
            platform === "linux"
              ? "bg-white text-gray-900 shadow-sm dark:bg-gray-600 dark:text-gray-100"
              : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
          }`}
        >
          Linux / macOS
        </button>
        <button
          onClick={() => setPlatform("windows")}
          className={`flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
            platform === "windows"
              ? "bg-white text-gray-900 shadow-sm dark:bg-gray-600 dark:text-gray-100"
              : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
          }`}
        >
          Windows
        </button>
      </div>

      <div className="relative">
        <pre className="overflow-x-auto rounded-md bg-gray-900 p-4 text-xs leading-relaxed text-gray-100">
          <code>{instructions}</code>
        </pre>
        <button
          onClick={handleCopy}
          className="absolute right-2 top-2 rounded p-1.5 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
          title="Copy instructions"
        >
          {copied ? (
            <Check className="h-4 w-4 text-green-400" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Main Page ───

export function AgentsPage() {
  const { data: tokens, isLoading } = useAgentTokens();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const activeTokens = tokens?.filter((t) => t.isActive) ?? [];
  const inactiveTokens = tokens?.filter((t) => !t.isActive) ?? [];
  const displayTokens = showInactive ? tokens ?? [] : activeTokens;

  const totalReports = tokens?.reduce((sum, t) => sum + t.reportCount, 0) ?? 0;
  const activeCount = activeTokens.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Agent Tokens
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Manage tokens for agent-based host reporting
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          <Plus className="h-4 w-4" />
          Create Token
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <Shield className="h-4 w-4" />
            Active Tokens
          </div>
          <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">{activeCount}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <Server className="h-4 w-4" />
            Total Reports
          </div>
          <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">{totalReports}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <Clock className="h-4 w-4" />
            Revoked
          </div>
          <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">{inactiveTokens.length}</p>
        </div>
      </div>

      {/* Token Table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-700">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Tokens ({displayTokens.length})
          </h3>
          {inactiveTokens.length > 0 && (
            <button
              onClick={() => setShowInactive(!showInactive)}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              {showInactive ? "Hide" : "Show"} revoked ({inactiveTokens.length})
              {showInactive ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="p-4">
            <TableSkeleton rows={5} />
          </div>
        ) : displayTokens.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  <th className="px-4 py-2.5">Name</th>
                  <th className="px-4 py-2.5">Scope</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Host</th>
                  <th className="px-4 py-2.5">Environment</th>
                  <th className="px-4 py-2.5 text-center">Reports</th>
                  <th className="px-4 py-2.5">Last Used</th>
                  <th className="px-4 py-2.5">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {displayTokens.map((token) => (
                  <tr
                    key={token.id}
                    onClick={() => setSelectedTokenId(token.id)}
                    className={`cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50 ${
                      !token.isActive ? "opacity-60" : ""
                    }`}
                  >
                    <td className="px-4 py-2.5">
                      <div>
                        <span className="font-medium text-gray-900 dark:text-gray-100">
                          {token.name}
                        </span>
                        {token.description && (
                          <p className="text-xs text-gray-500 dark:text-gray-400">{token.description}</p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <ScopeBadge scope={token.scope} />
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadgeInline active={token.isActive} />
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-600 dark:text-gray-400">
                      {token.lockedHostname ?? "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      {token.environmentTag ? (
                        <span className="inline-flex rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                          {token.environmentTag}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-center text-gray-700 dark:text-gray-300">
                      {token.reportCount}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">
                      {token.lastUsedAt ? timeAgo(token.lastUsedAt) : "Never"}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">
                      {new Date(token.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-4 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
            No agent tokens yet. Create one to get started.
          </div>
        )}
      </div>

      {/* Agent Health */}
      <AgentHealthSection />

      {/* Setup Instructions */}
      <SetupInstructions serverUrl="" />

      {/* Modals */}
      <CreateTokenModal open={showCreate} onClose={() => setShowCreate(false)} />
      <TokenDetailModal tokenId={selectedTokenId} onClose={() => setSelectedTokenId(null)} />
    </div>
  );
}
