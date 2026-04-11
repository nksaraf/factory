import "unfonts.css"
import "./globals.css"
import "vinxi/client"
import "./bootstrap"

import { startTransition } from "react"
import { createRoot } from "react-dom/client"
import { createBrowserRouter } from "react-router"
import { RouterProvider } from "react-router/dom"

import { AppProvider } from "@rio.js/app-ui/components/app-provider"
import { RioApp } from "@rio.js/app-ui/lib/app-context"
import type { ModuleRegistration } from "@rio.js/app-ui/lib/module-context"
import { createAuthClient } from "@rio.js/auth-client"
import { AuthProvider } from "@rio.js/auth-ui/components/auth-provider"
import { RioClientProvider } from "@rio.js/client"
import { ThemeProvider } from "@rio.js/ui/components/theme-provider"
import { Toaster } from "@rio.js/ui/toaster"
import { TooltipProvider } from "@rio.js/ui/tooltip"
import { CommandController } from "@rio.js/uikit/components/command-provider"
import { fsRoutes } from "@rio.js/vinxi/fs-routes"
import { createClient as createWorkflowsClient } from "@rio.js/workflows/lib/client"

import { FactorySidebar } from "./components/factory/factory-sidebar"
import { FactoryPowerSyncProvider } from "./lib/powersync/provider"
import { rio } from "./lib/rio"

declare module "@rio.js/client" {
  export interface RioServices {
    auth: ReturnType<typeof createAuthClient>
    workflows: ReturnType<typeof createWorkflowsClient>
  }
}
async function boot() {
  async function enableMocking() {
    if (import.meta.env.PROD) {
      return
    }

    const { worker } = await import("./mocks/browser")
    return worker.start({
      onUnhandledRequest: "bypass",
    })
  }

  // await enableMocking()

  // Devtools: conditionally load in dev mode
  let DevtoolsPanel: React.ComponentType<{ rio: any; router: any }> | null =
    null
  if (import.meta.env.DEV) {
    const mod = await import("./modules/smart-market.devtools")
    DevtoolsPanel = mod.DevtoolsPanel
  }

  rio.extensions.register({
    "app.core": () => import("@rio.js/app.core"),
    // "settings.user": () => import("@rio.js/settings.user"),
    // "settings.organization": () => import("@rio.js/settings.organization"),
    "factory.auth": () => import("./modules/factory.auth"),
    "factory.fleet": () => import("./modules/factory.fleet"),
    "factory.infra": () => import("./modules/factory.infra"),
    "factory.game-viz": () => import("./modules/factory.game-viz"),
  })

  const url = new URL(window.location.href)

  console.log(rio.env)
  const authService = createAuthClient({
    baseURL: import.meta.env.DEV
      ? "http://localhost:8180"
      : "https://dev.trafficure.rio.software",
    basePath: "/api/auth",
    bearer: true,
  })

  rio.services.registerSync("auth", authService)

  await rio.extensions.enable(
    "app.core",
    // "settings.user",
    // "settings.organization",
    "factory.auth",
    "factory.fleet",
    "factory.infra",
    "factory.game-viz"
  )

  // Extract modules from enabled extensions that have a "module" field
  const modules: ModuleRegistration[] = []
  for (const ext of Object.values(rio.extensions._extensions.value)) {
    if (ext && (ext as any).module) {
      const mod = (ext as any).module
      modules.push({
        id: ext.id,
        displayName: ext.displayName ?? ext.id,
        sidebar: mod.sidebar,
        routePrefix: mod.routePrefix,
        moduleSidebar: mod.moduleSidebar,
        statusBar: mod.statusBar,
      })
    }
  }

  const routes = rio.extensions.getContributions("routes")
  const router = createBrowserRouter(fsRoutes(routes))

  console.log(routes, fsRoutes(routes), router)

  const SITE_URL = "https://trafficure.com"
  function updateCanonicalUrl(pathname: string) {
    const normalized = pathname.replace(/\/+$/, "") || "/"
    const href = `${SITE_URL}${normalized}`
    let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (!link) {
      link = document.createElement("link")
      link.rel = "canonical"
      document.head.appendChild(link)
    }
    if (link.href !== href) {
      link.href = href
    }
  }

  updateCanonicalUrl(window.location.pathname)
  router.subscribe((state) => {
    updateCanonicalUrl(state.location.pathname)
  })

  const app = new RioApp(
    rio,
    {
      name: "SmartMarket",
      id: "smart-market",
      logo: "/sm-logo.png",
      backgroundImage: "/bg.png",
    },
    modules
  )

  function App() {
    return (
      <AppProvider app={app}>
        <RioClientProvider value={rio}>
          <AuthProvider
            authClient={authService}
            account={{
              basePath: "/dashboard",
              fields: ["image", "name"],
            }}
            twoFactor={["otp", "totp"]}
            redirectTo="/my-projects"
            organization={true}
            apiKey={true}
            social={{
              providers: ["google"],
            }}
          >
            <FactoryPowerSyncProvider
              powersyncUrl={rio.env.PUBLIC_POWERSYNC_URL ?? ""}
              factoryApiUrl={rio.env.PUBLIC_FACTORY_API_URL ?? ""}
              enabled={rio.env.PUBLIC_ENABLE_POWERSYNC === "true"}
            >
              <ThemeProvider defaultTheme="light" storageKey="trafficure-theme">
                <TooltipProvider>
                  <Toaster />
                  <RouterProvider router={router} />
                  <FactorySidebar />
                  <CommandController />
                  {/* {DevtoolsPanel && <DevtoolsPanel rio={rio} router={router} />} */}
                </TooltipProvider>
              </ThemeProvider>
            </FactoryPowerSyncProvider>
          </AuthProvider>
        </RioClientProvider>
      </AppProvider>
    )
  }

  const root = createRoot(document.getElementById("root")!)

  startTransition(() => {
    root.render(<App />)
  })
}

boot()
