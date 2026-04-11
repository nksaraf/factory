import React, { useState, useEffect } from "react"
import { Box, Text } from "ink"

interface StatusBarProps {
  counts: { running: number; degraded: number; down: number }
  connected: boolean
}

export function StatusBar({ counts, connected }: StatusBarProps) {
  const [time, setTime] = useState(formatTime())

  useEffect(() => {
    const timer = setInterval(() => setTime(formatTime()), 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <Box
      borderStyle="single"
      borderTop
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      paddingX={1}
    >
      <Text>
        <Text color="green">● {counts.running} running</Text>
        {"  "}
        <Text color="yellow">◐ {counts.degraded} degraded</Text>
        {"  "}
        <Text color="red">○ {counts.down} down</Text>
      </Text>
      <Box flexGrow={1} />
      <Text>
        <Text color={connected ? "green" : "red"}>
          {connected ? "● connected" : "○ disconnected"}
        </Text>
        {"  "}
        <Text dimColor>{time}</Text>
      </Text>
    </Box>
  )
}

function formatTime(): string {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })
}
