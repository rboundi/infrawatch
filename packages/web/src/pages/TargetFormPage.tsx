import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Zap, Loader2, CheckCircle2, XCircle, Save } from "lucide-react";
import {
  useCreateTarget,
  useUpdateTarget,
  useScanTargets,
  useScanTarget,
  useTestConnection,
} from "../api/hooks";
import { Skeleton } from "../components/Skeleton";
import type { TestConnectionResult } from "../api/types";

// ─── Type configs ───

const TARGET_TYPES = [
  { value: "ssh_linux", label: "SSH (Linux)", desc: "Discover packages and services via SSH" },
  { value: "winrm", label: "WinRM (Windows)", desc: "Discover programs and services via PowerShell remoting" },
  { value: "kubernetes", label: "Kubernetes", desc: "Discover deployments, pods, and container images" },
  { value: "aws", label: "AWS", desc: "Discover EC2, RDS, ECS, Lambda resources" },
  { value: "vmware", label: "VMware vSphere", desc: "Discover VMs and ESXi hosts" },
  { value: "docker", label: "Docker", desc: "Discover containers and images on remote Docker host" },
  { value: "network_discovery", label: "Network Discovery", desc: "Scan subnets to find hosts, services, and open ports via nmap" },
] as const;

const AWS_REGIONS = [
  "us-east-1", "us-east-2", "us-west-1", "us-west-2",
  "eu-west-1", "eu-west-2", "eu-west-3", "eu-central-1", "eu-north-1",
  "ap-southeast-1", "ap-southeast-2", "ap-northeast-1", "ap-northeast-2", "ap-south-1",
  "sa-east-1", "ca-central-1", "me-south-1", "af-south-1",
];

interface FormErrors {
  [key: string]: string;
}

