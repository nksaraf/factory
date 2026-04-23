/**
 * Graph schema — customer-layer storage for the three-layer graph runtime.
 *
 * Terminology follows Palantir Foundry: object types are entity kinds
 * (schemas), instances are rows of an object type, links are typed
 * relationships. A "graph" is a registered composition (framework + product
 * + customer overlays), scoped by a single graph_id.
 *
 * See the plan at docs/superpowers/plans/ for the full type surface.
 */

import {
  boolean,
  index,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core"

export const graphSchema = pgSchema("graph")

// ---------- Registry ----------

export const registry = graphSchema.table("registry", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  ownerKind: text("owner_kind").notNull(),
  ownerId: text("owner_id").notNull(),
  displayName: text("display_name"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
})

const graphIdRef = () =>
  text("graph_id")
    .notNull()
    .references(() => registry.id, { onDelete: "cascade" })

// ---------- Type schemas ----------

export const objectType = graphSchema.table(
  "object_type",
  {
    id: text("id").primaryKey(),
    graphId: graphIdRef(),
    kind: text("kind").notNull(),
    extendsKind: text("extends_kind"),
    specSchema: jsonb("spec_schema").notNull(),
    statusSchema: jsonb("status_schema"),
    annotations: jsonb("annotations"),
    implements: jsonb("implements"),
    traits: jsonb("traits"),
    access: jsonb("access"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uniqGraphKind: primaryKey({
      columns: [t.graphId, t.kind],
      name: "object_type_graph_kind",
    }),
  })
)

export const linkType = graphSchema.table(
  "link_type",
  {
    id: text("id").primaryKey(),
    graphId: graphIdRef(),
    name: text("name").notNull(),
    sourceKind: text("source_kind").notNull(),
    targetKind: text("target_kind").notNull(),
    cardinality: text("cardinality").notNull(),
    inverseName: text("inverse_name"),
    propertiesSchema: jsonb("properties_schema"),
    annotations: jsonb("annotations"),
    access: jsonb("access"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uniqGraphName: primaryKey({
      columns: [t.graphId, t.name],
      name: "link_type_graph_name",
    }),
    bySource: index("link_type_source_idx").on(t.graphId, t.sourceKind),
  })
)

export const interfaceType = graphSchema.table(
  "interface_type",
  {
    id: text("id").primaryKey(),
    graphId: graphIdRef(),
    name: text("name").notNull(),
    propertiesSchema: jsonb("properties_schema").notNull(),
    annotations: jsonb("annotations"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uniqGraphName: primaryKey({
      columns: [t.graphId, t.name],
      name: "interface_type_graph_name",
    }),
  })
)

export const sharedProperty = graphSchema.table(
  "shared_property",
  {
    id: text("id").primaryKey(),
    graphId: graphIdRef(),
    name: text("name").notNull(),
    schema: jsonb("schema").notNull(),
    annotations: jsonb("annotations"),
    display: jsonb("display"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uniqGraphName: primaryKey({
      columns: [t.graphId, t.name],
      name: "shared_property_graph_name",
    }),
  })
)

export const valueType = graphSchema.table(
  "value_type",
  {
    id: text("id").primaryKey(),
    graphId: graphIdRef(),
    name: text("name").notNull(),
    base: text("base").notNull(),
    description: text("description"),
    display: jsonb("display"),
    validation: jsonb("validation"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uniqGraphName: primaryKey({
      columns: [t.graphId, t.name],
      name: "value_type_graph_name",
    }),
  })
)

export const structType = graphSchema.table(
  "struct_type",
  {
    id: text("id").primaryKey(),
    graphId: graphIdRef(),
    name: text("name").notNull(),
    fieldsSchema: jsonb("fields_schema").notNull(),
    mainField: text("main_field"),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uniqGraphName: primaryKey({
      columns: [t.graphId, t.name],
      name: "struct_type_graph_name",
    }),
  })
)

