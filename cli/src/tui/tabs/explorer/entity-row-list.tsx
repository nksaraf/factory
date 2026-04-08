import React, { useState, useMemo, useEffect } from "react"
import { Box, Text, useInput, useStdout } from "ink"
import { statusColor } from "../../components/data-table.js"
import type { EntityDef } from "./entity-registry.js"

interface EntityRowListProps {
  entity: EntityDef
  rows: Record<string, unknown>[]
  loading: boolean
  error: string | null
  focused: boolean
  selectedRow: Record<string, unknown> | null
  onSelect: (row: Record<string, unknown>) => void
  onConfirm: (row: Record<string, unknown>) => void
  onCreate: () => void
  onBack: () => void
}

const ROW_MAX_WIDTH = 38

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s
}

function getRowLabel(row: Record<string, unknown>): string {
  return (row.name as string) ?? (row.slug as string) ?? (row.version as string) ?? (row.id as string) ?? "?"
}

function getRowSublabel(row: Record<string, unknown>): string | null {
  if (row.name && row.slug && row.name !== row.slug) return row.slug as string
  if (row.type) return row.type as string
  return null
}

function getRowStatus(row: Record<string, unknown>): string | null {
  const s = row.status
  if (typeof s === "string") return s
  if (typeof s === "object" && s !== null) {
    const obj = s as Record<string, unknown>
    return (obj.phase as string) ?? (obj.state as string) ?? null
  }
  return null
}

function matchesFilter(row: Record<string, unknown>, filter: string): boolean {
  const f = filter.toLowerCase()
  for (const key of ["name", "slug", "type", "status", "id", "version"]) {
    const val = row[key]
    if (val == null) continue
    if (String(val).toLowerCase().includes(f)) return true
  }
  return false
}

export function EntityRowList({
  entity, rows: allRows, loading, error,
  focused, selectedRow, onSelect, onConfirm, onCreate, onBack,
}: EntityRowListProps) {
  const [filter, setFilter] = useState("")
  const [filtering, setFiltering] = useState(false)
  const [cursorPos, setCursorPos] = useState(0)

  const rows = useMemo(
    () => (filter ? allRows.filter((r) => matchesFilter(r, filter)) : allRows),
    [allRows, filter]
  )

  useEffect(() => {
    if (cursorPos >= rows.length && rows.length > 0) {
      setCursorPos(rows.length - 1)
    }
  }, [rows.length])

  useEffect(() => {
    setFilter("")
    setFiltering(false)
    setCursorPos(0)
  }, [entity.module, entity.entity])

  useInput(
    (input, key) => {
      if (!focused) return

      if (filtering) {
        if (key.escape) {
          if (filter) {
            setFilter("")
            setCursorPos(0)
          }
          setFiltering(false)
          return
        }
        if (key.return) {
          setFiltering(false)
          if (rows[cursorPos]) onConfirm(rows[cursorPos])
          return
        }
        if (key.upArrow) {
          setCursorPos((c) => Math.max(0, c - 1))
          return
        }
        if (key.downArrow) {
          setCursorPos((c) => Math.min(rows.length - 1, c + 1))
          return
        }
        if (key.backspace || key.delete) {
          setFilter((f) => f.slice(0, -1))
          setCursorPos(0)
          return
        }
        if (input && !key.ctrl && !key.meta) {
          setFilter((f) => f + input)
          setCursorPos(0)
          return
        }
        return
      }

      // Not filtering
      if (key.escape) {
        onBack()
        return
      }
      if (key.upArrow) {
        const next = Math.max(0, cursorPos - 1)
        setCursorPos(next)
        if (rows[next]) setTimeout(() => onSelect(rows[next]), 0)
      } else if (key.downArrow) {
        const next = Math.min(rows.length - 1, cursorPos + 1)
        setCursorPos(next)
        if (rows[next]) setTimeout(() => onSelect(rows[next]), 0)
      } else if (key.return) {
        if (rows[cursorPos]) onConfirm(rows[cursorPos])
      } else if (input === "n") {
        onCreate()
      } else if (input === "/" || input === "f") {
        setFiltering(true)
      } else if (input && !key.ctrl && !key.meta && /^[a-zA-Z0-9]$/.test(input)) {
        setFiltering(true)
        setFilter(input)
        setCursorPos(0)
      }
    },
    { isActive: focused }
  )

  const { stdout } = useStdout()
  // 5 = tab bar + status bar + header + filter bar + bottom padding
  const windowSize = Math.max(10, (stdout.rows ?? 24) - 5)
  const windowStart = Math.max(0, cursorPos - Math.floor(windowSize / 2))
  const windowEnd = Math.min(rows.length, windowStart + windowSize)
  const visible = rows.slice(windowStart, windowEnd)

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text bold color={focused ? "cyan" : "gray"}>
          {entity.label}
        </Text>
        <Text dimColor>
          {loading && allRows.length === 0 ? "…" : filter ? `${rows.length}/${allRows.length}` : `${allRows.length}`}
        </Text>
      </Box>

      <Box>
        {filtering || filter ? (
          <Box>
            <Text color="yellow">/</Text>
            <Text color="white">{filter}</Text>
            {filtering && <Text color="yellow">▌</Text>}
          </Box>
        ) : (
          <Text dimColor>{focused ? "type to filter" : ""}</Text>
        )}
      </Box>

      {error ? (
        <Text color="red">err</Text>
      ) : loading && allRows.length === 0 ? (
        <Text dimColor>loading…</Text>
      ) : rows.length === 0 ? (
        <Text dimColor>{filter ? "no match" : "empty"}</Text>
      ) : (
        visible.map((row, i) => {
          const realIdx = windowStart + i
          const isCursor = realIdx === cursorPos && focused
          const isSelected =
            selectedRow &&
            ((row.id && row.id === selectedRow.id) ||
              (row.slug && row.slug === selectedRow.slug))
          const label = getRowLabel(row)
          const sub = getRowSublabel(row)
          const status = getRowStatus(row)
          const sc = status ? statusColor(status) : undefined

          const prefix = isCursor ? "› " : isSelected ? "▸ " : "  "
          const statusDot = sc && !isCursor ? " ●" : ""
          const subText = sub ? ` ${sub}` : ""
          const availableWidth = ROW_MAX_WIDTH - prefix.length - statusDot.length
          const displayLabel = truncate(label + subText, availableWidth)

          return (
            <Box key={(row.id as string) ?? realIdx}>
              <Text
                backgroundColor={isCursor ? "blue" : undefined}
                color={isCursor ? "white" : isSelected ? "cyan" : undefined}
                bold={!!isSelected}
                wrap="truncate-end"
              >
                {prefix}{displayLabel}
              </Text>
              {sc && !isCursor && (
                <Text color={sc}>{statusDot}</Text>
              )}
            </Box>
          )
        })
      )}
    </Box>
  )
}
