/**
 * Commerce controller.
 *
 * Route → table mapping:
 *   /commerce/customers           → commerce.customer
 *   /commerce/plans               → commerce.plan
 *   /commerce/subscriptions       → commerce.subscription
 *   /commerce/subscription-items  → commerce.subscription_item
 *   /commerce/entitlement-bundles → commerce.entitlement_bundle
 *   /commerce/billable-metrics    → commerce.billable_metric
 */
import {
  CreateBillableMetricSchema,
  CreateCustomerSchema,
  CreateEntitlementBundleSchema,
  CreatePlanSchema,
  CreateSubscriptionItemSchema,
  CreateSubscriptionSchema,
  UpdateBillableMetricSchema,
  UpdateCustomerSchema,
  UpdateEntitlementBundleSchema,
  UpdatePlanSchema,
  UpdateSubscriptionItemSchema,
  UpdateSubscriptionSchema,
} from "@smp/factory-shared/schemas/commerce"
import type {
  CustomerSpec,
  EntitlementBundleSpec,
  SubscriptionSpec,
} from "@smp/factory-shared/schemas/commerce"
import { eq } from "drizzle-orm"
import { Elysia } from "elysia"
import { z } from "zod"

import type { Database } from "../../db/connection"
import { ConflictError } from "../../lib/errors"
import {
  billableMetric,
  customer,
  entitlementBundle,
  plan,
  subscription,
  subscriptionItem,
} from "../../db/schema/commerce"
import { tenant } from "../../db/schema/ops"
import { ontologyRoutes } from "../../lib/crud"
import { idempotencyPlugin } from "../../plugins/idempotency.plugin"

