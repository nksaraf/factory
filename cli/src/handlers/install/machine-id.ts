/**
 * Cross-platform machine identifier.
 *
 * Returns a stable, unique-per-machine string used to derive
 * the workbench ID. Supports macOS, Linux, and Windows.
 */

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { platform } from "node:os"
import { randomUUID } from "node:crypto"
import { configDir } from "@crustjs/store"

let cached: string | undefined

/** Read macOS IOPlatformUUID via ioreg. */
function darwinId(): string | undefined {
  const proc = spawnSync("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], {
    encoding: "utf8",
    timeout: 5_000,
  })
  if (proc.status !== 0) return undefined
  const match = proc.stdout.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)
  return match?.[1]
}

/** Read /etc/machine-id (systemd) or /var/lib/dbus/machine-id. */
function linuxId(): string | undefined {
  for (const p of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
    try {
      const id = readFileSync(p, "utf8").trim()
      if (id.length > 0) return id
    } catch {
      // try next
    }
  }
  return undefined
}

/** Read Windows MachineGuid from the registry. */
function windowsId(): string | undefined {
  const proc = spawnSync(
    "reg",
    ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"],
    { encoding: "utf8", timeout: 5_000 }
  )
  if (proc.status !== 0) return undefined
  const match = proc.stdout.match(/MachineGuid\s+REG_SZ\s+(\S+)/)
  return match?.[1]
}

/** Fallback: generate a random UUID and persist it to ~/.config/dx/machine-id. */
function fallbackId(): string {
  const dir = configDir("dx")
  const file = join(dir, "machine-id")
  try {
    const existing = readFileSync(file, "utf8").trim()
    if (existing.length > 0) return existing
  } catch {
    // not yet created
  }
  const id = randomUUID()
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, id, { mode: 0o600 })
  return id
}

/**
 * Get a stable machine identifier for the current platform.
 * Result is cached for the lifetime of the process.
 */
export function getMachineId(): string {
  if (cached) return cached

  const os = platform()
  let id: string | undefined

  if (os === "darwin") {
    id = darwinId()
  } else if (os === "win32") {
    id = windowsId()
  } else {
    id = linuxId()
  }

  cached = id ?? fallbackId()
  return cached
}
