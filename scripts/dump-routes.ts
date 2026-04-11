#!/usr/bin/env bun
/**
 * Extract the Elysia route tree from the factory API.
 *
 * Usage:
 *   bun run scripts/dump-routes.ts > snapshots/v1-routes.json
 *
 * Outputs a JSON array of { method, path, tags?, summary? } objects
 * by introspecting the Elysia app's internal route metadata.
 *
 * If the app requires a DB connection, set DATABASE_URL or it will
 * fall back to extracting routes from the OpenAPI spec file if available.
 */
import { existsSync, readFileSync } from "fs"
import { resolve } from "path"

// Try to extract from an existing OpenAPI JSON file first (fastest)
const openApiPath = resolve(import.meta.dir, "../snapshots/v1-openapi.json")
if (existsSync(openApiPath)) {
  const spec = JSON.parse(readFileSync(openApiPath, "utf-8"))
  const routes = extractFromOpenApi(spec)
  console.log(JSON.stringify(routes, null, 2))
  process.exit(0)
}

// Otherwise, build the app and introspect
async function main() {
  // Set a dummy DATABASE_URL if not set — we just need the route tree, not a live DB
  if (!process.env.DATABASE_URL) {
    console.error(
      "No DATABASE_URL set. Attempting to extract routes from app structure...\n" +
        "For a complete snapshot, run with DATABASE_URL or first capture the OpenAPI spec:\n" +
        "  curl http://localhost:3000/api/v1/factory/openapi > snapshots/v1-openapi.json\n" +
        "  bun run scripts/dump-routes.ts"
    )
    process.exit(1)
  }

  try {
    const { FactoryAPI } = await import("../api/src/factory.api")
    const factory = await FactoryAPI.create()
    const app = factory.createApp()

    const routes: Array<{
      method: string
      path: string
      tags?: string[]
      summary?: string
    }> = []

    // Elysia stores routes in its internal router
    // Walk the route tree to extract method + path + metadata
    const routeEntries =
      (app as any).routes ?? (app as any).router?.routes ?? []
    for (const route of routeEntries) {
      routes.push({
        method: route.method?.toUpperCase() ?? "GET",
        path: route.path ?? route.url ?? "",
        tags: route.detail?.tags,
        summary: route.detail?.summary,
      })
    }

    // Sort for deterministic output
    routes.sort(
      (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method)
    )

    console.log(JSON.stringify(routes, null, 2))
    await factory.close()
  } catch (err) {
    console.error("Failed to build app for route extraction:", err)
    process.exit(1)
  }
}

function extractFromOpenApi(spec: any) {
  const routes: Array<{
    method: string
    path: string
    tags?: string[]
    summary?: string
    parameters?: string[]
    requestBody?: boolean
  }> = []

  const paths = spec.paths ?? {}
  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, details] of Object.entries(methods as any)) {
      if (method === "parameters") continue // path-level params
      const d = details as any
      routes.push({
        method: method.toUpperCase(),
        path,
        tags: d.tags,
        summary: d.summary,
        parameters: d.parameters?.map((p: any) => `${p.in}:${p.name}`),
        requestBody: !!d.requestBody,
      })
    }
  }

  routes.sort(
    (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method)
  )
  return routes
}

main()
