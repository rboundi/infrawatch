import { NavLink, Outlet } from "react-router-dom";
import {
  LayoutDashboard,
  Server,
  Bell,
  Radar,
  Scan,
  Sun,
  Moon,
  GitCommitHorizontal,
  Hourglass,
  FileText,
} from "lucide-react";
import { useDarkMode } from "../hooks/useDarkMode";

const nav = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/changes", label: "Changes", icon: GitCommitHorizontal },
  { to: "/hosts", label: "Hosts", icon: Server },
  { to: "/discovery", label: "Discovery", icon: Scan },
  { to: "/alerts", label: "Alerts", icon: Bell },
  { to: "/eol", label: "EOL Tracker", icon: Hourglass },
  { to: "/reports", label: "Reports", icon: FileText },
  { to: "/targets", label: "Scan Targets", icon: Radar },
];

export function Layout() {
  const [dark, setDark] = useDarkMode();

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      {/* Sidebar */}
      <aside className="flex w-56 flex-col border-r border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="flex h-14 items-center gap-2 border-b border-gray-200 px-4 dark:border-gray-700">
          <Radar className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          <span className="text-lg font-bold text-gray-900 dark:text-gray-100">
            InfraWatch
          </span>
        </div>

        <nav className="flex-1 space-y-1 px-2 py-3">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                }`
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          <span className="text-xs text-gray-400">v0.1.0</span>
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-14 items-center justify-between border-b border-gray-200 bg-white px-6 dark:border-gray-700 dark:bg-gray-800">
          <h1 className="text-sm font-medium text-gray-500 dark:text-gray-400">
            Infrastructure Inventory
          </h1>
          <button
            onClick={() => setDark(!dark)}
            className="rounded-md p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
            title={dark ? "Switch to light mode" : "Switch to dark mode"}
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
