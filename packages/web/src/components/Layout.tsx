import { useState, useRef, useEffect } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
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
  BellRing,
  Layers,
  Network,
  Shield,
  Settings,
  Users,
  ScrollText,
  KeyRound,
  LogOut,
  ChevronDown,
  Monitor,
} from "lucide-react";
import { useDarkMode } from "../hooks/useDarkMode";
import { useAuth } from "../contexts/AuthContext";

const nav = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/changes", label: "Changes", icon: GitCommitHorizontal },
  { to: "/hosts", label: "Hosts", icon: Server },
  { to: "/groups", label: "Groups", icon: Layers },
  { to: "/dependencies", label: "Dependencies", icon: Network },
  { to: "/compliance", label: "Compliance", icon: Shield },
  { to: "/discovery", label: "Discovery", icon: Scan },
  { to: "/alerts", label: "Alerts", icon: Bell },
  { to: "/eol", label: "EOL Tracker", icon: Hourglass },
  { to: "/reports", label: "Reports", icon: FileText },
  { to: "/targets", label: "Scan Targets", icon: Radar },
  { to: "/settings/notifications", label: "Notifications", icon: BellRing },
];

const adminNav = [
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/settings", label: "Settings", icon: Settings },
  { to: "/admin/audit-log", label: "Audit Log", icon: ScrollText },
];

export function Layout() {
  const [dark, setDark] = useDarkMode();
  const { user, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const [adminOpen, setAdminOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close user menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  const handleLogout = async () => {
    setMenuOpen(false);
    await logout();
    navigate("/login");
  };

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

        <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3">
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

          {/* Admin section */}
          {isAdmin && (
            <>
              <div className="pt-3">
                <button
                  onClick={() => setAdminOpen(!adminOpen)}
                  className="flex w-full items-center justify-between rounded-md px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                >
                  <span className="flex items-center gap-2">
                    <Settings className="h-3.5 w-3.5" />
                    Admin
                  </span>
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform ${adminOpen ? "rotate-180" : ""}`}
                  />
                </button>
              </div>
              {adminOpen &&
                adminNav.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 rounded-md px-3 py-2 pl-8 text-sm font-medium transition-colors ${
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
            </>
          )}
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

          <div className="flex items-center gap-3">
            <button
              onClick={() => setDark(!dark)}
              className="rounded-md p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
              title={dark ? "Switch to light mode" : "Switch to dark mode"}
            >
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            {/* User menu */}
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-100 text-xs font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                  {(user?.displayName || user?.username || "U").charAt(0).toUpperCase()}
                </div>
                <span className="font-medium text-gray-700 dark:text-gray-200">
                  {user?.displayName || user?.username}
                </span>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                    user?.role === "admin"
                      ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                      : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400"
                  }`}
                >
                  {user?.role}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
                  <button
                    onClick={() => { setMenuOpen(false); navigate("/change-password"); }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                  >
                    <KeyRound className="h-4 w-4" />
                    Change Password
                  </button>
                  <button
                    onClick={() => { setMenuOpen(false); navigate("/profile/sessions"); }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                  >
                    <Monitor className="h-4 w-4" />
                    Active Sessions
                  </button>
                  <div className="my-1 border-t border-gray-200 dark:border-gray-700" />
                  <button
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                  >
                    <LogOut className="h-4 w-4" />
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
