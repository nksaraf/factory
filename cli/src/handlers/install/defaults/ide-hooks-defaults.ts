/**
 * IDE hook defaults — configures Claude Code and Cursor to send
 * telemetry events to the Factory API via hook scripts.
 *
 * Detects whether each IDE's hook config already includes our telemetry
 * hooks. If not, proposes adding them.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

import type { ConfigChange, ConfigProvider } from "./types.js"

/**
 * Resolve the hook scripts directory.
 * Walks up from this file's directory looking for the repo root (has package.json with workspaces),
 * then returns scripts/ide-hooks under it.
 */
function resolveScriptsDir(): string {
  // Default to a well-known relative path from the CLI source
  // The scripts live at <repo>/scripts/ide-hooks/
  let dir = resolve(import.meta.dir, "../../../../..")
  const candidate = join(dir, "scripts", "ide-hooks")
  if (existsSync(join(candidate, "claude-code-hook.ts"))) return candidate

  // Fallback: check from cwd (useful when running from repo root)
  const cwdCandidate = join(process.cwd(), "scripts", "ide-hooks")
  if (existsSync(join(cwdCandidate, "claude-code-hook.ts"))) return cwdCandidate

  return candidate
}

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

function detectClaudeCode(): ConfigChange {
  const settingsPath = join(homedir(), ".claude", "settings.json")
  const scriptsDir = resolveScriptsDir()
  const hookScript = join(scriptsDir, "claude-code-hook.ts")

  let alreadyApplied = false
  let currentValue: string | null = null

  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, "utf8"))
      const hooks = settings.hooks ?? {}
      // Check if at least the key events are registered
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
              typeof h.command === "string" && h.command.includes(hookScript)
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
          const command = `bun run ${hookScript} ${event}`
          if (!hooks[event]) hooks[event] = []

          // Remove stale entries, then add current
          hooks[event] = (
            hooks[event] as Array<Record<string, unknown>>
          ).filter((entry) => {
            const innerHooks = entry.hooks as
              | Array<Record<string, unknown>>
              | undefined
            if (!innerHooks) return true
            return !innerHooks.some(
              (h) =>
                typeof h.command === "string" &&
                h.command.includes("claude-code-hook.ts")
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
  const hooksDir = join(homedir(), ".cursor", "hooks")
  const hooksPath = join(hooksDir, "hooks.json")
  const scriptsDir = resolveScriptsDir()
  const hookScript = join(scriptsDir, "cursor-hook.ts")

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
            entry.command.includes(hookScript)
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
          const command = `bun run ${hookScript} ${event}`
          if (!hooks[event]) hooks[event] = []

          // Remove stale entries, then add current
          hooks[event] = (
            hooks[event] as Array<Record<string, unknown>>
          ).filter(
            (entry) =>
              !(
                typeof entry.command === "string" &&
                entry.command.includes("cursor-hook.ts")
              )
          )
          ;(hooks[event] as Array<Record<string, unknown>>).push({ command })
        }

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
