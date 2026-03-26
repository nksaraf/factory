import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { newId } from "../../lib/id";
import { orgTeam } from "./org";

export const factoryCatalog = pgSchema("factory_catalog");

// ─── Domain (= Backstage Domain, Lyon: Product) ─────────────

export const catalogDomain = factoryCatalog.table(
  "domain",
  {
    domainId: text("domain_id")
      .primaryKey()
      .$defaultFn(() => newId("cdom")),
    name: text("name").notNull(),
    namespace: text("namespace").notNull().default("default"),
    title: text("title"),
    description: text("description"),
    ownerTeamId: text("owner_team_id").references(() => orgTeam.teamId, {
      onDelete: "set null",
    }),
    labels: jsonb("labels").notNull().default({}),
    annotations: jsonb("annotations").notNull().default({}),
    tags: jsonb("tags").notNull().default([]),
    links: jsonb("links").notNull().default([]),
    spec: jsonb("spec").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("catalog_domain_name_unique").on(t.name),
    index("catalog_domain_owner_idx").on(t.ownerTeamId),
  ]
);

// ─── System (= Backstage System, Lyon: Module) ──────────────

export const catalogSystem = factoryCatalog.table(
  "system",
  {
    systemId: text("system_id")
      .primaryKey()
      .$defaultFn(() => newId("csys")),
    name: text("name").notNull(),
    namespace: text("namespace").notNull().default("default"),
    title: text("title"),
    description: text("description"),
    ownerTeamId: text("owner_team_id").references(() => orgTeam.teamId, {
      onDelete: "set null",
    }),
    domainId: text("domain_id").references(() => catalogDomain.domainId, {
      onDelete: "set null",
    }),
    lifecycle: text("lifecycle").default("production"),
    labels: jsonb("labels").notNull().default({}),
    annotations: jsonb("annotations").notNull().default({}),
    tags: jsonb("tags").notNull().default([]),
    links: jsonb("links").notNull().default([]),
    spec: jsonb("spec").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("catalog_system_ns_name_unique").on(t.namespace, t.name),
    index("catalog_system_owner_idx").on(t.ownerTeamId),
    index("catalog_system_domain_idx").on(t.domainId),
    check(
      "catalog_system_lifecycle_valid",
      sql`${t.lifecycle} IN ('experimental', 'development', 'production', 'deprecated')`
    ),
  ]
);

// ─── Component (services you build) ──────────────────────────

