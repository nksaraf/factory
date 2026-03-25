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

export const factoryProduct = pgSchema("factory_product");

export const productModule = factoryProduct.table(
  "module",
  {
    moduleId: text("module_id")
      .primaryKey()
      .$defaultFn(() => newId("mod")),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    team: text("team").notNull(),
    product: text("product"),
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
    assignee: text("assignee"),
    externalId: text("external_id"),
    externalUrl: text("external_url"),
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
  ]
);
