import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import type { LogEntry, LogLevel } from "@smp/factory-shared/observability-types"

export interface DockerLogStreamOptions {
  composeFile: string
  services?: string[]
  follow?: boolean
  since?: string
  tail?: number
  signal?: AbortSignal
}

/**
 * Parse a single docker compose log line into a LogEntry.
 *
 * Docker compose log format (with --no-log-prefix off, the default):
 *   container-name  | message text here
 *
 * If the message text is valid JSON with a "level" field, extract structured data.
 */
export function parseDockerLogLine(line: string): LogEntry {
  const now = new Date().toISOString()

  // Match "container-name  | rest"
  const pipeIdx = line.indexOf(" | ")
  let source = ""
  let message = line

  if (pipeIdx !== -1) {
    source = line.slice(0, pipeIdx).trim()
    message = line.slice(pipeIdx + 3)
  }

  // Try JSON parse for structured logs
  const trimmed = message.trim()
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed)
      return {
        timestamp: parsed.time ?? parsed.timestamp ?? parsed.ts ?? now,
        level: normalizeLevel(parsed.level ?? parsed.severity ?? "info"),
        message: parsed.msg ?? parsed.message ?? trimmed,
        source,
        attributes: extractAttributes(parsed),
        traceId: parsed.traceId ?? parsed.trace_id,
        spanId: parsed.spanId ?? parsed.span_id,
      }
    } catch {
      // not JSON — fall through
    }
  }

  return {
    timestamp: now,
    level: "info",
    message: message.trim(),
    source,
    attributes: {},
  }
}

function normalizeLevel(raw: string): LogLevel {
  const lower = raw.toLowerCase()
  if (lower === "fatal" || lower === "60") return "fatal"
  if (lower === "error" || lower === "err" || lower === "50") return "error"
  if (lower === "warn" || lower === "warning" || lower === "40") return "warn"
  if (lower === "info" || lower === "30") return "info"
  if (lower === "debug" || lower === "20" || lower === "trace" || lower === "10") return "debug"
  return "info"
}

function extractAttributes(parsed: Record<string, unknown>): Record<string, string> {
  const skip = new Set([
    "time", "timestamp", "ts", "level", "severity",
    "msg", "message", "traceId", "trace_id", "spanId", "span_id",
  ])
  const attrs: Record<string, string> = {}
  for (const [k, v] of Object.entries(parsed)) {
    if (skip.has(k)) continue
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      attrs[k] = String(v)
    }
  }
  return attrs
}

/**
 * Stream Docker Compose logs as LogEntry events.
 * Resolves when the stream ends (or signal is aborted).
 */
export function streamDockerLogs(
  opts: DockerLogStreamOptions,
  onEntry: (entry: LogEntry) => void
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const args = ["compose", "-f", opts.composeFile, "logs"]
    if (opts.follow) args.push("--follow")
    if (opts.since) args.push("--since", opts.since)
    if (opts.tail !== undefined) args.push("--tail", String(opts.tail))
    args.push("--no-log-prefix")
    if (opts.services?.length) args.push(...opts.services)

    const proc = spawn("docker", args, {
      stdio: ["ignore", "pipe", "pipe"],
    })

    const rl = createInterface({ input: proc.stdout! })
    rl.on("line", (line) => {
      if (line.trim()) onEntry(parseDockerLogLine(line))
    })

    // Also capture stderr lines as error-level entries
    const rlErr = createInterface({ input: proc.stderr! })
    rlErr.on("line", (line) => {
      if (line.trim()) {
        onEntry({
          timestamp: new Date().toISOString(),
          level: "error",
          message: line.trim(),
          source: "docker",
          attributes: {},
        })
      }
    })

    proc.on("close", () => {
      rl.close()
      rlErr.close()
      resolve()
    })

    proc.on("error", (err) => {
      rl.close()
      rlErr.close()
      reject(err)
    })

    if (opts.signal) {
      opts.signal.addEventListener("abort", () => {
        proc.kill("SIGTERM")
      })
    }
  })
}
