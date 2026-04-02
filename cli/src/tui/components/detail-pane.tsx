import React from "react"
import { Box, Text } from "ink"
import { useSelection } from "../hooks/use-selection.js"

interface DetailPaneProps {
  sandboxes: any[]
  clusters: any[]
  providers: any[]
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

export function DetailPane({ sandboxes, clusters, providers }: DetailPaneProps) {
  const { selection } = useSelection()

  if (!selection) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text dimColor>Select a resource to view details</Text>
      </Box>
    )
  }

  let fields: [string, string, string?][] = [] // [label, value, color?]

  if (selection.type === "sandbox") {
    const sb = sandboxes.find(
      (s: any) =>
        s.sandboxId === selection.id ||
        s.id === selection.id ||
        s.slug === selection.id ||
        s.name === selection.name
    )
    if (sb) {
      fields = [
        ["Name", sb.name ?? sb.slug ?? selection.name],
        ["Slug", sb.slug ?? "-"],
        ["Status", sb.status ?? "unknown", statusColor(sb.status)],
        ["Runtime", sb.runtimeType ?? "-"],
        ["Health", sb.healthStatus ?? "unknown", statusColor(sb.healthStatus)],
        ["CPU", sb.cpu ?? "-"],
        ["Memory", sb.memory ?? "-"],
        ["Owner", sb.ownerId ?? sb.ownerName ?? sb.owner ?? "-"],
        ["IP", sb.ipAddress ?? "-"],
        ["Created", timeAgo(sb.createdAt)],
      ]
    }
  } else if (selection.type === "cluster") {
    const cl = clusters.find(
      (c: any) =>
        c.clusterId === selection.id ||
        c.id === selection.id ||
        c.slug === selection.id ||
        c.name === selection.name
    )
    if (cl) {
      fields = [
        ["Name", cl.name ?? cl.slug ?? selection.name],
        ["Slug", cl.slug ?? "-"],
        ["Status", cl.status ?? "unknown", statusColor(cl.status)],
        ["Provider", cl.providerName ?? cl.providerId ?? "-"],
        ["Endpoint", cl.endpoint ?? "-"],
        ["Created", timeAgo(cl.createdAt)],
      ]
    }
  } else if (selection.type === "provider") {
    const pr = providers.find(
      (p: any) =>
        p.providerId === selection.id ||
        p.id === selection.id ||
        p.name === selection.name
    )
    if (pr) {
      fields = [
        ["Name", pr.name ?? selection.name],
        ["Slug", pr.slug ?? "-"],
        ["Status", pr.status ?? "unknown", statusColor(pr.status)],
        ["Type", pr.providerType ?? "-"],
        ["Kind", pr.providerKind ?? "-"],
        ["Created", timeAgo(pr.createdAt)],
      ]
    }
  }

  if (fields.length === 0) {
    fields = [["Name", selection.name], ["Type", selection.type]]
  }

  const maxLabel = Math.max(...fields.map(([l]) => l.length))

  return (
    <Box flexDirection="column">
      <Box paddingX={1} marginBottom={1}>
        <Text bold>{selection.type}: {selection.name}</Text>
      </Box>
      {fields.map(([label, value, color]) => (
        <Box key={label} paddingX={1}>
          <Text dimColor>{label.padEnd(maxLabel)}  </Text>
          {color ? (
            <Text color={color as any}>● {value}</Text>
          ) : (
            <Text>{value}</Text>
          )}
        </Box>
      ))}

      {selection.type === "sandbox" && (
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
