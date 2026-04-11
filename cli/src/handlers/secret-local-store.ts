/**
 * Local secret store at ~/.config/dx/secrets.json.
 *
 * Stores secrets as a flat Record<string, string> in a JSON file.
 * File permissions set to 0600 (owner read/write only).
 * Used as a fallback when not connected to Factory API.
 */

import fs from "node:fs"
import path from "node:path"
import { configDir } from "@crustjs/store"

const DX_CONFIG_DIR = configDir("dx")
const SECRETS_FILE = path.join(DX_CONFIG_DIR, "secrets.json")

function ensureDir(): void {
  fs.mkdirSync(DX_CONFIG_DIR, { recursive: true })
}

function readAll(): Record<string, string> {
  try {
    const raw = fs.readFileSync(SECRETS_FILE, "utf8")
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function writeAll(secrets: Record<string, string>): void {
  ensureDir()
  fs.writeFileSync(SECRETS_FILE, JSON.stringify(secrets, null, 2), {
    mode: 0o600,
  })
}

export function localSecretSet(key: string, value: string): void {
  const secrets = readAll()
  secrets[key] = value
  writeAll(secrets)
}

export function localSecretGet(key: string): string | undefined {
  return readAll()[key]
}

export function localSecretList(): Array<{ key: string }> {
  return Object.keys(readAll()).map((key) => ({ key }))
}

export function localSecretRemove(key: string): boolean {
  const secrets = readAll()
  if (!(key in secrets)) return false
  delete secrets[key]
  writeAll(secrets)
  return true
}

/** Set multiple keys in a single read-modify-write cycle. */
export function localSecretSetMany(updates: Record<string, string>): void {
  const secrets = readAll()
  Object.assign(secrets, updates)
  writeAll(secrets)
}

/** Load all local secrets as a flat env-compatible record. */
export function loadLocalSecrets(): Record<string, string> {
  return readAll()
}