export const actionType = graphSchema.table(
  "action_type",
  {
    id: text("id").primaryKey(),
    graphId: graphIdRef(),
    targetKind: text("target_kind").notNull(),
    name: text("name").notNull(),
    inputSchema: jsonb("input_schema").notNull(),
    outputSchema: jsonb("output_schema"),
    precondition: jsonb("precondition"),
    effect: jsonb("effect").notNull(),
    sideEffects: jsonb("side_effects"),
    annotations: jsonb("annotations"),
    access: jsonb("access"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uniq: primaryKey({
      columns: [t.graphId, t.targetKind, t.name],
      name: "action_type_pk",
    }),
  })
)

export const functionType = graphSchema.table(
  "function_type",
  {
    id: text("id").primaryKey(),
    graphId: graphIdRef(),
    targetKind: text("target_kind").notNull(),
    name: text("name").notNull(),
    inputSchema: jsonb("input_schema").notNull(),
    outputSchema: jsonb("output_schema").notNull(),
    body: jsonb("body").notNull(),
    kind: text("kind").notNull(),
    annotations: jsonb("annotations"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uniq: primaryKey({
      columns: [t.graphId, t.targetKind, t.name],
      name: "function_type_pk",
    }),
  })
)

export const extension = graphSchema.table(
  "extension",
  {
    id: text("id").primaryKey(),
    graphId: graphIdRef(),
    targetKind: text("target_kind").notNull(),
    propertyName: text("property_name").notNull(),
    schema: jsonb("schema").notNull(),
    annotations: jsonb("annotations"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uniqGraphTargetProp: primaryKey({
      columns: [t.graphId, t.targetKind, t.propertyName],
      name: "extension_graph_target_property",
    }),
  })
)

// ---------- Instances ----------

export const instance = graphSchema.table(
  "instance",
  {
    id: text("id").primaryKey(),
    graphId: graphIdRef(),
    kind: text("kind").notNull(),
    slug: text("slug"),
    title: text("title"),
    spec: jsonb("spec").notNull(),
    status: jsonb("status"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    byGraphKind: index("instance_graph_kind_idx").on(t.graphId, t.kind),
    bySlug: index("instance_slug_idx").on(t.graphId, t.kind, t.slug),
  })
)

export const link = graphSchema.table(
  "link",
  {
    id: text("id").primaryKey(),
    graphId: graphIdRef(),
    linkTypeName: text("link_type_name").notNull(),
    sourceKind: text("source_kind").notNull(),
    sourceId: text("source_id").notNull(),
    targetKind: text("target_kind").notNull(),
    targetId: text("target_id").notNull(),
    properties: jsonb("properties"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    bySource: index("link_source_idx").on(
      t.graphId,
      t.sourceKind,
      t.sourceId,
      t.linkTypeName
    ),
    byTarget: index("link_target_idx").on(t.graphId, t.targetKind, t.targetId),
    byType: index("link_type_idx").on(t.graphId, t.linkTypeName),
  })
)

export const extensionValue = graphSchema.table(
  "extension_value",
  {
    graphId: text("graph_id").notNull(),
    targetKind: text("target_kind").notNull(),
    targetId: text("target_id").notNull(),
    propertyName: text("property_name").notNull(),
    value: jsonb("value"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({
      columns: [t.graphId, t.targetKind, t.targetId, t.propertyName],
      name: "extension_value_pk",
    }),
  })
)

// ---------- Runtime caches / UI ----------

export const uiOverride = graphSchema.table(
  "ui_override",
  {
    graphId: text("graph_id").notNull(),
    kind: text("kind").notNull(),
    viewKind: text("view_kind").notNull(),
    code: text("code").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({
      columns: [t.graphId, t.kind, t.viewKind],
      name: "ui_override_pk",
    }),
  })
)

export const materializedDerived = graphSchema.table(
  "materialized_derived",
  {
    graphId: text("graph_id").notNull(),
    targetKind: text("target_kind").notNull(),
    targetId: text("target_id").notNull(),
    propertyName: text("property_name").notNull(),
    value: jsonb("value"),
    computedAt: timestamp("computed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    stale: boolean("stale").default(false).notNull(),
  },
  (t) => ({
    pk: primaryKey({
      columns: [t.graphId, t.targetKind, t.targetId, t.propertyName],
      name: "materialized_derived_pk",
    }),
  })
)
