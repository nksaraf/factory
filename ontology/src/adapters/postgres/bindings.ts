import type { PgTable, PgColumn } from "drizzle-orm/pg-core"

/** Binding: connects an ontology entity kind to its Drizzle table. */
export interface TableBinding<T extends PgTable = PgTable> {
  readonly table: T
  readonly slug: PgColumn
  readonly id: PgColumn
  /** FK columns for parent links — maps link name to column on this table */
  readonly fks?: Record<string, PgColumn>
}

/** Complete set of bindings for an ontology — one per entity kind. */
export type TableBindings = Record<string, TableBinding>
