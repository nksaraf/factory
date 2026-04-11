/**
 * Lightweight CLI logger with level control.
 *
 * Level precedence:
 *   1. DX_LOG_LEVEL env var (explicit override)
 *   2. --verbose / -v flag → "debug"
 *   3. --quiet / -q flag → "warn"
 *   4. Default → "info"
 *
 * `debug` / `info` / `warn` / `error` always use **stderr** so stdout can stay
 * JSON-only when `--json` is set (see `cli-output.ts`).
 *
 * For a single line that would otherwise be `console.log` but must not steal stdout
 * under `--json`, use **`cliLine`** from `cli-output.ts`.
 */
import { styleMuted } from "../cli-style.js"

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 } as const
type LogLevel = keyof typeof LEVELS

function resolveLevel(): LogLevel {
  const env = process.env.DX_LOG_LEVEL
  if (env && env in LEVELS) return env as LogLevel
  if (process.argv.includes("--verbose") || process.argv.includes("-v"))
    return "debug"
  if (process.argv.includes("--quiet") || process.argv.includes("-q"))
    return "warn"
  return "info"
}

const currentLevel = resolveLevel()
const threshold = LEVELS[currentLevel]

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= threshold
}

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
    .join(" ")
}

export const log = {
  /** Current log level. */
  level: currentLevel,

  /** Verbose progress — only shown with --verbose or DX_LOG_LEVEL=debug. */
  debug(...args: unknown[]) {
    if (shouldLog("debug"))
      console.error(styleMuted(`  [debug] ${formatArgs(args)}`))
  },

  /** Normal progress messages (e.g., "Creating workbench..."). */
  info(...args: unknown[]) {
    if (shouldLog("info")) console.error(`  ${formatArgs(args)}`)
  },

  /** Something unexpected but non-fatal. */
  warn(...args: unknown[]) {
    if (shouldLog("warn")) console.error(`  ⚠ ${formatArgs(args)}`)
  },

  /** Fatal errors — always shown (unless level=silent). */
  error(...args: unknown[]) {
    if (shouldLog("error")) console.error(`  ✖ ${formatArgs(args)}`)
  },

  /** Whether the given level would produce output. */
  isEnabled(level: LogLevel): boolean {
    return shouldLog(level)
  },
}
