import { useState } from "react";
import { Copy, Check, ChevronDown, ChevronRight, AlertTriangle, Info, Clock, Network } from "lucide-react";
import { useImpactAnalysis } from "../api/hooks";
import type { RemediationCommand, RemediationResult, HostRemediationPlan } from "../api/types";

// ─── Single alert remediation panel ───

export function RemediationInlinePanel({ data, isLoading }: { data?: RemediationResult; isLoading: boolean }) {
  const [showRollback, setShowRollback] = useState(false);

  if (isLoading) {
    return (
      <div className="border-t border-gray-100 bg-gray-50 px-6 py-4 dark:border-gray-700 dark:bg-gray-900/50">
        <div className="animate-pulse space-y-2">
          <div className="h-4 w-48 rounded bg-gray-200 dark:bg-gray-700" />
          <div className="h-10 rounded bg-gray-200 dark:bg-gray-700" />
          <div className="h-10 rounded bg-gray-200 dark:bg-gray-700" />
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="border-t border-gray-100 bg-gray-50 px-6 py-4 dark:border-gray-700 dark:bg-gray-900/50">
      {/* Warnings */}
      <WarningBox warnings={data.warnings} />

      {/* Commands */}
      <div className="space-y-2">
        {data.commands.map((cmd) => (
          <CommandBlock key={cmd.step} cmd={cmd} />
        ))}
      </div>

      {/* Metadata */}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
        {data.affectedServices.length > 0 && (
          <span className="text-gray-500 dark:text-gray-400">
            Affected services: <span className="font-medium">{data.affectedServices.join(", ")}</span>
          </span>
        )}
        <DowntimeBadge downtime={data.estimatedDowntime} />
      </div>

      {/* Notes */}
      <NotesList notes={data.notes} />

      {/* Rollback (collapsible) */}
      {data.rollbackCommands.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setShowRollback(!showRollback)}
            className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            {showRollback ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Rollback Commands
          </button>
          {showRollback && (
            <div className="mt-2 space-y-2">
              {data.rollbackCommands.map((cmd) => (
                <CommandBlock key={cmd.step} cmd={cmd} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Host remediation plan panel ───

export function HostRemediationPanel({
  plan,
  isLoading,
  onClose,
}: {
  plan?: HostRemediationPlan;
  isLoading: boolean;
  onClose: () => void;
}) {
  const [showRollback, setShowRollback] = useState(false);

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
        <div className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-xl dark:bg-gray-800" onClick={(e) => e.stopPropagation()}>
          <div className="animate-pulse space-y-3">
            <div className="h-6 w-64 rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-10 rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-10 rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-10 rounded bg-gray-200 dark:bg-gray-700" />
          </div>
        </div>
      </div>
    );
  }

  if (!plan) return null;

  const allCommands = collectAllPlanCommands(plan);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
              Remediation Plan: {plan.hostname}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {plan.packageUpdates.length} package{plan.packageUpdates.length !== 1 ? "s" : ""} to update
              {plan.os && <> &middot; {plan.os}</>}
            </p>
          </div>
          <CopyAllButton commands={allCommands} hostname={plan.hostname} />
        </div>

        <WarningBox warnings={plan.warnings} />

        {/* Impact warning */}
        <ImpactWarning hostId={plan.hostId} />

        {/* Pre-update */}
        {plan.preUpdate.length > 0 && (
          <Section title="Pre-Update">
            {plan.preUpdate.map((cmd) => <CommandBlock key={cmd.step} cmd={cmd} />)}
          </Section>
        )}

        {/* Package updates */}
        <Section title="Package Updates">
          {plan.packageUpdates.map(({ packageName, commands }) => (
            <div key={packageName} className="mb-2">
              <span className="mb-1 block text-xs font-semibold text-gray-600 dark:text-gray-400">{packageName}</span>
              {commands.map((cmd) => <CommandBlock key={cmd.step} cmd={cmd} />)}
            </div>
          ))}
        </Section>

        {/* Service restarts */}
        {plan.serviceRestarts.length > 0 && (
          <Section title="Service Restarts">
            {plan.serviceRestarts.map((cmd) => <CommandBlock key={cmd.step} cmd={cmd} />)}
          </Section>
        )}

        {/* Post-update */}
        {plan.postUpdate.length > 0 && (
          <Section title="Post-Update Verification">
            {plan.postUpdate.map((cmd) => <CommandBlock key={cmd.step} cmd={cmd} />)}
          </Section>
        )}

        {/* Reboot */}
        {plan.reboot.length > 0 && (
          <Section title="Reboot">
            {plan.reboot.map((cmd) => <CommandBlock key={cmd.step} cmd={cmd} />)}
          </Section>
        )}

        {/* Metadata */}
        <div className="mt-3 flex items-center gap-3 text-xs">
          <DowntimeBadge downtime={plan.estimatedDowntime} />
          {plan.requiresReboot && (
            <span className="rounded bg-red-100 px-2 py-0.5 text-red-700 dark:bg-red-900/30 dark:text-red-400">Reboot Required</span>
          )}
        </div>

        <NotesList notes={plan.notes} />

        {/* Rollback */}
        {plan.rollbackCommands.length > 0 && (
          <div className="mt-3">
            <button
              onClick={() => setShowRollback(!showRollback)}
              className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              {showRollback ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Rollback Commands ({plan.rollbackCommands.length})
            </button>
            {showRollback && (
              <div className="mt-2 space-y-2">
                {plan.rollbackCommands.map((cmd) => <CommandBlock key={`rb-${cmd.step}`} cmd={cmd} />)}
              </div>
            )}
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Shared components ───

function CommandBlock({ cmd }: { cmd: RemediationCommand }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(cmd.command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="group relative rounded-md border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-start justify-between px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
              {cmd.step}
            </span>
            <span className="text-xs text-gray-600 dark:text-gray-400">{cmd.description}</span>
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-gray-900 px-3 py-2 font-mono text-xs text-green-400">
            {cmd.command}
          </pre>
        </div>
        <button
          onClick={copy}
          className="ml-2 mt-1 shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
          title="Copy command"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

function WarningBox({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="mb-3 rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 dark:border-yellow-800 dark:bg-yellow-900/20">
      {warnings.map((w, i) => (
        <div key={i} className="flex items-start gap-2 text-xs text-yellow-800 dark:text-yellow-300">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{w}</span>
        </div>
      ))}
    </div>
  );
}

function NotesList({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null;
  return (
    <div className="mt-3 space-y-1">
      {notes.map((n, i) => (
        <div key={i} className="flex items-start gap-2 text-xs text-gray-500 dark:text-gray-400">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{n}</span>
        </div>
      ))}
    </div>
  );
}

function DowntimeBadge({ downtime }: { downtime: string }) {
  const colors: Record<string, string> = {
    none: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    seconds: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
    minutes: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
    unknown: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-400",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${colors[downtime] ?? colors.unknown}`}>
      <Clock className="h-3 w-3" />
      Downtime: {downtime}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <h4 className="mb-2 text-sm font-semibold text-gray-800 dark:text-gray-200">{title}</h4>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function CopyAllButton({ commands, hostname }: { commands: RemediationCommand[]; hostname: string }) {
  const [copied, setCopied] = useState(false);

  const copyAll = () => {
    const script = [
      `#!/bin/bash`,
      `# Remediation plan for ${hostname}`,
      `# Generated by InfraWatch`,
      ``,
      ...commands.map((c) => `# Step ${c.step}: ${c.description}\n${c.command}\n`),
    ].join("\n");

    navigator.clipboard.writeText(script);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={copyAll}
      className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied!" : "Copy All"}
    </button>
  );
}

function collectAllPlanCommands(plan: HostRemediationPlan): RemediationCommand[] {
  return [
    ...plan.preUpdate,
    ...plan.packageUpdates.flatMap((p) => p.commands),
    ...plan.serviceRestarts,
    ...plan.postUpdate,
    ...plan.reboot,
  ];
}

function ImpactWarning({ hostId }: { hostId: string }) {
  const { data: impact } = useImpactAnalysis(hostId);

  if (!impact || (impact.directDependents.length === 0 && impact.indirectDependents.length === 0)) {
    return null;
  }

  const colorClass =
    impact.riskLevel === "critical" ? "border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-900/20 dark:text-red-300" :
    impact.riskLevel === "high" ? "border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-700 dark:bg-orange-900/20 dark:text-orange-300" :
    "border-yellow-300 bg-yellow-50 text-yellow-800 dark:border-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-300";

  return (
    <div className={`mb-4 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${colorClass}`}>
      <Network className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <div>
        <p className="font-medium">Dependency Impact: {impact.riskLevel.toUpperCase()}</p>
        <p className="text-xs mt-0.5 opacity-80">
          {impact.directDependents.length} direct and {impact.indirectDependents.length} indirect dependent(s) may be affected by changes to this host.
        </p>
        <div className="mt-1 flex flex-wrap gap-1">
          {impact.directDependents.slice(0, 5).map((d) => (
            <span key={d.hostId} className="rounded bg-white/50 px-1.5 py-0.5 text-xs font-medium dark:bg-black/20">
              {d.hostname}
            </span>
          ))}
          {impact.directDependents.length > 5 && (
            <span className="text-xs opacity-70">+{impact.directDependents.length - 5} more</span>
          )}
        </div>
      </div>
    </div>
  );
}
