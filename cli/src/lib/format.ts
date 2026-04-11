import {
  styleSuccess,
  styleError,
  styleWarn,
  styleMuted,
} from "../cli-style.js"

const GREEN_STATUSES = new Set([
  "active",
  "running",
  "ready",
  "healthy",
  "production",
  "verified",
  "connected",
  "completed",
  "success",
  "idle",
])

const RED_STATUSES = new Set([
  "stopped",
  "disabled",
  "destroying",
  "destroyed",
  "failure",
  "failed",
  "cancelled",
  "timed_out",
  "error",
])

const YELLOW_STATUSES = new Set([
  "provisioning",
  "pending",
  "draining",
  "draft",
  "building",
  "staging",
  "creating",
  "connecting",
  "queued",
  "syncing",
  "deploying",
  "suspended",
])

/**
 * Format a status string with colored dot indicator.
 * "● active" (green), "● stopped" (red), "● provisioning" (yellow), "● unknown" (gray)
 */
export function formatStatus(status: string): string {
  const normalized = (status ?? "").toLowerCase().trim()
  const dot = "\u25cf"

  if (GREEN_STATUSES.has(normalized)) {
    return styleSuccess(`${dot} ${status}`)
  }
  if (RED_STATUSES.has(normalized)) {
    return styleError(`${dot} ${status}`)
  }
  if (YELLOW_STATUSES.has(normalized)) {
    return styleWarn(`${dot} ${status}`)
  }
  return styleMuted(`${dot} ${status}`)
}

/** Format bytes as human-readable string: 2147483648 → "2.0 GB" */
export function formatBytes(bytes: number): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "0 B"
  if (bytes === 0) return "0 B"

  const units = ["B", "KB", "MB", "GB", "TB"]
  let unitIndex = 0
  let value = bytes

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }

  return unitIndex === 0
    ? `${Math.round(value)} ${units[unitIndex]}`
    : `${value.toFixed(1)} ${units[unitIndex]}`
}

/** Format bytes compact: 2147483648 → "2G" */
export function formatBytesCompact(bytes: number): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "0B"
  if (bytes === 0) return "0B"

  const units: Array<[number, string]> = [
    [1024 ** 4, "T"],
    [1024 ** 3, "G"],
    [1024 ** 2, "M"],
    [1024, "K"],
  ]

  for (const [threshold, suffix] of units) {
    if (bytes >= threshold) {
      const value = bytes / threshold
      return Number.isInteger(value)
        ? `${value}${suffix}`
        : `${parseFloat(value.toFixed(1))}${suffix}`
    }
  }

  return `${bytes}B`
}

/** Format duration from seconds: 3900 → "1h 5m", 45 → "45s", 90000 → "1d 1h" */
export function formatDuration(seconds: number): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "0s"
  if (seconds === 0) return "0s"

  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)
  if (secs > 0 && days === 0) parts.push(`${secs}s`)

  return parts.length > 0 ? parts.slice(0, 2).join(" ") : "0s"
}

/** Format resource spec compact: ("2000m", "4Gi", 20) → "2c/4Gi/20G" */
export function formatResourceSpec(
  cpu: string | null | undefined,
  mem: string | null | undefined,
  diskGb: number | null | undefined
): string {
  const parts: string[] = []

  if (cpu != null && cpu !== "") {
    parts.push(formatCpu(cpu))
  } else {
    parts.push("-")
  }

  if (mem != null && mem !== "") {
    parts.push(mem)
  } else {
    parts.push("-")
  }

  if (diskGb != null && diskGb > 0) {
    parts.push(`${diskGb}G`)
  } else {
    parts.push("-")
  }

  return parts.join("/")
}

function formatCpu(cpu: string): string {
  const milliMatch = cpu.match(/^(\d+)m$/)
  if (milliMatch) {
    const millis = parseInt(milliMatch[1], 10)
    const cores = millis / 1000
    return Number.isInteger(cores)
      ? `${cores}c`
      : `${parseFloat(cores.toFixed(1))}c`
  }

  const numericMatch = cpu.match(/^(\d+(?:\.\d+)?)$/)
  if (numericMatch) {
    return `${numericMatch[1]}c`
  }

  return cpu
}

/** Parse memory string to bytes: "2G" → 2147483648, "512M" → 536870912, "4Gi" → 4294967296 */
export function parseMemoryString(mem: string): number {
  if (mem == null || mem === "") return 0

  const match = mem.trim().match(/^(\d+(?:\.\d+)?)\s*(.*?)$/)
  if (!match) return 0

  const value = parseFloat(match[1])
  if (!Number.isFinite(value) || value < 0) return 0

  const unit = match[2].toLowerCase()

  const multipliers: Record<string, number> = {
    "": 1,
    b: 1,
    k: 1024,
    kb: 1024,
    ki: 1024,
    kib: 1024,
    m: 1024 ** 2,
    mb: 1024 ** 2,
    mi: 1024 ** 2,
    mib: 1024 ** 2,
    g: 1024 ** 3,
    gb: 1024 ** 3,
    gi: 1024 ** 3,
    gib: 1024 ** 3,
    t: 1024 ** 4,
    tb: 1024 ** 4,
    ti: 1024 ** 4,
    tib: 1024 ** 4,
  }

  const multiplier = multipliers[unit]
  if (multiplier == null) return 0

  return Math.round(value * multiplier)
}
