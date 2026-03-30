import { BrowserRouter, Routes, Route } from "react-router-dom";
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
import { ChangesPage } from "./pages/ChangesPage";
import { EolPage } from "./pages/EolPage";
import { ReportsPage } from "./pages/ReportsPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { GroupsPage } from "./pages/GroupsPage";
import { GroupDetailPage } from "./pages/GroupDetailPage";
import { DependenciesPage } from "./pages/DependenciesPage";
import { CompliancePage } from "./pages/CompliancePage";
import { UsersPage } from "./pages/admin/UsersPage";
import { SettingsPage } from "./pages/admin/SettingsPage";
import { AuditLogPage } from "./pages/admin/AuditLogPage";

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
                <Route path="changes" element={<ChangesPage />} />
                <Route path="hosts" element={<HostsPage />} />
                <Route path="hosts/:id" element={<HostDetailPage />} />
                <Route path="groups" element={<GroupsPage />} />
                <Route path="groups/:id" element={<GroupDetailPage />} />
                <Route path="dependencies" element={<DependenciesPage />} />
                <Route path="compliance" element={<CompliancePage />} />
                <Route path="discovery" element={<DiscoveryPage />} />
                <Route path="alerts" element={<AlertsPage />} />
                <Route path="eol" element={<EolPage />} />
                <Route path="reports" element={<ReportsPage />} />
                <Route path="settings/notifications" element={<NotificationsPage />} />
                <Route path="targets" element={<ScanTargetsPage />} />
                <Route path="targets/new" element={<TargetFormPage />} />
                <Route path="targets/:id/edit" element={<TargetFormPage />} />
                <Route path="profile/sessions" element={<SessionsPage />} />

                {/* Admin-only routes */}
                <Route path="admin/users" element={<RequireAdmin><UsersPage /></RequireAdmin>} />
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
