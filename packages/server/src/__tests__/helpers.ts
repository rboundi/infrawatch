import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import supertest from "supertest";
import { getTestDb } from "./setup.js";
import { getTestApp } from "./app.js";

const DEFAULT_PASSWORD = "TestPass123";

// ─── Users ───

interface UserOverrides {
  username?: string;
  email?: string;
  password?: string;
  role?: "admin" | "operator";
  displayName?: string;
  isActive?: boolean;
}

export async function createTestUser(overrides: UserOverrides = {}) {
  const pool = getTestDb();
  const password = overrides.password ?? DEFAULT_PASSWORD;
  const hash = await bcrypt.hash(password, 4); // low rounds for speed

  const result = await pool.query(
    `INSERT INTO users (username, email, password_hash, display_name, role, is_active)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, username, email, display_name, role, is_active, created_at, updated_at`,
    [
      overrides.username ?? `user_${randomUUID().slice(0, 8)}`,
      overrides.email ?? `${randomUUID().slice(0, 8)}@test.local`,
      hash,
      overrides.displayName ?? null,
      overrides.role ?? "operator",
      overrides.isActive ?? true,
    ],
  );

  return { ...result.rows[0], password };
}

export async function createTestAdmin(overrides: UserOverrides = {}) {
  return createTestUser({ role: "admin", ...overrides });
}

// ─── Auth ───

export async function getAuthToken(username: string, password: string): Promise<string> {
  const app = getTestApp();
  const res = await supertest(app)
    .post("/api/v1/auth/login")
    .send({ username, password })
    .expect(200);

  return res.body.token;
}

// ─── Scan Targets ───

interface ScanTargetOverrides {
  name?: string;
  type?: string;
  connectionConfig?: string;
  scanIntervalHours?: number;
  enabled?: boolean;
  lastScanStatus?: string;
}

export async function createTestScanTarget(overrides: ScanTargetOverrides = {}) {
  const pool = getTestDb();
  const result = await pool.query(
    `INSERT INTO scan_targets (name, type, connection_config, scan_interval_hours, enabled, last_scan_status)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      overrides.name ?? `target_${randomUUID().slice(0, 8)}`,
      overrides.type ?? "ssh_linux",
      overrides.connectionConfig ?? JSON.stringify({ host: "127.0.0.1" }),
      overrides.scanIntervalHours ?? 6,
      overrides.enabled ?? true,
      overrides.lastScanStatus ?? "pending",
    ],
  );

  return result.rows[0];
}

// ─── Hosts ───

interface HostOverrides {
  hostname?: string;
  ipAddress?: string;
  os?: string;
  osVersion?: string;
  architecture?: string;
  environmentTag?: string;
  status?: string;
}

export async function createTestHost(scanTargetId: string, overrides: HostOverrides = {}) {
  const pool = getTestDb();
  const result = await pool.query(
    `INSERT INTO hosts (scan_target_id, hostname, ip_address, os, os_version, architecture, environment_tag, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      scanTargetId,
      overrides.hostname ?? `host_${randomUUID().slice(0, 8)}`,
      overrides.ipAddress ?? "10.0.0.1",
      overrides.os ?? "Ubuntu",
      overrides.osVersion ?? "22.04",
      overrides.architecture ?? "x86_64",
      overrides.environmentTag ?? "test",
      overrides.status ?? "active",
    ],
  );

  return result.rows[0];
}

// ─── Packages ───

interface PackageOverrides {
  packageName?: string;
  installedVersion?: string;
  packageManager?: string;
  ecosystem?: string;
}

export async function createTestPackage(hostId: string, overrides: PackageOverrides = {}) {
  const pool = getTestDb();
  const result = await pool.query(
    `INSERT INTO discovered_packages (host_id, package_name, installed_version, package_manager, ecosystem)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      hostId,
      overrides.packageName ?? `pkg_${randomUUID().slice(0, 8)}`,
      overrides.installedVersion ?? "1.0.0",
      overrides.packageManager ?? "apt",
      overrides.ecosystem ?? "debian",
    ],
  );

  return result.rows[0];
}

// ─── Services ───

interface ServiceOverrides {
  serviceName?: string;
  serviceType?: string;
  version?: string;
  port?: number;
  status?: string;
}

export async function createTestService(hostId: string, overrides: ServiceOverrides = {}) {
  const pool = getTestDb();
  const result = await pool.query(
    `INSERT INTO services (host_id, service_name, service_type, version, port, status)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      hostId,
      overrides.serviceName ?? `svc_${randomUUID().slice(0, 8)}`,
      overrides.serviceType ?? "webserver",
      overrides.version ?? "1.0",
      overrides.port ?? 80,
      overrides.status ?? "running",
    ],
  );

  return result.rows[0];
}

// ─── Alerts ───

interface AlertOverrides {
  packageId?: string;
  packageName?: string;
  currentVersion?: string;
  availableVersion?: string;
  severity?: string;
  acknowledged?: boolean;
}

export async function createTestAlert(hostId: string, overrides: AlertOverrides = {}) {
  const pool = getTestDb();
  const result = await pool.query(
    `INSERT INTO alerts (host_id, package_id, package_name, current_version, available_version, severity, acknowledged)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      hostId,
      overrides.packageId ?? null,
      overrides.packageName ?? `pkg_${randomUUID().slice(0, 8)}`,
      overrides.currentVersion ?? "1.0.0",
      overrides.availableVersion ?? "2.0.0",
      overrides.severity ?? "medium",
      overrides.acknowledged ?? false,
    ],
  );

  return result.rows[0];
}
