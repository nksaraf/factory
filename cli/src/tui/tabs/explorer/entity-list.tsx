import React, { useMemo, useState } from "react"
import { Box, Text, useInput } from "ink"
import {
  DataTable,
  type Column,
  statusColor,
  timeAgo,
} from "../../components/data-table.js"
import { useEntityData } from "../../hooks/use-entity-data.js"
import type { EntityDef } from "./entity-registry.js"

interface EntityListProps {
  entity: EntityDef
  focused: boolean
  onBack: () => void
  onSelect: (row: Record<string, unknown>) => void
  onCreate: () => void
}

const HIDDEN_KEYS = new Set([
  "id",
  "spec",
  "metadata",
  "status",
  "validFrom",
  "validTo",
  "systemFrom",
  "systemTo",
  "changedBy",
  "changeReason",
  "updatedAt",
  "generation",
  "observedGeneration",
])

const PRIORITY_KEYS = [
  "name",
  "slug",
  "type",
  "version",
  "lifecycle",
  "createdAt",
]

function deriveColumns(rows: Record<string, unknown>[]): Column[] {
  if (rows.length === 0) return []
  const sample = rows[0]
  const allKeys = Object.keys(sample)

  const columns: Column[] = []

  // Name or slug first
  const nameKey = allKeys.includes("name")
    ? "name"
    : allKeys.includes("slug")
      ? "slug"
      : null
  if (nameKey) {
    const slugKey =
      nameKey === "name" && allKeys.includes("slug") ? "slug" : undefined
    columns.push({
      header: nameKey === "name" ? "Name" : "Slug",
      key: nameKey,
      slugKey,
    })
  }

  // Status with color
  if (allKeys.includes("status")) {
    columns.push({
      header: "Status",
      key: "status",
      width: 14,
      format: (v: unknown) => {
        if (typeof v === "object" && v !== null) {
          const obj = v as Record<string, unknown>
          return (
            (obj.phase as string) ?? (obj.state as string) ?? JSON.stringify(v)
          )
        }
        return v == null ? "-" : String(v)
      },
      color: (val: string) => statusColor(val),
    })
  }

  // Other priority keys
  for (const key of PRIORITY_KEYS) {
    if (key === "name" || key === "slug" || key === "status") continue
    if (!allKeys.includes(key)) continue
    columns.push({
      header: key
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, (c) => c.toUpperCase()),
      key,
      ...(key === "createdAt"
        ? { format: (v: unknown) => timeAgo(v as string), width: 14 }
        : {}),
    })
  }

  // Remaining keys (up to 3 more)
  let extra = 0
  for (const key of allKeys) {
    if (extra >= 3) break
    if (HIDDEN_KEYS.has(key)) continue
    if (columns.some((c) => c.key === key)) continue
    columns.push({
      header: key
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, (c) => c.toUpperCase()),
      key,
      format: (v: unknown) => {
        if (v == null) return "-"
        if (typeof v === "object") return JSON.stringify(v).slice(0, 30)
        const s = String(v)
        if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return timeAgo(s)
        return s.length > 30 ? s.slice(0, 27) + "..." : s
      },
    })
    extra++
  }

  return columns
}

function filterRows(
  rows: Record<string, unknown>[],
  filter: string
): Record<string, unknown>[] {
  if (!filter) return rows
  const f = filter.toLowerCase()
  return rows.filter((row) => {
    // Search across name, slug, type, status, and id
    for (const key of ["name", "slug", "type", "status", "id", "version"]) {
      const val = row[key]
      if (val == null) continue
      const s = typeof val === "object" ? JSON.stringify(val) : String(val)
      if (s.toLowerCase().includes(f)) return true
    }
    return false
  })
}

export function EntityList({
  entity,
  focused,
  onBack,
  onSelect,
  onCreate,
}: EntityListProps) {
  const { data, loading, error } = useEntityData(entity.module, entity.entity)
  const allRows = data ?? []
  const [filter, setFilter] = useState("")
  const [filtering, setFiltering] = useState(false)

  const rows = useMemo(() => filterRows(allRows, filter), [allRows, filter])
  const columns = useMemo(() => deriveColumns(rows), [rows])

  useInput(
    (input, key) => {
      if (!focused) return

      if (filtering) {
        if (key.escape) {
          if (filter) {
            setFilter("")
          }
          setFiltering(false)
          return
        }
        if (key.backspace || key.delete) {
          setFilter((f) => f.slice(0, -1))
          return
        }
        if (key.return) {
          setFiltering(false)
          return
        }
        if (input && !key.ctrl && !key.meta) {
          setFilter((f) => f + input)
          return
        }
        return
      }

      // Not filtering
      if (key.escape) {
        if (filter) {
          setFilter("")
        } else {
          onBack()
        }
        return
      }
      if (input === "/" || input === "f") {
        setFiltering(true)
        return
      }
      if (input === "n") {
        onCreate()
        return
      }
    },
    { isActive: focused }
  )

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box paddingX={1} gap={2}>
        <Text bold color="cyan">
          {entity.module}
        </Text>
        <Text dimColor>›</Text>
        <Text bold>{entity.label}</Text>
        <Text dimColor>
          (
          {loading
            ? "loading..."
            : `${rows.length}${filter ? `/${allRows.length}` : ""} rows`}
          )
        </Text>
        {filtering || filter ? (
          <Box>
            <Text color="yellow">/</Text>
            <Text color="white">{filter}</Text>
            {filtering && <Text color="yellow">▌</Text>}
          </Box>
        ) : null}
        <Box flexGrow={1} />
        <Text dimColor>/ filter n new esc back</Text>
      </Box>
      {error && (
        <Box paddingX={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}
      <DataTable
        columns={columns}
        rows={rows}
        focused={focused && !filtering}
        onSelect={onSelect}
        emptyMessage={
          loading
            ? "Loading..."
            : filter
              ? `No rows matching "${filter}"`
              : "No records."
        }
      />
    </Box>
  )
}