export const catalogComponent = factoryCatalog.table(
  "component",
  {
    componentId: text("component_id")
      .primaryKey()
      .$defaultFn(() => newId("ccmp")),
    systemId: text("system_id").references(() => catalogSystem.systemId, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    namespace: text("namespace").notNull().default("default"),
    title: text("title"),
    description: text("description"),
    type: text("type").notNull(),
    lifecycle: text("lifecycle").default("production"),
    ownerTeamId: text("owner_team_id").references(() => orgTeam.teamId, {
      onDelete: "set null",
    }),
    isPublic: boolean("is_public").notNull().default(false),
    stateful: boolean("stateful").notNull().default(false),
    ports: jsonb("ports").notNull().default([]),
    healthcheck: jsonb("healthcheck"),
    replicas: integer("replicas").notNull().default(1),
    cpu: text("cpu").notNull().default("100m"),
    memory: text("memory").notNull().default("128Mi"),
    labels: jsonb("labels").notNull().default({}),
    annotations: jsonb("annotations").notNull().default({}),
    tags: jsonb("tags").notNull().default([]),
    links: jsonb("links").notNull().default([]),
    spec: jsonb("spec").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("catalog_component_sys_name_unique").on(t.systemId, t.name),
    index("catalog_component_owner_idx").on(t.ownerTeamId),
    index("catalog_component_type_idx").on(t.type),
    check(
      "catalog_component_type_valid",
      sql`${t.type} IN ('service', 'worker', 'task', 'cronjob', 'website', 'library')`
    ),
    check(
      "catalog_component_lifecycle_valid",
      sql`${t.lifecycle} IN ('experimental', 'development', 'production', 'deprecated')`
    ),
  ]
);

// ─── Resource (infra dependencies) ───────────────────────────

export const catalogResource = factoryCatalog.table(
  "resource",
  {
    resourceId: text("resource_id")
      .primaryKey()
      .$defaultFn(() => newId("cres")),
    systemId: text("system_id").references(() => catalogSystem.systemId, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    namespace: text("namespace").notNull().default("default"),
    title: text("title"),
    description: text("description"),
    type: text("type").notNull(),
    lifecycle: text("lifecycle").default("production"),
    ownerTeamId: text("owner_team_id").references(() => orgTeam.teamId, {
      onDelete: "set null",
    }),
    image: text("image"),
    ports: jsonb("ports").notNull().default([]),
    containerPort: integer("container_port"),
    environment: jsonb("environment").notNull().default({}),
    volumes: jsonb("volumes").notNull().default([]),
    healthcheck: text("healthcheck"),
    labels: jsonb("labels").notNull().default({}),
    annotations: jsonb("annotations").notNull().default({}),
    tags: jsonb("tags").notNull().default([]),
    spec: jsonb("spec").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("catalog_resource_sys_name_unique").on(t.systemId, t.name),
    index("catalog_resource_owner_idx").on(t.ownerTeamId),
    index("catalog_resource_type_idx").on(t.type),
    check(
      "catalog_resource_type_valid",
      sql`${t.type} IN ('database', 'cache', 'queue', 'gateway', 'storage', 'search')`
    ),
    check(
      "catalog_resource_lifecycle_valid",
      sql`${t.lifecycle} IN ('experimental', 'development', 'production', 'deprecated')`
    ),
  ]
);

// ─── API (interface boundary) ────────────────────────────────

export const catalogApi = factoryCatalog.table(
  "api",
  {
    apiId: text("api_id")
      .primaryKey()
      .$defaultFn(() => newId("capi")),
    systemId: text("system_id").references(() => catalogSystem.systemId, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    namespace: text("namespace").notNull().default("default"),
    title: text("title"),
    description: text("description"),
    type: text("type").notNull(),
    lifecycle: text("lifecycle").default("production"),
    ownerTeamId: text("owner_team_id").references(() => orgTeam.teamId, {
      onDelete: "set null",
    }),
    definition: text("definition"),
    providedByComponentId: text("provided_by_component_id").references(
      () => catalogComponent.componentId,
      { onDelete: "set null" }
    ),
    labels: jsonb("labels").notNull().default({}),
    annotations: jsonb("annotations").notNull().default({}),
    spec: jsonb("spec").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("catalog_api_sys_name_unique").on(t.systemId, t.name),
    index("catalog_api_owner_idx").on(t.ownerTeamId),
    check(
      "catalog_api_type_valid",
      sql`${t.type} IN ('openapi', 'asyncapi', 'graphql', 'grpc')`
    ),
    check(
      "catalog_api_lifecycle_valid",
      sql`${t.lifecycle} IN ('experimental', 'development', 'production', 'deprecated')`
    ),
  ]
);

// ─── Entity Link ─────────────────────────────────────────────
// Bidirectional mapping between catalog and factory domain entities.

export const catalogEntityLink = factoryCatalog.table(
  "entity_link",
  {
    linkId: text("link_id")
      .primaryKey()
      .$defaultFn(() => newId("elnk")),
    catalogEntityKind: text("catalog_entity_kind").notNull(),
    catalogEntityId: text("catalog_entity_id").notNull(),
    factorySchema: text("factory_schema").notNull(),
    factoryTable: text("factory_table").notNull(),
    factoryEntityId: text("factory_entity_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("catalog_link_catalog_unique").on(
      t.catalogEntityKind,
      t.catalogEntityId
    ),
    uniqueIndex("catalog_link_factory_unique").on(
      t.factorySchema,
      t.factoryTable,
      t.factoryEntityId
    ),
    check(
      "catalog_link_kind_valid",
      sql`${t.catalogEntityKind} IN ('System', 'Domain', 'Component', 'Resource', 'API', 'Group', 'User')`
    ),
  ]
);
