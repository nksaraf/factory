import React, { useState } from "react"
import { Box, Text, useInput, useStdout } from "ink"
import { statusColor, timeAgo } from "../../components/data-table.js"
import type { EntityDef } from "./entity-registry.js"

interface EntityDetailProps {
  entity: EntityDef
  row: Record<string, unknown>
  focused: boolean
  onBack: () => void
  onEdit: () => void
}

const HIDDEN_KEYS = new Set(["id"])

function formatLabel(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())
}

function formatValue(key: string, val: unknown): string {
  if (val === null || val === undefined) return "-"
  if (typeof val === "boolean") return val ? "true" : "false"
  if (typeof val === "object") return JSON.stringify(val, null, 2)
  const s = String(val)
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return `${s.slice(0, 19).replace("T", " ")} (${timeAgo(s)})`
  return s
}

interface FieldEntry {
  key: string
  label: string
  value: string
  indent: number
  color?: string
}

function buildFields(row: Record<string, unknown>): FieldEntry[] {
  const fields: FieldEntry[] = []

  // Top-level scalar fields first
  for (const [key, val] of Object.entries(row)) {
    if (HIDDEN_KEYS.has(key)) continue
    if (key === "spec" || key === "metadata") continue

    const sc = key === "status" && typeof val === "string" ? statusColor(val) : undefined
    fields.push({
      key,
      label: formatLabel(key),
      value: typeof val === "object" && val !== null ? JSON.stringify(val) : formatValue(key, val),
      indent: 0,
      color: sc ?? undefined,
    })
  }

  // Spec expanded
  const spec = row.spec
  if (spec && typeof spec === "object") {
    fields.push({ key: "__spec_header", label: "── spec ──", value: "", indent: 0 })
    for (const [key, val] of Object.entries(spec as Record<string, unknown>)) {
      fields.push({
        key: `spec.${key}`,
        label: formatLabel(key),
        value: formatValue(key, val),
        indent: 2,
      })
    }
  }

  // Metadata expanded
  const metadata = row.metadata
  if (metadata && typeof metadata === "object" && Object.keys(metadata as object).length > 0) {
    fields.push({ key: "__metadata_header", label: "── metadata ──", value: "", indent: 0 })
    for (const [key, val] of Object.entries(metadata as Record<string, unknown>)) {
      fields.push({
        key: `metadata.${key}`,
        label: formatLabel(key),
        value: formatValue(key, val),
        indent: 2,
      })
    }
  }

  return fields
}

export function EntityDetail({ entity, row, focused, onBack, onEdit }: EntityDetailProps) {
  const fields = buildFields(row)
  const maxLabel = Math.max(...fields.filter((f) => f.value).map((f) => f.label.length + f.indent), 10)

  const [scroll, setScroll] = useState(0)
  const { stdout } = useStdout()
  // 5 = tab bar + status bar + breadcrumb header + scroll hint + padding
  const windowSize = Math.max(10, (stdout.rows ?? 24) - 5)

  useInput(
    (input, key) => {
      if (!focused) return
      if (key.escape) onBack()
      else if (input === "e") onEdit()
      else if (key.upArrow) setScroll((s) => Math.max(0, s - 1))
      else if (key.downArrow) setScroll((s) => Math.min(Math.max(0, fields.length - windowSize), s + 1))
    },
    { isActive: focused }
  )

  const name = (row.name as string) ?? (row.slug as string) ?? (row.id as string) ?? "?"
  const visible = fields.slice(scroll, scroll + windowSize)

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box paddingX={1} gap={2}>
        <Text bold color="cyan">{entity.module}</Text>
        <Text dimColor>›</Text>
        <Text bold>{entity.label}</Text>
        <Text dimColor>›</Text>
        <Text bold color="white">{name}</Text>
        <Box flexGrow={1} />
        <Text dimColor>e edit  esc back</Text>
      </Box>

      <Box flexDirection="column" paddingX={2} paddingY={1}>
        {visible.map((field) => {
          // Section headers
          if (!field.value && field.label.startsWith("──")) {
            return (
              <Box key={field.key} marginTop={1}>
                <Text bold dimColor>{field.label}</Text>
              </Box>
            )
          }

          return (
            <Box key={field.key}>
              <Text dimColor>{"  ".repeat(field.indent / 2)}{field.label.padEnd(maxLabel - field.indent)}  </Text>
              {field.color ? (
                <Text color={field.color}>● {field.value}</Text>
              ) : (
                <Text wrap="truncate-end">{field.value}</Text>
              )}
            </Box>
          )
        })}
      </Box>

      {fields.length > windowSize && (
        <Box paddingX={2}>
          <Text dimColor>↑↓ scroll  {scroll + 1}-{Math.min(scroll + windowSize, fields.length)}/{fields.length}</Text>
        </Box>
      )}
    </Box>
  )
}
