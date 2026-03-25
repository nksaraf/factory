import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgSchema, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { newId } from "../../lib/id";
import { productModule } from "./product";

export const factoryCommerce = pgSchema("factory_commerce");

export const customerAccount = factoryCommerce.table(
  "customer_account",
  {
    customerId: text("customer_id")
      .primaryKey()
      .$defaultFn(() => newId("cust")),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    status: text("status").notNull().default("trial"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("customer_account_slug_unique").on(t.slug),
    check(
      "customer_status_valid",
      sql`${t.status} IN ('trial', 'active', 'suspended', 'terminated')`
    ),
  ]
);

export const commercePlan = factoryCommerce.table(
  "plan",
  {
    planId: text("plan_id")
      .primaryKey()
      .$defaultFn(() => newId("pln")),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    includedModules: jsonb("included_modules").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [uniqueIndex("commerce_plan_slug_unique").on(t.slug)]
);

export const entitlement = factoryCommerce.table(
  "entitlement",
  {
    entitlementId: text("entitlement_id")
      .primaryKey()
      .$defaultFn(() => newId("ent")),
    customerId: text("customer_id")
      .notNull()
      .references(() => customerAccount.customerId, { onDelete: "cascade" }),
    moduleId: text("module_id")
      .notNull()
      .references(() => productModule.moduleId, { onDelete: "cascade" }),
    status: text("status").notNull().default("active"),
    quotas: jsonb("quotas").notNull().default({}),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    siteId: text("site_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    check(
      "entitlement_status_valid",
      sql`${t.status} IN ('active', 'suspended', 'revoked')`
    ),
  ]
);

export const entitlementBundle = factoryCommerce.table("entitlement_bundle", {
  bundleId: text("bundle_id")
    .primaryKey()
    .$defaultFn(() => newId("bndl")),
  customerId: text("customer_id")
    .notNull()
    .references(() => customerAccount.customerId, { onDelete: "cascade" }),
  siteId: text("site_id").notNull(),
  payload: jsonb("payload").notNull(),
  signature: text("signature").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  gracePeriodDays: integer("grace_period_days").notNull().default(30),
})
