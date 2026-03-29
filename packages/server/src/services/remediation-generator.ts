import type pg from "pg";

// ─── Types ───

export interface RemediationCommand {
  step: number;
  description: string;
  command: string;
  runAs: "root" | "sudo" | "user";
  platform: string;
}

export interface RemediationResult {
  commands: RemediationCommand[];
  warnings: string[];
  notes: string[];
  rollbackCommands: RemediationCommand[];
  requiresRestart: boolean;
  affectedServices: string[];
  estimatedDowntime: "none" | "seconds" | "minutes" | "unknown";
}

export interface AlertContext {
  alertId: string;
  hostId: string;
  hostname: string;
  os: string | null;
  osVersion: string | null;
  packageName: string;
  currentVersion: string | null;
  availableVersion: string | null;
  ecosystem: string | null;
  packageManager: string | null;
  services: Array<{ serviceName: string; status: string }>;
}

export interface HostRemediationPlan {
  hostId: string;
  hostname: string;
  os: string | null;
  preUpdate: RemediationCommand[];
  packageUpdates: Array<{ packageName: string; commands: RemediationCommand[] }>;
  serviceRestarts: RemediationCommand[];
  postUpdate: RemediationCommand[];
  reboot: RemediationCommand[];
  rollbackCommands: RemediationCommand[];
  warnings: string[];
  notes: string[];
  requiresReboot: boolean;
  estimatedDowntime: "none" | "seconds" | "minutes" | "unknown";
}

// ─── Service restart mappings ───

const SERVICE_RESTART_MAP: Array<{
  patterns: RegExp[];
  serviceName: string;
  restartCommand: string;
  warning?: string;
}> = [
  { patterns: [/^nginx/i], serviceName: "nginx", restartCommand: "sudo systemctl restart nginx" },
  { patterns: [/^apache2/i, /^httpd/i, /^libapache/i], serviceName: "apache2", restartCommand: "sudo systemctl restart apache2" },
  { patterns: [/^postgresql/i, /^postgres/i, /^libpq/i], serviceName: "postgresql", restartCommand: "sudo systemctl restart postgresql" },
  { patterns: [/^mysql/i, /^libmysql/i, /^mariadb/i], serviceName: "mysql", restartCommand: "sudo systemctl restart mysql" },
  { patterns: [/^redis/i], serviceName: "redis-server", restartCommand: "sudo systemctl restart redis-server" },
  {
    patterns: [/^openssh/i, /^ssh/i],
    serviceName: "sshd",
    restartCommand: "sudo systemctl restart sshd",
    warning: "Restarting SSH may disconnect your current session. Ensure you have alternative access.",
  },
  {
    patterns: [/^openssl/i, /^libssl/i],
    serviceName: "openssl",
    restartCommand: "sudo lsof -n | grep libssl | awk '{print $1}' | sort -u",
    warning: "Restart all services using OpenSSL. Run: sudo lsof -n | grep libssl | awk '{print $1}' | sort -u",
  },
];

const REBOOT_PACKAGES = [
  /^glibc/i, /^libc6/i, /^linux-image/i, /^linux-headers/i, /^kernel/i,
  /^systemd$/i, /^dbus$/i,
];

// ─── Main generator ───

export function generateRemediation(ctx: AlertContext): RemediationResult {
  const ecosystem = detectEcosystem(ctx);
  const result: RemediationResult = {
    commands: [],
    warnings: [],
    notes: [],
    rollbackCommands: [],
    requiresRestart: false,
    affectedServices: [],
    estimatedDowntime: "none",
  };

  // Generate commands based on ecosystem
  switch (ecosystem) {
    case "debian":
    case "ubuntu":
      generateAptCommands(ctx, result);
      break;
    case "rhel":
    case "centos":
    case "fedora":
      generateYumCommands(ctx, result);
      break;
    case "alpine":
      generateApkCommands(ctx, result);
      break;
    case "npm":
      generateNpmCommands(ctx, result);
      break;
    case "pypi":
    case "pip":
      generatePipCommands(ctx, result);
      break;
    case "docker":
      generateDockerCommands(ctx, result);
      break;
    case "kubernetes":
      generateKubernetesCommands(ctx, result);
      break;
    case "vmware":
      generateVmwareCommands(ctx, result);
      break;
    case "windows":
      generateWindowsCommands(ctx, result);
      break;
    default:
      generateGenericCommands(ctx, result);
  }

  // Check for service restarts needed
  detectServiceRestarts(ctx, result);

  // Check for reboot-requiring packages
  detectRebootRequired(ctx, result);

  // Renumber steps
  result.commands.forEach((cmd, i) => { cmd.step = i + 1; });
  result.rollbackCommands.forEach((cmd, i) => { cmd.step = i + 1; });

  return result;
}

