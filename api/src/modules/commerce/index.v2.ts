/**
 * v2 Commerce controller.
 *
 * Maps legacy commerce routes to v2 ontology tables:
 *   /commerce/customers       → commerce.customer
 *   /commerce/plans           → commerce.plan
 *   /commerce/subscriptions   → commerce.subscription   (was /commerce/entitlements)
 *   /commerce/billable-metrics → commerce.billable_metric
 */

import { Elysia } from "elysia";

import type { Database } from "../../db/connection";
import { ontologyRoutes } from "../../lib/crud";
import {
  customer,
  plan,
  subscription,
  subscriptionItem,
  entitlementBundle,
  billableMetric,
} from "../../db/schema/commerce-v2";

import {
  CreateCustomerSchema,
  UpdateCustomerSchema,
  CreatePlanSchema,
  UpdatePlanSchema,
  CreateSubscriptionSchema,
  UpdateSubscriptionSchema,
  CreateBillableMetricSchema,
  UpdateBillableMetricSchema,
} from "@smp/factory-shared/schemas/commerce";

export function commerceControllerV2(db: Database) {
  return new Elysia({ prefix: "/commerce" })

    // ── Customers ──────────────────────────────────────────
    .use(
      ontologyRoutes(db, {
        schema: "commerce",
        entity: "customers",
        singular: "customer",
        table: customer,
        slugColumn: customer.slug,
        idColumn: customer.id,
        createSchema: CreateCustomerSchema,
        updateSchema: UpdateCustomerSchema,
        deletable: "bitemporal",
        bitemporal: { validTo: customer.validTo, systemTo: customer.systemTo },
        relations: {
          subscriptions: {
            path: "subscriptions",
            table: subscription,
            fk: subscription.customerId,
            bitemporal: { validTo: subscription.validTo, systemTo: subscription.systemTo },
          },
          bundles: {
            path: "bundles",
            table: entitlementBundle,
            fk: entitlementBundle.customerId,
          },
        },
      }),
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
        createSchema: CreatePlanSchema,
        updateSchema: UpdatePlanSchema,
        deletable: true,
      }),
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
        createSchema: CreateSubscriptionSchema,
        updateSchema: UpdateSubscriptionSchema,
        deletable: "bitemporal",
        bitemporal: { validTo: subscription.validTo, systemTo: subscription.systemTo },
        relations: {
          items: {
            path: "items",
            table: subscriptionItem,
            fk: subscriptionItem.subscriptionId,
          },
        },
      }),
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
        createSchema: CreateBillableMetricSchema,
        updateSchema: UpdateBillableMetricSchema,
        deletable: true,
      }),
    );
}
