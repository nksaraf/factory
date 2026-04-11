#!/usr/bin/env bun
/**
 * Extract a machine-diffable inventory of all Drizzle table definitions.
 *
 * Usage:
 *   bun run scripts/entity-inventory.ts
 *
 * Outputs JSON: { tables: [{ schema, name, columns: [...], indexes: [...] }] }
 *
 * Strategy: import all schema files and use drizzle-orm's getTableColumns() / getTableName()
 * to extract the full structure.
 */

import { getTableColumns, getTableName, is } from "drizzle-orm"
import { PgTable } from "drizzle-orm/pg-core"

interface ColumnInfo {
  name: string
  sqlName: string
  type: string
  nullable: boolean
  primaryKey: boolean
  hasDefault: boolean
}

interface TableInfo {
  schema: string
  tableName: string
  exportName: string
  columns: ColumnInfo[]
}

async function extractTables(): Promise<TableInfo[]> {
  const tables: TableInfo[] = []

  const software = await import("../api/src/db/schema/software")
  const org = await import("../api/src/db/schema/org")
  const infra = await import("../api/src/db/schema/infra")
  const ops = await import("../api/src/db/schema/ops")
  const build = await import("../api/src/db/schema/build")
  const commerce = await import("../api/src/db/schema/commerce")

  for (const [label, mod] of Object.entries({
    software,
    org,
    infra,
    ops,
    build,
    commerce,
  })) {
    extractFromModule(mod, label, tables)
  }

  tables.sort(
    (a, b) =>
      a.schema.localeCompare(b.schema) || a.tableName.localeCompare(b.tableName)
  )
  return tables
}

function extractFromModule(
  mod: Record<string, unknown>,
  schemaLabel: string,
  tables: TableInfo[]
) {
  for (const [exportName, value] of Object.entries(mod)) {
    // Skip non-table exports (pgSchema instances, relations, etc.)
    if (!value || typeof value !== "object") continue
    if (!is(value, PgTable)) continue

    try {
      const cols = getTableColumns(value as PgTable)
      const tableName = getTableName(value as PgTable)

      const columns: ColumnInfo[] = Object.entries(cols).map(([key, col]) => {
        const c = col as any
        return {
          name: key,
          sqlName: c.name ?? key,
          type: c.dataType ?? c.columnType ?? "unknown",
          nullable: !c.notNull,
          primaryKey: !!c.primary,
          hasDefault: c.hasDefault ?? false,
        }
      })

      tables.push({
        schema: schemaLabel,
        tableName,
        exportName,
        columns,
      })
    } catch {
      // Not a valid table — skip
    }
  }
}

async function main() {
  const tables = await extractTables()
  const summary = {
    capturedAt: new Date().toISOString(),
    tableCount: tables.length,
    tables,
  }
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((err) => {
  console.error("Failed to extract entity inventory:", err)
  process.exit(1)
})
