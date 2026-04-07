import React, { useState, useEffect } from "react"
import { render, Box, useInput, useApp, useStdout } from "ink"
import { TabBar, TAB_IDS, type TabId } from "./components/tab-bar.js"
import { StatusBar } from "./components/status-bar.js"
import { HelpOverlay } from "./components/help-overlay.js"
import { InfraTab } from "./tabs/infra-tab.js"
import { FleetTab } from "./tabs/fleet-tab.js"
import { WorkspaceTab } from "./tabs/workspace-tab.js"
import { BuildTab } from "./tabs/build-tab.js"
import { GatewayTab } from "./tabs/gateway-tab.js"
import { CommerceTab } from "./tabs/commerce-tab.js"
import { AlertsTab } from "./tabs/alerts-tab.js"
import { LogsTab } from "./tabs/logs-tab.js"
import { ExplorerTab } from "./tabs/explorer/explorer-tab.js"
import { SelectionProvider, useSelection } from "./hooks/use-selection.js"
import { useSubstrates, useRuntimes, useWorkspaces } from "./hooks/use-infra-data.js"

function resolveInitialTab(tab?: string): TabId {
  if (tab && TAB_IDS.includes(tab as TabId)) return tab as TabId
  return "infra"
}

interface AppProps {
  initialTab?: string
}

function useTerminalHeight() {
  const { stdout } = useStdout()
  const [height, setHeight] = useState(stdout.rows ?? 24)

  useEffect(() => {
    const onResize = () => setHeight(stdout.rows ?? 24)
    stdout.on("resize", onResize)
    return () => { stdout.off("resize", onResize) }
  }, [stdout])

  return height
}

function Dashboard({ initialTab }: AppProps) {
  const [activeTab, setActiveTab] = useState<TabId>(resolveInitialTab(initialTab))
  const [showHelp, setShowHelp] = useState(false)
  const { exit } = useApp()
  const { selection } = useSelection()
  const termHeight = useTerminalHeight()

  // Infra data (used for status bar counts)
  const substratesQuery = useSubstrates()
  const runtimesQuery = useRuntimes()
  const workspacesQuery = useWorkspaces()

  const substrates = substratesQuery.data ?? []
  const runtimes = runtimesQuery.data ?? []
  const workspaces = workspacesQuery.data ?? []

  const counts = {
    running: workspaces.filter((s: any) =>
      ["active", "running", "ready", "healthy"].includes(s.spec?.lifecycle ?? s.status)
    ).length,
    degraded: workspaces.filter((s: any) =>
      ["provisioning", "pending", "creating", "syncing"].includes(s.spec?.lifecycle ?? s.status)
    ).length,
    down: workspaces.filter((s: any) =>
      ["stopped", "error", "failed", "destroyed"].includes(s.spec?.lifecycle ?? s.status)
    ).length,
  }

  const connected = !substratesQuery.error && !runtimesQuery.error && !workspacesQuery.error

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

    // Action: l on workspace switches to logs
    if (activeTab === "infra" && selection?.type === "workspace" && input === "l") {
      setActiveTab("logs")
    }
  })

  const tabFocused = !showHelp

  return (
    <Box flexDirection="column" height={termHeight}>
      <TabBar activeTab={activeTab} />

      {showHelp ? (
        <HelpOverlay onClose={() => setShowHelp(false)} />
      ) : (
        <Box flexGrow={1} flexDirection="column">
          {activeTab === "infra" && (
            <InfraTab
              substrates={substrates}
              runtimes={runtimes}
              workspaces={workspaces}
              focused={tabFocused}
            />
          )}
          {activeTab === "fleet" && <FleetTab focused={tabFocused} />}
          {activeTab === "workspace" && <WorkspaceTab focused={tabFocused} />}
          {activeTab === "build" && <BuildTab focused={tabFocused} />}
          {activeTab === "gateway" && <GatewayTab focused={tabFocused} />}
          {activeTab === "commerce" && <CommerceTab focused={tabFocused} />}
          {activeTab === "alerts" && <AlertsTab focused={tabFocused} />}
          {activeTab === "logs" && <LogsTab focused={tabFocused} />}
          {activeTab === "explorer" && <ExplorerTab focused={tabFocused} />}
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
  // Enter alternate screen buffer (fullscreen, like vim/htop)
  process.stdout.write("\x1b[?1049h")
  process.stdout.write("\x1b[H") // move cursor to top-left

  const instance = render(<App initialTab={opts.initialTab} />)

  try {
    await instance.waitUntilExit()
  } finally {
    // Leave alternate screen buffer, restoring previous terminal content
    process.stdout.write("\x1b[?1049l")
  }
}
