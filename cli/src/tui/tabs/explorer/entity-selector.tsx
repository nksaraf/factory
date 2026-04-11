import React, { useState, useMemo, useEffect } from "react"
import { Box, Text, useInput, useStdout } from "ink"
import { MODULE_GROUPS, type EntityDef } from "./entity-registry.js"

interface EntitySelectorProps {
  focused: boolean
  selected: EntityDef | null
  onSelect: (entity: EntityDef) => void
}

type ListItem =
  | { type: "header"; label: string }
  | { type: "entity"; def: EntityDef }

function matchesFilter(def: EntityDef, filter: string): boolean {
  const f = filter.toLowerCase()
  return (
    def.label.toLowerCase().includes(f) ||
    def.entity.toLowerCase().includes(f) ||
    def.module.toLowerCase().includes(f)
  )
}

export function EntitySelector({
  focused,
  selected,
  onSelect,
}: EntitySelectorProps) {
  const [filter, setFilter] = useState("")
  const [filtering, setFiltering] = useState(false)
  const [cursorPos, setCursorPos] = useState(0)

  const items = useMemo(() => {
    const result: ListItem[] = []
    for (const group of MODULE_GROUPS) {
      const matching = filter
        ? group.entities.filter((def) => matchesFilter(def, filter))
        : group.entities
      if (matching.length === 0) continue
      result.push({ type: "header", label: group.label })
      for (const def of matching) {
        result.push({ type: "entity", def })
      }
    }
    return result
  }, [filter])

  const selectableIndices = useMemo(
    () =>
      items
        .map((item, i) => (item.type === "entity" ? i : -1))
        .filter((i) => i >= 0),
    [items]
  )

  // Clamp cursor when filter changes
  useEffect(() => {
    if (cursorPos >= selectableIndices.length && selectableIndices.length > 0) {
      setCursorPos(selectableIndices.length - 1)
    }
  }, [selectableIndices.length])

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
          const itemIdx = selectableIndices[cursorPos]
          const item = items[itemIdx]
          if (item?.type === "entity") onSelect(item.def)
          setFiltering(false)
          return
        }
        if (key.upArrow) {
          setCursorPos((c) => Math.max(0, c - 1))
          return
        }
        if (key.downArrow) {
          setCursorPos((c) => Math.min(selectableIndices.length - 1, c + 1))
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
      if (key.upArrow) {
        setCursorPos((c) => Math.max(0, c - 1))
      } else if (key.downArrow) {
        setCursorPos((c) => Math.min(selectableIndices.length - 1, c + 1))
      } else if (key.return) {
        const itemIdx = selectableIndices[cursorPos]
        const item = items[itemIdx]
        if (item?.type === "entity") onSelect(item.def)
      } else if (
        input &&
        !key.ctrl &&
        !key.meta &&
        /^[a-zA-Z0-9]$/.test(input)
      ) {
        setFiltering(true)
        setFilter(input)
        setCursorPos(0)
      }
    },
    { isActive: focused }
  )

  const activeItemIdx = selectableIndices[cursorPos] ?? 0

  const { stdout } = useStdout()
  // 4 = tab bar + status bar + filter bar + bottom padding
  const windowSize = Math.max(10, (stdout.rows ?? 24) - 4)
  const windowStart = Math.max(0, activeItemIdx - Math.floor(windowSize / 2))
  const windowEnd = Math.min(items.length, windowStart + windowSize)
  const visible = items.slice(windowStart, windowEnd)

  return (
    <Box flexDirection="column">
      {/* Filter bar */}
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

      {/* Entity list */}
      {selectableIndices.length === 0 ? (
        <Box>
          <Text dimColor>no match</Text>
        </Box>
      ) : (
        visible.map((item, i) => {
          const realIdx = windowStart + i
          if (item.type === "header") {
            return (
              <Box key={`h-${item.label}`} marginTop={realIdx > 0 ? 1 : 0}>
                <Text bold dimColor>
                  {item.label}
                </Text>
              </Box>
            )
          }
          const isCursor = realIdx === activeItemIdx && focused
          const isSelected =
            selected?.module === item.def.module &&
            selected?.entity === item.def.entity
          return (
            <Box key={`${item.def.module}-${item.def.entity}`}>
              <Text
                backgroundColor={isCursor ? "blue" : undefined}
                color={isCursor ? "white" : isSelected ? "cyan" : undefined}
                bold={isSelected}
              >
                {isCursor ? "›" : isSelected ? "▸" : " "} {item.def.label}
              </Text>
            </Box>
          )
        })
      )}
    </Box>
  )
}
