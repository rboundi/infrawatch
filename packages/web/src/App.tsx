import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Layout } from "./components/Layout";
import { OverviewPage } from "./pages/OverviewPage";
import { HostsPage } from "./pages/HostsPage";
import { AlertsPage } from "./pages/AlertsPage";
import { ScanTargetsPage } from "./pages/ScanTargetsPage";
import { HostDetailPage } from "./pages/HostDetailPage";
import { TargetFormPage } from "./pages/TargetFormPage";
import { DiscoveryPage } from "./pages/DiscoveryPage";
import { ChangesPage } from "./pages/ChangesPage";
import { EolPage } from "./pages/EolPage";

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
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<OverviewPage />} />
            <Route path="changes" element={<ChangesPage />} />
            <Route path="hosts" element={<HostsPage />} />
            <Route path="hosts/:id" element={<HostDetailPage />} />
            <Route path="discovery" element={<DiscoveryPage />} />
            <Route path="alerts" element={<AlertsPage />} />
            <Route path="eol" element={<EolPage />} />
            <Route path="targets" element={<ScanTargetsPage />} />
            <Route path="targets/new" element={<TargetFormPage />} />
            <Route path="targets/:id/edit" element={<TargetFormPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
