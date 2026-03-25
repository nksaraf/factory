import { Elysia } from "elysia"

import type { Database } from "../../db/connection"
import { BundleService } from "./bundle.service"
import { CommerceModel } from "./model"
import { CommercePlaneService } from "./plane.service"

export function commerceController(db: Database) {
  const plane = new CommercePlaneService(db)
  const signingKey = process.env.ENTITLEMENT_SIGNING_KEY
  const bundleSvc = signingKey ? new BundleService(db, signingKey) : null

  return new Elysia({ prefix: "/commerce" })
    .get(
      "/customers",
      async ({ query }) => ({
        success: true,
        ...(await plane.listCustomers({
          status: query.status,
          limit: query.limit,
          offset: query.offset,
        })),
      }),
      {
        query: CommerceModel.listCustomersQuery,
        detail: { tags: ["Commerce"], summary: "List customers" },
      }
    )
    .post(
      "/customers",
      async ({ body }) => {
        const row = await plane.createCustomer(body)
        return { success: true, data: row }
      },
      {
        body: CommerceModel.createCustomerBody,
        detail: { tags: ["Commerce"], summary: "Create customer" },
      }
    )
    .get(
      "/customers/:id",
      async ({ params, set }) => {
        const row = await plane.getCustomer(params.id)
        if (!row) {
          set.status = 404
          return { success: false, error: "not_found" }
        }
        return { success: true, data: row }
      },
      {
        params: CommerceModel.customerIdParams,
        detail: { tags: ["Commerce"], summary: "Get customer" },
      }
    )
    .patch(
      "/customers/:id",
      async ({ params, body, set }) => {
        const row = await plane.updateCustomerStatus(params.id, body)
        if (!row) {
          set.status = 404
          return { success: false, error: "not_found" }
        }
        return { success: true, data: row }
      },
      {
        params: CommerceModel.customerIdParams,
        body: CommerceModel.updateCustomerBody,
        detail: { tags: ["Commerce"], summary: "Update customer status" },
      }
    )
    .get(
      "/plans",
      async ({ query }) => ({
        success: true,
        ...(await plane.listPlans({
          limit: query.limit,
          offset: query.offset,
        })),
      }),
      {
        query: CommerceModel.listPlansQuery,
        detail: { tags: ["Commerce"], summary: "List plans" },
      }
    )
    .post(
      "/plans",
      async ({ body }) => {
        const row = await plane.createPlan(body)
        return { success: true, data: row }
      },
      {
        body: CommerceModel.createPlanBody,
        detail: { tags: ["Commerce"], summary: "Create plan" },
      }
    )
    .get(
      "/entitlements",
      async ({ query }) => ({
        success: true,
        ...(await plane.listEntitlements({
          customerId: query.customerId,
          status: query.status,
          limit: query.limit,
          offset: query.offset,
        })),
      }),
      {
        query: CommerceModel.listEntitlementsQuery,
        detail: { tags: ["Commerce"], summary: "List entitlements" },
      }
    )
    .post(
      "/entitlements",
      async ({ body }) => {
        const row = await plane.grantEntitlement(body)
        return { success: true, data: row }
      },
      {
        body: CommerceModel.createEntitlementBody,
        detail: { tags: ["Commerce"], summary: "Grant entitlement" },
      }
    )
    .delete(
      "/entitlements",
      async ({ query, set }) => {
        const row = await plane.revokeEntitlement(query.id)
        if (!row) {
          set.status = 404
          return { success: false, error: "not_found" }
        }
        return { success: true, data: row }
      },
      {
        query: CommerceModel.entitlementIdQuery,
        detail: { tags: ["Commerce"], summary: "Revoke entitlement" },
      }
    )
    .get(
      "/usage",
      async ({ query }) => ({
        success: true,
        ...(await plane.usageSummary({
          customerId: query.customerId,
        })),
      }),
      {
        query: CommerceModel.usageSummaryQuery,
        detail: { tags: ["Commerce"], summary: "Usage summary" },
      }
    )
    .post(
      "/bundles",
      async ({ body, set }) => {
        if (!bundleSvc) {
          set.status = 503
          return { success: false, error: "signing_key_not_configured" }
        }
        const result = await bundleSvc.generateBundle(body)
        return { success: true, data: result }
      },
      {
        body: CommerceModel.generateBundleBody,
        detail: { tags: ["Commerce"], summary: "Generate signed entitlement bundle" },
      }
    )
    .post(
      "/bundles/verify",
      async ({ body }) => {
        const { decodeBundle, verifyBundle, checkEnforcementState } =
          await import("@smp/factory-shared/entitlement-bundle")
        const publicKey = process.env.ENTITLEMENT_PUBLIC_KEY
        if (!publicKey) {
          return { success: false, error: "public_key_not_configured" }
        }
        try {
          const signed = decodeBundle(body.bundle)
          const payload = verifyBundle(signed, publicKey)
          const enforcement = checkEnforcementState(payload)
          return { success: true, data: { payload, enforcement } }
        } catch {
          return { success: false, error: "invalid_bundle" }
        }
      },
      {
        body: CommerceModel.verifyBundleBody,
        detail: { tags: ["Commerce"], summary: "Verify entitlement bundle" },
      }
    )
}
