import { sql } from "drizzle-orm";
import {
  check,
  index,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { newId } from "../../lib/id";
import {
  bitemporalCols,
  commerceSchema,
  createdAt,
  updatedAt,
  specCol,
} from "./helpers";

import { capability } from "./software-v2";

import type {
  CustomerSpec,
  SubscriptionSpec,
  SubscriptionItemSpec,
  PlanSpec,
  EntitlementBundleSpec,
  BillableMetricSpec,
} from "@smp/factory-shared/schemas/commerce";

// ─── Customer ─────────────────────────────────────────────────

export const customer = commerceSchema.table(
  "customer",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("cust")),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    spec: specCol<CustomerSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...bitemporalCols(),
  },
  (t) => [
    // Partial unique indexes in migration (bitemporal)
    index("commerce_customer_slug_idx").on(t.slug),
    index("commerce_customer_name_idx").on(t.name),
  ]
);

// ─── Plan ─────────────────────────────────────────────────────

export const plan = commerceSchema.table(
  "plan",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("pln")),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    spec: specCol<PlanSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("commerce_plan_slug_unique").on(t.slug),
    uniqueIndex("commerce_plan_name_unique").on(t.name),
    index("commerce_plan_type_idx").on(t.type),
    check(
      "commerce_plan_type_valid",
      sql`${t.type} IN ('base', 'add-on', 'suite')`
    ),
  ]
);

// ─── Subscription ─────────────────────────────────────────────

export const subscription = commerceSchema.table(
  "subscription",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("csub")),
    customerId: text("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => plan.id),
    spec: specCol<SubscriptionSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ...bitemporalCols(),
  },
  (t) => [
    index("commerce_subscription_customer_idx").on(t.customerId),
    index("commerce_subscription_plan_idx").on(t.planId),
  ]
);

// ─── Subscription Item ────────────────────────────────────────

export const subscriptionItem = commerceSchema.table(
  "subscription_item",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("subi")),
    subscriptionId: text("subscription_id")
      .notNull()
      .references(() => subscription.id, { onDelete: "cascade" }),
    capabilityId: text("capability_id").references(() => capability.id, { onDelete: "set null" }),
    spec: specCol<SubscriptionItemSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("commerce_subscription_item_subscription_idx").on(t.subscriptionId),
    index("commerce_subscription_item_capability_idx").on(t.capabilityId),
  ]
);

// ─── Entitlement Bundle ───────────────────────────────────────

export const entitlementBundle = commerceSchema.table(
  "entitlement_bundle",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("bndl")),
    customerId: text("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "cascade" }),
    spec: specCol<EntitlementBundleSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("commerce_entitlement_bundle_customer_idx").on(t.customerId),
  ]
);

// ─── Billable Metric ──────────────────────────────────────────

export const billableMetric = commerceSchema.table(
  "billable_metric",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => newId("bmet")),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    capabilityId: text("capability_id").references(() => capability.id, { onDelete: "set null" }),
    spec: specCol<BillableMetricSpec>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("commerce_billable_metric_slug_unique").on(t.slug),
    uniqueIndex("commerce_billable_metric_name_unique").on(t.name),
    index("commerce_billable_metric_capability_idx").on(t.capabilityId),
  ]
);
