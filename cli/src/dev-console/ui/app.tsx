import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { BrowserRouter, Route, Routes } from "react-router"

import { AppSidebar } from "./components/app-sidebar.js"
import { CatalogPage } from "./pages/catalog.js"
import { EnvPage } from "./pages/env.js"
import { LocationPage } from "./pages/location.js"
import { OverviewPage } from "./pages/overview.js"
import { ServicePage } from "./pages/service.js"
import { ThreadsPage } from "./pages/threads.js"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
})

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div className="flex h-screen overflow-hidden">
          <AppSidebar />
          <main className="flex-1 min-w-0 h-screen overflow-y-auto">
            <div className="px-8 py-6">
              <Routes>
                <Route path="/" element={<OverviewPage />} />
                <Route path="/services/:name" element={<ServicePage />} />
                <Route path="/threads" element={<ThreadsPage />} />
                <Route path="/threads/:threadId" element={<ThreadsPage />} />
                <Route path="/catalog" element={<CatalogPage />} />
                <Route path="/env" element={<EnvPage />} />
                <Route path="/location" element={<LocationPage />} />
              </Routes>
            </div>
          </main>
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
