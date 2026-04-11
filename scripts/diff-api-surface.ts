#!/usr/bin/env bun
/**
 * Diff two OpenAPI specs (or route dumps) to find missing/changed/new endpoints.
 *
 * Usage:
 *   bun run scripts/diff-api-surface.ts snapshots/v1-openapi.json snapshots/v2-openapi.json
 *
 * Reports:
 *   - Missing endpoints (in v1 but not v2)
 *   - Changed endpoints (same path, different methods or shapes)
 *   - New endpoints (in v2 but not v1)
 */

import { readFileSync } from "fs"

const [, , v1Path, v2Path] = process.argv

if (!v1Path || !v2Path) {
  console.error(
    "Usage: bun run scripts/diff-api-surface.ts <v1-spec.json> <v2-spec.json>"
  )
  process.exit(1)
}

interface RouteEntry {
  method: string
  path: string
  tags?: string[]
  summary?: string
  requestBody?: boolean
  parameters?: string[]
}

function loadRoutes(filePath: string): Map<string, RouteEntry> {
  const raw = JSON.parse(readFileSync(filePath, "utf-8"))

  // Handle both OpenAPI spec format and flat route array format
  let routes: RouteEntry[]
  if (raw.paths) {
    // OpenAPI format
    routes = []
    for (const [path, methods] of Object.entries(raw.paths)) {
      for (const [method, details] of Object.entries(methods as any)) {
        if (method === "parameters") continue
        const d = details as any
        routes.push({
          method: method.toUpperCase(),
          path,
          tags: d.tags,
          summary: d.summary,
          requestBody: !!d.requestBody,
          parameters: d.parameters?.map((p: any) => `${p.in}:${p.name}`),
        })
      }
    }
  } else if (Array.isArray(raw)) {
    routes = raw
  } else if (raw.tables) {
    console.error(
      "This looks like an entity inventory, not an API surface spec."
    )
    process.exit(1)
  } else {
    routes = raw.routes ?? []
  }

  const map = new Map<string, RouteEntry>()
  for (const r of routes) {
    map.set(`${r.method} ${r.path}`, r)
  }
  return map
}

const v1Routes = loadRoutes(v1Path)
const v2Routes = loadRoutes(v2Path)

const missing: string[] = []
const changed: string[] = []
const added: string[] = []

// Find missing and changed
for (const [key, v1] of v1Routes) {
  const v2 = v2Routes.get(key)
  if (!v2) {
    missing.push(key)
  } else {
    // Compare basic shape
    const diffs: string[] = []
    if (v1.requestBody !== v2.requestBody) diffs.push("requestBody changed")
    if (
      JSON.stringify(v1.parameters?.sort()) !==
      JSON.stringify(v2.parameters?.sort())
    ) {
      diffs.push("parameters changed")
    }
    if (diffs.length > 0) {
      changed.push(`${key}: ${diffs.join(", ")}`)
    }
  }
}

// Find new
for (const key of v2Routes.keys()) {
  if (!v1Routes.has(key)) {
    added.push(key)
  }
}

// Report
console.log("=== API Surface Diff ===\n")

if (missing.length === 0) {
  console.log("MISSING ENDPOINTS: 0 (all v1 endpoints covered)")
} else {
  console.log(`MISSING ENDPOINTS: ${missing.length} (in v1 but NOT in v2)`)
  console.log(
    "  These must be in MIGRATION.md 'Intentionally removed' or it's a bug:"
  )
  for (const m of missing.sort()) {
    console.log(`  - ${m}`)
  }
}

console.log()

if (changed.length === 0) {
  console.log("CHANGED ENDPOINTS: 0")
} else {
  console.log(`CHANGED ENDPOINTS: ${changed.length}`)
  for (const c of changed.sort()) {
    console.log(`  - ${c}`)
  }
}

console.log()

console.log(
  `NEW ENDPOINTS: ${added.length} (in v2 only — expected for actions, relations)`
)
if (added.length > 0 && process.argv.includes("--verbose")) {
  for (const a of added.sort()) {
    console.log(`  + ${a}`)
  }
}

console.log()
console.log(
  `Summary: v1=${v1Routes.size} routes, v2=${v2Routes.size} routes, missing=${missing.length}, changed=${changed.length}, new=${added.length}`
)

if (missing.length > 0) {
  process.exit(1) // Non-zero exit = migration gaps found
}
