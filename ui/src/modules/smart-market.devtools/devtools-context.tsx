import { createContext, useContext } from "react"

import type { RioClient } from "@rio.js/client"

interface DevtoolsContextValue {
  rio: RioClient
  router: any
}

const DevtoolsContext = createContext<DevtoolsContextValue | null>(null)

export function DevtoolsProvider({
  rio,
  router,
  children,
}: DevtoolsContextValue & { children: React.ReactNode }) {
  return <DevtoolsContext value={{ rio, router }}>{children}</DevtoolsContext>
}

export function useDevtools() {
  const ctx = useContext(DevtoolsContext)
  if (!ctx) throw new Error("useDevtools must be used within DevtoolsProvider")
  return ctx
}
