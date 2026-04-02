import React, { useState } from "react"
import { render, Box, useInput, useApp } from "ink"
import { TabBar, TAB_IDS, type TabId } from "./components/tab-bar.js"
import { StatusBar } from "./components/status-bar.js"
import { HelpOverlay } from "./components/help-overlay.js"
import { InfraTab } from "./tabs/infra-tab.js"
import { FleetTab } from "./tabs/fleet-tab.js"
import { SandboxTab } from "./tabs/sandbox-tab.js"
import { BuildTab } from "./tabs/build-tab.js"
import { GatewayTab } from "./tabs/gateway-tab.js"
import { CommerceTab } from "./tabs/commerce-tab.js"
import { AlertsTab } from "./tabs/alerts-tab.js"
import { LogsTab } from "./tabs/logs-tab.js"
import { SelectionProvider, useSelection } from "./hooks/use-selection.js"
import { useProviders, useClusters, useSandboxes } from "./hooks/use-infra-data.js"

function resolveInitialTab(tab?: string): TabId {
  if (tab && TAB_IDS.includes(tab as TabId)) return tab as TabId
  return "infra"
}

interface AppProps {
  initialTab?: string
}

function Dashboard({ initialTab }: AppProps) {
  const [activeTab, setActiveTab] = useState<TabId>(resolveInitialTab(initialTab))
  const [showHelp, setShowHelp] = useState(false)
  const { exit } = useApp()
  const { selection } = useSelection()

  // Infra data (used for status bar counts)
  const providersQuery = useProviders()
  const clustersQuery = useClusters()
  const sandboxesQuery = useSandboxes()

  const providers = providersQuery.data ?? []
  const clusters = clustersQuery.data ?? []
  const sandboxes = sandboxesQuery.data ?? []

  const counts = {
    running: sandboxes.filter((s: any) =>
      ["active", "running", "ready", "healthy"].includes(s.status)
    ).length,
    degraded: sandboxes.filter((s: any) =>
      ["provisioning", "pending", "creating", "syncing"].includes(s.status)
    ).length,
    down: sandboxes.filter((s: any) =>
      ["stopped", "error", "failed", "destroyed"].includes(s.status)
    ).length,
  }

  const connected = !providersQuery.error && !clustersQuery.error && !sandboxesQuery.error

  useInput((input, key) => {
    if (showHelp) {
      if (input === "?" || key.escape) setShowHelp(false)
      return
    }

    if (input === "q") {
      exit()
      return
    }

    if (input === "?") {
      setShowHelp(true)
      return
    }

    // Tab switching: 1-8
    const tabNum = parseInt(input, 10)
    if (tabNum >= 1 && tabNum <= TAB_IDS.length) {
      setActiveTab(TAB_IDS[tabNum - 1])
    }

    // Action: l on sandbox switches to logs
    if (activeTab === "infra" && selection?.type === "sandbox" && input === "l") {
      setActiveTab("logs")
    }
  })

  const tabFocused = !showHelp

  return (
    <Box flexDirection="column" minHeight={20}>
      <TabBar activeTab={activeTab} />

      {showHelp ? (
        <HelpOverlay onClose={() => setShowHelp(false)} />
      ) : (
        <Box flexGrow={1} flexDirection="column">
          {activeTab === "infra" && (
            <InfraTab
              providers={providers}
              clusters={clusters}
              sandboxes={sandboxes}
              focused={tabFocused}
            />
          )}
          {activeTab === "fleet" && <FleetTab focused={tabFocused} />}
          {activeTab === "sandbox" && <SandboxTab focused={tabFocused} />}
          {activeTab === "build" && <BuildTab focused={tabFocused} />}
          {activeTab === "gateway" && <GatewayTab focused={tabFocused} />}
          {activeTab === "commerce" && <CommerceTab focused={tabFocused} />}
          {activeTab === "alerts" && <AlertsTab focused={tabFocused} />}
          {activeTab === "logs" && <LogsTab focused={tabFocused} />}
        </Box>
      )}

      <StatusBar counts={counts} connected={connected} />
    </Box>
  )
}

function App({ initialTab }: AppProps) {
  return (
    <SelectionProvider>
      <Dashboard initialTab={initialTab} />
    </SelectionProvider>
  )
}

export async function renderApp(opts: { initialTab?: string }) {
  const instance = render(<App initialTab={opts.initialTab} />)
  await instance.waitUntilExit()
}
