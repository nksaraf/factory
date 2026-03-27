/**
 * PowerSync React provider — wraps the app with PowerSync context.
 *
 * Handles:
 * - Creating/connecting the PowerSync database on mount
 * - Disconnecting on unmount
 * - Feature flag gating (only connects when enabled)
 */
import { PowerSyncContext } from "@powersync/react"
import { createContext, type ReactNode, use, useEffect, useMemo, useState } from "react"

import { FactoryPowerSyncConnector } from "./connector"
import { getPowerSyncDatabase } from "./database"

interface PowerSyncProviderProps {
  powersyncUrl: string
  factoryApiUrl: string
  enabled: boolean
  children: ReactNode
}

export function FactoryPowerSyncProvider({
  powersyncUrl,
  factoryApiUrl,
  enabled,
  children,
}: PowerSyncProviderProps) {
  const db = useMemo(() => (enabled ? getPowerSyncDatabase() : null), [enabled])
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (!db || !enabled) return

    const connector = new FactoryPowerSyncConnector({
      powersyncUrl,
      factoryApiUrl,
    })

    db.connect(connector)
      .then(() => setConnected(true))
      .catch((err) =>
        console.error("[PowerSync] Connection failed:", err)
      )

    return () => {
      db.disconnect()
      setConnected(false)
    }
  }, [db, enabled, powersyncUrl, factoryApiUrl])

  if (!db || !enabled) {
    return (
      <PowerSyncEnabledContext value={false}>
        {children}
      </PowerSyncEnabledContext>
    )
  }

  return (
    <PowerSyncEnabledContext value={connected}>
      <PowerSyncContext.Provider value={db}>{children}</PowerSyncContext.Provider>
    </PowerSyncEnabledContext>
  )
}

const PowerSyncEnabledContext = createContext(false)

/**
 * Hook to check if PowerSync is enabled and connected.
 */
export function usePowerSyncEnabled(): boolean {
  return use(PowerSyncEnabledContext)
}
