import React, { useState, useEffect } from "react"
import { Box, Text, useInput } from "ink"

export interface Column {
  header: string
  key: string
  width?: number
  color?: (value: string, row: Record<string, unknown>) => string | undefined
  format?: (value: unknown, row: Record<string, unknown>) => string
  /** When set, renders the slug dimmed after the main value: "Name slug" */
  slugKey?: string
}

/** Fields to show in the expanded detail row. If omitted, all row keys are shown. */
export interface DetailField {
  label: string
  key: string
  format?: (value: unknown, row: Record<string, unknown>) => string
}

interface DataTableProps {
  columns: Column[]
  rows: Record<string, unknown>[]
  focused: boolean
  onSelect?: (row: Record<string, unknown>) => void
  emptyMessage?: string
  /** Detail fields shown when Enter is pressed on a row. Pass [] to disable. */
  detailFields?: DetailField[]
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
    case "success":
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
    case "warning":
    case "acknowledged":
      return "yellow"
    case "stopped":
    case "error":
    case "failed":
    case "destroyed":
    case "firing":
    case "critical":
    case "cancelled":
    case "timed_out":
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

function getValue(row: Record<string, unknown>, col: Column): string {
  const raw = row[col.key]
  if (col.format) return col.format(raw, row)
  if (raw === null || raw === undefined) return "-"
  if (col.key.includes("At") || col.key.includes("Date") || col.key === "since") {
    return timeAgo(String(raw))
  }
  return String(raw)
}

/** Auto-generate detail fields from a row's keys, skipping internal/id fields */
function autoDetailFields(row: Record<string, unknown>): DetailField[] {
  const skip = new Set(["id"])
  return Object.keys(row)
    .filter((k) => !skip.has(k))
    .map((k) => ({
      label: k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()),
      key: k,
    }))
}

function formatDetailValue(val: unknown): string {
  if (val === null || val === undefined) return "-"
  if (typeof val === "object") return JSON.stringify(val)
  const s = String(val)
  // Auto-detect timestamps
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return `${s.slice(0, 19).replace("T", " ")} (${timeAgo(s)})`
  return s
}

export function DataTable({
  columns,
  rows,
  focused,
  onSelect,
  emptyMessage = "No data.",
  detailFields,
}: DataTableProps) {
  const [cursor, setCursor] = useState(0)
  const [expandedRow, setExpandedRow] = useState<number | null>(null)

  useEffect(() => {
    if (cursor >= rows.length && rows.length > 0) {
      setCursor(rows.length - 1)
    }
  }, [rows.length, cursor])

  // Close detail when cursor moves away
  useEffect(() => {
    if (expandedRow !== null && expandedRow !== cursor) {
      setExpandedRow(null)
    }
  }, [cursor])

  useInput(
    (input, key) => {
      if (!focused) return
      if (key.upArrow) setCursor((c) => Math.max(0, c - 1))
      else if (key.downArrow) setCursor((c) => Math.min(rows.length - 1, c + 1))
      else if (key.return && rows[cursor]) {
        if (onSelect) onSelect(rows[cursor])
        // Toggle detail expansion
        setExpandedRow((prev) => (prev === cursor ? null : cursor))
      } else if (key.escape) {
        setExpandedRow(null)
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
        const isExpanded = rowIdx === expandedRow
        return (
          <React.Fragment key={rowIdx}>
            <Box paddingX={1}>
              {columns.map((col, colIdx) => {
                const val = getValue(row, col)
                const color = col.color
                  ? col.color(val, row)
                  : col.key === "status" || col.key === "severity"
                    ? statusColor(val)
                    : undefined
                const slugRaw = col.slugKey ? row[col.slugKey] : undefined
                const slug = typeof slugRaw === "string" ? slugRaw : undefined
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
            {isExpanded && (
              <DetailRow row={row} fields={detailFields} />
            )}
          </React.Fragment>
        )
      })}

      <Box paddingX={1} marginTop={1}>
        <Text dimColor>
          {rows.length} row{rows.length !== 1 ? "s" : ""}{" "}
          {focused && `· ${cursor + 1}/${rows.length}`}
          {focused && "  ↵ detail  esc close"}
        </Text>
      </Box>
    </Box>
  )
}

function DetailRow({ row, fields }: { row: Record<string, unknown>; fields?: DetailField[] }) {
  const resolvedFields = fields ?? autoDetailFields(row)
  const maxLabel = Math.max(...resolvedFields.map((f) => f.label.length))

  return (
    <Box
      flexDirection="column"
      paddingX={3}
      paddingY={0}
      borderStyle="single"
      borderLeft
      borderRight={false}
      borderTop={false}
      borderBottom={false}
      marginLeft={2}
    >
      {resolvedFields.map((field) => {
        const raw = row[field.key]
        const val = field.format ? field.format(raw, row) : formatDetailValue(raw)
        const sc = typeof raw === "string" ? statusColor(raw) : undefined
        return (
          <Box key={field.key}>
            <Text dimColor>{field.label.padEnd(maxLabel)}  </Text>
            {sc ? (
              <Text color={sc}>● {val}</Text>
            ) : (
              <Text>{val}</Text>
            )}
          </Box>
        )
      })}
    </Box>
  )
}

export { statusColor, timeAgo }