// ─── Ecosystem detection ───

function detectEcosystem(ctx: AlertContext): string {
  if (ctx.ecosystem) {
    const eco = ctx.ecosystem.toLowerCase();
    if (eco === "pypi") return "pip";
    return eco;
  }
  if (ctx.packageManager) {
    const pm = ctx.packageManager.toLowerCase();
    if (pm === "apt" || pm === "dpkg") return "debian";
    if (pm === "yum" || pm === "dnf" || pm === "rpm") return "rhel";
    if (pm === "apk") return "alpine";
    if (pm === "npm") return "npm";
    if (pm === "pip" || pm === "pip3") return "pip";
    return pm;
  }
  if (ctx.os) {
    const os = ctx.os.toLowerCase();
    if (os.includes("ubuntu") || os.includes("debian")) return "debian";
    if (os.includes("rhel") || os.includes("centos") || os.includes("fedora") || os.includes("red hat")) return "rhel";
    if (os.includes("alpine")) return "alpine";
    if (os.includes("windows")) return "windows";
    if (os.includes("kubernetes") || os.includes("k8s")) return "kubernetes";
    if (os.includes("vmware") || os.includes("esxi")) return "vmware";
  }
  return "unknown";
}

// ─── Debian / Ubuntu (apt) ───

function generateAptCommands(ctx: AlertContext, result: RemediationResult): void {
  const pkg = ctx.packageName;
  const ver = ctx.availableVersion;
  const oldVer = ctx.currentVersion;

  result.commands.push({
    step: 0, description: "Update package lists",
    command: "sudo apt-get update",
    runAs: "sudo", platform: "debian",
  });

  if (ver) {
    result.commands.push({
      step: 0, description: `Upgrade ${pkg} to ${ver}`,
      command: `sudo apt-get install --only-upgrade ${pkg}=${ver}*`,
      runAs: "sudo", platform: "debian",
    });
  } else {
    result.commands.push({
      step: 0, description: `Upgrade ${pkg} to latest`,
      command: `sudo apt-get install --only-upgrade ${pkg}`,
      runAs: "sudo", platform: "debian",
    });
  }

  // Rollback
  if (oldVer) {
    result.rollbackCommands.push({
      step: 0, description: `Rollback ${pkg} to ${oldVer}`,
      command: `sudo apt-get install ${pkg}=${oldVer}*`,
      runAs: "sudo", platform: "debian",
    });
  }

  // Kernel/OpenSSL warnings
  if (/^linux-image|^linux-headers/i.test(pkg)) {
    result.warnings.push("Kernel update requires a system reboot to take effect.");
  }
  if (/^openssl|^libssl/i.test(pkg)) {
    result.warnings.push(
      "Restart all services using OpenSSL. Run: sudo lsof -n | grep libssl | awk '{print $1}' | sort -u"
    );
  }
}

// ─── RHEL / CentOS (yum) ───

function generateYumCommands(ctx: AlertContext, result: RemediationResult): void {
  const pkg = ctx.packageName;
  const ver = ctx.availableVersion;
  const oldVer = ctx.currentVersion;

  if (ver) {
    result.commands.push({
      step: 0, description: `Update ${pkg} to ${ver}`,
      command: `sudo yum update ${pkg}-${ver}`,
      runAs: "sudo", platform: "rhel",
    });
  } else {
    result.commands.push({
      step: 0, description: `Update ${pkg} to latest`,
      command: `sudo yum update ${pkg}`,
      runAs: "sudo", platform: "rhel",
    });
  }

  if (oldVer) {
    result.rollbackCommands.push({
      step: 0, description: `Rollback ${pkg} to ${oldVer}`,
      command: `sudo yum downgrade ${pkg}-${oldVer}`,
      runAs: "sudo", platform: "rhel",
    });
  }
}

