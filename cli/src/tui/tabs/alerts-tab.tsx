import { Box, Text } from "ink"
import React from "react"

import { type Column, DataTable, timeAgo } from "../components/data-table.js"
import { useAlerts } from "../hooks/use-ops-data.js"

interface AlertsTabProps {
  focused: boolean
}

const ALERT_COLUMNS: Column[] = [
  {
    header: "Severity",
    key: "severity",
    width: 12,
    color: (v: string) => {
      if (v === "critical") return "red"
      if (v === "warning") return "yellow"
      return "cyan"
    },
  },
  { header: "Name", key: "name", width: 30 },
  { header: "Status", key: "status", width: 14 },
  { header: "Site", key: "site", width: 16, format: (v: any) => v ?? "-" },
  { header: "Module", key: "module", width: 16, format: (v: any) => v ?? "-" },
  { header: "Since", key: "since", width: 12, format: (v: any) => timeAgo(v) },
]

export function AlertsTab({ focused }: AlertsTabProps) {
  const alertsQuery = useAlerts()
  const alerts = alertsQuery.data ?? []

  const firingCount = alerts.filter((a: any) => a.status === "firing").length
  const ackCount = alerts.filter((a: any) => a.status === "acknowledged").length
  const criticalCount = alerts.filter(
    (a: any) => a.severity === "critical"
  ).length

  return (
    <Box flexGrow={1} flexDirection="column">
      <Box paddingX={1} gap={2}>
        {criticalCount > 0 ? (
          <Text color="red" bold>
            ■ {criticalCount} CRITICAL
          </Text>
        ) : (
          <Text color="green">■ No critical alerts</Text>
        )}
        <Text color={firingCount > 0 ? "yellow" : "green"}>
          {firingCount} firing
        </Text>
        <Text dimColor>{ackCount} acknowledged</Text>
        <Text dimColor>{alerts.length} total</Text>
      </Box>

      <DataTable
        columns={ALERT_COLUMNS}
        rows={alerts}
        focused={focused}
        emptyMessage="No active alerts. All systems operational."
      />
    </Box>
  )
}
