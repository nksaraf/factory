/**
 * Zod schemas for the `commerce` schema — "Customer State"
 * Single source of truth. TS types derived via z.infer<>.
 */

import { z } from "zod"
import { BitemporalSchema } from "./common"

// ── Customer ────────────────────────────────────────────────

export const CustomerTypeSchema = z.enum(["direct", "reseller", "partner"])
export type CustomerType = z.infer<typeof CustomerTypeSchema>

export const CustomerStatusSchema = z.enum([
  "trial",
  "active",
  "suspended",
  "terminated",
])
export type CustomerStatus = z.infer<typeof CustomerStatusSchema>

export const CustomerSpecSchema = z.object({
  type: CustomerTypeSchema.default("direct"),
  status: CustomerStatusSchema.default("trial"),
  billingEmail: z.string().email().optional(),
  companyName: z.string().optional(),
  stripeId: z.string().optional(),
  website: z.string().url().optional(),
  address: z
    .object({
      line1: z.string().optional(),
      line2: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      postalCode: z.string().optional(),
      country: z.string().optional(),
    })
    .optional(),
})
export type CustomerSpec = z.infer<typeof CustomerSpecSchema>

export const CustomerSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    spec: CustomerSpecSchema,
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
  })
  .merge(BitemporalSchema)
export type Customer = z.infer<typeof CustomerSchema>

// ── Subscription ────────────────────────────────────────────

export const SubscriptionStatusSchema = z.enum([
  "active",
  "past_due",
  "cancelled",
  "trialing",
  "paused",
])
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>

export const SubscriptionSpecSchema = z.object({
  status: SubscriptionStatusSchema.default("trialing"),
  currentPeriodStart: z.coerce.date(),
  currentPeriodEnd: z.coerce.date(),
  cancelAtPeriodEnd: z.boolean().default(false),
  trialEndsAt: z.coerce.date().optional(),
  stripeSubscriptionId: z.string().optional(),
  cancelledAt: z.coerce.date().optional(),
  cancelReason: z.string().optional(),
})
export type SubscriptionSpec = z.infer<typeof SubscriptionSpecSchema>

export const SubscriptionSchema = z
  .object({
    id: z.string(),
    customerId: z.string(),
    planId: z.string(),
    spec: SubscriptionSpecSchema,
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
  })
  .merge(BitemporalSchema)
export type Subscription = z.infer<typeof SubscriptionSchema>

// ── Subscription Item ───────────────────────────────────────

export const SubscriptionItemStatusSchema = z.enum([
  "active",
  "suspended",
  "revoked",
])
export type SubscriptionItemStatus = z.infer<
  typeof SubscriptionItemStatusSchema
>

export const SubscriptionItemSpecSchema = z.object({
  status: SubscriptionItemStatusSchema.default("active"),
  quantity: z.number().int().default(1),
  usageLimit: z.number().int().optional(),
  overagePolicy: z.enum(["block", "charge", "notify"]).default("block"),
  currentUsage: z.number().int().default(0),
  lastResetAt: z.coerce.date().optional(),
})
export type SubscriptionItemSpec = z.infer<typeof SubscriptionItemSpecSchema>

export const SubscriptionItemSchema = z.object({
  id: z.string(),
  subscriptionId: z.string(),
  capabilityId: z.string(),
  spec: SubscriptionItemSpecSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})
export type SubscriptionItem = z.infer<typeof SubscriptionItemSchema>

// ── Plan ────────────────────────────────────────────────────

export const PlanTypeSchema = z.enum(["base", "add-on", "suite"])
export type PlanType = z.infer<typeof PlanTypeSchema>

export const BillingIntervalSchema = z.enum(["monthly", "yearly"])
export type BillingInterval = z.infer<typeof BillingIntervalSchema>

export const PlanSpecSchema = z.object({
  description: z.string().optional(),
  price: z.number().min(0), // in cents
  billingInterval: BillingIntervalSchema.default("monthly"),
  currency: z.string().default("usd"),
  includedCapabilities: z.array(z.string()).default([]),
  trialDays: z.number().int().default(0),
  isPublic: z.boolean().default(true),
  stripePriceId: z.string().optional(),
})
export type PlanSpec = z.infer<typeof PlanSpecSchema>

export const PlanSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  type: PlanTypeSchema,
  spec: PlanSpecSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})
export type Plan = z.infer<typeof PlanSchema>

// ── Entitlement Bundle ──────────────────────────────────────

export const EntitlementBundleSpecSchema = z.object({
  signedPayload: z.string(),
  signature: z.string(),
  issuer: z.string().default("factory"),
  bundleVersion: z.number().int().default(1),
  expiresAt: z.coerce.date(),
  capabilities: z.array(z.string()).default([]),
  maxSites: z.number().int().optional(),
})
export type EntitlementBundleSpec = z.infer<typeof EntitlementBundleSpecSchema>

export const EntitlementBundleSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  spec: EntitlementBundleSpecSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})
export type EntitlementBundle = z.infer<typeof EntitlementBundleSchema>

// ── Billable Metric ─────────────────────────────────────────

export const AggregationTypeSchema = z.enum([
  "sum",
  "count",
  "max",
  "unique",
  "last",
])
export type AggregationType = z.infer<typeof AggregationTypeSchema>

export const BillableMetricSpecSchema = z.object({
  aggregation: AggregationTypeSchema.default("count"),
  eventName: z.string(),
  property: z.string().optional(),
  resetInterval: z
    .enum(["billing_period", "daily", "monthly", "never"])
    .default("billing_period"),
  unit: z.string().optional(), // e.g., "GB", "requests", "seats"
  description: z.string().optional(),
})
export type BillableMetricSpec = z.infer<typeof BillableMetricSpecSchema>

export const BillableMetricSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  capabilityId: z.string(),
  spec: BillableMetricSpecSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})
export type BillableMetric = z.infer<typeof BillableMetricSchema>

// ── Input Schemas (CREATE / UPDATE) ────────────────────────

export const CreateCustomerSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  spec: CustomerSpecSchema.default({}),
})
export const UpdateCustomerSchema = CreateCustomerSchema.partial()

export const CreatePlanSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  type: PlanTypeSchema,
  spec: PlanSpecSchema,
})
export const UpdatePlanSchema = CreatePlanSchema.partial()

export const CreateSubscriptionSchema = z.object({
  customerId: z.string().optional(),
  planId: z.string().optional(),
  spec: SubscriptionSpecSchema,
})
export const UpdateSubscriptionSchema = CreateSubscriptionSchema.partial()

export const CreateSubscriptionItemSchema = z.object({
  subscriptionId: z.string(),
  capabilityId: z.string().optional(),
  spec: SubscriptionItemSpecSchema.default({}),
})
export const UpdateSubscriptionItemSchema =
  CreateSubscriptionItemSchema.partial()

export const CreateEntitlementBundleSchema = z.object({
  customerId: z.string(),
  spec: EntitlementBundleSpecSchema,
})
export const UpdateEntitlementBundleSchema =
  CreateEntitlementBundleSchema.partial()

export const CreateBillableMetricSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  capabilityId: z.string().optional(),
  spec: BillableMetricSpecSchema,
})
export const UpdateBillableMetricSchema = CreateBillableMetricSchema.partial()
