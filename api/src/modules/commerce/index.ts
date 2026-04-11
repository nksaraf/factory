/**
 * Commerce controller.
 *
 * Route → table mapping:
 *   /commerce/customers       → commerce.customer
 *   /commerce/plans           → commerce.plan
 *   /commerce/subscriptions   → commerce.subscription
 *   /commerce/billable-metrics → commerce.billable_metric
 */
import {
  CreateBillableMetricSchema,
  CreateCustomerSchema,
  CreatePlanSchema,
  CreateSubscriptionSchema,
  UpdateBillableMetricSchema,
  UpdateCustomerSchema,
  UpdatePlanSchema,
  UpdateSubscriptionSchema,
} from "@smp/factory-shared/schemas/commerce"
import { Elysia } from "elysia"

import type { Database } from "../../db/connection"
import {
  billableMetric,
  customer,
  entitlementBundle,
  plan,
  subscription,
  subscriptionItem,
} from "../../db/schema/commerce"
import { ontologyRoutes } from "../../lib/crud"

export function commerceController(db: Database) {
  return (
    new Elysia({ prefix: "/commerce" })

      // ── Customers ──────────────────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "commerce",
          entity: "customers",
          singular: "customer",
          table: customer,
          slugColumn: customer.slug,
          idColumn: customer.id,
          prefix: "cust",
          kindAlias: "customer",
          createSchema: CreateCustomerSchema,
          updateSchema: UpdateCustomerSchema,
          deletable: "bitemporal",
          bitemporal: {
            validTo: customer.validTo,
            systemTo: customer.systemTo,
          },
          relations: {
            subscriptions: {
              path: "subscriptions",
              table: subscription,
              fk: subscription.customerId,
              bitemporal: {
                validTo: subscription.validTo,
                systemTo: subscription.systemTo,
              },
            },
            bundles: {
              path: "bundles",
              table: entitlementBundle,
              fk: entitlementBundle.customerId,
            },
          },
        })
      )

      // ── Plans ──────────────────────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "commerce",
          entity: "plans",
          singular: "plan",
          table: plan,
          slugColumn: plan.slug,
          idColumn: plan.id,
          prefix: "pln",
          kindAlias: "plan",
          createSchema: CreatePlanSchema,
          updateSchema: UpdatePlanSchema,
          deletable: true,
        })
      )

      // ── Subscriptions ──────────────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "commerce",
          entity: "subscriptions",
          singular: "subscription",
          table: subscription,
          slugColumn: subscription.id, // no slug — use id
          idColumn: subscription.id,
          prefix: "csub",
          kindAlias: "subscription",
          createSchema: CreateSubscriptionSchema,
          updateSchema: UpdateSubscriptionSchema,
          deletable: "bitemporal",
          bitemporal: {
            validTo: subscription.validTo,
            systemTo: subscription.systemTo,
          },
          relations: {
            items: {
              path: "items",
              table: subscriptionItem,
              fk: subscriptionItem.subscriptionId,
            },
          },
        })
      )

      // ── Billable Metrics ───────────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "commerce",
          entity: "billable-metrics",
          singular: "billable metric",
          table: billableMetric,
          slugColumn: billableMetric.slug,
          idColumn: billableMetric.id,
          prefix: "bmet",
          kindAlias: "billable-metric",
          createSchema: CreateBillableMetricSchema,
          updateSchema: UpdateBillableMetricSchema,
          deletable: true,
        })
      )
  )
}

import type { OntologyRouteConfig } from "../../lib/crud"

export const commerceOntologyConfigs: Pick<OntologyRouteConfig<any>, "entity" | "singular" | "table" | "slugColumn" | "idColumn" | "prefix" | "kindAlias" | "createSchema">[] = [
  { entity: "customers", singular: "customer", table: customer, slugColumn: customer.slug, idColumn: customer.id, prefix: "cust", kindAlias: "customer" },
  { entity: "plans", singular: "plan", table: plan, slugColumn: plan.slug, idColumn: plan.id, prefix: "pln", kindAlias: "plan" },
  { entity: "subscriptions", singular: "subscription", table: subscription, slugColumn: subscription.id, idColumn: subscription.id, prefix: "csub", kindAlias: "subscription" },
  { entity: "billable-metrics", singular: "billable metric", table: billableMetric, slugColumn: billableMetric.slug, idColumn: billableMetric.id, prefix: "bmet", kindAlias: "billable-metric" },
]
