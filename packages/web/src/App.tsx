import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./contexts/AuthContext";
import { ToastProvider } from "./components/Toast";
import { RequireAuth } from "./components/RequireAuth";
import { RequireAdmin } from "./components/RequireAdmin";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { ChangePasswordPage } from "./pages/ChangePasswordPage";
import { SessionsPage } from "./pages/SessionsPage";
import { OverviewPage } from "./pages/OverviewPage";
import { HostsPage } from "./pages/HostsPage";
import { AlertsPage } from "./pages/AlertsPage";
import { ScanTargetsPage } from "./pages/ScanTargetsPage";
import { HostDetailPage } from "./pages/HostDetailPage";
import { TargetFormPage } from "./pages/TargetFormPage";
import { DiscoveryPage } from "./pages/DiscoveryPage";
import { ReportsPage } from "./pages/ReportsPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { DependenciesPage } from "./pages/DependenciesPage";
import { UsersPage } from "./pages/admin/UsersPage";
import { SettingsPage } from "./pages/admin/SettingsPage";
import { AuditLogPage } from "./pages/admin/AuditLogPage";
import { AgentsPage } from "./pages/admin/AgentsPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <Routes>
              {/* Public routes */}
              <Route path="/login" element={<LoginPage />} />

              {/* Auth-required routes without sidebar (centered forms) */}
              <Route
                path="/change-password"
                element={
                  <RequireAuth>
                    <ChangePasswordPage />
                  </RequireAuth>
                }
              />

              {/* Auth-required routes with sidebar layout */}
              <Route
                element={
                  <RequireAuth>
                    <Layout />
                  </RequireAuth>
                }
              >
                <Route index element={<OverviewPage />} />
                <Route path="changes" element={<Navigate to="/" replace />} />
                <Route path="hosts" element={<HostsPage />} />
                <Route path="hosts/:id" element={<HostDetailPage />} />
                <Route path="groups" element={<Navigate to="/hosts" replace />} />
                <Route path="groups/:id" element={<Navigate to="/hosts" replace />} />
                <Route path="discovery" element={<DiscoveryPage />} />
                <Route path="alerts" element={<AlertsPage />} />

                {/* Setup routes */}
                <Route path="setup/targets" element={<ScanTargetsPage />} />
                <Route path="setup/targets/new" element={<TargetFormPage />} />
                <Route path="setup/targets/:id/edit" element={<TargetFormPage />} />
                <Route path="setup/reports" element={<ReportsPage />} />
                <Route path="setup/notifications" element={<NotificationsPage />} />
                <Route path="setup/dependencies" element={<DependenciesPage />} />

                {/* Legacy redirects */}
                <Route path="dependencies" element={<Navigate to="/setup/dependencies" replace />} />
                <Route path="compliance" element={<Navigate to="/" replace />} />
                <Route path="eol" element={<Navigate to="/alerts" replace />} />
                <Route path="reports" element={<Navigate to="/setup/reports" replace />} />
                <Route path="settings/notifications" element={<Navigate to="/setup/notifications" replace />} />
                <Route path="targets" element={<Navigate to="/setup/targets" replace />} />
                <Route path="targets/new" element={<Navigate to="/setup/targets/new" replace />} />
                <Route path="targets/:id/edit" element={<TargetFormPage />} />
                <Route path="profile/sessions" element={<SessionsPage />} />

                {/* Admin-only routes */}
                <Route path="admin/users" element={<RequireAdmin><UsersPage /></RequireAdmin>} />
                <Route path="admin/agents" element={<RequireAdmin><AgentsPage /></RequireAdmin>} />
                <Route path="admin/settings" element={<RequireAdmin><SettingsPage /></RequireAdmin>} />
                <Route path="admin/audit-log" element={<RequireAdmin><AuditLogPage /></RequireAdmin>} />
              </Route>
            </Routes>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
