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
  dependencies: "Dependencies",
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

export function Breadcrumbs() {
  const { pathname } = useLocation();

  if (pathname === "/") return null;

  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  const crumbs: { label: string; path: string }[] = [];
  let accumulated = "";

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    accumulated += `/${seg}`;
    const label = LABELS[seg] || (seg.length > 20 ? seg.slice(0, 8) + "..." : seg);
    crumbs.push({ label, path: accumulated });
  }

  return (
    <nav className="flex items-center gap-1.5 px-6 pt-4 pb-0 text-sm">
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={crumb.path} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500" />}
            {isLast ? (
              <span className="font-medium text-gray-900 dark:text-gray-100">{crumb.label}</span>
            ) : (
              <Link
                to={crumb.path}
                className="text-gray-500 hover:text-indigo-600 dark:text-gray-400 dark:hover:text-indigo-400"
              >
                {crumb.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
