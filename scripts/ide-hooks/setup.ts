#!/usr/bin/env bun
/**
 * IDE Hooks Setup — configures Claude Code and Cursor to send telemetry
 * events to the Factory API via `dx hook` CLI commands.
 *
 * Usage:
 *   bun run scripts/ide-hooks/setup.ts [--claude-code] [--cursor] [--all]
 *
 * Without flags, sets up both IDEs.
 *
 * NOTE: This is a convenience script. The canonical path is `dx setup` which
 * uses cli/src/handlers/install/defaults/ide-hooks-defaults.ts. Both produce
 * identical `dx hook <source> <event>` commands.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

function isOurHookCommand(command: string): boolean {
  return (
    command.includes("dx hook") ||
    command.includes("claude-code-hook.ts") ||
    command.includes("cursor-hook.ts")
  )
}

// ── Claude Code Setup ────────────────────────────────────────

const CC_HOOK_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Stop",
  "StopFailure",
  "SubagentStart",
  "SubagentStop",
  "PreCompact",
  "PostCompact",
]

function setupClaudeCode() {
  const settingsPath = join(homedir(), ".claude", "settings.json")
  let settings: Record<string, unknown> = {}

  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf8"))
    } catch {
      console.error(`Warning: Could not parse ${settingsPath}, creating fresh`)
    }
  }

  const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>

  for (const event of CC_HOOK_EVENTS) {
    const command = `dx hook claude-code ${event}`

    if (!hooks[event]) {
      hooks[event] = []
    }

    // Remove stale entries (old bun-run paths and current dx hook)
    hooks[event] = (hooks[event] as Array<Record<string, unknown>>).filter(
      (entry) => {
        if (entry.hooks) {
          const innerHooks = entry.hooks as Array<Record<string, unknown>>
          return !innerHooks.some(
            (h) => typeof h.command === "string" && isOurHookCommand(h.command)
          )
        }
        return !(
          typeof entry.command === "string" && isOurHookCommand(entry.command)
        )
      }
    )
    ;(hooks[event] as Array<Record<string, unknown>>).push({
      matcher: "*",
      hooks: [{ type: "command", command }],
    })
  }

  settings.hooks = hooks

  mkdirSync(join(homedir(), ".claude"), { recursive: true })
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n")
  console.log(`Claude Code hooks configured in ${settingsPath}`)
  console.log(`  Events: ${CC_HOOK_EVENTS.join(", ")}`)
}

// ── Cursor Setup ─────────────────────────────────────────────

const CURSOR_HOOK_EVENTS = [
  "sessionStart",
  "sessionEnd",
  "beforeSubmitPrompt",
  "preToolUse",
  "postToolUse",
  "postToolUseFailure",
  "beforeShellExecution",
  "afterShellExecution",
  "beforeMCPExecution",
  "afterMCPExecution",
  "beforeReadFile",
  "afterFileEdit",
  "beforeTabFileRead",
  "afterTabFileEdit",
  "subagentStart",
  "subagentStop",
  "afterAgentResponse",
  "afterAgentThought",
  "preCompact",
  "stop",
]

function setupCursor() {
  const hooksDir = join(homedir(), ".cursor")
  const hooksPath = join(hooksDir, "hooks.json")
  let config: Record<string, unknown> = {}

  if (existsSync(hooksPath)) {
    try {
      config = JSON.parse(readFileSync(hooksPath, "utf8"))
    } catch {
      console.error(`Warning: Could not parse ${hooksPath}, creating fresh`)
    }
  }

  const hooks = (config.hooks ?? {}) as Record<string, unknown[]>

  for (const event of CURSOR_HOOK_EVENTS) {
    const command = `dx hook cursor ${event}`

    if (!hooks[event]) {
      hooks[event] = []
    }

    // Remove stale entries (old bun-run paths and current dx hook)
    hooks[event] = (hooks[event] as Array<Record<string, unknown>>).filter(
      (entry) =>
        !(typeof entry.command === "string" && isOurHookCommand(entry.command))
    )
    ;(hooks[event] as Array<Record<string, unknown>>).push({
      type: "command",
      command,
    })
  }

  config.version = 1
  config.hooks = hooks

  mkdirSync(hooksDir, { recursive: true })
  writeFileSync(hooksPath, JSON.stringify(config, null, 2) + "\n")
  console.log(`Cursor hooks configured in ${hooksPath}`)
  console.log(`  Events: ${CURSOR_HOOK_EVENTS.join(", ")}`)
}

// ── Main ─────────────────────────────────────────────────────

const args = process.argv.slice(2)
const setupCC =
  args.includes("--claude-code") || args.includes("--all") || args.length === 0
const setupCursorFlag =
  args.includes("--cursor") || args.includes("--all") || args.length === 0

console.log("Setting up IDE hook telemetry...\n")

if (setupCC) setupClaudeCode()
if (setupCursorFlag) setupCursor()

console.log("\nDone! Make sure you're logged in with `dx factory login`.")
console.log(
  "Hooks use `dx hook` — only requires dx on your PATH, no source code."
)
console.log("\nSet FACTORY_HOOK_DEBUG=1 to see debug output from hook scripts.")
