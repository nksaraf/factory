/**
 * IDE hook defaults — configures Claude Code and Cursor to send
 * telemetry events to the Factory API via `dx hook` CLI commands.
 *
 * Hooks are registered as `dx hook cursor <event>` / `dx hook claude-code <event>`,
 * so they only depend on `dx` being on $PATH — no source code paths.
 *
 * Detects whether each IDE's hook config already includes our telemetry
 * hooks. If not, proposes adding them.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import type { ConfigChange, ConfigProvider } from "./types.js"

// ── Claude Code ──────────────────────────────────────────────

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
] as const

function isOurHookCommand(command: string): boolean {
  return (
    command.includes("dx hook") ||
    command.includes("claude-code-hook.ts") ||
    command.includes("cursor-hook.ts")
  )
}

function detectClaudeCode(): ConfigChange {
  const settingsPath = join(homedir(), ".claude", "settings.json")

  let alreadyApplied = false
  let currentValue: string | null = null

  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, "utf8"))
      const hooks = settings.hooks ?? {}
      const registered = CC_HOOK_EVENTS.filter((event) => {
        const entries = hooks[event] as
          | Array<Record<string, unknown>>
          | undefined
        if (!entries) return false
        return entries.some((entry) => {
          const innerHooks = entry.hooks as
            | Array<Record<string, unknown>>
            | undefined
          if (!innerHooks) return false
          return innerHooks.some(
            (h) =>
              typeof h.command === "string" &&
              h.command.includes("dx hook claude-code")
          )
        })
      })
      alreadyApplied = registered.length === CC_HOOK_EVENTS.length
      currentValue =
        registered.length > 0
          ? `${registered.length}/${CC_HOOK_EVENTS.length} events`
          : null
    } catch {
      // Malformed JSON — treat as not configured
    }
  }

  return {
    id: "ide-hooks:claude-code",
    category: "ide-hooks",
    description: `Claude Code: telemetry hooks (${CC_HOOK_EVENTS.length} events → Factory API)`,
    target: settingsPath,
    currentValue,
    proposedValue: `${CC_HOOK_EVENTS.length} hook events`,
    alreadyApplied,
    requiresSudo: false,
    platform: null,
    apply: async () => {
      try {
        let settings: Record<string, unknown> = {}
        if (existsSync(settingsPath)) {
          settings = JSON.parse(readFileSync(settingsPath, "utf8"))
        }

        const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>

        for (const event of CC_HOOK_EVENTS) {
          const command = `dx hook claude-code ${event}`
          if (!hooks[event]) hooks[event] = []

          // Remove stale entries (both old bun-run and current dx hook)
          hooks[event] = (
            hooks[event] as Array<Record<string, unknown>>
          ).filter((entry) => {
            const innerHooks = entry.hooks as
              | Array<Record<string, unknown>>
              | undefined
            if (!innerHooks) return true
            return !innerHooks.some(
              (h) =>
                typeof h.command === "string" && isOurHookCommand(h.command)
            )
          })
          ;(hooks[event] as Array<Record<string, unknown>>).push({
            matcher: "*",
            hooks: [{ type: "command", command }],
          })
        }

        settings.hooks = hooks
        mkdirSync(join(homedir(), ".claude"), { recursive: true })
        writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n")
        return true
      } catch {
        return false
      }
    },
  }
}

// ── Cursor ───────────────────────────────────────────────────

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
] as const

function detectCursor(): ConfigChange {
  const hooksDir = join(homedir(), ".cursor")
  const hooksPath = join(hooksDir, "hooks.json")

  let alreadyApplied = false
  let currentValue: string | null = null

  if (existsSync(hooksPath)) {
    try {
      const config = JSON.parse(readFileSync(hooksPath, "utf8"))
      const hooks = config.hooks ?? {}
      const registered = CURSOR_HOOK_EVENTS.filter((event) => {
        const entries = hooks[event] as
          | Array<Record<string, unknown>>
          | undefined
        if (!entries) return false
        return entries.some(
          (entry) =>
            typeof entry.command === "string" &&
            entry.command.includes("dx hook cursor")
        )
      })
      alreadyApplied = registered.length === CURSOR_HOOK_EVENTS.length
      currentValue =
        registered.length > 0
          ? `${registered.length}/${CURSOR_HOOK_EVENTS.length} events`
          : null
    } catch {
      // Malformed JSON
    }
  }

  return {
    id: "ide-hooks:cursor",
    category: "ide-hooks",
    description: `Cursor: telemetry hooks (${CURSOR_HOOK_EVENTS.length} events → Factory API)`,
    target: hooksPath,
    currentValue,
    proposedValue: `${CURSOR_HOOK_EVENTS.length} hook events`,
    alreadyApplied,
    requiresSudo: false,
    platform: null,
    apply: async () => {
      try {
        let config: Record<string, unknown> = {}
        if (existsSync(hooksPath)) {
          config = JSON.parse(readFileSync(hooksPath, "utf8"))
        }

        const hooks = (config.hooks ?? {}) as Record<string, unknown[]>

        for (const event of CURSOR_HOOK_EVENTS) {
          const command = `dx hook cursor ${event}`
          if (!hooks[event]) hooks[event] = []

          // Remove stale entries (both old bun-run and current dx hook)
          hooks[event] = (
            hooks[event] as Array<Record<string, unknown>>
          ).filter(
            (entry) =>
              !(
                typeof entry.command === "string" &&
                isOurHookCommand(entry.command)
              )
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
        return true
      } catch {
        return false
      }
    },
  }
}

// ── Provider ─────────────────────────────────────────────────

export const ideHooksDefaultsProvider: ConfigProvider = {
  name: "IDE hook telemetry",
  category: "ide-hooks",
  roles: ["workbench"],

  async detect(): Promise<ConfigChange[]> {
    return [detectClaudeCode(), detectCursor()]
  },
}
