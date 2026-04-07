import React, { useState } from "react"
import { Box, Text, useInput } from "ink"
import { DataTable, type Column, type DetailField, timeAgo } from "../components/data-table.js"
import { useSites, useReleases } from "../hooks/use-fleet-data.js"

interface FleetTabProps {
  focused: boolean
}

type SubView = "sites" | "releases"

const SITE_COLUMNS: Column[] = [
  { header: "Name", key: "name", width: 36, slugKey: "slug" },
  { header: "Product", key: "product", width: 16 },
  { header: "Status", key: "status", width: 14 },
  { header: "Manifest", key: "currentManifestVersion", width: 10, format: (v: any) => v ? `v${v}` : "-" },
  {
    header: "Last Check-in",
    key: "lastCheckinAt",
    width: 14,
    format: (v: any) => timeAgo(v),
  },
]

const RELEASE_COLUMNS: Column[] = [
  { header: "Version", key: "version", width: 18 },
  { header: "Status", key: "status", width: 14 },
  { header: "Created By", key: "createdBy", width: 16, format: (v: any) => v ?? "-" },
  {
    header: "Created",
    key: "createdAt",
    width: 14,
    format: (v: any) => timeAgo(v),
  },
]

export function FleetTab({ focused }: FleetTabProps) {
  const [subView, setSubView] = useState<SubView>("sites")
  const sitesQuery = useSites()
  const releasesQuery = useReleases()

  useInput(
    (input) => {
      if (!focused) return
      if (input === "s") setSubView("sites")
      else if (input === "r") setSubView("releases")
    },
    { isActive: focused }
  )

  const sites = sitesQuery.data ?? []
  const releases = releasesQuery.data ?? []

  return (
    <Box flexGrow={1} flexDirection="column">
      {/* Sub-nav */}
      <Box paddingX={1} gap={2}>
        <Text bold={subView === "sites"} color={subView === "sites" ? "cyan" : "gray"}>
          [s] Sites ({sites.length})
        </Text>
        <Text bold={subView === "releases"} color={subView === "releases" ? "cyan" : "gray"}>
          [r] Releases ({releases.length})
        </Text>
      </Box>

      {subView === "sites" && (
        <DataTable
          columns={SITE_COLUMNS}
          rows={sites}
          focused={focused}
          emptyMessage="No sites deployed."
          detailFields={[
            { label: "Name", key: "name" },
            { label: "Slug", key: "slug" },
            { label: "Product", key: "product" },
            { label: "Status", key: "status" },
            { label: "Runtime", key: "runtimeId" },
            { label: "Manifest", key: "currentManifestVersion", format: (v: any) => v ? `v${v}` : "-" },
            { label: "Last Check-in", key: "lastCheckinAt", format: (v: any) => timeAgo(v) },
            { label: "Created", key: "createdAt", format: (v: any) => timeAgo(v) },
          ]}
        />
      )}

      {subView === "releases" && (
        <DataTable
          columns={RELEASE_COLUMNS}
          rows={releases}
          focused={focused}
          emptyMessage="No releases."
        />
      )}
    </Box>
  )
}