// ─── Alpine (apk) ───

function generateApkCommands(ctx: AlertContext, result: RemediationResult): void {
  const pkg = ctx.packageName;

  result.commands.push({
    step: 0, description: `Update and upgrade ${pkg}`,
    command: `sudo apk update && sudo apk upgrade ${pkg}`,
    runAs: "sudo", platform: "alpine",
  });
}

// ─── npm ───

function generateNpmCommands(ctx: AlertContext, result: RemediationResult): void {
  const pkg = ctx.packageName;
  const ver = ctx.availableVersion;
  const target = ver ? `${pkg}@${ver}` : `${pkg}@latest`;

  result.commands.push({
    step: 0, description: `Update ${pkg} globally`,
    command: `sudo npm install -g ${target}`,
    runAs: "sudo", platform: "npm",
  });

  result.notes.push(
    `For project-local install: cd /path/to/project && npm install ${target}`
  );
}

// ─── pip ───

function generatePipCommands(ctx: AlertContext, result: RemediationResult): void {
  const pkg = ctx.packageName;
  const ver = ctx.availableVersion;

  if (ver) {
    result.commands.push({
      step: 0, description: `Update ${pkg} to ${ver}`,
      command: `pip3 install ${pkg}==${ver}`,
      runAs: "user", platform: "pip",
    });
  } else {
    result.commands.push({
      step: 0, description: `Update ${pkg} to latest`,
      command: `pip3 install --upgrade ${pkg}`,
      runAs: "user", platform: "pip",
    });
  }

  result.warnings.push(
    "If using a virtual environment, activate it first: source /path/to/venv/bin/activate"
  );
}

// ─── Docker ───

