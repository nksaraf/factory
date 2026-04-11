#!/usr/bin/env bun
/**
 * Extract a machine-diffable inventory of all Drizzle table definitions.
 *
 * Usage:
 *   bun run scripts/entity-inventory.ts              # v1 schemas
 *   bun run scripts/entity-inventory.ts --v2         # v2 schemas
 *
 * Outputs JSON: { tables: [{ schema, name, columns: [{ name, type, nullable, primaryKey, references?, defaultFn? }], indexes: [...] }] }
 *
 * Strategy: import all schema files and use drizzle-orm's getTableColumns() / getTableName()
 * to extract the full structure.
 */

import { getTableColumns, getTableName, is } from "drizzle-orm"
import { PgTable } from "drizzle-orm/pg-core"

const isV2 = process.argv.includes("--v2")

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

  if (isV2) {
    // V2 schemas
    const softwareV2 = await import("../api/src/db/schema/software-v2")
    const orgV2 = await import("../api/src/db/schema/org-v2")
    const infraV2 = await import("../api/src/db/schema/infra-v2")
    const ops = await import("../api/src/db/schema/ops")
    const buildV2 = await import("../api/src/db/schema/build-v2")
    const commerceV2 = await import("../api/src/db/schema/commerce-v2")

    for (const [label, mod] of Object.entries({
      software: softwareV2,
      org: orgV2,
      infra: infraV2,
      ops,
      build: buildV2,
      commerce: commerceV2,
    })) {
      extractFromModule(mod, label, tables)
    }
  } else {
    throw new Error("entity-inventory requires --v2")
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
    version: isV2 ? "v2" : "v1",
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
