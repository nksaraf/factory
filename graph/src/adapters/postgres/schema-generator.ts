import type { EntityIR, LinkIR } from "../../schema/ir"

export interface ColumnSpec {
  name: string // DB column name (snake_case)
  columnType: string // Drizzle column type: "PgText", "PgJsonb", "PgTimestamp", "PgBigInt53"
  notNull: boolean
  hasDefault: boolean
}

export interface TableSpec {
  tableName: string // e.g., "estate", "system_deployment"
  schema: string // e.g., "infra", "ops"
  columns: ColumnSpec[]
}

/** Convert camelCase/kebab-case to snake_case. */
function toSnakeCase(s: string): string {
  return s
    .replace(/-/g, "_")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
}

/** Check if the metadata schema has actual properties (i.e. not an empty object). */
function hasMetadataProperties(entity: EntityIR): boolean {
  const meta = entity.schemas.metadata
  if (!meta) return false
  if (typeof meta !== "object") return false
  const props = (meta as Record<string, unknown>).properties
  return (
    props != null && typeof props === "object" && Object.keys(props).length > 0
  )
}

/**
 * Generate expected column specs from an EntityIR.
 *
 * Column generation rules:
 * 1. Always: id (PgText, PK, hasDefault), slug (PgText, notNull), name (PgText, notNull)
 * 2. Always: type (PgText, notNull) -- convention for all ontology tables
 * 3. If entity has many-to-one links with fk: generate FK column (PgText, nullable unless link.required)
 * 4. Always: spec (PgJsonb, notNull, hasDefault='{}')
 * 5. If metadata schema has properties: metadata (PgJsonb, notNull, hasDefault='{}')
 * 6. Always: created_at, updated_at (PgTimestamp, notNull, hasDefault)
 * 7. If reconciliation: status (PgJsonb, notNull, hasDefault), generation (PgBigInt53, notNull, hasDefault),
 *    observed_generation (PgBigInt53, notNull, hasDefault)
 * 8. If bitemporal: valid_from (PgTimestamp, notNull, hasDefault), valid_to (PgTimestamp, nullable),
 *    system_from (PgTimestamp, notNull, hasDefault), system_to (PgTimestamp, nullable),
 *    changed_by (PgText, notNull, hasDefault), change_reason (PgText, nullable)
 */
export function generateTableSpec(entity: EntityIR): TableSpec {
  const columns: ColumnSpec[] = []

  // 1. Identity columns
  columns.push({
    name: "id",
    columnType: "PgText",
    notNull: true,
    hasDefault: true,
  })
  columns.push({
    name: "slug",
    columnType: "PgText",
    notNull: true,
    hasDefault: false,
  })
  columns.push({
    name: "name",
    columnType: "PgText",
    notNull: true,
    hasDefault: false,
  })

  // 2. Type column (convention: all ontology tables have one)
  columns.push({
    name: "type",
    columnType: "PgText",
    notNull: true,
    hasDefault: false,
  })

  // 3. FK columns from many-to-one links
  for (const [, linkDef] of Object.entries(entity.links)) {
    if (linkDef.cardinality === "many-to-one" && linkDef.fk) {
      const dbColName = toSnakeCase(linkDef.fk)
      columns.push({
        name: dbColName,
        columnType: "PgText",
        notNull: linkDef.required === true,
        hasDefault: false,
      })
    }
  }

  // 4. Spec column
  columns.push({
    name: "spec",
    columnType: "PgJsonb",
    notNull: true,
    hasDefault: true,
  })

  // 5. Metadata column (only if schema has properties)
  if (hasMetadataProperties(entity)) {
    columns.push({
      name: "metadata",
      columnType: "PgJsonb",
      notNull: true,
      hasDefault: true,
    })
  }

  // 6. Timestamp columns
  columns.push({
    name: "created_at",
    columnType: "PgTimestamp",
    notNull: true,
    hasDefault: true,
  })
  columns.push({
    name: "updated_at",
    columnType: "PgTimestamp",
    notNull: true,
    hasDefault: true,
  })

  // 7. Reconciliation columns
  if (entity.reconciliation) {
    columns.push({
      name: "status",
      columnType: "PgJsonb",
      notNull: true,
      hasDefault: true,
    })
    columns.push({
      name: "generation",
      columnType: "PgBigInt53",
      notNull: true,
      hasDefault: true,
    })
    columns.push({
      name: "observed_generation",
      columnType: "PgBigInt53",
      notNull: true,
      hasDefault: true,
    })
  }

  // 8. Bitemporal columns
  if (entity.bitemporal) {
    columns.push({
      name: "valid_from",
      columnType: "PgTimestamp",
      notNull: true,
      hasDefault: true,
    })
    columns.push({
      name: "valid_to",
      columnType: "PgTimestamp",
      notNull: false,
      hasDefault: false,
    })
    columns.push({
      name: "system_from",
      columnType: "PgTimestamp",
      notNull: true,
      hasDefault: true,
    })
    columns.push({
      name: "system_to",
      columnType: "PgTimestamp",
      notNull: false,
      hasDefault: false,
    })
    columns.push({
      name: "changed_by",
      columnType: "PgText",
      notNull: true,
      hasDefault: true,
    })
    columns.push({
      name: "change_reason",
      columnType: "PgText",
      notNull: false,
      hasDefault: false,
    })
  }

  return {
    tableName: toSnakeCase(entity.kind),
    schema: entity.namespace,
    columns,
  }
}
