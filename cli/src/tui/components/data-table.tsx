import React, { useState, useEffect } from "react"
import { Box, Text, useInput } from "ink"

export interface Column {
  header: string
  key: string
  width?: number
  color?: (value: string, row: any) => string | undefined
  format?: (value: any, row: any) => string
  /** When set, renders the slug dimmed after the main value: "Name slug" */
  slugKey?: string
}

interface DataTableProps {
  columns: Column[]
  rows: any[]
  focused: boolean
  onSelect?: (row: any) => void
  emptyMessage?: string
}

function statusColor(val: string): string | undefined {
  switch (val) {
    case "active":
    case "running":
    case "ready":
    case "healthy":
    case "connected":
    case "succeeded":
    case "completed":
    case "verified":
    case "production":
      return "green"
    case "provisioning":
    case "pending":
    case "creating":
    case "building":
    case "staging":
    case "queued":
    case "syncing":
    case "deploying":
    case "draft":
    case "suspended":
      return "yellow"
    case "stopped":
    case "error":
    case "failed":
    case "destroyed":
    case "firing":
    case "critical":
    case "cancelled":
      return "red"
    default:
      return undefined
  }
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

function getValue(row: any, col: Column): string {
  const raw = row[col.key]
  if (col.format) return col.format(raw, row)
  if (raw === null || raw === undefined) return "-"
  if (col.key.includes("At") || col.key.includes("Date") || col.key === "since") {
    return timeAgo(String(raw))
  }
  return String(raw)
}

export function DataTable({
  columns,
  rows,
  focused,
  onSelect,
  emptyMessage = "No data.",
}: DataTableProps) {
  const [cursor, setCursor] = useState(0)

  useEffect(() => {
    if (cursor >= rows.length && rows.length > 0) {
      setCursor(rows.length - 1)
    }
  }, [rows.length, cursor])

  useInput(
    (input, key) => {
      if (!focused) return
      if (key.upArrow) setCursor((c) => Math.max(0, c - 1))
      else if (key.downArrow) setCursor((c) => Math.min(rows.length - 1, c + 1))
      else if (key.return && onSelect && rows[cursor]) {
        onSelect(rows[cursor])
      }
    },
    { isActive: focused }
  )

  if (rows.length === 0) {
    return (
      <Box padding={1}>
        <Text dimColor>{emptyMessage}</Text>
      </Box>
    )
  }

  // Auto-compute column widths
  const colWidths = columns.map((col) => {
    const headerLen = col.header.length
    const maxDataLen = Math.max(
      ...rows.slice(0, 50).map((r) => getValue(r, col).length)
    )
    return col.width ?? Math.min(40, Math.max(headerLen, maxDataLen) + 2)
  })

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box paddingX={1}>
        {columns.map((col, i) => (
          <Box key={col.key} width={colWidths[i]}>
            <Text bold dimColor>
              {col.header}
            </Text>
          </Box>
        ))}
      </Box>

      {/* Rows */}
      {rows.map((row, rowIdx) => {
        const isCursor = rowIdx === cursor && focused
        const rowKey = row.id ?? row[columns[0]?.key] ?? rowIdx
        return (
          <Box
            key={rowKey}
            paddingX={1}
          >
            {columns.map((col, colIdx) => {
              const val = getValue(row, col)
              const color = col.color
                ? col.color(val, row)
                : col.key === "status" || col.key === "severity"
                  ? statusColor(val)
                  : undefined
              const slug = col.slugKey ? row[col.slugKey] : undefined
              return (
                <Box key={col.key} width={colWidths[colIdx]}>
                  <Text
                    backgroundColor={isCursor ? "blue" : undefined}
                    color={isCursor ? "white" : color ?? undefined}
                    bold={colIdx === 0 && !isCursor}
                  >
                    {color && !isCursor ? `● ${val}` : val}
                  </Text>
                  {slug && slug !== val && (
                    <Text dimColor={!isCursor} color={isCursor ? "white" : undefined} backgroundColor={isCursor ? "blue" : undefined}> {slug}</Text>
                  )}
                </Box>
              )
            })}
          </Box>
        )
      })}

      <Box paddingX={1} marginTop={1}>
        <Text dimColor>
          {rows.length} row{rows.length !== 1 ? "s" : ""}{" "}
          {focused && `· ${cursor + 1}/${rows.length}`}
        </Text>
      </Box>
    </Box>
  )
}

export { statusColor, timeAgo }