function generateDockerCommands(ctx: AlertContext, result: RemediationResult): void {
  const image = ctx.packageName;
  const tag = ctx.availableVersion ?? "latest";
  const container = image.replace(/\//g, "-");

  result.commands.push(
    { step: 0, description: `Pull new image`, command: `docker pull ${image}:${tag}`, runAs: "sudo", platform: "docker" },
    { step: 0, description: `Stop running container`, command: `docker stop ${container}`, runAs: "sudo", platform: "docker" },
    { step: 0, description: `Remove old container`, command: `docker rm ${container}`, runAs: "sudo", platform: "docker" },
    { step: 0, description: `Start new container`, command: `docker run -d --name ${container} ${image}:${tag}`, runAs: "sudo", platform: "docker" },
  );

  result.notes.push(
    `Docker Compose alternative: Update the image tag in docker-compose.yml to "${image}:${tag}", then run: docker compose up -d`
  );

  result.rollbackCommands.push({
    step: 0, description: `Rollback to previous image`,
    command: ctx.currentVersion
      ? `docker run -d --name ${container} ${image}:${ctx.currentVersion}`
      : `# Previous image tag needed for rollback`,
    runAs: "sudo", platform: "docker",
  });

  result.estimatedDowntime = "seconds";
}

// ─── Kubernetes ───

function generateKubernetesCommands(ctx: AlertContext, result: RemediationResult): void {
  const image = ctx.packageName;
  const tag = ctx.availableVersion ?? "latest";
  const deployName = image.replace(/[^a-z0-9-]/gi, "-").toLowerCase();

  result.commands.push({
    step: 0, description: `Update deployment image`,
    command: `kubectl set image deployment/${deployName} ${deployName}=${image}:${tag}`,
    runAs: "user", platform: "kubernetes",
  });

  result.rollbackCommands.push({
    step: 0, description: `Rollback deployment`,
    command: `kubectl rollout undo deployment/${deployName}`,
    runAs: "user", platform: "kubernetes",
  });

  result.notes.push(
    "If managed via Helm: update the chart values and run helm upgrade instead.",
    "Add -n <namespace> if the deployment is not in the default namespace."
  );

  result.estimatedDowntime = "seconds";
}

// ─── VMware ───

function generateVmwareCommands(ctx: AlertContext, result: RemediationResult): void {
  result.commands.push({
    step: 0, description: "Update VMware Tools from vCenter",
    command: "# Right-click VM > Guest OS > Update VMware Tools in vCenter",
    runAs: "user", platform: "vmware",
  });
  result.notes.push("VMware Tools updates are managed through vCenter Server.");
}

// ─── Windows ───

function generateWindowsCommands(ctx: AlertContext, result: RemediationResult): void {
  result.commands.push({
    step: 0, description: "Update via Windows Update or WSUS",
    command: "# Use Windows Update, WSUS, or download latest installer from vendor",
    runAs: "user", platform: "windows",
  });
  result.notes.push(
    "For managed environments, use WSUS or SCCM to deploy the update.",
    `Package: ${ctx.packageName}, Target version: ${ctx.availableVersion ?? "latest"}`
  );
  result.estimatedDowntime = "minutes";
}

// ─── Generic fallback ───

function generateGenericCommands(ctx: AlertContext, result: RemediationResult): void {
  result.commands.push({
    step: 0, description: `Update ${ctx.packageName}`,
    command: `# Update ${ctx.packageName} from ${ctx.currentVersion ?? "current"} to ${ctx.availableVersion ?? "latest"} using your system's package manager`,
    runAs: "user", platform: "generic",
  });
  result.notes.push(
    "Could not determine the package manager. Update using the appropriate tool for your system."
  );
}

// ─── Service restart detection ───

function detectServiceRestarts(ctx: AlertContext, result: RemediationResult): void {
  for (const mapping of SERVICE_RESTART_MAP) {
    if (mapping.patterns.some((p) => p.test(ctx.packageName))) {
      // Check if the service is actually running on this host
      const running = ctx.services.some(
        (s) => s.serviceName.toLowerCase().includes(mapping.serviceName.toLowerCase()) && s.status === "running"
      );

      if (running || mapping.serviceName === "openssl") {
        result.affectedServices.push(mapping.serviceName);
        result.requiresRestart = true;

        if (mapping.warning) {
          result.warnings.push(mapping.warning);
        }

        if (mapping.serviceName !== "openssl") {
          result.commands.push({
            step: 0, description: `Restart ${mapping.serviceName}`,
            command: mapping.restartCommand,
            runAs: "sudo", platform: ctx.os?.toLowerCase().includes("alpine") ? "alpine" : "linux",
          });
        }

        if (result.estimatedDowntime === "none") {
          result.estimatedDowntime = "seconds";
        }
      }
    }
  }
}

// ─── Reboot detection ───

function detectRebootRequired(ctx: AlertContext, result: RemediationResult): void {
  if (REBOOT_PACKAGES.some((p) => p.test(ctx.packageName))) {
    result.warnings.push("This update requires a system reboot to fully take effect.");
    result.commands.push({
      step: 0, description: "Reboot system (schedule during maintenance window)",
      command: "sudo reboot",
      runAs: "sudo", platform: "linux",
    });
    result.estimatedDowntime = "minutes";
  }
}

// ─── Consolidated host plan ───

export async function generateHostRemediationPlan(
  pool: pg.Pool,
  hostId: string
): Promise<HostRemediationPlan | null> {
  // Get host info
  const hostResult = await pool.query<{
    id: string; hostname: string; os: string | null; os_version: string | null;
  }>("SELECT id, hostname, os, os_version FROM hosts WHERE id = $1", [hostId]);

  if (hostResult.rows.length === 0) return null;
  const host = hostResult.rows[0];

  // Get open alerts with package info
  const alertsResult = await pool.query<{
    id: string; package_name: string; current_version: string | null;
    available_version: string | null; severity: string;
    ecosystem: string | null; package_manager: string | null;
  }>(
    `SELECT a.id, a.package_name, a.current_version, a.available_version, a.severity,
            dp.ecosystem, dp.package_manager
     FROM alerts a
     LEFT JOIN discovered_packages dp ON dp.host_id = a.host_id AND dp.package_name = a.package_name AND dp.removed_at IS NULL
     WHERE a.host_id = $1 AND a.acknowledged = false
     ORDER BY CASE a.severity
       WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3
       WHEN 'low' THEN 4 ELSE 5 END`,
    [hostId]
  );

  if (alertsResult.rows.length === 0) return null;

  // Get services
  const servicesResult = await pool.query<{ service_name: string; status: string }>(
    "SELECT service_name, status FROM services WHERE host_id = $1",
    [hostId]
  );
  const services = servicesResult.rows.map((r) => ({ serviceName: r.service_name, status: r.status }));

  const plan: HostRemediationPlan = {
    hostId: host.id,
    hostname: host.hostname,
    os: host.os,
    preUpdate: [],
    packageUpdates: [],
    serviceRestarts: [],
    postUpdate: [],
    reboot: [],
    rollbackCommands: [],
    warnings: [],
    notes: [],
    requiresReboot: false,
    estimatedDowntime: "none",
  };

  const ecosystem = detectEcosystem({
    alertId: "", hostId: host.id, hostname: host.hostname,
    os: host.os, osVersion: host.os_version,
    packageName: "", currentVersion: null, availableVersion: null,
    ecosystem: alertsResult.rows[0].ecosystem, packageManager: alertsResult.rows[0].package_manager,
    services,
  });

  // Pre-update: single apt-get update / yum check-update
  if (ecosystem === "debian" || ecosystem === "ubuntu") {
    plan.preUpdate.push({
      step: 1, description: "Update package lists",
      command: "sudo apt-get update", runAs: "sudo", platform: "debian",
    });
  }

  const restartSet = new Set<string>();
  let needsReboot = false;
  let step = plan.preUpdate.length + 1;

  // Generate per-package commands (without the pre-update step)
  for (const alert of alertsResult.rows) {
    const ctx: AlertContext = {
      alertId: alert.id, hostId: host.id, hostname: host.hostname,
      os: host.os, osVersion: host.os_version,
      packageName: alert.package_name, currentVersion: alert.current_version,
      availableVersion: alert.available_version,
      ecosystem: alert.ecosystem, packageManager: alert.package_manager,
      services,
    };

    const remed = generateRemediation(ctx);

    // Filter out duplicate apt-get update / general pre-update commands
    const updateCmds = remed.commands.filter(
      (c) => !c.command.startsWith("sudo apt-get update") && !c.command.startsWith("sudo yum check-update")
    );

    // Filter out restart/reboot commands (we'll consolidate them)
    const pkgCmds = updateCmds.filter(
      (c) => !c.command.startsWith("sudo systemctl restart") && c.command !== "sudo reboot"
    );

    plan.packageUpdates.push({
      packageName: alert.package_name,
      commands: pkgCmds.map((c) => ({ ...c, step: step++ })),
    });

    // Collect service restarts
    for (const svc of remed.affectedServices) {
      restartSet.add(svc);
    }

    // Collect rollback commands
    plan.rollbackCommands.push(...remed.rollbackCommands);
    plan.warnings.push(...remed.warnings);
    plan.notes.push(...remed.notes);

    if (REBOOT_PACKAGES.some((p) => p.test(alert.package_name))) {
      needsReboot = true;
    }

    if (remed.estimatedDowntime === "minutes" && plan.estimatedDowntime !== "minutes") {
      plan.estimatedDowntime = "minutes";
    } else if (remed.estimatedDowntime === "seconds" && plan.estimatedDowntime === "none") {
      plan.estimatedDowntime = "seconds";
    }
  }

  // Consolidated service restarts
  for (const svc of restartSet) {
    if (svc === "openssl") continue; // openssl needs manual detection, not a single restart
    plan.serviceRestarts.push({
      step: step++, description: `Restart ${svc}`,
      command: `sudo systemctl restart ${svc}`,
      runAs: "sudo", platform: "linux",
    });
  }

  // Post-update verification
  if (ecosystem === "debian" || ecosystem === "ubuntu") {
    plan.postUpdate.push({
      step: step++, description: "Verify no held packages remain",
      command: "sudo apt-get -s upgrade | head -20",
      runAs: "sudo", platform: "debian",
    });
  }

  // Reboot if needed
  if (needsReboot) {
    plan.requiresReboot = true;
    plan.estimatedDowntime = "minutes";
    plan.reboot.push({
      step: step++, description: "Reboot system (schedule during maintenance window)",
      command: "sudo reboot", runAs: "sudo", platform: "linux",
    });
  }

  // Deduplicate warnings and notes
  plan.warnings = [...new Set(plan.warnings)];
  plan.notes = [...new Set(plan.notes)];

  // Renumber rollback commands
  plan.rollbackCommands.forEach((c, i) => { c.step = i + 1; });

  return plan;
}
