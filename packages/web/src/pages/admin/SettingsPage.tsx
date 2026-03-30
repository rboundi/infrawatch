import { useState } from "react";
import { ChevronDown, Save, Mail, Loader2, CheckCircle, XCircle } from "lucide-react";
import {
  useSettings,
  useUpdateSettings,
  useTestSmtp,
  type SettingDefinition,
} from "../../api/admin-hooks";
import { useToast } from "../../components/Toast";
import { useAuth } from "../../contexts/AuthContext";
import { Skeleton } from "../../components/Skeleton";

// ─── Constants ───

const SECTION_ORDER = [
  "general",
  "scanning",
  "alerts",
  "notifications",
  "reports",
  "security",
  "maintenance",
] as const;

const SMTP_KEYS = new Set([
  "smtp_host",
  "smtp_port",
  "smtp_user",
  "smtp_password",
  "smtp_from",
  "smtp_secure",
]);

const SMTP_PASSWORD_KEY = "smtp_password";
const SMTP_PASSWORD_PLACEHOLDER = "********";

// ─── Helpers ───

function formatCategoryName(category: string): string {
  return category
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatSettingKey(key: string): string {
  return key
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function getConstraintHint(setting: SettingDefinition): string | null {
  const c = setting.constraints;
  if (!c) return null;
  const parts: string[] = [];
  if (c.min !== undefined && c.max !== undefined) {
    parts.push(`${c.min} – ${c.max}`);
  } else if (c.min !== undefined) {
    parts.push(`min: ${c.min}`);
  } else if (c.max !== undefined) {
    parts.push(`max: ${c.max}`);
  }
  if (c.maxLength !== undefined) parts.push(`max length: ${c.maxLength}`);
  return parts.length > 0 ? parts.join(", ") : null;
}

// ─── Toggle Switch ───

function ToggleSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "bg-indigo-600" : "bg-gray-300 dark:bg-gray-600"
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

// ─── Setting Input ───

interface SettingInputProps {
  setting: SettingDefinition;
  localValue: unknown;
  onChange: (key: string, value: unknown) => void;
}

function SettingInput({ setting, localValue, onChange }: SettingInputProps) {
  const { key, valueType, constraints } = setting;
  const isPassword = key === SMTP_PASSWORD_KEY;
  const displayValue = localValue === undefined ? setting.value : localValue;
  const constraintHint = getConstraintHint(setting);

  if (valueType === "boolean") {
    return (
      <ToggleSwitch
        checked={Boolean(displayValue)}
        onChange={(v) => onChange(key, v)}
      />
    );
  }

  if (valueType === "select" && constraints?.options) {
    return (
      <select
        value={String(displayValue ?? "")}
        onChange={(e) => onChange(key, e.target.value)}
        className="w-full max-w-xs rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
      >
        {constraints.options.map((opt) => (
          <option key={opt} value={opt}>
            {formatSettingKey(opt)}
          </option>
        ))}
      </select>
    );
  }

  if (valueType === "number") {
    return (
      <div>
        <input
          type="number"
          value={displayValue === null || displayValue === undefined ? "" : String(displayValue)}
          min={constraints?.min}
          max={constraints?.max}
          onChange={(e) => {
            const parsed = e.target.value === "" ? null : Number(e.target.value);
            onChange(key, parsed);
          }}
          className="w-full max-w-xs rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
        />
        {constraintHint && (
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">Range: {constraintHint}</p>
        )}
      </div>
    );
  }

  if (valueType === "email") {
    return (
      <input
        type="email"
        value={String(displayValue ?? "")}
        onChange={(e) => onChange(key, e.target.value)}
        className="w-full max-w-sm rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
      />
    );
  }

  // string or password
  const isPasswordMasked =
    isPassword && (displayValue === SMTP_PASSWORD_PLACEHOLDER || displayValue === null || displayValue === undefined);

  return (
    <input
      type={isPassword ? "password" : "text"}
      value={isPasswordMasked ? "" : String(displayValue ?? "")}
      placeholder={isPasswordMasked ? SMTP_PASSWORD_PLACEHOLDER : undefined}
      maxLength={constraints?.maxLength}
      onChange={(e) => {
        const val = e.target.value;
        onChange(key, isPassword && val === "" ? SMTP_PASSWORD_PLACEHOLDER : val);
      }}
      className="w-full max-w-sm rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
    />
  );
}

// ─── Confirm Dialog ───

interface ConfirmDialogProps {
  category: string;
  changes: Array<{ label: string; oldValue: unknown; newValue: unknown }>;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}

function ConfirmDialog({ category, changes, onConfirm, onCancel, isPending }: ConfirmDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
          Save {formatCategoryName(category)} Settings
        </h3>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          The following changes will be applied:
        </p>

        <ul className="mb-6 max-h-60 space-y-2 overflow-y-auto">
          {changes.map(({ label, oldValue, newValue }) => (
            <li key={label} className="rounded-md bg-gray-50 p-3 dark:bg-gray-700/50">
              <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{label}</p>
              <div className="mt-1 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <span className="rounded bg-red-100 px-1.5 py-0.5 font-mono text-red-700 dark:bg-red-900/30 dark:text-red-400">
                  {formatDisplayValue(oldValue)}
                </span>
                <span>→</span>
                <span className="rounded bg-green-100 px-1.5 py-0.5 font-mono text-green-700 dark:bg-green-900/30 dark:text-green-400">
                  {formatDisplayValue(newValue)}
                </span>
              </div>
            </li>
          ))}
        </ul>

        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={isPending}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

function formatDisplayValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === SMTP_PASSWORD_PLACEHOLDER) return "••••••••";
  return String(value);
}

// ─── Section Card ───

interface SectionCardProps {
  category: string;
  settings: SettingDefinition[];
  isOpen: boolean;
  onToggle: () => void;
  edits: Record<string, unknown>;
  onEdit: (key: string, value: unknown) => void;
  onSaveRequest: () => void;
  isSaving: boolean;
  smtpTestResult: { success: boolean; message: string } | undefined;
  isSmtpTesting: boolean;
  onTestSmtp: () => void;
}

function SectionCard({
  category,
  settings,
  isOpen,
  onToggle,
  edits,
  onEdit,
  onSaveRequest,
  isSaving,
  smtpTestResult,
  isSmtpTesting,
  onTestSmtp,
}: SectionCardProps) {
  const hasEdits = Object.keys(edits).length > 0;
  const isNotifications = category === "notifications";
  const hasSmtpSettings = isNotifications && settings.some((s) => SMTP_KEYS.has(s.key));

  // Split notifications into smtp and non-smtp for rendering order
  const smtpSettings = settings.filter((s) => SMTP_KEYS.has(s.key));
  const nonSmtpSettings = settings.filter((s) => !SMTP_KEYS.has(s.key));
  const orderedSettings = hasSmtpSettings
    ? [...nonSmtpSettings, ...smtpSettings]
    : settings;

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      {/* Section Header */}
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-6 py-4 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50"
      >
        <div className="flex items-center gap-3">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {formatCategoryName(category)}
          </h3>
          {hasEdits && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              {Object.keys(edits).length} unsaved change{Object.keys(edits).length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <ChevronDown
          className={`h-5 w-5 text-gray-400 transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Section Body */}
      {isOpen && (
        <div className="border-t border-gray-100 dark:border-gray-700">
          <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
            {orderedSettings.map((setting) => (
              <div key={setting.key} className="px-6 py-4">
                <div className="flex items-start justify-between gap-6">
                  <div className="min-w-0 flex-1">
                    <label
                      htmlFor={`setting-${setting.key}`}
                      className="block text-sm font-medium text-gray-800 dark:text-gray-200"
                    >
                      {formatSettingKey(setting.key)}
                    </label>
                    {setting.description && (
                      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                        {setting.description}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0" id={`setting-${setting.key}`}>
                    <SettingInput
                      setting={setting}
                      localValue={edits[setting.key]}
                      onChange={onEdit}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* SMTP Test Button */}
          {hasSmtpSettings && (
            <div className="border-t border-gray-100 px-6 py-4 dark:border-gray-700">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={onTestSmtp}
                  disabled={isSmtpTesting}
                  className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  {isSmtpTesting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Mail className="h-4 w-4" />
                  )}
                  {isSmtpTesting ? "Sending..." : "Send Test Email"}
                </button>

                {smtpTestResult && (
                  <div
                    className={`flex items-center gap-1.5 text-sm font-medium ${
                      smtpTestResult.success
                        ? "text-green-600 dark:text-green-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {smtpTestResult.success ? (
                      <CheckCircle className="h-4 w-4" />
                    ) : (
                      <XCircle className="h-4 w-4" />
                    )}
                    {smtpTestResult.message}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Save Button */}
          <div className="flex justify-end border-t border-gray-100 px-6 py-4 dark:border-gray-700">
            <button
              type="button"
              onClick={onSaveRequest}
              disabled={!hasEdits || isSaving}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save Changes
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Loading Skeleton ───

function SettingsSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800"
        >
          <div className="px-6 py-4">
            <div className="h-5 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          </div>
          <div className="border-t border-gray-100 px-6 py-4 dark:border-gray-700">
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, j) => (
                <div key={j} className="flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="h-4 w-40 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                    <div className="h-3 w-64 animate-pulse rounded bg-gray-100 dark:bg-gray-700/50" />
                  </div>
                  <div className="h-9 w-48 animate-pulse rounded-md bg-gray-200 dark:bg-gray-700" />
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ───

export function SettingsPage() {
  const { data: settings, isLoading, isError, error } = useSettings();
  const updateMutation = useUpdateSettings();
  const testSmtpMutation = useTestSmtp();
  const { toast } = useToast();
  useAuth(); // Ensure auth context is accessible (admin guard already applied at route level)

  // Per-category local edits: { category: { key: newValue } }
  const [edits, setEdits] = useState<Record<string, Record<string, unknown>>>({});

  // Which sections are open
  const [openSections, setOpenSections] = useState<Set<string>>(
    new Set(["general", "scanning", "alerts", "notifications", "reports", "security", "maintenance"])
  );

  // Which section has a pending confirm dialog
  const [confirmSection, setConfirmSection] = useState<string | null>(null);

  const handleToggleSection = (category: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const handleEdit = (category: string, key: string, value: unknown) => {
    setEdits((prev) => ({
      ...prev,
      [category]: {
        ...(prev[category] ?? {}),
        [key]: value,
      },
    }));
  };

  const handleSaveRequest = (category: string) => {
    setConfirmSection(category);
  };

  const handleConfirm = async () => {
    if (!confirmSection || !settings) return;

    const categoryEdits = edits[confirmSection] ?? {};
    const updates: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(categoryEdits)) {
      // Skip smtp_password if it's still the placeholder (user didn't change it)
      if (key === SMTP_PASSWORD_KEY && value === SMTP_PASSWORD_PLACEHOLDER) continue;
      updates[key] = value;
    }

    if (Object.keys(updates).length === 0) {
      setConfirmSection(null);
      return;
    }

    try {
      await updateMutation.mutateAsync(updates);
      // Clear edits for this section
      setEdits((prev) => {
        const next = { ...prev };
        delete next[confirmSection];
        return next;
      });
      toast(`${formatCategoryName(confirmSection)} settings saved`, "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save settings", "error");
    } finally {
      setConfirmSection(null);
    }
  };

  // Build the confirm dialog changes list for the current section
  const buildChangesList = (category: string) => {
    if (!settings) return [];
    const categorySettings = settings[category] ?? [];
    const categoryEdits = edits[category] ?? {};
    return Object.entries(categoryEdits)
      .filter(([key, newVal]) => {
        if (key === SMTP_PASSWORD_KEY && newVal === SMTP_PASSWORD_PLACEHOLDER) return false;
        return true;
      })
      .map(([key, newVal]) => {
        const original = categorySettings.find((s) => s.key === key);
        return {
          label: formatSettingKey(key),
          oldValue:
            key === SMTP_PASSWORD_KEY
              ? SMTP_PASSWORD_PLACEHOLDER
              : (original?.value ?? null),
          newValue: key === SMTP_PASSWORD_KEY ? SMTP_PASSWORD_PLACEHOLDER : newVal,
        };
      });
  };

  // Determine sorted categories to render
  const sortedCategories = settings
    ? [
        ...SECTION_ORDER.filter((c) => c in settings),
        ...Object.keys(settings).filter(
          (c) => !SECTION_ORDER.includes(c as (typeof SECTION_ORDER)[number])
        ),
      ]
    : [];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">System Settings</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Configure InfraWatch system behavior, scanning, alerts, and notifications.
        </p>
      </div>

      {/* Loading */}
      {isLoading && <SettingsSkeleton />}

      {/* Error */}
      {isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 dark:border-red-800 dark:bg-red-900/20">
          <div className="flex items-center gap-3">
            <XCircle className="h-5 w-5 shrink-0 text-red-500" />
            <div>
              <p className="font-medium text-red-800 dark:text-red-300">Failed to load settings</p>
              <p className="mt-0.5 text-sm text-red-600 dark:text-red-400">
                {error instanceof Error ? error.message : "An unexpected error occurred"}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Settings Sections */}
      {settings && (
        <div className="space-y-4">
          {sortedCategories.map((category) => {
            const categorySettings = settings[category] ?? [];
            if (categorySettings.length === 0) return null;

            const categoryEdits = edits[category] ?? {};
            const isSaving =
              updateMutation.isPending && confirmSection === category;

            return (
              <SectionCard
                key={category}
                category={category}
                settings={categorySettings}
                isOpen={openSections.has(category)}
                onToggle={() => handleToggleSection(category)}
                edits={categoryEdits}
                onEdit={(key, value) => handleEdit(category, key, value)}
                onSaveRequest={() => handleSaveRequest(category)}
                isSaving={isSaving}
                smtpTestResult={testSmtpMutation.data ?? undefined}
                isSmtpTesting={testSmtpMutation.isPending}
                onTestSmtp={() => testSmtpMutation.mutate()}
              />
            );
          })}
        </div>
      )}

      {/* Confirm Dialog */}
      {confirmSection && settings && (
        <ConfirmDialog
          category={confirmSection}
          changes={buildChangesList(confirmSection)}
          onConfirm={handleConfirm}
          onCancel={() => setConfirmSection(null)}
          isPending={updateMutation.isPending}
        />
      )}
    </div>
  );
}
