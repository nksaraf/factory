import type {
  ApiSpec,
  ArtifactSpec,
  CapabilitySpec,
  ComponentSpec,
  ProductSpec,
  ReleaseSpec,
  SystemSpec,
  TemplateSpec,
} from "@smp/factory-shared/schemas/software"
import { sql } from "drizzle-orm"
import { check, index, text, uniqueIndex } from "drizzle-orm/pg-core"

import { newId } from "../../lib/id"
import {
  bitemporalCols,
  createdAt,
  metadataCol,
  softwareSchema,
  specCol,
  updatedAt,
} from "./helpers"
import { team } from "./org-v2"

// ─── System ──────────────────────────────────────────────────

export const system = softwareSchema.table(
  "system",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("sys")),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    ownerTeamId: text("owner_team_id").references(() => team.id, {
      onDelete: "set null",
    }),
    spec: specCol<SystemSpec>(),
    metadata: metadataCol(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...bitemporalCols(),
  },
  (t) => [
    // Partial unique indexes in migration (bitemporal)
    index("software_system_slug_idx").on(t.slug),
    index("software_system_name_idx").on(t.name),
    index("software_system_owner_team_idx").on(t.ownerTeamId),
  ]
)

// ─── Component ───────────────────────────────────────────────

export const component = softwareSchema.table(
  "component",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("cmp")),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    systemId: text("system_id")
      .notNull()
      .references(() => system.id, { onDelete: "cascade" }),
    ownerTeamId: text("owner_team_id").references(() => team.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("active"),
    lifecycle: text("lifecycle").default("production"),
    spec: specCol<ComponentSpec>(),
    metadata: metadataCol(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...bitemporalCols(),
  },
  (t) => [
    // Partial unique indexes in migration (bitemporal)
    index("software_component_system_slug_idx").on(t.systemId, t.slug),
    index("software_component_system_name_idx").on(t.systemId, t.name),
    index("software_component_type_idx").on(t.type),
    index("software_component_owner_team_idx").on(t.ownerTeamId),
    check(
      "software_component_type_valid",
      sql`${t.type} IN ('service', 'worker', 'task', 'cronjob', 'website', 'library', 'cli', 'agent', 'gateway', 'ml-model', 'database', 'cache', 'queue', 'storage', 'search')`
    ),
  ]
)

// ─── API ─────────────────────────────────────────────────────

export const softwareApi = softwareSchema.table(
  "api",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("api")),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    systemId: text("system_id")
      .notNull()
      .references(() => system.id, { onDelete: "cascade" }),
    providedByComponentId: text("provided_by_component_id").references(
      () => component.id,
      { onDelete: "set null" }
    ),
    spec: specCol<ApiSpec>(),
    metadata: metadataCol(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("software_api_system_slug_unique").on(t.systemId, t.slug),
    check(
      "software_api_type_valid",
      sql`${t.type} IN ('openapi', 'grpc', 'graphql', 'asyncapi', 'webhook')`
    ),
  ]
)

// ─── Artifact ────────────────────────────────────────────────

export const artifact = softwareSchema.table(
  "artifact",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("art")),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    componentId: text("component_id")
      .notNull()
      .references(() => component.id, { onDelete: "cascade" }),
    spec: specCol<ArtifactSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      "software_artifact_type_valid",
      sql`${t.type} IN ('container_image', 'binary', 'archive', 'package', 'bundle')`
    ),
  ]
)

// ─── Release ─────────────────────────────────────────────────

export const release = softwareSchema.table(
  "release",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("rel")),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    systemId: text("system_id")
      .notNull()
      .references(() => system.id, { onDelete: "cascade" }),
    spec: specCol<ReleaseSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("software_release_system_slug_unique").on(t.systemId, t.slug),
  ]
)

// ─── Release–Artifact Pin (junction) ─────────────────────────

export const releaseArtifactPin = softwareSchema.table(
  "release_artifact_pin",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("rap")),
    releaseId: text("release_id")
      .notNull()
      .references(() => release.id, { onDelete: "cascade" }),
    artifactId: text("artifact_id")
      .notNull()
      .references(() => artifact.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("software_release_artifact_pin_unique").on(
      t.releaseId,
      t.artifactId
    ),
  ]
)

// ─── Template ────────────────────────────────────────────────

export const template = softwareSchema.table(
  "template",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("tmpl")),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    spec: specCol<TemplateSpec>(),
    metadata: metadataCol(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("software_template_slug_unique").on(t.slug),
    uniqueIndex("software_template_name_unique").on(t.name),
    check(
      "software_template_type_valid",
      sql`${t.type} IN ('component', 'system', 'workbench')`
    ),
  ]
)

// ─── Product ─────────────────────────────────────────────────

export const product = softwareSchema.table(
  "product",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("prod")),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    spec: specCol<ProductSpec>(),
    metadata: metadataCol(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("software_product_slug_unique").on(t.slug),
    uniqueIndex("software_product_name_unique").on(t.name),
  ]
)

// ─── Product–System (junction) ───────────────────────────────

export const productSystem = softwareSchema.table(
  "product_system",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("psys")),
    productId: text("product_id")
      .notNull()
      .references(() => product.id, { onDelete: "cascade" }),
    systemId: text("system_id")
      .notNull()
      .references(() => system.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("software_product_system_unique").on(t.productId, t.systemId),
  ]
)

// ─── Capability ──────────────────────────────────────────────

export const capability = softwareSchema.table(
  "capability",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("cap")),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    productId: text("product_id").references(() => product.id, {
      onDelete: "set null",
    }),
    ownerTeamId: text("owner_team_id").references(() => team.id, {
      onDelete: "set null",
    }),
    spec: specCol<CapabilitySpec>(),
    metadata: metadataCol(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("software_capability_slug_unique").on(t.slug),
    check(
      "software_capability_type_valid",
      sql`${t.type} IN ('feature', 'integration', 'compute', 'data', 'support')`
    ),
  ]
)
