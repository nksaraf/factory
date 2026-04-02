import React, { useState } from "react"
import { Box, Text, useInput } from "ink"
import { DataTable, type Column, timeAgo } from "../components/data-table.js"
import { useSandboxes, usePreviews } from "../hooks/use-infra-data.js"
import { useSelection } from "../hooks/use-selection.js"

interface SandboxTabProps {
  focused: boolean
}

type SubView = "sandboxes" | "previews"

const SANDBOX_COLUMNS: Column[] = [
  { header: "Name", key: "name", width: 28, slugKey: "slug" },
  { header: "Status", key: "status", width: 14 },
  { header: "Runtime", key: "runtimeType", width: 12, format: (v: any) => v ?? "-" },
  { header: "Health", key: "healthStatus", width: 10, format: (v: any) => v ?? "-" },
  { header: "CPU", key: "cpu", width: 6, format: (v: any) => v ? String(v) : "-" },
  { header: "Mem", key: "memory", width: 8, format: (v: any) => v ?? "-" },
  { header: "Created", key: "createdAt", width: 14, format: (v: any) => timeAgo(v) },
]

const PREVIEW_COLUMNS: Column[] = [
  { header: "Name", key: "name", width: 28, slugKey: "slug" },
  { header: "Status", key: "status", width: 14 },
  { header: "Branch", key: "sourceBranch", width: 20, format: (v: any) => v ?? "-" },
  { header: "PR", key: "prNumber", width: 8, format: (v: any) => v ? `#${v}` : "-" },
  { header: "Repo", key: "repo", width: 16, format: (v: any) => v ?? "-" },
  { header: "Created", key: "createdAt", width: 14, format: (v: any) => timeAgo(v) },
]

export function SandboxTab({ focused }: SandboxTabProps) {
  const [subView, setSubView] = useState<SubView>("sandboxes")
  const sandboxesQuery = useSandboxes()
  const previewsQuery = usePreviews()
  const { setSelection } = useSelection()

  useInput(
    (input) => {
      if (!focused) return
      if (input === "s") setSubView("sandboxes")
      else if (input === "p") setSubView("previews")
    },
    { isActive: focused }
  )

  const sandboxes = sandboxesQuery.data ?? []
  const previews = previewsQuery.data ?? []

  return (
    <Box flexGrow={1} flexDirection="column">
      <Box paddingX={1} gap={2}>
        <Text bold={subView === "sandboxes"} color={subView === "sandboxes" ? "cyan" : "gray"}>
          [s] Sandboxes ({sandboxes.length})
        </Text>
        <Text bold={subView === "previews"} color={subView === "previews" ? "cyan" : "gray"}>
          [p] Previews ({previews.length})
        </Text>
      </Box>

      {subView === "sandboxes" && (
        <DataTable
          columns={SANDBOX_COLUMNS}
          rows={sandboxes}
          focused={focused}
          onSelect={(row) => {
            setSelection({
              type: "sandbox",
              id: row.sandboxId ?? row.id,
              name: row.name ?? row.slug,
            })
          }}
          emptyMessage="No sandboxes. Create one with: dx sandbox create <name>"
        />
      )}

      {subView === "previews" && (
        <DataTable
          columns={PREVIEW_COLUMNS}
          rows={previews}
          focused={focused}
          emptyMessage="No preview deployments."
        />
      )}
    </Box>
  )
}
