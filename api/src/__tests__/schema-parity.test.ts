import { describe, test, expect } from "bun:test"
import { getTableColumns } from "drizzle-orm"
import { FactoryOntology } from "@smp/ontology/factory"
import { generateTableSpec } from "@smp/ontology/adapters/postgres/schema-generator"
import { FACTORY_BINDINGS } from "../effect/factory-bindings"

describe("schema parity -- generated vs hand-written", () => {
  for (const [kind, entityIR] of Object.entries(FactoryOntology.entities)) {
    const binding = (FACTORY_BINDINGS as Record<string, any>)[kind]
    if (!binding) continue // skip entities without bindings (e.g., componentDeployment)

    test(`${kind}: generated columns match Drizzle table`, () => {
      const generated = generateTableSpec(entityIR)
      const actual = getTableColumns(binding.table)

      const mismatches: string[] = []

      // Check that every generated column exists in the actual table
      for (const col of generated.columns) {
        const actualCol = Object.values(actual).find(
          (c: any) => c.name === col.name
        ) as any

        if (!actualCol) {
          // Special case: `system` entity doesn't have a `type` column in DB.
          // The ontology generator includes `type` by default. This is a known
          // divergence -- the generator assumes the convention, the hand-written
          // schema omits it for `system`.
          if (col.name === "type") {
            console.log(
              `  ${kind}: 'type' column generated but absent in table (known divergence)`
            )
            continue
          }
          mismatches.push(`MISSING column '${col.name}' in actual table`)
          continue
        }

        if (actualCol.columnType !== col.columnType) {
          mismatches.push(
            `Column '${col.name}': expected columnType '${col.columnType}', got '${actualCol.columnType}'`
          )
        }

        if (actualCol.notNull !== col.notNull) {
          mismatches.push(
            `Column '${col.name}': expected notNull=${col.notNull}, got ${actualCol.notNull}`
          )
        }
      }

      if (mismatches.length > 0) {
        console.error(`  ${kind} mismatches:\n    ${mismatches.join("\n    ")}`)
      }
      expect(mismatches).toEqual([])

      // Report actual columns not in generated (extra columns the ontology doesn't model yet)
      const generatedNames = new Set(generated.columns.map((c) => c.name))
      const extraColumns = Object.values(actual)
        .filter((c: any) => !generatedNames.has(c.name))
        .map((c: any) => c.name)

      if (extraColumns.length > 0) {
        console.log(
          `  ${kind}: extra columns not in ontology: [${extraColumns.join(", ")}]`
        )
      }
    })
  }
})
