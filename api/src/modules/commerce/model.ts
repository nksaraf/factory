import { t, type UnwrapSchema } from "elysia"

export const CommerceModel = {
  createCustomerBody: t.Object({
    name: t.String(),
    slug: t.Optional(t.String()),
  }),
  customerIdParams: t.Object({ id: t.String() }),
  createEntitlementBody: t.Object({
    customerId: t.String(),
    moduleId: t.String(),
    quotas: t.Optional(t.Record(t.String(), t.Number())),
    expiresAt: t.Optional(t.String()),
    siteId: t.Optional(t.String()),
  }),
  entitlementIdQuery: t.Object({ id: t.String() }),
  updateCustomerBody: t.Object({
    status: t.Union([
      t.Literal("trial"),
      t.Literal("active"),
      t.Literal("suspended"),
      t.Literal("terminated"),
    ]),
  }),
  createPlanBody: t.Object({
    name: t.String(),
    slug: t.Optional(t.String()),
    includedModules: t.Optional(t.Array(t.String())),
  }),
  listCustomersQuery: t.Object({
    status: t.Optional(t.String()),
    limit: t.Optional(t.Numeric()),
    offset: t.Optional(t.Numeric()),
  }),
  listEntitlementsQuery: t.Object({
    customerId: t.Optional(t.String()),
    status: t.Optional(t.String()),
    limit: t.Optional(t.Numeric()),
    offset: t.Optional(t.Numeric()),
  }),
  listPlansQuery: t.Object({
    limit: t.Optional(t.Numeric()),
    offset: t.Optional(t.Numeric()),
  }),
  usageSummaryQuery: t.Object({
    customerId: t.Optional(t.String()),
  }),
  generateBundleBody: t.Object({
    customerId: t.String(),
    siteId: t.String(),
    expiresAt: t.String(),
    gracePeriodDays: t.Optional(t.Number({ default: 30 })),
  }),
  verifyBundleBody: t.Object({
    bundle: t.String(),
  }),
} as const

export type CommerceModels = {
  [K in keyof typeof CommerceModel]: UnwrapSchema<(typeof CommerceModel)[K]>
}
