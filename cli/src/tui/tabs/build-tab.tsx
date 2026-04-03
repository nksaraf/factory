import React, { useState } from "react"
import { Box, Text, useInput } from "ink"
import { DataTable, type Column, timeAgo } from "../components/data-table.js"
import { useModules, useRepos, useBuildRuns } from "../hooks/use-fleet-data.js"

interface BuildTabProps {
  focused: boolean
}

type SubView = "modules" | "repos" | "runs"

const MODULE_COLUMNS: Column[] = [
  { header: "Name", key: "name", width: 30, slugKey: "slug" },
  { header: "Product", key: "product", width: 16, format: (v: any) => v ?? "-" },
  { header: "State", key: "lifecycleState", width: 12 },
  { header: "Description", key: "description", width: 30, format: (v: any) => v ? String(v).slice(0, 28) : "-" },
  { header: "Created", key: "createdAt", width: 14, format: (v: any) => timeAgo(v) },
]

const REPO_COLUMNS: Column[] = [
  { header: "Name", key: "name", width: 30, slugKey: "slug" },
  { header: "URL", key: "gitUrl", width: 36, format: (v: any) => v ? String(v).slice(0, 34) : "-" },
  { header: "Default Branch", key: "defaultBranch", width: 16, format: (v: any) => v ?? "-" },
  { header: "Created", key: "createdAt", width: 14, format: (v: any) => timeAgo(v) },
]

const RUN_COLUMNS: Column[] = [
  { header: "ID", key: "runId", width: 14, format: (v: any) => v ? String(v).slice(0, 12) : "-" },
  { header: "Status", key: "status", width: 12 },
  { header: "Trigger", key: "trigger", width: 12, format: (v: any) => v ?? "-" },
  { header: "Started", key: "startedAt", width: 14, format: (v: any) => timeAgo(v) },
]

export function BuildTab({ focused }: BuildTabProps) {
  const [subView, setSubView] = useState<SubView>("modules")
  const modulesQuery = useModules()
  const reposQuery = useRepos()
  const runsQuery = useBuildRuns()

  useInput(
    (input) => {
      if (!focused) return
      if (input === "m") setSubView("modules")
      else if (input === "p") setSubView("repos")
      else if (input === "r") setSubView("runs")
    },
    { isActive: focused }
  )

  const modules = modulesQuery.data ?? []
  const repos = reposQuery.data ?? []
  const runs = runsQuery.data ?? []

  return (
    <Box flexGrow={1} flexDirection="column">
      <Box paddingX={1} gap={2}>
        <Text bold={subView === "modules"} color={subView === "modules" ? "cyan" : "gray"}>
          [m] Modules ({modules.length})
        </Text>
        <Text bold={subView === "repos"} color={subView === "repos" ? "cyan" : "gray"}>
          [p] Repos ({repos.length})
        </Text>
        <Text bold={subView === "runs"} color={subView === "runs" ? "cyan" : "gray"}>
          [r] CI Runs ({runs.length})
        </Text>
      </Box>

      {subView === "modules" && (
        <DataTable
          columns={MODULE_COLUMNS}
          rows={modules}
          focused={focused}
          emptyMessage="No modules registered."
        />
      )}

      {subView === "repos" && (
        <DataTable
          columns={REPO_COLUMNS}
          rows={repos}
          focused={focused}
          emptyMessage="No repos linked."
        />
      )}

      {subView === "runs" && (
        <DataTable
          columns={RUN_COLUMNS}
          rows={runs}
          focused={focused}
          emptyMessage="No recent CI runs."
        />
      )}
    </Box>
  )
}
