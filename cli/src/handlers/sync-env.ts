import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { readDotenv, writeDotenv } from "./pkg/registry.js"
import { localSecretGet } from "./secret-local-store.js"
import { localVarGet } from "./var-local-store.js"
import type { FactoryFetchClient } from "./factory-fetch.js"

export interface SyncEnvResult {
  created: boolean
  resolved: string[]
  unresolved: string[]
}

function parseEnvExample(
  filePath: string
): Array<{ key: string; value: string }> {
  const entries: Array<{ key: string; value: string }> = []
  for (const line of readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx < 0) continue
    entries.push({
      key: trimmed.slice(0, eqIdx).trim(),
      value: trimmed.slice(eqIdx + 1).trim(),
    })
  }
  return entries
}

async function getClient(): Promise<FactoryFetchClient | null> {
  try {
    const { getFactoryFetchClient } = await import("./factory-fetch.js")
    return await getFactoryFetchClient()
  } catch {
    return null
  }
}

async function resolveFromFactory(
  client: FactoryFetchClient | null,
  type: "secrets" | "vars",
  slug: string
): Promise<string | undefined> {
  if (!client) return undefined
  try {
    const res = await client.fetchApi(
      `/${type}/${encodeURIComponent(slug)}?scopeType=org&scopeId=default`
    )
    if (res.ok) {
      const data = (await res.json()) as { value: string }
      return data.value
    }
  } catch {
    // API call failed
  }
  return undefined
}

interface PendingResolution {
  key: string
  type: "secret" | "var"
  slug: string
}

export async function syncEnv(rootDir: string): Promise<SyncEnvResult> {
  const examplePath = join(rootDir, ".env.example")
  const envPath = join(rootDir, ".env")

  const declarations = parseEnvExample(examplePath)
  const fileExists = existsSync(envPath)
  const existing = fileExists ? readDotenv(rootDir) : {}
  const created = !fileExists

  const updates: Record<string, string> = {}
  const resolved: string[] = []
  const unresolved: string[] = []
  const pending: PendingResolution[] = []

  for (const { key, value } of declarations) {
    if (existing[key] !== undefined && existing[key] !== "") continue

    if (value.startsWith("secret:")) {
      const slug = value.slice("secret:".length)
      if (slug) {
        pending.push({ key, type: "secret", slug })
      } else {
        updates[key] = ""
        unresolved.push(key)
      }
    } else if (value.startsWith("var:")) {
      const slug = value.slice("var:".length)
      if (slug) {
        pending.push({ key, type: "var", slug })
      } else {
        updates[key] = ""
        unresolved.push(key)
      }
    } else {
      updates[key] = value
      resolved.push(key)
    }
  }

  if (pending.length > 0) {
    const client = await getClient()

    const results = await Promise.allSettled(
      pending.map(async ({ key, type, slug }) => {
        const factoryType = type === "secret" ? "secrets" : "vars"
        const val = await resolveFromFactory(client, factoryType, slug)
        if (val !== undefined) return { key, value: val, resolved: true }

        const localVal =
          type === "secret" ? localSecretGet(slug) : localVarGet(slug)
        if (localVal !== undefined)
          return { key, value: localVal, resolved: true }

        return { key, value: "", resolved: false }
      })
    )

    for (const result of results) {
      if (result.status === "rejected") continue
      const { key, value, resolved: ok } = result.value
      updates[key] = value
      if (ok) {
        resolved.push(key)
      } else {
        unresolved.push(key)
      }
    }
  }

  if (Object.keys(updates).length > 0) {
    writeDotenv(rootDir, updates)
  }

  return { created, resolved, unresolved }
}
