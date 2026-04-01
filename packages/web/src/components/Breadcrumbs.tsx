import { Link, useLocation } from "react-router-dom";
import { ChevronRight } from "lucide-react";

const LABELS: Record<string, string> = {
  hosts: "Hosts",
  alerts: "Alerts",
  discovery: "Discovery",
  setup: "Setup",
  targets: "Scan Targets",
  reports: "Reports",
  notifications: "Notifications",
  admin: "Admin",
  users: "Users",
  agents: "Agents",
  settings: "Settings",
  "audit-log": "Audit Log",
  profile: "Profile",
  sessions: "Sessions",
  new: "New",
  edit: "Edit",
};

// Paths that are actual routable pages (not just grouping prefixes)
const ROUTABLE = new Set([
  "/hosts",
  "/alerts",
  "/discovery",
  "/setup/targets",
  "/setup/agents",
  "/setup/reports",
  "/setup/notifications",
  "/admin/users",
  "/admin/settings",
  "/admin/audit-log",
  "/profile/sessions",
]);

export function Breadcrumbs() {
  const { pathname } = useLocation();

  if (pathname === "/") return null;

  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  const crumbs: { label: string; path: string; routable: boolean }[] = [];
  let accumulated = "";

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    accumulated += `/${seg}`;
    const label = LABELS[seg] || (seg.length > 20 ? seg.slice(0, 8) + "..." : seg);
    crumbs.push({ label, path: accumulated, routable: ROUTABLE.has(accumulated) });
  }

  return (
    <nav className="flex items-center gap-1.5 px-6 pt-4 pb-0 text-sm" aria-label="Breadcrumb">
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={crumb.path} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500" aria-hidden="true" />}
            {isLast ? (
              <span className="font-medium text-gray-900 dark:text-gray-100">{crumb.label}</span>
            ) : crumb.routable ? (
              <Link
                to={crumb.path}
                className="text-gray-500 hover:text-indigo-600 dark:text-gray-400 dark:hover:text-indigo-400"
              >
                {crumb.label}
              </Link>
            ) : (
              <span className="text-gray-500 dark:text-gray-400">{crumb.label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
