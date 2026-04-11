import { Box, Text, useInput } from "ink"
import React, { useState } from "react"

import {
  type Column,
  DataTable,
  type DetailField,
  timeAgo,
} from "../components/data-table.js"
import { usePreviews, useWorkbenches } from "../hooks/use-infra-data.js"
import { useSelection } from "../hooks/use-selection.js"

interface WorkbenchTabProps {
  focused: boolean
}

type SubView = "workbenches" | "previews"

const WORKBENCH_COLUMNS: Column[] = [
  { header: "Name", key: "name", width: 28, slugKey: "slug" },
  { header: "Status", key: "status", width: 14 },
  {
    header: "Realm",
    key: "realmType",
    width: 12,
    format: (v: any) => v ?? "-",
  },
  {
    header: "Health",
    key: "healthStatus",
    width: 10,
    format: (v: any) => v ?? "-",
  },
  {
    header: "CPU",
    key: "cpu",
    width: 6,
    format: (v: any) => (v ? String(v) : "-"),
  },
  { header: "Mem", key: "memory", width: 8, format: (v: any) => v ?? "-" },
  {
    header: "Created",
    key: "createdAt",
    width: 14,
    format: (v: any) => timeAgo(v),
  },
]

const PREVIEW_COLUMNS: Column[] = [
  { header: "Name", key: "name", width: 28, slugKey: "slug" },
  { header: "Status", key: "status", width: 14 },
  {
    header: "Branch",
    key: "sourceBranch",
    width: 20,
    format: (v: any) => v ?? "-",
  },
  {
    header: "PR",
    key: "prNumber",
    width: 8,
    format: (v: any) => (v ? `#${v}` : "-"),
  },
  { header: "Repo", key: "repo", width: 16, format: (v: any) => v ?? "-" },
  {
    header: "Created",
    key: "createdAt",
    width: 14,
    format: (v: any) => timeAgo(v),
  },
]

export function WorkbenchTab({ focused }: WorkbenchTabProps) {
  const [subView, setSubView] = useState<SubView>("workbenches")
  const workbenchesQuery = useWorkbenches()
  const previewsQuery = usePreviews()
  const { setSelection } = useSelection()

  useInput(
    (input) => {
      if (!focused) return
      if (input === "w") setSubView("workbenches")
      else if (input === "p") setSubView("previews")
    },
    { isActive: focused }
  )

  const workbenches = workbenchesQuery.data ?? []
  const previews = previewsQuery.data ?? []

  return (
    <Box flexGrow={1} flexDirection="column">
      <Box paddingX={1} gap={2}>
        <Text
          bold={subView === "workbenches"}
          color={subView === "workbenches" ? "cyan" : "gray"}
        >
          [w] Workbenches ({workbenches.length})
        </Text>
        <Text
          bold={subView === "previews"}
          color={subView === "previews" ? "cyan" : "gray"}
        >
          [p] Previews ({previews.length})
        </Text>
      </Box>

      {subView === "workbenches" && (
        <DataTable
          columns={WORKBENCH_COLUMNS}
          rows={workbenches}
          focused={focused}
          onSelect={(row) => {
            setSelection({
              type: "workbench",
              id: String(row.workbenchId ?? row.id ?? ""),
              name: String(row.name ?? row.slug ?? ""),
            })
          }}
          emptyMessage="No workbenches. Create one with: dx workbench create <name>"
          detailFields={[
            { label: "Name", key: "name" },
            { label: "Slug", key: "slug" },
            { label: "Status", key: "status" },
            { label: "Realm", key: "realmType" },
            { label: "Health", key: "healthStatus" },
            { label: "CPU", key: "cpu" },
            { label: "Memory", key: "memory" },
            {
              label: "Storage",
              key: "storageGb",
              format: (v: any) => (v ? `${v} GB` : "-"),
            },
            { label: "Owner", key: "ownerId" },
            { label: "IP", key: "ipAddress" },
            {
              label: "SSH",
              key: "sshHost",
              format: (v: any, r: any) => (v ? `${v}:${r.sshPort ?? 22}` : "-"),
            },
            { label: "Web IDE", key: "webIdeUrl" },
            {
              label: "Created",
              key: "createdAt",
              format: (v: any) => timeAgo(v),
            },
          ]}
        />
      )}

      {subView === "previews" && (
        <DataTable
          columns={PREVIEW_COLUMNS}
          rows={previews}
          focused={focused}
          emptyMessage="No preview deployments."
          detailFields={[
            { label: "Name", key: "name" },
            { label: "Slug", key: "slug" },
            { label: "Branch", key: "sourceBranch" },
            { label: "Commit", key: "commitSha" },
            { label: "Repo", key: "repo" },
            {
              label: "PR",
              key: "prNumber",
              format: (v: any) => (v ? `#${v}` : "-"),
            },
            { label: "Status", key: "status" },
            { label: "Owner", key: "ownerId" },
            { label: "Image", key: "imageRef" },
            {
              label: "Created",
              key: "createdAt",
              format: (v: any) => timeAgo(v),
            },
          ]}
        />
      )}
    </Box>
  )
}
