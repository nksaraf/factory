import React, { useState, useEffect, useRef } from "react"
import { Box, Text, useInput, useStdout } from "ink"
import type { LogEntry } from "../hooks/use-logs.js"

interface LogViewerProps {
  entries: LogEntry[]
  focused: boolean
}

function levelColor(level: string): string {
  switch (level?.toLowerCase()) {
    case "fatal":
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

function shortTimestamp(ts: string): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  return d.toISOString().slice(11, 23)
}

export function LogViewer({ entries, focused }: LogViewerProps) {
  const { stdout } = useStdout()
  const termHeight = stdout?.rows ?? 24
  // Reserve space for tab bar, filter bar, status bar, borders
  const visibleLines = Math.max(5, termHeight - 10)

  const [scrollOffset, setScrollOffset] = useState(0)
  const [autoScroll, setAutoScroll] = useState(true)
  const prevLengthRef = useRef(entries.length)

  // Auto-scroll when new entries arrive and autoScroll is on
  useEffect(() => {
    if (autoScroll && entries.length > prevLengthRef.current) {
      const maxOffset = Math.max(0, entries.length - visibleLines)
      setScrollOffset(maxOffset)
    }
    prevLengthRef.current = entries.length
  }, [entries.length, autoScroll, visibleLines])

  useInput(
    (input, key) => {
      if (!focused) return

      if (key.upArrow) {
        setAutoScroll(false)
        setScrollOffset((o) => Math.max(0, o - 1))
      } else if (key.downArrow) {
        const maxOffset = Math.max(0, entries.length - visibleLines)
        setScrollOffset((o) => {
          const next = Math.min(maxOffset, o + 1)
          if (next >= maxOffset) setAutoScroll(true)
          return next
        })
      } else if (key.pageUp) {
        setAutoScroll(false)
        setScrollOffset((o) => Math.max(0, o - visibleLines))
      } else if (key.pageDown) {
        const maxOffset = Math.max(0, entries.length - visibleLines)
        setScrollOffset((o) => {
          const next = Math.min(maxOffset, o + visibleLines)
          if (next >= maxOffset) setAutoScroll(true)
          return next
        })
      }
    },
    { isActive: focused }
  )

  const visible = entries.slice(scrollOffset, scrollOffset + visibleLines)

  if (entries.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text dimColor>Waiting for log entries...</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {visible.map((entry, i) => (
        <Box key={scrollOffset + i} paddingX={1}>
          <Text dimColor>{shortTimestamp(entry.timestamp)} </Text>
          <Text color={levelColor(entry.level)}>
            {entry.level.toUpperCase().padEnd(5)}
          </Text>
          <Text> </Text>
          {entry.source && <Text dimColor>[{entry.source}] </Text>}
          <Text>{entry.message}</Text>
        </Box>
      ))}
      <Box paddingX={1} marginTop={1}>
        <Text dimColor>
          {autoScroll ? "▼ auto-scroll" : "▲ scroll paused"} ({entries.length}{" "}
          entries)
        </Text>
      </Box>
    </Box>
  )
}