export function commerceController(db: Database) {
  return (
    new Elysia({ prefix: "/commerce" })
      .use(idempotencyPlugin(db))

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
            tenants: {
              path: "tenants",
              table: tenant,
              fk: tenant.customerId,
              bitemporal: {
                validTo: tenant.validTo,
                systemTo: tenant.systemTo,
              },
            },
          },
          actions: {
            activate: {
              handler: async ({ db, entity }) => {
                const spec = entity.spec as CustomerSpec
                if (spec.status === "active") return entity
                if (spec.status === "terminated")
                  throw new ConflictError(
                    "Cannot activate a terminated customer"
                  )
                const [row] = await db
                  .update(customer)
                  .set({
                    spec: { ...spec, status: "active" } as CustomerSpec,
                    updatedAt: new Date(),
                  })
                  .where(eq(customer.id, entity.id as string))
                  .returning()
                return row
              },
            },
            suspend: {
              handler: async ({ db, entity }) => {
                const spec = entity.spec as CustomerSpec
                if (spec.status !== "active")
                  throw new ConflictError("Can only suspend an active customer")
                const [row] = await db
                  .update(customer)
                  .set({
                    spec: { ...spec, status: "suspended" } as CustomerSpec,
                    updatedAt: new Date(),
                  })
                  .where(eq(customer.id, entity.id as string))
                  .returning()
                return row
              },
            },
            terminate: {
              handler: async ({ db, entity }) => {
                const spec = entity.spec as CustomerSpec
                if (spec.status === "terminated")
                  throw new ConflictError("Customer is already terminated")
                const [row] = await db
                  .update(customer)
                  .set({
                    spec: { ...spec, status: "terminated" } as CustomerSpec,
                    updatedAt: new Date(),
                  })
                  .where(eq(customer.id, entity.id as string))
                  .returning()
                return row
              },
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
          relations: {
            subscriptions: {
              path: "subscriptions",
              table: subscription,
              fk: subscription.planId,
              bitemporal: {
                validTo: subscription.validTo,
                systemTo: subscription.systemTo,
              },
            },
          },
        })
      )

      // ── Subscriptions ──────────────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "commerce",
          entity: "subscriptions",
          singular: "subscription",
          table: subscription,
          slugColumn: subscription.id,
          idColumn: subscription.id,
          prefix: "csub",
          kindAlias: "subscription",
          slugRefs: {
            customerSlug: {
              fk: "customerId",
              lookupTable: customer,
              lookupSlugCol: customer.slug,
              lookupIdCol: customer.id,
            },
            planSlug: {
              fk: "planId",
              lookupTable: plan,
              lookupSlugCol: plan.slug,
              lookupIdCol: plan.id,
            },
          },
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
          actions: {
            cancel: {
              bodySchema: z.object({ reason: z.string().optional() }),
              handler: async ({ db, entity, body }) => {
                const spec = entity.spec as SubscriptionSpec
                if (spec.status === "cancelled")
                  throw new ConflictError("Subscription is already cancelled")
                const parsed = body as { reason?: string }
                const [row] = await db
                  .update(subscription)
                  .set({
                    spec: {
                      ...spec,
                      status: "cancelled",
                      cancelledAt: new Date(),
                      cancelReason: parsed.reason,
                    } as SubscriptionSpec,
                    updatedAt: new Date(),
                  })
                  .where(eq(subscription.id, entity.id as string))
                  .returning()
                return row
              },
            },
            pause: {
              handler: async ({ db, entity }) => {
                const spec = entity.spec as SubscriptionSpec
                if (spec.status !== "active")
                  throw new ConflictError(
                    "Can only pause an active subscription"
                  )
                const [row] = await db
                  .update(subscription)
                  .set({
                    spec: {
                      ...spec,
                      status: "paused",
                    } as SubscriptionSpec,
                    updatedAt: new Date(),
                  })
                  .where(eq(subscription.id, entity.id as string))
                  .returning()
                return row
              },
            },
            resume: {
              handler: async ({ db, entity }) => {
                const spec = entity.spec as SubscriptionSpec
                if (spec.status !== "paused")
                  throw new ConflictError(
                    "Can only resume a paused subscription"
                  )
                const [row] = await db
                  .update(subscription)
                  .set({
                    spec: {
                      ...spec,
                      status: "active",
                    } as SubscriptionSpec,
                    updatedAt: new Date(),
                  })
                  .where(eq(subscription.id, entity.id as string))
                  .returning()
                return row
              },
            },
            reactivate: {
              handler: async ({ db, entity }) => {
                const spec = entity.spec as SubscriptionSpec
                if (spec.status !== "past_due")
                  throw new ConflictError(
                    "Can only reactivate a past_due subscription"
                  )
                const [row] = await db
                  .update(subscription)
                  .set({
                    spec: {
                      ...spec,
                      status: "active",
                    } as SubscriptionSpec,
                    updatedAt: new Date(),
                  })
                  .where(eq(subscription.id, entity.id as string))
                  .returning()
                return row
              },
            },
          },
        })
      )

      // ── Subscription Items ─────────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "commerce",
          entity: "subscription-items",
          singular: "subscription item",
          table: subscriptionItem,
          slugColumn: subscriptionItem.id,
          idColumn: subscriptionItem.id,
          prefix: "subi",
          kindAlias: "subscription-item",
          createSchema: CreateSubscriptionItemSchema,
          updateSchema: UpdateSubscriptionItemSchema,
          deletable: true,
        })
      )

      // ── Entitlement Bundles ────────────────────────────────
      .use(
        ontologyRoutes(db, {
          schema: "commerce",
          entity: "entitlement-bundles",
          singular: "entitlement bundle",
          table: entitlementBundle,
          slugColumn: entitlementBundle.id,
          idColumn: entitlementBundle.id,
          prefix: "bndl",
          kindAlias: "entitlement-bundle",
          slugRefs: {
            customerSlug: {
              fk: "customerId",
              lookupTable: customer,
              lookupSlugCol: customer.slug,
              lookupIdCol: customer.id,
            },
          },
          createSchema: CreateEntitlementBundleSchema,
          updateSchema: UpdateEntitlementBundleSchema,
          deletable: true,
          actions: {
            revoke: {
              handler: async ({ db, entity }) => {
                const spec = entity.spec as EntitlementBundleSpec
                const [row] = await db
                  .update(entitlementBundle)
                  .set({
                    spec: {
                      ...spec,
                      expiresAt: new Date(),
                    } as EntitlementBundleSpec,
                    updatedAt: new Date(),
                  })
                  .where(eq(entitlementBundle.id, entity.id as string))
                  .returning()
                return row
              },
            },
            refresh: {
              handler: async ({ db, entity }) => {
                const spec = entity.spec as EntitlementBundleSpec
                if (new Date(spec.expiresAt).getTime() < Date.now())
                  throw new ConflictError(
                    "Cannot refresh a revoked/expired bundle"
                  )
                const [row] = await db
                  .update(entitlementBundle)
                  .set({
                    spec: {
                      ...spec,
                      bundleVersion: spec.bundleVersion + 1,
                      expiresAt: new Date(
                        Date.now() + 30 * 24 * 60 * 60 * 1000
                      ),
                    } as EntitlementBundleSpec,
                    updatedAt: new Date(),
                  })
                  .where(eq(entitlementBundle.id, entity.id as string))
                  .returning()
                return row
              },
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

export const commerceOntologyConfigs: Pick<
  OntologyRouteConfig<any>,
  | "entity"
  | "singular"
  | "table"
  | "slugColumn"
  | "idColumn"
  | "prefix"
  | "kindAlias"
  | "slugRefs"
  | "createSchema"
>[] = [
  {
    entity: "customers",
    singular: "customer",
    table: customer,
    slugColumn: customer.slug,
    idColumn: customer.id,
    prefix: "cust",
    kindAlias: "customer",
  },
  {
    entity: "plans",
    singular: "plan",
    table: plan,
    slugColumn: plan.slug,
    idColumn: plan.id,
    prefix: "pln",
    kindAlias: "plan",
  },
  {
    entity: "subscriptions",
    singular: "subscription",
    table: subscription,
    slugColumn: subscription.id,
    idColumn: subscription.id,
    prefix: "csub",
    kindAlias: "subscription",
    slugRefs: {
      customerSlug: {
        fk: "customerId",
        lookupTable: customer,
        lookupSlugCol: customer.slug,
        lookupIdCol: customer.id,
      },
      planSlug: {
        fk: "planId",
        lookupTable: plan,
        lookupSlugCol: plan.slug,
        lookupIdCol: plan.id,
      },
    },
  },
  {
    entity: "subscription-items",
    singular: "subscription item",
    table: subscriptionItem,
    slugColumn: subscriptionItem.id,
    idColumn: subscriptionItem.id,
    prefix: "subi",
    kindAlias: "subscription-item",
  },
  {
    entity: "entitlement-bundles",
    singular: "entitlement bundle",
    table: entitlementBundle,
    slugColumn: entitlementBundle.id,
    idColumn: entitlementBundle.id,
    prefix: "bndl",
    kindAlias: "entitlement-bundle",
    slugRefs: {
      customerSlug: {
        fk: "customerId",
        lookupTable: customer,
        lookupSlugCol: customer.slug,
        lookupIdCol: customer.id,
      },
    },
  },
  {
    entity: "billable-metrics",
    singular: "billable metric",
    table: billableMetric,
    slugColumn: billableMetric.slug,
    idColumn: billableMetric.id,
    prefix: "bmet",
    kindAlias: "billable-metric",
  },
]
