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

export const factoryProduct = pgSchema("factory_product");

export const productModule = factoryProduct.table(
  "module",
  {
    moduleId: text("module_id")
      .primaryKey()
      .$defaultFn(() => newId("mod")),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    teamId: text("team_id")
      .notNull()
      .references(() => orgTeam.teamId),
    product: text("product"),
    description: text("description"),
    lifecycleState: text("lifecycle_state").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("module_name_unique").on(t.name),
    uniqueIndex("module_slug_unique").on(t.slug),
    check(
      "module_lifecycle_valid",
      sql`${t.lifecycleState} IN ('active', 'deprecated', 'retired')`
    ),
  ]
);

export const componentSpec = factoryProduct.table(
  "component_spec",
  {
    componentId: text("component_id")
      .primaryKey()
      .$defaultFn(() => newId("cmp")),
    moduleId: text("module_id")
      .notNull()
      .references(() => productModule.moduleId, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    kind: text("kind").notNull(),
    entityKind: text("entity_kind").notNull().default("Component"),
    specType: text("spec_type"),
    lifecycle: text("lifecycle").default("production"),
    description: text("description"),
    ports: jsonb("ports").notNull().default([]),
    healthcheck: jsonb("healthcheck"),
    isPublic: boolean("is_public").notNull().default(false),
    stateful: boolean("stateful").notNull().default(false),
    runOrder: integer("run_order"),
    defaultReplicas: integer("default_replicas").notNull().default(1),
    defaultCpu: text("default_cpu").notNull().default("100m"),
    defaultMemory: text("default_memory").notNull().default("128Mi"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("component_spec_module_name_unique").on(t.moduleId, t.name),
    uniqueIndex("component_spec_module_slug_unique").on(t.moduleId, t.slug),
    check(
      "component_spec_kind_valid",
      sql`${t.kind} IN ('server', 'worker', 'task', 'scheduled', 'site', 'database', 'gateway')`
    ),
    check(
      "component_spec_entity_kind_valid",
      sql`${t.entityKind} IN ('Component', 'Resource')`
    ),
    check(
      "component_spec_lifecycle_valid",
      sql`${t.lifecycle} IN ('experimental', 'development', 'production', 'deprecated')`
    ),
  ]
);

export const workTrackerProvider = factoryProduct.table(
  "work_tracker_provider",
  {
    workTrackerProviderId: text("work_tracker_provider_id")
      .primaryKey()
      .$defaultFn(() => newId("wtp")),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    kind: text("kind").notNull(),
    apiUrl: text("api_url").notNull(),
    credentialsRef: text("credentials_ref"),
    defaultProjectKey: text("default_project_key"),
    status: text("status").notNull().default("active"),
    syncEnabled: boolean("sync_enabled").notNull().default(true),
    syncIntervalMinutes: integer("sync_interval_minutes").notNull().default(5),
    syncStatus: text("sync_status").notNull().default("idle"),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    syncError: text("sync_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("work_tracker_provider_slug_unique").on(t.slug),
    check(
      "work_tracker_kind_valid",
      sql`${t.kind} IN ('jira', 'linear')`
    ),
    check(
      "work_tracker_status_valid",
      sql`${t.status} IN ('active', 'inactive')`
    ),
    check(
      "work_tracker_sync_status_valid",
      sql`${t.syncStatus} IN ('idle', 'syncing', 'error')`
    ),
  ]
);

export const workTrackerProjectMapping = factoryProduct.table(
  "work_tracker_project_mapping",
  {
    mappingId: text("mapping_id")
      .primaryKey()
      .$defaultFn(() => newId("wtpm")),
    workTrackerProviderId: text("work_tracker_provider_id")
      .notNull()
      .references(() => workTrackerProvider.workTrackerProviderId, {
        onDelete: "cascade",
      }),
    moduleId: text("module_id")
      .notNull()
      .references(() => productModule.moduleId, { onDelete: "cascade" }),
    externalProjectId: text("external_project_id").notNull(),
    externalProjectName: text("external_project_name"),
    syncDirection: text("sync_direction").notNull().default("pull"),
    filterQuery: text("filter_query"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("work_tracker_mapping_unique").on(
      t.workTrackerProviderId,
      t.moduleId,
      t.externalProjectId
    ),
    check(
      "sync_direction_valid",
      sql`${t.syncDirection} IN ('pull', 'push', 'bidirectional')`
    ),
  ]
);

export const workItem = factoryProduct.table(
  "work_item",
  {
    workItemId: text("work_item_id")
      .primaryKey()
      .$defaultFn(() => newId("wi")),
    moduleId: text("module_id").references(() => productModule.moduleId, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    status: text("status").notNull().default("backlog"),
    kind: text("kind").notNull().default("story"),
    priority: text("priority"),
    description: text("description"),
    labels: jsonb("labels").notNull().default([]),
    parentWorkItemId: text("parent_work_item_id"),
    assignee: text("assignee"),
    externalId: text("external_id"),
    externalKey: text("external_key"),
    externalUrl: text("external_url"),
    workTrackerProviderId: text("work_tracker_provider_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("work_item_status_idx").on(t.status),
    index("work_item_assignee_idx").on(t.assignee),
    check(
      "work_item_status_valid",
      sql`${t.status} IN ('backlog', 'ready', 'in_progress', 'in_review', 'done')`
    ),
    check(
      "work_item_kind_valid",
      sql`${t.kind} IN ('epic', 'story', 'task', 'bug')`
    ),
  ]
);
