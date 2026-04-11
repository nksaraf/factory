/**
 * Reusable column builders for Drizzle table definitions.
 * Reduces duplication across the 6 ontology schema files.
 */

import { bigint, jsonb, pgSchema, text, timestamp } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

import type { EntityMetadata } from "@smp/factory-shared/schemas/common"

// ── Schema namespaces ──────────────────────────────────────

export const softwareSchema = pgSchema("software")
export const orgSchema = pgSchema("org")
export const infraSchema = pgSchema("infra")
export const opsSchema = pgSchema("ops")
export const buildSchema = pgSchema("build")
export const commerceSchema = pgSchema("commerce")

// ── Timestamp columns ──────────────────────────────────────

/** Standard createdAt column with timezone and default now. */
export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull()

/** Standard updatedAt column with timezone and default now. */
export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()

// ── Common column combos ───────────────────────────────────

/** Standard metadata JSONB column (labels, annotations, tags, links). */
export const metadataCol = () =>
  jsonb("metadata")
    .$type<EntityMetadata>()
    .notNull()
    .default(sql`'{}'`)

/**
 * JSONB spec column with a DB-level `'{}'` default.
 * The `.$type<T>()` annotation provides compile-time type safety,
 * while the SQL default avoids TS complaints about `{}` not matching
 * spec types with required fields (Zod validates at the app layer).
 */
export const specCol = <T>() =>
  jsonb("spec")
    .$type<T>()
    .notNull()
    .default(sql`'{}'`)

// ── Bitemporal columns ──────────────────────────────────
// Opt-in per table. Spread into table definitions: ...bitemporalCols()

/** Bitemporal column set: valid_time + system_time + provenance. */
export const bitemporalCols = () => ({
  validFrom: timestamp("valid_from", { withTimezone: true })
    .defaultNow()
    .notNull(),
  validTo: timestamp("valid_to", { withTimezone: true }),
  systemFrom: timestamp("system_from", { withTimezone: true })
    .defaultNow()
    .notNull(),
  systemTo: timestamp("system_to", { withTimezone: true }),
  changedBy: text("changed_by").notNull().default("system"),
  changeReason: text("change_reason"),
})

// ── Reconciliation columns ──────────────────────────────
// For operational entities with external state (spec/status convergence).

/** Reconciliation column set: status JSONB + generation counter. */
export const reconciliationCols = () => ({
  status: jsonb("status")
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'`),
  generation: bigint("generation", { mode: "number" }).notNull().default(0),
  observedGeneration: bigint("observed_generation", { mode: "number" })
    .notNull()
    .default(0),
})
