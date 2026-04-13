import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { upsertDotfile } from "./file-utils.js"
import type { ConfigProvider, ConfigChange } from "./types.js"

const NPMRC_PATH = join(homedir(), ".npmrc")

const NPM_DEFAULTS: Record<string, string> = {
  "save-exact": "true",
  "engine-strict": "true",
  fund: "false",
  "audit-level": "high",
  loglevel: "warn",
  "prefer-offline": "true",
}

const NPM_CACHE_HOST = "npm-cache.internal"

const NPM_CACHE_DEFAULTS: Record<string, string> = {
  registry: `http://${NPM_CACHE_HOST}:4873`,
  "@lepton:registry": `http://${NPM_CACHE_HOST}:4873`,
  "@rio.js:registry": `http://${NPM_CACHE_HOST}:4873`,
}

async function isNpmCacheReachable(): Promise<boolean> {
  try {
    const res = await fetch(`http://${NPM_CACHE_HOST}:4873/-/ping`, {
      signal: AbortSignal.timeout(2000),
    })
    return res.ok
  } catch {
    return false
  }
}

function parseNpmrc(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) continue
    const eq = trimmed.indexOf("=")
    if (eq > 0) {
      result[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
    }
  }
  return result
}

export const npmDefaultsProvider: ConfigProvider = {
  name: "npm defaults (~/.npmrc)",
  category: "npm",
  roles: ["workbench"],

  async detect(): Promise<ConfigChange[]> {
    const existing = existsSync(NPMRC_PATH)
      ? parseNpmrc(readFileSync(NPMRC_PATH, "utf8"))
      : {}

    const changes: ConfigChange[] = Object.entries(NPM_DEFAULTS).map(
      ([key, value]) => ({
        id: `npm:${key}`,
        category: "npm" as const,
        description: `${key}=${value}`,
        target: NPMRC_PATH,
        currentValue: existing[key] ?? null,
        proposedValue: value,
        alreadyApplied: existing[key] === value,
        requiresSudo: false,
        platform: null,
        apply: async () => upsertDotfile(NPMRC_PATH, key, value),
      })
    )

    const cacheAvailable = await isNpmCacheReachable()
    if (cacheAvailable) {
      for (const [key, value] of Object.entries(NPM_CACHE_DEFAULTS)) {
        changes.push({
          id: `npm:${key}`,
          category: "npm" as const,
          description: `${key}=${value} (local cache)`,
          target: NPMRC_PATH,
          currentValue: existing[key] ?? null,
          proposedValue: value,
          alreadyApplied: existing[key] === value,
          requiresSudo: false,
          platform: null,
          apply: async () => upsertDotfile(NPMRC_PATH, key, value),
        })
      }
    }

    return changes
  },
}
