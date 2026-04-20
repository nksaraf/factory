import { z } from "zod"
import { defineEntity, link, Bitemporal, Junction } from "../schema/index"

export const Customer = defineEntity("customer", {
  namespace: "commerce",
  prefix: "cust",
  plural: "customers",
  description: "Customer account for billing and entitlements",
  traits: [Bitemporal],
  bitemporal: true,
  spec: z.object({
    type: z.enum(["direct", "reseller", "partner"]).optional(),
    status: z.enum(["trial", "active", "suspended", "terminated"]).optional(),
    billingEmail: z.string().optional(),
    companyName: z.string().optional(),
  }),
  links: {},
})

export const Plan = defineEntity("plan", {
  namespace: "commerce",
  prefix: "pln",
  plural: "plans",
  description: "Pricing/subscription plan",
  spec: z.object({
    description: z.string().optional(),
    price: z.number().optional(),
    billingInterval: z.enum(["monthly", "yearly"]).optional(),
    currency: z.string().optional(),
    trialDays: z.number().optional(),
    isPublic: z.boolean().optional(),
  }),
  links: {},
})

// TODO: subscription needs a slug column
export const Subscription = defineEntity("subscription", {
  namespace: "commerce",
  prefix: "csub",
  plural: "subscriptions",
  description: "Customer subscription to a plan",
  traits: [Bitemporal],
  bitemporal: true,
  spec: z.object({
    status: z
      .enum(["active", "past_due", "cancelled", "trialing", "paused"])
      .optional(),
    cancelAtPeriodEnd: z.boolean().optional(),
  }),
  links: {
    customer: link.manyToOne("customer", {
      fk: "customerId",
      inverse: "subscriptions",
      required: true,
    }),
    plan: link.manyToOne("plan", {
      fk: "planId",
      inverse: "subscriptions",
      required: true,
    }),
  },
})

export const BillableMetric = defineEntity("billableMetric", {
  namespace: "commerce",
  prefix: "bmet",
  plural: "billableMetrics",
  description: "Usage metric for billing",
  spec: z.object({
    aggregation: z.enum(["sum", "count", "max", "unique", "last"]).optional(),
    eventName: z.string().optional(),
    property: z.string().optional(),
    unit: z.string().optional(),
    description: z.string().optional(),
  }),
  links: {
    capability: link.manyToOne("capability", {
      fk: "capabilityId",
      inverse: "billableMetrics",
    }),
  },
})

export const SubscriptionItem = defineEntity("subscription-item", {
  namespace: "commerce",
  prefix: "subi",
  plural: "subscriptionItems",
  description: "Links a subscription to a capability with usage tracking",
  traits: [Junction],
  spec: z.object({
    status: z.enum(["active", "suspended", "revoked"]).optional(),
    quantity: z.number().optional(),
    usageLimit: z.number().optional(),
  }),
  links: {
    subscription: link.manyToOne("subscription", {
      fk: "subscriptionId",
      inverse: "items",
      required: true,
      cascade: "delete",
    }),
    capability: link.manyToOne("capability", {
      fk: "capabilityId",
      inverse: "subscriptionItems",
    }),
  },
})

export const EntitlementBundle = defineEntity("entitlement-bundle", {
  namespace: "commerce",
  prefix: "bndl",
  plural: "entitlementBundles",
  description: "Bundle of signed entitlements for a customer",
  spec: z.object({
    issuer: z.string().optional(),
    bundleVersion: z.number().optional(),
    capabilities: z.array(z.string()).optional(),
    maxSites: z.number().optional(),
  }),
  links: {
    customer: link.manyToOne("customer", {
      fk: "customerId",
      inverse: "entitlementBundles",
      required: true,
    }),
  },
})
