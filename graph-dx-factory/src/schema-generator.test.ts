import { describe, test, expect } from "bun:test"
import { DxFactoryGraph } from "./index"
import { generateTableSpec } from "@smp/graph/adapters/postgres/schema-generator"

function columnNames(spec: ReturnType<typeof generateTableSpec>): string[] {
  return spec.columns.map((c) => c.name)
}

function findCol(spec: ReturnType<typeof generateTableSpec>, name: string) {
  return spec.columns.find((c) => c.name === name)
}

describe("generateTableSpec", () => {
  test("estate: reconcilable entity with self-referencing FK", () => {
    const entity = DxFactoryGraph.entities["estate"]
    const spec = generateTableSpec(entity)

    expect(spec.tableName).toBe("estate")
    expect(spec.schema).toBe("infra")

    const names = columnNames(spec)

    // Identity columns
    expect(names).toContain("id")
    expect(names).toContain("slug")
    expect(names).toContain("name")
    expect(names).toContain("type")

    // FK from parent link
    expect(names).toContain("parent_estate_id")
    const parentFk = findCol(spec, "parent_estate_id")!
    expect(parentFk.columnType).toBe("PgText")
    expect(parentFk.notNull).toBe(false) // optional self-ref

    // Spec + metadata
    expect(names).toContain("spec")
    expect(names).toContain("metadata")

    // Timestamps
    expect(names).toContain("created_at")
    expect(names).toContain("updated_at")

    // Reconciliation columns (estate is reconcilable)
    expect(names).toContain("status")
    expect(names).toContain("generation")
    expect(names).toContain("observed_generation")

    // Should NOT have bitemporal columns
    expect(names).not.toContain("valid_from")
    expect(names).not.toContain("system_from")
  })

  test("team: bitemporal entity with self-referencing FK", () => {
    const entity = DxFactoryGraph.entities["team"]
    const spec = generateTableSpec(entity)

    expect(spec.tableName).toBe("team")
    expect(spec.schema).toBe("org")

    const names = columnNames(spec)

    // Identity
    expect(names).toContain("id")
    expect(names).toContain("slug")
    expect(names).toContain("name")

    // FK
    expect(names).toContain("parent_team_id")

    // Bitemporal columns
    expect(names).toContain("valid_from")
    expect(names).toContain("valid_to")
    expect(names).toContain("system_from")
    expect(names).toContain("system_to")
    expect(names).toContain("changed_by")
    expect(names).toContain("change_reason")

    // Bitemporal column nullability
    expect(findCol(spec, "valid_from")!.notNull).toBe(true)
    expect(findCol(spec, "valid_to")!.notNull).toBe(false)
    expect(findCol(spec, "system_from")!.notNull).toBe(true)
    expect(findCol(spec, "system_to")!.notNull).toBe(false)
    expect(findCol(spec, "changed_by")!.notNull).toBe(true)
    expect(findCol(spec, "change_reason")!.notNull).toBe(false)

    // Should NOT have reconciliation columns (team is not reconcilable)
    expect(names).not.toContain("generation")
    expect(names).not.toContain("observed_generation")
  })

  test("systemDeployment: required FKs + reconcilable", () => {
    const entity = DxFactoryGraph.entities["systemDeployment"]
    const spec = generateTableSpec(entity)

    expect(spec.tableName).toBe("system_deployment")
    expect(spec.schema).toBe("ops")

    const names = columnNames(spec)

    // Required FKs
    expect(names).toContain("system_id")
    expect(names).toContain("site_id")
    const systemFk = findCol(spec, "system_id")!
    const siteFk = findCol(spec, "site_id")!
    expect(systemFk.notNull).toBe(true)
    expect(siteFk.notNull).toBe(true)

    // Optional FK
    expect(names).toContain("realm_id")
    const realmFk = findCol(spec, "realm_id")!
    expect(realmFk.notNull).toBe(false)

    // Reconciliation
    expect(names).toContain("status")
    expect(names).toContain("generation")
    expect(names).toContain("observed_generation")

    // Metadata
    expect(names).toContain("metadata")
  })

  test("workbench: multiple optional FKs + reconcilable + bitemporal", () => {
    const entity = DxFactoryGraph.entities["workbench"]
    const spec = generateTableSpec(entity)

    expect(spec.tableName).toBe("workbench")
    expect(spec.schema).toBe("ops")

    const names = columnNames(spec)

    // FKs from links
    expect(names).toContain("site_id")
    expect(names).toContain("host_id")
    expect(names).toContain("realm_id")
    expect(names).toContain("owner_id")

    // All are optional
    expect(findCol(spec, "site_id")!.notNull).toBe(false)
    expect(findCol(spec, "host_id")!.notNull).toBe(false)
    expect(findCol(spec, "realm_id")!.notNull).toBe(false)
    expect(findCol(spec, "owner_id")!.notNull).toBe(false)

    // Both reconcilable and bitemporal
    expect(names).toContain("status")
    expect(names).toContain("generation")
    expect(names).toContain("valid_from")
    expect(names).toContain("changed_by")
  })

  test("host: does not generate columns for one-to-many links", () => {
    const entity = DxFactoryGraph.entities["host"]
    const spec = generateTableSpec(entity)

    const names = columnNames(spec)

    // Has its own FK
    expect(names).toContain("estate_id")

    // Should NOT have any column from the estate's hosts one-to-many
    // (that link lives on estate, pointing to host via targetFk)
    const unexpectedReverseFks = names.filter(
      (n) => n.includes("host_id") && n !== "estate_id"
    )
    expect(unexpectedReverseFks).toHaveLength(0)
  })

  test("componentDeployment: required FKs without metadata", () => {
    const entity = DxFactoryGraph.entities["componentDeployment"]
    const spec = generateTableSpec(entity)

    expect(spec.tableName).toBe("component_deployment")
    expect(spec.schema).toBe("ops")

    const names = columnNames(spec)

    // Required FKs
    expect(names).toContain("system_deployment_id")
    expect(names).toContain("component_id")
    expect(findCol(spec, "system_deployment_id")!.notNull).toBe(true)
    expect(findCol(spec, "component_id")!.notNull).toBe(true)

    // Metadata should be present (componentDeployment has metadata: "standard")
    expect(names).toContain("metadata")
  })

  test("column type assignments are correct", () => {
    const entity = DxFactoryGraph.entities["site"]
    const spec = generateTableSpec(entity)

    expect(findCol(spec, "id")!.columnType).toBe("PgText")
    expect(findCol(spec, "spec")!.columnType).toBe("PgJsonb")
    expect(findCol(spec, "metadata")!.columnType).toBe("PgJsonb")
    expect(findCol(spec, "created_at")!.columnType).toBe("PgTimestamp")
    expect(findCol(spec, "updated_at")!.columnType).toBe("PgTimestamp")
    expect(findCol(spec, "status")!.columnType).toBe("PgJsonb")
    expect(findCol(spec, "generation")!.columnType).toBe("PgBigInt53")
    expect(findCol(spec, "valid_from")!.columnType).toBe("PgTimestamp")
    expect(findCol(spec, "changed_by")!.columnType).toBe("PgText")
  })
})
