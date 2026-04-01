import { useState, useRef, useEffect, useCallback } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Breadcrumbs } from "./Breadcrumbs";
import { ShortcutsModal } from "./ShortcutsModal";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Server,
  Bell,
  Radar,
  Scan,
  Sun,
  Moon,
  FileText,
  BellRing,
  Settings,
  Users,
  ScrollText,
  KeyRound,
  LogOut,
  ChevronDown,
  ChevronRight,
  Monitor,
  Cpu,
  Wrench,
  Menu,
} from "lucide-react";
import { useDarkMode } from "../hooks/useDarkMode";
import { useAuth } from "../contexts/AuthContext";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

// Tier 1 — always visible
const primaryNav: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/hosts", label: "Hosts", icon: Server },
  { to: "/alerts", label: "Alerts", icon: Bell },
  { to: "/discovery", label: "Discovery", icon: Scan },
];

// Tier 2 — collapsible "Setup" section
const setupNav: NavItem[] = [
  { to: "/setup/targets", label: "Scan Targets", icon: Radar },
  { to: "/setup/agents", label: "Agents", icon: Cpu },
  { to: "/setup/reports", label: "Reports", icon: FileText },
  { to: "/setup/notifications", label: "Notifications", icon: BellRing },
];

// Tier 3 — collapsible "Admin" section (admin-only)
const adminNav: NavItem[] = [
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/settings", label: "Settings", icon: Settings },
  { to: "/admin/audit-log", label: "Audit Log", icon: ScrollText },
];

function useSectionToggle(key: string, defaultOpen = false): [boolean, () => void] {
  const storageKey = `iw_sidebar_${key}`;
  const [open, setOpen] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored !== null ? stored === "1" : defaultOpen;
    } catch {
      return defaultOpen;
    }
  });
  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      try { localStorage.setItem(storageKey, next ? "1" : "0"); } catch { /* noop */ }
      return next;
    });
  }, [storageKey]);
  return [open, toggle];
}

export function Layout() {
  const [dark, setDark] = useDarkMode();
  const { user, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const [setupOpen, toggleSetup] = useSectionToggle("setup", false);
  const [adminOpen, toggleAdmin] = useSectionToggle("admin", false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  useKeyboardShortcuts(navigate, setShowShortcuts);
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

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium transition-colors ${
      isActive
        ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
        : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
    }`;

  const subNavLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2.5 rounded-md px-3 py-1.5 pl-9 text-[13px] font-medium transition-colors ${
      isActive
        ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
        : "text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
    }`;

  const sectionBtnClass =
    "flex w-full items-center justify-between rounded-md px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300";

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-gray-200 bg-white transition-transform dark:border-gray-700 dark:bg-gray-800 md:relative md:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex h-16 items-center gap-2 border-b border-gray-200 px-4 dark:border-gray-700">
          <Radar className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          <span className="text-lg font-bold text-gray-900 dark:text-gray-100">
            InfraWatch
          </span>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
          {/* Tier 1 — Primary */}
          {primaryNav.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === "/"} className={navLinkClass} onClick={() => setSidebarOpen(false)}>
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}

          {/* Tier 2 — Setup */}
          <div className="pt-4">
            <button onClick={toggleSetup} className={sectionBtnClass}>
              <span className="flex items-center gap-2">
                <Wrench className="h-3.5 w-3.5" />
                Setup
              </span>
              <ChevronRight
                className={`h-3.5 w-3.5 transition-transform ${setupOpen ? "rotate-90" : ""}`}
              />
            </button>
          </div>
          {setupOpen &&
            setupNav.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} className={subNavLinkClass}>
                <Icon className="h-4 w-4" />
                {label}
              </NavLink>
            ))}

          {/* Tier 3 — Admin */}
          {isAdmin && (
            <>
              <div className="pt-4">
                <button onClick={toggleAdmin} className={sectionBtnClass}>
                  <span className="flex items-center gap-2">
                    <Settings className="h-3.5 w-3.5" />
                    Admin
                  </span>
                  <ChevronRight
                    className={`h-3.5 w-3.5 transition-transform ${adminOpen ? "rotate-90" : ""}`}
                  />
                </button>
              </div>
              {adminOpen &&
                adminNav.map(({ to, label, icon: Icon }) => (
                  <NavLink key={to} to={to} className={subNavLinkClass}>
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
        <header className="flex h-14 items-center justify-between border-b border-gray-200 bg-white px-4 md:px-6 dark:border-gray-700 dark:bg-gray-800">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 md:hidden dark:text-gray-400 dark:hover:bg-gray-700"
              aria-label="Toggle sidebar"
            >
              <Menu className="h-5 w-5" />
            </button>
            <h1 className="text-sm font-medium text-gray-500 dark:text-gray-400">
              Infrastructure Inventory
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setDark(!dark)}
              className="rounded-md p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
              aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
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
        <main className="flex-1 overflow-auto p-6 pt-0">
          <Breadcrumbs />
          <div className="pt-4">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Keyboard shortcuts */}
      <button
        onClick={() => setShowShortcuts(true)}
        className="fixed bottom-4 right-4 z-40 flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-sm font-semibold text-gray-500 shadow-sm hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400"
        aria-label="Show keyboard shortcuts"
      >
        ?
      </button>
      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}
