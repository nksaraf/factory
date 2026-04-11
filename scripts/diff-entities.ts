#!/usr/bin/env bun
/**
 * Diff two entity inventory files to find missing/changed/new tables and columns.
 *
 * Usage:
 *   bun run scripts/diff-entities.ts <baseline.json> <candidate.json>
 *   (e.g. older snapshot vs current `entity-inventory` output)
 *
 * Reports:
 *   - Missing tables (in baseline but not candidate, after rename map)
 *   - Missing columns (baseline column absent from candidate table or its spec JSONB)
 *   - New tables (candidate only)
 *   - Column type changes
 */
import { readFileSync } from "fs"

const [, , v1Path, v2Path] = process.argv

if (!v1Path || !v2Path) {
  console.error(
    "Usage: bun run scripts/diff-entities.ts <baseline-entities.json> <candidate-entities.json>"
  )
  process.exit(1)
}

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

interface Inventory {
  version: string
  tableCount: number
  tables: TableInfo[]
}

function loadInventory(filePath: string): Inventory {
  return JSON.parse(readFileSync(filePath, "utf-8"))
}

// Known table renames: legacy tableName → current tableName
const TABLE_RENAMES: Record<string, string> = {
  module: "system",
  module_version: "release",
  component_spec: "component",
  deployment_target: "system_deployment",
  workload: "component_deployment",
  sandbox: "workbench",
  sandbox_snapshot: "workbench_snapshot",
  cluster: "realm",
  provider: "estate",
  subnet: "__removed__",
  entitlement: "subscription",
  gateway_route: "route",
  gateway_domain: "dns_domain",
}

// Known columns that moved into spec JSONB (v1 column → "in spec")
const COLUMNS_IN_SPEC = new Set([
  // Columns that existed as flat fields historically but now live inside spec JSONB
  // Add entries as we discover them during migration
])

const v1 = loadInventory(v1Path)
const v2 = loadInventory(v2Path)

// Build lookup maps
const v1Tables = new Map<string, TableInfo>()
for (const t of v1.tables) {
  v1Tables.set(t.tableName, t)
}

const v2Tables = new Map<string, TableInfo>()
for (const t of v2.tables) {
  v2Tables.set(t.tableName, t)
}

const missingTables: string[] = []
const missingColumns: string[] = []
const typeChanges: string[] = []
const newTables: string[] = []

// Find missing tables and columns
for (const [v1Name, v1Table] of v1Tables) {
  const v2Name = TABLE_RENAMES[v1Name] ?? v1Name

  if (v2Name === "__removed__") {
    // Intentionally removed — skip
    continue
  }

  const v2Table = v2Tables.get(v2Name)
  if (!v2Table) {
    missingTables.push(`${v1Name} (expected as ${v2Name} in candidate)`)
    continue
  }

  // Compare columns
  const v2ColMap = new Map(v2Table.columns.map((c) => [c.sqlName, c]))

  for (const v1Col of v1Table.columns) {
    // Skip standard metadata columns that may have been renamed
    if (["created_at", "updated_at", "deleted_at"].includes(v1Col.sqlName))
      continue

    const v2Col = v2ColMap.get(v1Col.sqlName)
    if (!v2Col) {
      // Check if this column is known to be in spec JSONB
      const specKey = `${v1Name}.${v1Col.sqlName}`
      if (COLUMNS_IN_SPEC.has(specKey)) continue

      // Check if candidate table has a spec column (JSONB catch-all)
      const hasSpec = v2ColMap.has("spec")
      const hint = hasSpec ? " (may be in spec JSONB — verify manually)" : ""
      missingColumns.push(`${v1Name}.${v1Col.sqlName} → ${v2Name}${hint}`)
      continue
    }

    // Check type changes
    if (v1Col.type !== v2Col.type) {
      typeChanges.push(
        `${v1Name}.${v1Col.sqlName}: ${v1Col.type} → ${v2Col.type} (in ${v2Name})`
      )
    }
  }
}

// Find new tables
for (const v2Name of v2Tables.keys()) {
  // Check if any baseline table maps to this name
  const isRenamed = Object.values(TABLE_RENAMES).includes(v2Name)
  const existsInV1 = v1Tables.has(v2Name)
  if (!isRenamed && !existsInV1) {
    newTables.push(v2Name)
  }
}

// Report
console.log("=== Entity Inventory Diff ===\n")

console.log(`V1: ${v1.tableCount} tables, V2: ${v2.tableCount} tables\n`)

if (missingTables.length === 0) {
  console.log("MISSING TABLES: 0 (all v1 tables accounted for)")
} else {
  console.log(`MISSING TABLES: ${missingTables.length}`)
  console.log(
    "  These must be in MIGRATION.md 'Intentionally removed' or it's a bug:"
  )
  for (const t of missingTables.sort()) {
    console.log(`  - ${t}`)
  }
}

console.log()

if (missingColumns.length === 0) {
  console.log("MISSING COLUMNS: 0")
} else {
  console.log(`MISSING COLUMNS: ${missingColumns.length}`)
  console.log("  Verify each is either in spec JSONB or intentionally removed:")
  for (const c of missingColumns.sort()) {
    console.log(`  - ${c}`)
  }
}

console.log()

if (typeChanges.length === 0) {
  console.log("TYPE CHANGES: 0")
} else {
  console.log(`TYPE CHANGES: ${typeChanges.length}`)
  for (const c of typeChanges.sort()) {
    console.log(`  ~ ${c}`)
  }
}

console.log()

console.log(`NEW TABLES: ${newTables.length} (v2 only)`)
if (newTables.length > 0 && process.argv.includes("--verbose")) {
  for (const t of newTables.sort()) {
    console.log(`  + ${t}`)
  }
}

console.log()
console.log(
  `Summary: missing_tables=${missingTables.length}, missing_columns=${missingColumns.length}, type_changes=${typeChanges.length}, new_tables=${newTables.length}`
)

if (missingTables.length > 0 || missingColumns.length > 0) {
  process.exit(1) // Non-zero = gaps found
}
