import React from "react"
import { Box, Text } from "ink"

export type TabId = "infra" | "fleet" | "workspace" | "build" | "gateway" | "commerce" | "alerts" | "logs" | "explorer"

interface TabBarProps {
  activeTab: TabId
}

const TABS: { id: TabId; label: string; key: string }[] = [
  { id: "infra", label: "Infra", key: "1" },
  { id: "fleet", label: "Fleet", key: "2" },
  { id: "workspace", label: "Workspace", key: "3" },
  { id: "build", label: "Build", key: "4" },
  { id: "gateway", label: "Gateway", key: "5" },
  { id: "commerce", label: "Commerce", key: "6" },
  { id: "alerts", label: "Alerts", key: "7" },
  { id: "logs", label: "Logs", key: "8" },
  { id: "explorer", label: "Explorer", key: "9" },
]

export const TAB_IDS = TABS.map((t) => t.id)
export const TAB_COUNT = TABS.length

export function TabBar({ activeTab }: TabBarProps) {
  return (
    <Box borderStyle="single" borderBottom borderLeft={false} borderRight={false} borderTop={false} paddingX={1}>
      {TABS.map((tab) => {
        const active = tab.id === activeTab
        return (
          <Box key={tab.id} marginRight={1}>
            <Text bold={active} color={active ? "cyan" : "gray"}>
              {tab.key}:{tab.label}
            </Text>
          </Box>
        )
      })}
      <Box flexGrow={1} />
      <Text dimColor>? q</Text>
    </Box>
  )
}
