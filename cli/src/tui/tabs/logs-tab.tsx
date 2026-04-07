import React, { useState } from "react"
import { Box, Text, useInput } from "ink"
import { TextInput } from "@inkjs/ui"
import { LogViewer } from "../components/log-viewer.js"
import { useLogs, type LogFilters } from "../hooks/use-logs.js"
import { useSelection } from "../hooks/use-selection.js"

interface LogsTabProps {
  focused: boolean
}

const LEVELS = [undefined, "error", "warn", "info", "debug"] as const

export function LogsTab({ focused }: LogsTabProps) {
  const { selection } = useSelection()
  const [levelIndex, setLevelIndex] = useState(0)
  const [grepText, setGrepText] = useState("")
  const [grepMode, setGrepMode] = useState(false)

  const filters: LogFilters = {
    workspaceId: selection?.type === "workspace" ? selection.id : undefined,
    level: LEVELS[levelIndex],
    grep: grepText || undefined,
  }

  const { entries, connected, clear } = useLogs(filters)

  useInput(
    (input, key) => {
      if (!focused) return

      if (grepMode) {
        if (key.escape || (input === "/" && grepText === "")) {
          setGrepMode(false)
        }
        return
      }

      if (input === "f") {
        setLevelIndex((i: number) => (i + 1) % LEVELS.length)
      } else if (input === "/") {
        setGrepMode(true)
      } else if (input === "c") {
        clear()
      }
    },
    { isActive: focused }
  )

  const sourceName =
    selection?.type === "workspace" ? selection.name : "all"

  return (
    <Box flexGrow={1} flexDirection="column">
      {/* Filter bar */}
      <Box paddingX={1} gap={2}>
        <Text>
          source: <Text bold>{sourceName}</Text>
        </Text>
        <Text>
          level:{" "}
          <Text bold color={levelColor(LEVELS[levelIndex])}>
            ≥{LEVELS[levelIndex] ?? "all"}
          </Text>
        </Text>
        {grepMode ? (
          <Box>
            <Text>grep: </Text>
            <TextInput
              placeholder="search..."
              defaultValue={grepText}
              onSubmit={(val) => {
                setGrepText(val)
                setGrepMode(false)
              }}
            />
          </Box>
        ) : grepText ? (
          <Text>
            grep: <Text bold>"{grepText}"</Text>
          </Text>
        ) : null}
        <Box flexGrow={1} />
        <Text dimColor>
          {connected ? "● streaming" : "○ connecting..."}
        </Text>
      </Box>

      {/* Separator */}
      <Box paddingX={1}>
        <Text dimColor>{"─".repeat(80)}</Text>
      </Box>

      {/* Log entries */}
      <LogViewer entries={entries} focused={focused && !grepMode} />

      {/* Footer shortcuts */}
      <Box paddingX={1}>
        <Text dimColor>
          [f] level  [/] grep  [c] clear  [↑↓] scroll
        </Text>
      </Box>
    </Box>
  )
}

function levelColor(level: string | undefined): string {
  switch (level) {
    case "error":
      return "red"
    case "warn":
      return "yellow"
    case "info":
      return "cyan"
    case "debug":
      return "gray"
    default:
      return "white"
  }
}