export function TargetFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = !!id;

  // Load existing target if editing (detail endpoint includes decrypted config)
  const { data: targets } = useScanTargets();
  const { data: existingTarget } = useScanTarget(isEdit ? id : undefined);

  // Form state
  const [name, setName] = useState("");
  const [type, setType] = useState("ssh_linux");
  const [scanIntervalHours, setScanIntervalHours] = useState(6);
  const [environmentTag, setEnvironmentTag] = useState("");
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<FormErrors>({});
  const initialLoadDone = useRef(!isEdit);

  // Test state
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);

  const createMutation = useCreateTarget();
  const updateMutation = useUpdateTarget();
  const testMutation = useTestConnection();

  // Populate form for edit mode
  useEffect(() => {
    if (existingTarget) {
      initialLoadDone.current = false; // Guard: prevent type-change effect from clearing config
      setName(existingTarget.name);
      setType(existingTarget.type);
      setScanIntervalHours(existingTarget.scanIntervalHours);
      if (existingTarget.connectionConfig) {
        const cfg = { ...existingTarget.connectionConfig };

        // Convert array subnets back to newline-separated string for textarea
        if (Array.isArray(cfg.subnets)) {
          cfg.subnets = (cfg.subnets as string[]).join("\n");
        }
        // Convert array excludeHosts back to string
        if (Array.isArray(cfg.excludeHosts)) {
          cfg.excludeHosts = (cfg.excludeHosts as string[]).join("\n");
        }

        // Clear redacted placeholder values so fields show as empty (user re-enters if needed)
        const redacted = "••••••••";
        for (const key of ["password", "privateKey", "secretAccessKey", "token"]) {
          if (cfg[key] === redacted) {
            cfg[key] = "";
          }
        }

        setConfig(cfg);
        if (cfg.environmentTag) {
          setEnvironmentTag(cfg.environmentTag as string);
        }
      }
    }
  }, [existingTarget]);

  // Reset config when type changes (skip during initial edit load)
  // The flag is set to true HERE after skipping, guaranteeing correct render-cycle ordering.
  useEffect(() => {
    if (!initialLoadDone.current) {
      initialLoadDone.current = true;
      return;
    }
    setConfig({});
    setErrors({});
    setTestResult(null);
  }, [type]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateConfig = (key: string, value: unknown) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const validate = (): boolean => {
    const errs: FormErrors = {};

    if (!name.trim()) errs.name = "Name is required";

    // Type-specific validation
    switch (type) {
      case "ssh_linux":
        if (!config.host) errs.host = "Host is required";
        if (!config.username) errs.username = "Username is required";
        if (!isEdit) {
          if (config.authMethod === "password" && !config.password) errs.password = "Password is required";
          if (config.authMethod === "privateKey" && !config.privateKey) errs.privateKey = "Private key is required";
        }
        break;
      case "winrm":
        if (!config.host) errs.host = "Host is required";
        if (!config.username) errs.username = "Username is required";
        if (!isEdit && !config.password) errs.password = "Password is required";
        break;
      case "kubernetes":
        if (config.method === "kubeconfig" && !config.kubeconfig) errs.kubeconfig = "Kubeconfig is required";
        break;
      case "aws":
        if (!config.regions || (config.regions as string[]).length === 0) errs.regions = "At least one region is required";
        if (config.authMethod === "keys" && !config.accessKeyId) errs.accessKeyId = "Access Key ID is required";
        if (!isEdit && config.authMethod === "keys" && !config.secretAccessKey) errs.secretAccessKey = "Secret Access Key is required";
        break;
      case "vmware":
        if (!config.host) errs.host = "vCenter host is required";
        if (!config.username) errs.username = "Username is required";
        if (!isEdit && !config.password) errs.password = "Password is required";
        break;
      case "docker":
        if (!config.host && !config.socketPath) errs.host = "Host or socket path is required";
        break;
      case "network_discovery":
        if (!config.subnets || (config.subnets as string).trim() === "") errs.subnets = "At least one subnet is required";
        break;
    }

    if (scanIntervalHours < 1) errs.scanIntervalHours = "Must be at least 1 hour";

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const connectionConfig = { ...config };
    if (type === "network_discovery" && typeof connectionConfig.subnets === "string") {
      connectionConfig.subnets = (connectionConfig.subnets as string)
        .split(/[\n,]+/)
        .map((s: string) => s.trim())
        .filter(Boolean);
    }
    if (type === "network_discovery" && typeof connectionConfig.excludeHosts === "string") {
      const val = (connectionConfig.excludeHosts as string).trim();
      connectionConfig.excludeHosts = val ? val.split(/[\n,]+/).map((s: string) => s.trim()).filter(Boolean) : [];
    }
    if (environmentTag.trim()) {
      connectionConfig.environmentTag = environmentTag.trim();
    }

    // On edit, remove empty sensitive fields so the backend preserves existing values
    if (isEdit) {
      for (const key of ["password", "privateKey", "secretAccessKey", "token"]) {
        if (connectionConfig[key] === "" || connectionConfig[key] === undefined) {
          delete connectionConfig[key];
        }
      }
    }

    if (isEdit && id) {
      updateMutation.mutate(
        { id, name, type, connectionConfig, scanIntervalHours },
        { onSuccess: () => navigate("/targets") }
      );
    } else {
      createMutation.mutate(
        { name, type, connectionConfig, scanIntervalHours },
        { onSuccess: () => navigate("/targets") }
      );
    }
  };

  const handleTest = () => {
    if (!isEdit || !id) return;
    setTestResult(null);
    testMutation.mutate(id, {
      onSuccess: (result) => setTestResult(result),
    });
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const mutationError = createMutation.error ?? updateMutation.error;

  if (isEdit && !existingTarget && targets) {
    // Target detail hasn't loaded yet but list is available — check if id exists
    const found = targets.find((t) => t.id === id);
    if (!found) {
      return (
        <div className="py-12 text-center text-gray-500 dark:text-gray-400">
          Target not found.
        </div>
      );
    }
  }

  if (isEdit && !existingTarget) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          to="/targets"
          className="mb-3 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to targets
        </Link>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          {isEdit ? "Edit Target" : "Add Scan Target"}
        </h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Name */}
        <Field label="Name" error={errors.name} required>
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setErrors((p) => { const n = {...p}; delete n.name; return n; }); }}
            placeholder="e.g. Production SSH Servers"
            className={inputClass(errors.name)}
          />
        </Field>

        {/* Type selector */}
        <Field label="Type" required>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {TARGET_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setType(t.value)}
                className={`rounded-lg border p-3 text-left transition-all ${
                  type === t.value
                    ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500 dark:border-indigo-400 dark:bg-indigo-900/20"
                    : "border-gray-200 bg-white hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600"
                }`}
              >
                <p className={`text-sm font-medium ${type === t.value ? "text-indigo-700 dark:text-indigo-300" : "text-gray-900 dark:text-gray-100"}`}>
                  {t.label}
                </p>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{t.desc}</p>
              </button>
            ))}
          </div>
        </Field>

        {/* Dynamic connection config */}
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50">
          <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
            Connection Configuration
          </h3>
          <ConnectionFields type={type} config={config} updateConfig={updateConfig} errors={errors} />
        </div>

        {/* Scan interval */}
        <Field label="Scan Interval" error={errors.scanIntervalHours}>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              value={scanIntervalHours}
              onChange={(e) => setScanIntervalHours(parseInt(e.target.value, 10) || 6)}
              className={`w-24 ${inputClass(errors.scanIntervalHours)}`}
            />
            <span className="text-sm text-gray-500 dark:text-gray-400">hours</span>
          </div>
        </Field>

        {/* Environment tag */}
        <Field label="Environment Tag" hint="Optional. Applied to all discovered hosts.">
          <input
            type="text"
            value={environmentTag}
            onChange={(e) => setEnvironmentTag(e.target.value)}
            placeholder="e.g. production, staging"
            className={inputClass()}
          />
        </Field>

        {/* Test connection (edit mode only) */}
        {isEdit && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleTest}
              disabled={testMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              {testMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Zap className="h-4 w-4" />
              )}
              Test Connection
            </button>
            {testResult && (
              <span className={`inline-flex items-center gap-1 text-sm ${testResult.success ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
                {testResult.success ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                {testResult.message} ({testResult.latencyMs}ms)
              </span>
            )}
          </div>
        )}

        {/* Error banner */}
        {mutationError && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
            {mutationError.message}
          </div>
        )}

        {/* Submit */}
        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {isPending ? "Saving..." : isEdit ? "Update Target" : "Create Target"}
          </button>
          <Link
            to="/targets"
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}

// ─── Connection fields per type ───

function ConnectionFields({
  type,
  config,
  updateConfig,
  errors,
}: {
  type: string;
  config: Record<string, unknown>;
  updateConfig: (k: string, v: unknown) => void;
  errors: FormErrors;
}) {
  switch (type) {
    case "ssh_linux":
      return <SSHFields config={config} updateConfig={updateConfig} errors={errors} />;
    case "winrm":
      return <WinRMFields config={config} updateConfig={updateConfig} errors={errors} />;
    case "kubernetes":
      return <KubernetesFields config={config} updateConfig={updateConfig} errors={errors} />;
    case "aws":
      return <AWSFields config={config} updateConfig={updateConfig} errors={errors} />;
    case "vmware":
      return <VMwareFields config={config} updateConfig={updateConfig} errors={errors} />;
    case "docker":
      return <DockerFields config={config} updateConfig={updateConfig} errors={errors} />;
    case "network_discovery":
      return <NetworkDiscoveryFields config={config} updateConfig={updateConfig} errors={errors} />;
    default:
      return null;
  }
}

function SSHFields({ config, updateConfig, errors }: FieldProps) {
  const authMethod = (config.authMethod as string) || "privateKey";

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Host" error={errors.host} required compact>
          <input type="text" value={(config.host as string) ?? ""} onChange={(e) => updateConfig("host", e.target.value)} placeholder="192.168.1.100" className={inputClass(errors.host)} />
        </Field>
        <Field label="Port" compact>
          <input type="number" value={(config.port as number) ?? 22} onChange={(e) => updateConfig("port", parseInt(e.target.value, 10) || 22)} className={inputClass()} />
        </Field>
      </div>
      <Field label="Username" error={errors.username} required compact>
        <input type="text" value={(config.username as string) ?? ""} onChange={(e) => updateConfig("username", e.target.value)} placeholder="root" className={inputClass(errors.username)} />
      </Field>
      <Field label="Auth Method" compact>
        <div className="flex gap-4">
          <label className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300">
            <input type="radio" checked={authMethod === "privateKey"} onChange={() => updateConfig("authMethod", "privateKey")} className="text-indigo-600" />
            Private Key
          </label>
          <label className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300">
            <input type="radio" checked={authMethod === "password"} onChange={() => updateConfig("authMethod", "password")} className="text-indigo-600" />
            Password
          </label>
        </div>
      </Field>
      {authMethod === "privateKey" ? (
        <>
          <Field label="Private Key" error={errors.privateKey} required compact>
            <textarea rows={4} value={(config.privateKey as string) ?? ""} onChange={(e) => updateConfig("privateKey", e.target.value)} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" className={inputClass(errors.privateKey) + " font-mono text-xs"} />
          </Field>
          <Field label="Passphrase" compact hint="If key is encrypted">
            <input type="password" value={(config.passphrase as string) ?? ""} onChange={(e) => updateConfig("passphrase", e.target.value)} className={inputClass()} />
          </Field>
        </>
      ) : (
        <Field label="Password" error={errors.password} required compact>
          <input type="password" value={(config.password as string) ?? ""} onChange={(e) => updateConfig("password", e.target.value)} className={inputClass(errors.password)} />
        </Field>
      )}
    </div>
  );
}

function WinRMFields({ config, updateConfig, errors }: FieldProps) {
  const useSsl = (config.useSsl as boolean) ?? false;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Host" error={errors.host} required compact>
          <input type="text" value={(config.host as string) ?? ""} onChange={(e) => updateConfig("host", e.target.value)} placeholder="192.168.1.100" className={inputClass(errors.host)} />
        </Field>
        <Field label="Port" compact>
          <input type="number" value={(config.port as number) ?? (useSsl ? 5986 : 5985)} onChange={(e) => updateConfig("port", parseInt(e.target.value, 10))} className={inputClass()} />
        </Field>
      </div>
      <Field label="Username" error={errors.username} required compact>
        <input type="text" value={(config.username as string) ?? ""} onChange={(e) => updateConfig("username", e.target.value)} placeholder="Administrator" className={inputClass(errors.username)} />
      </Field>
      <Field label="Password" error={errors.password} required compact>
        <input type="password" value={(config.password as string) ?? ""} onChange={(e) => updateConfig("password", e.target.value)} className={inputClass(errors.password)} />
      </Field>
      <div className="flex gap-4">
        <label className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300">
          <input type="checkbox" checked={useSsl} onChange={(e) => { updateConfig("useSsl", e.target.checked); if (e.target.checked && (config.port as number) === 5985) updateConfig("port", 5986); if (!e.target.checked && (config.port as number) === 5986) updateConfig("port", 5985); }} className="rounded text-indigo-600" />
          Use SSL
        </label>
        <label className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300">
          <input type="checkbox" checked={(config.ignoreSslErrors as boolean) ?? false} onChange={(e) => updateConfig("ignoreSslErrors", e.target.checked)} className="rounded text-indigo-600" />
          Ignore SSL errors
        </label>
      </div>
    </div>
  );
}

function KubernetesFields({ config, updateConfig, errors }: FieldProps) {
  const method = (config.method as string) || "kubeconfig";

  return (
    <div className="space-y-3">
      <Field label="Method" compact>
        <div className="flex gap-4">
          <label className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300">
            <input type="radio" checked={method === "kubeconfig"} onChange={() => updateConfig("method", "kubeconfig")} className="text-indigo-600" />
            Kubeconfig File
          </label>
          <label className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300">
            <input type="radio" checked={method === "incluster"} onChange={() => updateConfig("method", "incluster")} className="text-indigo-600" />
            In-Cluster
          </label>
        </div>
      </Field>
      {method === "kubeconfig" && (
        <>
          <Field label="Kubeconfig" error={errors.kubeconfig} required compact>
            <textarea rows={6} value={(config.kubeconfig as string) ?? ""} onChange={(e) => updateConfig("kubeconfig", e.target.value)} placeholder="Paste kubeconfig YAML here..." className={inputClass(errors.kubeconfig) + " font-mono text-xs"} />
          </Field>
          <Field label="Context" compact hint="Leave blank for default context">
            <input type="text" value={(config.context as string) ?? ""} onChange={(e) => updateConfig("context", e.target.value)} placeholder="my-cluster" className={inputClass()} />
          </Field>
        </>
      )}
    </div>
  );
}

function AWSFields({ config, updateConfig, errors }: FieldProps) {
  const authMethod = (config.authMethod as string) || "default";
  const regions = (config.regions as string[]) || [];

  const toggleRegion = (region: string) => {
    const current = [...regions];
    const idx = current.indexOf(region);
    if (idx >= 0) current.splice(idx, 1);
    else current.push(region);
    updateConfig("regions", current);
  };

  return (
    <div className="space-y-3">
      <Field label="Regions" error={errors.regions} required compact>
        <div className="grid max-h-40 grid-cols-2 gap-1 overflow-y-auto rounded border border-gray-200 bg-white p-2 dark:border-gray-600 dark:bg-gray-800 sm:grid-cols-3">
          {AWS_REGIONS.map((r) => (
            <label key={r} className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300">
              <input type="checkbox" checked={regions.includes(r)} onChange={() => toggleRegion(r)} className="rounded text-indigo-600" />
              {r}
            </label>
          ))}
        </div>
        {regions.length > 0 && (
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{regions.length} region(s) selected</p>
        )}
      </Field>
      <Field label="Auth Method" compact>
        <div className="flex gap-4">
          <label className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300">
            <input type="radio" checked={authMethod === "default"} onChange={() => updateConfig("authMethod", "default")} className="text-indigo-600" />
            Default Credential Chain
          </label>
          <label className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300">
            <input type="radio" checked={authMethod === "keys"} onChange={() => updateConfig("authMethod", "keys")} className="text-indigo-600" />
            IAM Keys
          </label>
        </div>
      </Field>
      {authMethod === "keys" && (
        <>
          <Field label="Access Key ID" error={errors.accessKeyId} required compact>
            <input type="text" value={(config.accessKeyId as string) ?? ""} onChange={(e) => updateConfig("accessKeyId", e.target.value)} placeholder="AKIAIOSFODNN7EXAMPLE" className={inputClass(errors.accessKeyId) + " font-mono text-xs"} />
          </Field>
          <Field label="Secret Access Key" error={errors.secretAccessKey} required compact>
            <input type="password" value={(config.secretAccessKey as string) ?? ""} onChange={(e) => updateConfig("secretAccessKey", e.target.value)} className={inputClass(errors.secretAccessKey)} />
          </Field>
        </>
      )}
    </div>
  );
}

function VMwareFields({ config, updateConfig, errors }: FieldProps) {
  return (
    <div className="space-y-3">
      <Field label="vCenter Host" error={errors.host} required compact>
        <input type="text" value={(config.host as string) ?? ""} onChange={(e) => updateConfig("host", e.target.value)} placeholder="vcenter.example.com" className={inputClass(errors.host)} />
      </Field>
      <Field label="Username" error={errors.username} required compact>
        <input type="text" value={(config.username as string) ?? ""} onChange={(e) => updateConfig("username", e.target.value)} placeholder="administrator@vsphere.local" className={inputClass(errors.username)} />
      </Field>
      <Field label="Password" error={errors.password} required compact>
        <input type="password" value={(config.password as string) ?? ""} onChange={(e) => updateConfig("password", e.target.value)} className={inputClass(errors.password)} />
      </Field>
      <label className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300">
        <input type="checkbox" checked={(config.ignoreSslErrors as boolean) ?? false} onChange={(e) => updateConfig("ignoreSslErrors", e.target.checked)} className="rounded text-indigo-600" />
        Ignore SSL errors
      </label>
    </div>
  );
}

function DockerFields({ config, updateConfig, errors }: FieldProps) {
  const useTls = (config.useTls as boolean) ?? false;
  const useSocket = (config.useSocket as boolean) ?? false;

  return (
    <div className="space-y-3">
      <div className="flex gap-4">
        <label className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300">
          <input type="radio" checked={!useSocket} onChange={() => updateConfig("useSocket", false)} className="text-indigo-600" />
          TCP/TLS
        </label>
        <label className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300">
          <input type="radio" checked={useSocket} onChange={() => updateConfig("useSocket", true)} className="text-indigo-600" />
          Unix Socket
        </label>
      </div>
      {useSocket ? (
        <Field label="Socket Path" error={errors.host} compact>
          <input type="text" value={(config.socketPath as string) ?? "/var/run/docker.sock"} onChange={(e) => updateConfig("socketPath", e.target.value)} className={inputClass(errors.host)} />
        </Field>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Host" error={errors.host} required compact>
              <input type="text" value={(config.host as string) ?? ""} onChange={(e) => updateConfig("host", e.target.value)} placeholder="docker.example.com" className={inputClass(errors.host)} />
            </Field>
            <Field label="Port" compact>
              <input type="number" value={(config.port as number) ?? 2376} onChange={(e) => updateConfig("port", parseInt(e.target.value, 10))} className={inputClass()} />
            </Field>
          </div>
          <label className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={useTls} onChange={(e) => updateConfig("useTls", e.target.checked)} className="rounded text-indigo-600" />
            Use TLS
          </label>
          {useTls && (
            <div className="space-y-3">
              <Field label="CA Certificate" compact>
                <textarea rows={3} value={(config.ca as string) ?? ""} onChange={(e) => updateConfig("ca", e.target.value)} placeholder="-----BEGIN CERTIFICATE-----" className={inputClass() + " font-mono text-xs"} />
              </Field>
              <Field label="Client Certificate" compact>
                <textarea rows={3} value={(config.cert as string) ?? ""} onChange={(e) => updateConfig("cert", e.target.value)} placeholder="-----BEGIN CERTIFICATE-----" className={inputClass() + " font-mono text-xs"} />
              </Field>
              <Field label="Client Key" compact>
                <textarea rows={3} value={(config.key as string) ?? ""} onChange={(e) => updateConfig("key", e.target.value)} placeholder="-----BEGIN PRIVATE KEY-----" className={inputClass() + " font-mono text-xs"} />
              </Field>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function NetworkDiscoveryFields({ config, updateConfig, errors }: FieldProps) {
  const scanProfile = (config.scanProfile as string) || "polite";
  const portProfile = (config.portProfile as string) || "infrastructure";
  const osDetection = (config.osDetection as boolean) ?? true;
  const versionDetection = (config.versionDetection as boolean) ?? true;
  const scriptScanning = (config.scriptScanning as boolean) ?? false;

  return (
    <div className="space-y-3">
      <Field label="Subnets" error={errors.subnets} required compact hint="One per line or comma-separated. CIDR notation.">
        <textarea
          rows={3}
          value={(config.subnets as string) ?? ""}
          onChange={(e) => updateConfig("subnets", e.target.value)}
          placeholder={"192.168.1.0/24\n10.0.0.0/16"}
          className={inputClass(errors.subnets) + " font-mono text-xs"}
        />
      </Field>

      <Field label="Exclude Hosts" compact hint="IPs or ranges to skip (e.g. 192.168.1.1,192.168.1.254)">
        <input
          type="text"
          value={(config.excludeHosts as string) ?? ""}
          onChange={(e) => updateConfig("excludeHosts", e.target.value)}
          placeholder="192.168.1.1,192.168.1.254"
          className={inputClass()}
        />
      </Field>

      <Field label="Scan Profile" compact>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { value: "stealthy", label: "Stealthy", time: "~25 min / /24" },
            { value: "polite", label: "Polite", time: "~10 min / /24" },
            { value: "normal", label: "Normal", time: "~5 min / /24" },
            { value: "aggressive", label: "Aggressive", time: "~2 min / /24" },
          ].map((p) => (
            <label
              key={p.value}
              className={`flex cursor-pointer flex-col rounded-md border p-2 transition-all ${
                scanProfile === p.value
                  ? "border-indigo-500 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-900/20"
                  : "border-gray-200 hover:border-gray-300 dark:border-gray-600 dark:hover:border-gray-500"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={scanProfile === p.value}
                  onChange={() => updateConfig("scanProfile", p.value)}
                  className="text-indigo-600"
                />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{p.label}</span>
              </div>
              <span className="mt-0.5 pl-5 text-xs text-gray-400">{p.time}</span>
            </label>
          ))}
        </div>
      </Field>

      <Field label="Port Profile" compact>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { value: "infrastructure", label: "Infrastructure", desc: "Top 100 infra ports" },
            { value: "common", label: "Common", desc: "Top 1000 ports" },
            { value: "full", label: "Full", desc: "All 65535 ports" },
            { value: "custom", label: "Custom", desc: "Specify ports" },
          ].map((p) => (
            <label
              key={p.value}
              className={`flex cursor-pointer flex-col rounded-md border p-2 transition-all ${
                portProfile === p.value
                  ? "border-indigo-500 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-900/20"
                  : "border-gray-200 hover:border-gray-300 dark:border-gray-600 dark:hover:border-gray-500"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={portProfile === p.value}
                  onChange={() => updateConfig("portProfile", p.value)}
                  className="text-indigo-600"
                />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{p.label}</span>
              </div>
              <span className="mt-0.5 pl-5 text-xs text-gray-400">{p.desc}</span>
            </label>
          ))}
        </div>
        {portProfile === "full" && (
          <p className="mt-1.5 rounded bg-amber-50 px-2 py-1 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
            Full port scan is very slow and may trigger intrusion detection systems.
          </p>
        )}
      </Field>

      {portProfile === "custom" && (
        <Field label="Custom Ports" compact hint="Comma-separated ports or ranges (e.g. 22,80,443,8000-9000)">
          <input
            type="text"
            value={(config.customPorts as string) ?? ""}
            onChange={(e) => updateConfig("customPorts", e.target.value)}
            placeholder="22,80,443,8000-9000"
            className={inputClass()}
          />
        </Field>
      )}

      <div className="space-y-2 pt-1">
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={osDetection}
            onChange={(e) => updateConfig("osDetection", e.target.checked)}
            className="rounded text-indigo-600"
          />
          OS Detection
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={versionDetection}
            onChange={(e) => updateConfig("versionDetection", e.target.checked)}
            className="rounded text-indigo-600"
          />
          Version Detection
        </label>
        <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={scriptScanning}
            onChange={(e) => updateConfig("scriptScanning", e.target.checked)}
            className="mt-0.5 rounded text-indigo-600"
          />
          <div>
            Script Scanning (NSE)
            <p className="text-xs text-gray-400 dark:text-gray-500">
              Run default nmap scripts for service enumeration. Increases scan time and network traffic.
            </p>
          </div>
        </label>
      </div>

      <Field label="Scan Timeout" compact>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            value={(config.scanTimeout as number) ?? 30}
            onChange={(e) => updateConfig("scanTimeout", parseInt(e.target.value, 10) || 30)}
            className={`w-24 ${inputClass()}`}
          />
          <span className="text-sm text-gray-500 dark:text-gray-400">minutes</span>
        </div>
      </Field>
    </div>
  );
}

// ─── Shared form components ───

interface FieldProps {
  config: Record<string, unknown>;
  updateConfig: (k: string, v: unknown) => void;
  errors: FormErrors;
}

function Field({
  label,
  error,
  required,
  hint,
  compact,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  hint?: string;
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={compact ? "" : ""}>
      <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
      {hint && !error && (
        <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{hint}</p>
      )}
      {error && (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}

function inputClass(error?: string) {
  const base =
    "w-full rounded-md border px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 dark:text-gray-100 dark:placeholder-gray-500";
  return error
    ? `${base} border-red-300 focus:border-red-500 focus:ring-red-500 dark:border-red-700`
    : `${base} border-gray-300 focus:border-indigo-500 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800`;
}
