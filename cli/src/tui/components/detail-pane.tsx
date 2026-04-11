import { Box, Text } from "ink"
import React from "react"

import { useSelection } from "../hooks/use-selection.js"

interface DetailPaneProps {
  workspaces: Record<string, unknown>[]
  realms: Record<string, unknown>[]
  estates: Record<string, unknown>[]
}

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return "-"
  const diff = Date.now() - new Date(dateStr).getTime()
  if (diff < 0) return "just now"
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function statusColor(status?: string): string {
  switch (status) {
    case "active":
    case "running":
    case "ready":
    case "healthy":
    case "connected":
      return "green"
    case "provisioning":
    case "pending":
    case "creating":
      return "yellow"
    case "stopped":
    case "error":
    case "failed":
      return "red"
    default:
      return "gray"
  }
}

/** Safely extract a string from a record field, returning fallback if absent/non-string */
function str(
  rec: Record<string, unknown>,
  key: string,
  fallback = "-"
): string {
  const v = rec[key]
  return typeof v === "string" ? v : fallback
}

export function DetailPane({ workspaces, realms, estates }: DetailPaneProps) {
  const { selection } = useSelection()

  if (!selection) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text dimColor>Select a resource to view details</Text>
      </Box>
    )
  }

  let fields: [string, string, string?][] = [] // [label, value, color?]

  if (selection.type === "workspace") {
    const sb = workspaces.find(
      (s) =>
        s.workspaceId === selection.id ||
        s.id === selection.id ||
        s.slug === selection.id ||
        s.name === selection.name
    )
    if (sb) {
      fields = [
        ["Name", str(sb, "name", str(sb, "slug", selection.name))],
        ["Slug", str(sb, "slug")],
        [
          "Status",
          str(sb, "status", "unknown"),
          statusColor(str(sb, "status", "unknown")),
        ],
        ["Realm", str(sb, "realmType")],
        [
          "Health",
          str(sb, "healthStatus", "unknown"),
          statusColor(str(sb, "healthStatus", "unknown")),
        ],
        ["CPU", str(sb, "cpu")],
        ["Memory", str(sb, "memory")],
        ["Owner", str(sb, "ownerId", str(sb, "ownerName", str(sb, "owner")))],
        ["IP", str(sb, "ipAddress")],
        ["Created", timeAgo(str(sb, "createdAt", ""))],
      ]
    }
  } else if (selection.type === "realm") {
    const cl = realms.find(
      (c) =>
        c.realmId === selection.id ||
        c.id === selection.id ||
        c.slug === selection.id ||
        c.name === selection.name
    )
    if (cl) {
      fields = [
        ["Name", str(cl, "name", str(cl, "slug", selection.name))],
        ["Slug", str(cl, "slug")],
        [
          "Status",
          str(cl, "status", "unknown"),
          statusColor(str(cl, "status", "unknown")),
        ],
        ["Estate", str(cl, "estateName", str(cl, "estateId"))],
        ["Endpoint", str(cl, "endpoint")],
        ["Created", timeAgo(str(cl, "createdAt", ""))],
      ]
    }
  } else if (selection.type === "estate") {
    const pr = estates.find(
      (p) =>
        p.estateId === selection.id ||
        p.id === selection.id ||
        p.name === selection.name
    )
    if (pr) {
      fields = [
        ["Name", str(pr, "name", selection.name)],
        ["Slug", str(pr, "slug")],
        [
          "Status",
          str(pr, "status", "unknown"),
          statusColor(str(pr, "status", "unknown")),
        ],
        ["Type", str(pr, "estateType")],
        ["Kind", str(pr, "estateKind")],
        ["Created", timeAgo(str(pr, "createdAt", ""))],
      ]
    }
  }

  if (fields.length === 0) {
    fields = [
      ["Name", selection.name],
      ["Type", selection.type],
    ]
  }

  const maxLabel = Math.max(...fields.map(([l]) => l.length))

  return (
    <Box flexDirection="column">
      <Box paddingX={1} marginBottom={1}>
        <Text bold>
          {selection.type}: {selection.name}
        </Text>
      </Box>
      {fields.map(([label, value, color]) => (
        <Box key={label} paddingX={1}>
          <Text dimColor>{label.padEnd(maxLabel)} </Text>
          {color ? <Text color={color}>● {value}</Text> : <Text>{value}</Text>}
        </Box>
      ))}

      {selection.type === "workspace" && (
        <Box flexDirection="column" marginTop={1} paddingX={1}>
          <Box borderStyle="single" paddingX={1} flexDirection="row" gap={2}>
            <Text>[l] logs</Text>
            <Text>[s] ssh</Text>
            <Text>[r] restart</Text>
            <Text>[d] delete</Text>
          </Box>
        </Box>
      )}
    </Box>
  )
}
