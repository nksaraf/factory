import React from "react"
import { Box, Text } from "ink"

const SHORTCUTS = [
  ["Tabs", [
    ["1", "Infra — substrates, runtimes, hosts"],
    ["2", "Fleet — sites, releases"],
    ["3", "Workspace — workspaces, previews"],
    ["4", "Build — modules, CI runs"],
    ["5", "Gateway — routes, domains"],
    ["6", "Commerce — customers"],
    ["7", "Alerts — active alerts"],
    ["8", "Logs — streaming log viewer"],
  ]],
  ["Navigation", [
    ["↑ / ↓", "Navigate rows / tree"],
    ["← / →", "Collapse / expand tree nodes"],
    ["Enter", "Select / toggle"],
    ["PgUp/PgDn", "Scroll logs by page"],
  ]],
  ["Infra tab", [
    ["l", "View logs for selected workspace"],
    ["s", "SSH into selected workspace"],
  ]],
  ["Logs tab", [
    ["f", "Cycle log level filter"],
    ["/", "Toggle grep filter input"],
    ["c", "Clear log buffer"],
  ]],
  ["General", [
    ["?", "Toggle this help"],
    ["q", "Quit"],
  ]],
] as const

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <Box flexDirection="column" borderStyle="double" borderColor="cyan" paddingX={2} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">Keyboard Shortcuts</Text>
        <Box flexGrow={1} />
        <Text dimColor>Press ? to close</Text>
      </Box>

      {SHORTCUTS.map(([section, keys]) => (
        <Box key={section as string} flexDirection="column" marginBottom={1}>
          <Text bold underline>{section as string}</Text>
          {(keys as readonly (readonly [string, string])[]).map(([key, desc]) => (
            <Box key={key} paddingLeft={1}>
              <Text color="yellow">{(key as string).padEnd(12)}</Text>
              <Text>{desc as string}</Text>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  )
}
