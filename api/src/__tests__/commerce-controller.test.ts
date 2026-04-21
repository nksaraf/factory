import type { PGlite } from "@electric-sql/pglite"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test"

import {
  type TestApp,
  createTestContext,
  truncateAllTables,
} from "../test-helpers"

interface ApiResponse<T = Record<string, unknown>> {
  data: T
}
interface ApiListResponse<T = Record<string, unknown>> {
  data: T[]
  meta?: { total: number; limit: number; offset: number }
}
interface ActionResponse<T = Record<string, unknown>> {
  data: T
  action: string
}

const BASE = "http://localhost/api/v1/factory/commerce"

function post(url: string, body: Record<string, unknown> = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function action(url: string, body: Record<string, unknown> = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("Commerce Controller", () => {
  let app: TestApp
  let client: PGlite

  beforeAll(async () => {
    const ctx = await createTestContext()
    app = ctx.app
    client = ctx.client
  })

  afterAll(async () => {
    await client.close()
  })

  beforeEach(async () => {
    await truncateAllTables(client)
  })

  // ==========================================================================
  // Customers — CRUD
  // ==========================================================================
  describe("customers", () => {
    it("POST creates and GET lists customers", async () => {
      const create = await app.handle(
        post(`${BASE}/customers`, {
          slug: "acme",
          name: "Acme Corp",
          spec: { type: "direct", status: "trial" },
        })
      )
      expect(create.status).toBe(200)
      const { data: created } = (await create.json()) as ApiResponse
      expect(created.id).toBeTruthy()
      expect(created.slug).toBe("acme")

      const list = await app.handle(new Request(`${BASE}/customers`))
      const { data } = (await list.json()) as ApiListResponse
      expect(data).toHaveLength(1)
      expect(data[0].name).toBe("Acme Corp")
    })

    it("GET /customers/:slug returns detail by slug", async () => {
      await app.handle(
        post(`${BASE}/customers`, {
          slug: "globex",
          name: "Globex Corp",
          spec: { type: "partner", status: "active" },
        })
      )

      const res = await app.handle(new Request(`${BASE}/customers/globex`))
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiResponse
      expect(data.name).toBe("Globex Corp")
    })

    it("GET /customers/:slug returns 404 for missing", async () => {
      const res = await app.handle(new Request(`${BASE}/customers/nonexistent`))
      expect(res.status).toBe(404)
    })

    it("POST /customers/:slug/update updates customer", async () => {
      await app.handle(
        post(`${BASE}/customers`, {
          slug: "update-me",
          name: "Update Me",
          spec: { type: "direct" },
        })
      )

      const res = await app.handle(
        post(`${BASE}/customers/update-me/update`, {
          name: "Updated Name",
          spec: { type: "reseller", billingEmail: "billing@example.com" },
        })
      )
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiResponse<{
        name: string
        spec: Record<string, unknown>
      }>
      expect(data.name).toBe("Updated Name")
      expect(data.spec.type).toBe("reseller")
      expect(data.spec.billingEmail).toBe("billing@example.com")
    })

    it("POST /customers/:slug/delete soft-deletes (bitemporal)", async () => {
      await app.handle(
        post(`${BASE}/customers`, {
          slug: "delete-me",
          name: "Delete Me",
          spec: {},
        })
      )

      const res = await app.handle(post(`${BASE}/customers/delete-me/delete`))
      expect(res.status).toBe(200)

      const list = await app.handle(new Request(`${BASE}/customers`))
      const { data } = (await list.json()) as ApiListResponse
      expect(data).toHaveLength(0)
    })
  })

  // ==========================================================================
  // Customer Lifecycle Actions
  // ==========================================================================
  describe("customer lifecycle actions", () => {
    async function createCustomer(
      slug: string,
      status: string = "trial"
    ): Promise<Record<string, unknown>> {
      const res = await app.handle(
        post(`${BASE}/customers`, {
          slug,
          name: `Customer ${slug}`,
          spec: { type: "direct", status },
        })
      )
      const { data } = (await res.json()) as ApiResponse
      return data
    }

    it("activate transitions trial → active", async () => {
      await createCustomer("trial-cust", "trial")

      const res = await app.handle(
        action(`${BASE}/customers/trial-cust/activate`)
      )
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ActionResponse<{
        spec: { status: string }
      }>
      expect(data.spec.status).toBe("active")
    })

    it("activate transitions suspended → active", async () => {
      await createCustomer("susp-cust", "suspended")

      const res = await app.handle(
        action(`${BASE}/customers/susp-cust/activate`)
      )
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ActionResponse<{
        spec: { status: string }
      }>
      expect(data.spec.status).toBe("active")
    })

    it("activate rejects terminated customer (409)", async () => {
      await createCustomer("term-cust", "terminated")

      const res = await app.handle(
        action(`${BASE}/customers/term-cust/activate`)
      )
      expect(res.status).toBe(409)
    })

    it("suspend only works on active customer", async () => {
      await createCustomer("active-cust", "active")

      const res = await app.handle(
        action(`${BASE}/customers/active-cust/suspend`)
      )
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ActionResponse<{
        spec: { status: string }
      }>
      expect(data.spec.status).toBe("suspended")
    })

    it("suspend rejects non-active customer (409)", async () => {
      await createCustomer("trial-cust2", "trial")

      const res = await app.handle(
        action(`${BASE}/customers/trial-cust2/suspend`)
      )
      expect(res.status).toBe(409)
    })

    it("terminate works from any non-terminated state", async () => {
      await createCustomer("to-terminate", "active")

      const res = await app.handle(
        action(`${BASE}/customers/to-terminate/terminate`)
      )
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ActionResponse<{
        spec: { status: string }
      }>
      expect(data.spec.status).toBe("terminated")
    })

    it("terminate rejects already-terminated customer (409)", async () => {
      await createCustomer("already-term", "terminated")

      const res = await app.handle(
        action(`${BASE}/customers/already-term/terminate`)
      )
      expect(res.status).toBe(409)
    })

    it("full lifecycle: trial → active → suspended → active → terminated", async () => {
      await createCustomer("lifecycle-cust", "trial")

      let res = await app.handle(
        action(`${BASE}/customers/lifecycle-cust/activate`)
      )
      expect(res.status).toBe(200)
      let body = (await res.json()) as ActionResponse<{
        spec: { status: string }
      }>
      expect(body.data.spec.status).toBe("active")

      res = await app.handle(action(`${BASE}/customers/lifecycle-cust/suspend`))
      expect(res.status).toBe(200)
      body = (await res.json()) as ActionResponse<{
        spec: { status: string }
      }>
      expect(body.data.spec.status).toBe("suspended")

      res = await app.handle(
        action(`${BASE}/customers/lifecycle-cust/activate`)
      )
      expect(res.status).toBe(200)
      body = (await res.json()) as ActionResponse<{
        spec: { status: string }
      }>
      expect(body.data.spec.status).toBe("active")

      res = await app.handle(
        action(`${BASE}/customers/lifecycle-cust/terminate`)
      )
      expect(res.status).toBe(200)
      body = (await res.json()) as ActionResponse<{
        spec: { status: string }
      }>
      expect(body.data.spec.status).toBe("terminated")

      // Cannot reactivate after termination
      res = await app.handle(
        action(`${BASE}/customers/lifecycle-cust/activate`)
      )
      expect(res.status).toBe(409)
    })
  })

  // ==========================================================================
  // Plans — CRUD
  // ==========================================================================
  describe("plans", () => {
    it("POST creates and GET lists plans", async () => {
      const create = await app.handle(
        post(`${BASE}/plans`, {
          slug: "starter",
          name: "Starter Plan",
          type: "base",
          spec: { price: 2999, billingInterval: "monthly", currency: "usd" },
        })
      )
      expect(create.status).toBe(200)
      const { data: created } = (await create.json()) as ApiResponse
      expect(created.slug).toBe("starter")

      const list = await app.handle(new Request(`${BASE}/plans`))
      const { data } = (await list.json()) as ApiListResponse
      expect(data).toHaveLength(1)
    })

    it("GET /plans/:slug returns detail", async () => {
      await app.handle(
        post(`${BASE}/plans`, {
          slug: "pro",
          name: "Pro Plan",
          type: "base",
          spec: {
            price: 9999,
            billingInterval: "monthly",
            currency: "usd",
            trialDays: 14,
          },
        })
      )

      const res = await app.handle(new Request(`${BASE}/plans/pro`))
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiResponse<{
        spec: Record<string, unknown>
      }>
      expect(data.spec.price).toBe(9999)
      expect(data.spec.trialDays).toBe(14)
    })

    it("POST /plans/:slug/delete hard-deletes plan", async () => {
      await app.handle(
        post(`${BASE}/plans`, {
          slug: "delete-plan",
          name: "Delete Me",
          type: "base",
          spec: { price: 0, billingInterval: "monthly" },
        })
      )

      const res = await app.handle(post(`${BASE}/plans/delete-plan/delete`))
      expect(res.status).toBe(200)

      const list = await app.handle(new Request(`${BASE}/plans`))
      const { data } = (await list.json()) as ApiListResponse
      expect(data).toHaveLength(0)
    })
  })

  // ==========================================================================
  // Subscriptions — CRUD + Relations
  // ==========================================================================
  describe("subscriptions", () => {
    async function seedCustomerAndPlan() {
      const custRes = await app.handle(
        post(`${BASE}/customers`, {
          slug: "sub-cust",
          name: "Sub Customer",
          spec: { type: "direct", status: "active" },
        })
      )
      const { data: cust } = (await custRes.json()) as ApiResponse

      const planRes = await app.handle(
        post(`${BASE}/plans`, {
          slug: "sub-plan",
          name: "Sub Plan",
          type: "base",
          spec: {
            price: 4999,
            billingInterval: "monthly",
            currency: "usd",
          },
        })
      )
      const { data: plan } = (await planRes.json()) as ApiResponse

      return {
        customerId: cust.id as string,
        planId: plan.id as string,
      }
    }

    it("POST creates subscription and GET lists", async () => {
      const { customerId, planId } = await seedCustomerAndPlan()

      const create = await app.handle(
        post(`${BASE}/subscriptions`, {
          customerId,
          planId,
          spec: {
            status: "trialing",
            currentPeriodStart: "2026-01-01T00:00:00Z",
            currentPeriodEnd: "2026-02-01T00:00:00Z",
          },
        })
      )
      expect(create.status).toBe(200)
      const { data: created } = (await create.json()) as ApiResponse
      expect(created.customerId).toBe(customerId)
      expect(created.planId).toBe(planId)

      const list = await app.handle(new Request(`${BASE}/subscriptions`))
      const { data } = (await list.json()) as ApiListResponse
      expect(data).toHaveLength(1)
    })

    it("GET /subscriptions/:id returns detail", async () => {
      const { customerId, planId } = await seedCustomerAndPlan()

      const createRes = await app.handle(
        post(`${BASE}/subscriptions`, {
          customerId,
          planId,
          spec: {
            status: "active",
            currentPeriodStart: "2026-01-01T00:00:00Z",
            currentPeriodEnd: "2026-02-01T00:00:00Z",
          },
        })
      )
      const { data: created } = (await createRes.json()) as ApiResponse

      const res = await app.handle(
        new Request(`${BASE}/subscriptions/${created.id}`)
      )
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiResponse<{
        spec: { status: string }
      }>
      expect(data.spec.status).toBe("active")
    })

    it("GET /customers/:slug/subscriptions returns related subscriptions", async () => {
      const { customerId, planId } = await seedCustomerAndPlan()

      await app.handle(
        post(`${BASE}/subscriptions`, {
          customerId,
          planId,
          spec: {
            status: "active",
            currentPeriodStart: "2026-01-01T00:00:00Z",
            currentPeriodEnd: "2026-02-01T00:00:00Z",
          },
        })
      )

      const res = await app.handle(
        new Request(`${BASE}/customers/sub-cust/subscriptions`)
      )
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiListResponse
      expect(data).toHaveLength(1)
    })

    it("GET /plans/:slug/subscriptions returns related subscriptions", async () => {
      const { customerId, planId } = await seedCustomerAndPlan()

      await app.handle(
        post(`${BASE}/subscriptions`, {
          customerId,
          planId,
          spec: {
            status: "active",
            currentPeriodStart: "2026-01-01T00:00:00Z",
            currentPeriodEnd: "2026-02-01T00:00:00Z",
          },
        })
      )

      const res = await app.handle(
        new Request(`${BASE}/plans/sub-plan/subscriptions`)
      )
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiListResponse
      expect(data).toHaveLength(1)
    })
  })

  // ==========================================================================
  // Subscription Lifecycle Actions
  // ==========================================================================
  describe("subscription lifecycle actions", () => {
    async function createActiveSubscription(): Promise<{
      subscriptionId: string
      customerId: string
      planId: string
    }> {
      const custRes = await app.handle(
        post(`${BASE}/customers`, {
          slug: `cust-${Date.now()}`,
          name: "Action Customer",
          spec: { type: "direct", status: "active" },
        })
      )
      const { data: cust } = (await custRes.json()) as ApiResponse

      const planRes = await app.handle(
        post(`${BASE}/plans`, {
          slug: `plan-${Date.now()}`,
          name: "Action Plan",
          type: "base",
          spec: { price: 1999, billingInterval: "monthly", currency: "usd" },
        })
      )
      const { data: plan } = (await planRes.json()) as ApiResponse

      const subRes = await app.handle(
        post(`${BASE}/subscriptions`, {
          customerId: cust.id,
          planId: plan.id,
          spec: {
            status: "active",
            currentPeriodStart: "2026-01-01T00:00:00Z",
            currentPeriodEnd: "2026-02-01T00:00:00Z",
          },
        })
      )
      const { data: sub } = (await subRes.json()) as ApiResponse

      return {
        subscriptionId: sub.id as string,
        customerId: cust.id as string,
        planId: plan.id as string,
      }
    }

    it("cancel sets status to cancelled with reason", async () => {
      const { subscriptionId } = await createActiveSubscription()

      const res = await app.handle(
        action(`${BASE}/subscriptions/${subscriptionId}/cancel`, {
          reason: "Too expensive",
        })
      )
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ActionResponse<{
        spec: { status: string; cancelReason: string; cancelledAt: string }
      }>
      expect(data.spec.status).toBe("cancelled")
      expect(data.spec.cancelReason).toBe("Too expensive")
      expect(data.spec.cancelledAt).toBeTruthy()
    })

    it("cancel rejects already-cancelled subscription (409)", async () => {
      const { subscriptionId } = await createActiveSubscription()

      await app.handle(action(`${BASE}/subscriptions/${subscriptionId}/cancel`))

      const res = await app.handle(
        action(`${BASE}/subscriptions/${subscriptionId}/cancel`)
      )
      expect(res.status).toBe(409)
    })

    it("pause sets status to paused", async () => {
      const { subscriptionId } = await createActiveSubscription()

      const res = await app.handle(
        action(`${BASE}/subscriptions/${subscriptionId}/pause`)
      )
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ActionResponse<{
        spec: { status: string }
      }>
      expect(data.spec.status).toBe("paused")
    })

    it("pause rejects non-active subscription (409)", async () => {
      const { subscriptionId } = await createActiveSubscription()

      // First pause
      await app.handle(action(`${BASE}/subscriptions/${subscriptionId}/pause`))

      // Double-pause should fail
      const res = await app.handle(
        action(`${BASE}/subscriptions/${subscriptionId}/pause`)
      )
      expect(res.status).toBe(409)
    })

    it("resume sets paused subscription back to active", async () => {
      const { subscriptionId } = await createActiveSubscription()

      await app.handle(action(`${BASE}/subscriptions/${subscriptionId}/pause`))

      const res = await app.handle(
        action(`${BASE}/subscriptions/${subscriptionId}/resume`)
      )
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ActionResponse<{
        spec: { status: string }
      }>
      expect(data.spec.status).toBe("active")
    })

    it("resume rejects non-paused subscription (409)", async () => {
      const { subscriptionId } = await createActiveSubscription()

      const res = await app.handle(
        action(`${BASE}/subscriptions/${subscriptionId}/resume`)
      )
      expect(res.status).toBe(409)
    })

    it("full lifecycle: trialing → cancel (allowed) — no state guard on trialing", async () => {
      const custRes = await app.handle(
        post(`${BASE}/customers`, {
          slug: `trial-cust-${Date.now()}`,
          name: "Trial Cust",
          spec: { type: "direct", status: "active" },
        })
      )
      const { data: cust } = (await custRes.json()) as ApiResponse
      const planRes = await app.handle(
        post(`${BASE}/plans`, {
          slug: `trial-plan-${Date.now()}`,
          name: "Trial Plan",
          type: "base",
          spec: {
            price: 0,
            billingInterval: "monthly",
            currency: "usd",
            trialDays: 14,
          },
        })
      )
      const { data: plan } = (await planRes.json()) as ApiResponse

      const subRes = await app.handle(
        post(`${BASE}/subscriptions`, {
          customerId: cust.id,
          planId: plan.id,
          spec: {
            status: "trialing",
            currentPeriodStart: "2026-01-01T00:00:00Z",
            currentPeriodEnd: "2026-01-15T00:00:00Z",
            trialEndsAt: "2026-01-15T00:00:00Z",
          },
        })
      )
      const { data: sub } = (await subRes.json()) as ApiResponse

      // Trialing subscription can be cancelled (not active, but not already cancelled)
      const cancelRes = await app.handle(
        action(`${BASE}/subscriptions/${sub.id}/cancel`, {
          reason: "Changed mind during trial",
        })
      )
      expect(cancelRes.status).toBe(200)
      const { data } = (await cancelRes.json()) as ActionResponse<{
        spec: { status: string; cancelReason: string }
      }>
      expect(data.spec.status).toBe("cancelled")
      expect(data.spec.cancelReason).toBe("Changed mind during trial")
    })

    it("complex flow: active → pause → resume → pause → cancel", async () => {
      const { subscriptionId } = await createActiveSubscription()

      // Pause
      let res = await app.handle(
        action(`${BASE}/subscriptions/${subscriptionId}/pause`)
      )
      expect(res.status).toBe(200)

      // Resume
      res = await app.handle(
        action(`${BASE}/subscriptions/${subscriptionId}/resume`)
      )
      expect(res.status).toBe(200)

      // Pause again
      res = await app.handle(
        action(`${BASE}/subscriptions/${subscriptionId}/pause`)
      )
      expect(res.status).toBe(200)

      // Cancel from paused — should fail because cancel guard checks !== "cancelled"
      // but pause doesn't block cancel. Let's verify...
      // Actually our cancel guard only checks if already cancelled, not if active.
      // So cancel from paused should work.
      res = await app.handle(
        action(`${BASE}/subscriptions/${subscriptionId}/cancel`)
      )
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ActionResponse<{
        spec: { status: string }
      }>
      expect(data.spec.status).toBe("cancelled")
    })

    it("cannot pause a cancelled subscription", async () => {
      const { subscriptionId } = await createActiveSubscription()

      await app.handle(action(`${BASE}/subscriptions/${subscriptionId}/cancel`))

      const res = await app.handle(
        action(`${BASE}/subscriptions/${subscriptionId}/pause`)
      )
      expect(res.status).toBe(409)
    })

    it("cannot resume a cancelled subscription", async () => {
      const { subscriptionId } = await createActiveSubscription()

      await app.handle(action(`${BASE}/subscriptions/${subscriptionId}/cancel`))

      const res = await app.handle(
        action(`${BASE}/subscriptions/${subscriptionId}/resume`)
      )
      expect(res.status).toBe(409)
    })
  })

  // ==========================================================================
  // Entitlement Bundles — CRUD + Actions
  // ==========================================================================
  describe("entitlement bundles", () => {
    async function createCustomerAndBundle() {
      const custRes = await app.handle(
        post(`${BASE}/customers`, {
          slug: `bndl-cust-${Date.now()}`,
          name: "Bundle Customer",
          spec: { type: "direct", status: "active" },
        })
      )
      const { data: cust } = (await custRes.json()) as ApiResponse

      const bundleRes = await app.handle(
        post(`${BASE}/entitlement-bundles`, {
          customerId: cust.id,
          spec: {
            signedPayload: "test-payload",
            signature: "test-sig",
            issuer: "factory",
            bundleVersion: 1,
            expiresAt: "2027-01-01T00:00:00Z",
            capabilities: ["feature-a", "feature-b"],
          },
        })
      )
      const { data: bundle } = (await bundleRes.json()) as ApiResponse

      return {
        customerId: cust.id as string,
        customerSlug: (cust as any).slug as string,
        bundleId: bundle.id as string,
      }
    }

    it("POST creates entitlement bundle", async () => {
      const { bundleId } = await createCustomerAndBundle()
      expect(bundleId).toBeTruthy()
    })

    it("GET /entitlement-bundles/:id returns detail", async () => {
      const { bundleId } = await createCustomerAndBundle()

      const res = await app.handle(
        new Request(`${BASE}/entitlement-bundles/${bundleId}`)
      )
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiResponse<{
        spec: { bundleVersion: number; capabilities: string[] }
      }>
      expect(data.spec.bundleVersion).toBe(1)
      expect(data.spec.capabilities).toEqual(["feature-a", "feature-b"])
    })

    it("GET /customers/:slug/bundles returns related bundles", async () => {
      const { customerSlug } = await createCustomerAndBundle()

      const res = await app.handle(
        new Request(`${BASE}/customers/${customerSlug}/bundles`)
      )
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiListResponse
      expect(data).toHaveLength(1)
    })

    it("revoke action expires bundle immediately", async () => {
      const { bundleId } = await createCustomerAndBundle()

      const res = await app.handle(
        action(`${BASE}/entitlement-bundles/${bundleId}/revoke`)
      )
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ActionResponse<{
        spec: { expiresAt: string }
      }>
      const expiresAt = new Date(data.spec.expiresAt)
      // Should be roughly now (within 5 seconds)
      expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 5000)
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now() - 60000)
    })

    it("refresh action bumps version and extends expiry", async () => {
      const { bundleId } = await createCustomerAndBundle()

      const res = await app.handle(
        action(`${BASE}/entitlement-bundles/${bundleId}/refresh`)
      )
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ActionResponse<{
        spec: { bundleVersion: number; expiresAt: string }
      }>
      expect(data.spec.bundleVersion).toBe(2)
      const expiresAt = new Date(data.spec.expiresAt)
      // Should be ~30 days from now
      const thirtyDaysFromNow = Date.now() + 29 * 24 * 60 * 60 * 1000
      expect(expiresAt.getTime()).toBeGreaterThan(thirtyDaysFromNow)
    })
  })

  // ==========================================================================
  // Billable Metrics — CRUD
  // ==========================================================================
  describe("billable metrics", () => {
    it("POST creates and GET lists billable metrics", async () => {
      const create = await app.handle(
        post(`${BASE}/billable-metrics`, {
          slug: "api-calls",
          name: "API Calls",
          spec: {
            aggregation: "count",
            eventName: "api.request",
            resetInterval: "billing_period",
          },
        })
      )
      expect(create.status).toBe(200)

      const list = await app.handle(new Request(`${BASE}/billable-metrics`))
      const { data } = (await list.json()) as ApiListResponse
      expect(data).toHaveLength(1)
      expect(data[0].slug).toBe("api-calls")
    })

    it("GET /billable-metrics/:slug returns detail", async () => {
      await app.handle(
        post(`${BASE}/billable-metrics`, {
          slug: "storage-gb",
          name: "Storage GB",
          spec: {
            aggregation: "max",
            eventName: "storage.usage",
            unit: "GB",
          },
        })
      )

      const res = await app.handle(
        new Request(`${BASE}/billable-metrics/storage-gb`)
      )
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiResponse<{
        spec: { aggregation: string; unit: string }
      }>
      expect(data.spec.aggregation).toBe("max")
      expect(data.spec.unit).toBe("GB")
    })

    it("POST /billable-metrics/:slug/delete hard-deletes", async () => {
      await app.handle(
        post(`${BASE}/billable-metrics`, {
          slug: "delete-metric",
          name: "Delete Me",
          spec: { aggregation: "sum", eventName: "test.event" },
        })
      )

      const res = await app.handle(
        post(`${BASE}/billable-metrics/delete-metric/delete`)
      )
      expect(res.status).toBe(200)

      const list = await app.handle(new Request(`${BASE}/billable-metrics`))
      const { data } = (await list.json()) as ApiListResponse
      expect(data).toHaveLength(0)
    })
  })

  // ==========================================================================
  // Cross-Entity Flow: Full Purchase Journey
  // ==========================================================================
  describe("full purchase journey", () => {
    it("customer trial → plan subscription → active → terminate cascade", async () => {
      // 1. Create customer in trial
      const custRes = await app.handle(
        post(`${BASE}/customers`, {
          slug: "journey-cust",
          name: "Journey Corp",
          spec: { type: "direct", status: "trial" },
        })
      )
      const { data: cust } = (await custRes.json()) as ApiResponse

      // 2. Create a plan
      const planRes = await app.handle(
        post(`${BASE}/plans`, {
          slug: "journey-plan",
          name: "Journey Plan",
          type: "base",
          spec: {
            price: 4999,
            billingInterval: "monthly",
            currency: "usd",
            trialDays: 14,
          },
        })
      )
      const { data: plan } = (await planRes.json()) as ApiResponse

      // 3. Subscribe (trialing)
      const subRes = await app.handle(
        post(`${BASE}/subscriptions`, {
          customerId: cust.id,
          planId: plan.id,
          spec: {
            status: "trialing",
            currentPeriodStart: "2026-01-01T00:00:00Z",
            currentPeriodEnd: "2026-01-15T00:00:00Z",
            trialEndsAt: "2026-01-15T00:00:00Z",
          },
        })
      )
      const { data: sub } = (await subRes.json()) as ApiResponse

      // 4. Activate customer
      let res = await app.handle(
        action(`${BASE}/customers/journey-cust/activate`)
      )
      expect(res.status).toBe(200)

      // 5. Issue entitlement bundle
      const bundleRes = await app.handle(
        post(`${BASE}/entitlement-bundles`, {
          customerId: cust.id,
          spec: {
            signedPayload: "signed",
            signature: "sig",
            issuer: "factory",
            bundleVersion: 1,
            expiresAt: "2027-06-01T00:00:00Z",
            capabilities: ["core", "analytics"],
          },
        })
      )
      expect(bundleRes.status).toBe(200)
      const { data: bundle } = (await bundleRes.json()) as ApiResponse

      // 6. Verify customer has subscription + bundle
      const custSubs = await app.handle(
        new Request(`${BASE}/customers/journey-cust/subscriptions`)
      )
      expect(((await custSubs.json()) as ApiListResponse).data).toHaveLength(1)

      const custBundles = await app.handle(
        new Request(`${BASE}/customers/journey-cust/bundles`)
      )
      expect(((await custBundles.json()) as ApiListResponse).data).toHaveLength(
        1
      )

      // 7. Terminate customer
      res = await app.handle(action(`${BASE}/customers/journey-cust/terminate`))
      expect(res.status).toBe(200)

      // 8. Customer is terminated but subscription and bundle data persists
      const finalCust = await app.handle(
        new Request(`${BASE}/customers/journey-cust`)
      )
      const { data: finalCustData } = (await finalCust.json()) as ApiResponse<{
        spec: { status: string }
      }>
      expect(finalCustData.spec.status).toBe("terminated")

      // Subscription still exists (wasn't cascade-deleted)
      const subCheck = await app.handle(
        new Request(`${BASE}/subscriptions/${sub.id}`)
      )
      expect(subCheck.status).toBe(200)
    })
  })

  // ==========================================================================
  // Edge Cases: Idempotency + Guard Coverage
  // ==========================================================================
  describe("edge cases", () => {
    it("activate on already-active customer is idempotent (200)", async () => {
      await app.handle(
        post(`${BASE}/customers`, {
          slug: "already-active",
          name: "Already Active",
          spec: { type: "direct", status: "active" },
        })
      )

      const res = await app.handle(
        action(`${BASE}/customers/already-active/activate`)
      )
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ActionResponse<{
        spec: { status: string }
      }>
      expect(data.spec.status).toBe("active")
    })

    it("terminate from suspended customer succeeds", async () => {
      await app.handle(
        post(`${BASE}/customers`, {
          slug: "susp-term",
          name: "Susp Term",
          spec: { type: "direct", status: "suspended" },
        })
      )

      const res = await app.handle(
        action(`${BASE}/customers/susp-term/terminate`)
      )
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ActionResponse<{
        spec: { status: string }
      }>
      expect(data.spec.status).toBe("terminated")
    })

    it("cancel without reason succeeds", async () => {
      const custRes = await app.handle(
        post(`${BASE}/customers`, {
          slug: `nr-cust-${Date.now()}`,
          name: "No Reason",
          spec: { type: "direct", status: "active" },
        })
      )
      const { data: cust } = (await custRes.json()) as ApiResponse
      const planRes = await app.handle(
        post(`${BASE}/plans`, {
          slug: `nr-plan-${Date.now()}`,
          name: "NR Plan",
          type: "base",
          spec: { price: 999, billingInterval: "monthly", currency: "usd" },
        })
      )
      const { data: plan } = (await planRes.json()) as ApiResponse
      const subRes = await app.handle(
        post(`${BASE}/subscriptions`, {
          customerId: cust.id,
          planId: plan.id,
          spec: {
            status: "active",
            currentPeriodStart: "2026-01-01T00:00:00Z",
            currentPeriodEnd: "2026-02-01T00:00:00Z",
          },
        })
      )
      const { data: sub } = (await subRes.json()) as ApiResponse

      const res = await app.handle(
        action(`${BASE}/subscriptions/${sub.id}/cancel`)
      )
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ActionResponse<{
        spec: { status: string; cancelReason?: string }
      }>
      expect(data.spec.status).toBe("cancelled")
      expect(data.spec.cancelReason).toBeUndefined()
    })

    it("pause on trialing subscription rejects (409)", async () => {
      const custRes = await app.handle(
        post(`${BASE}/customers`, {
          slug: `pt-cust-${Date.now()}`,
          name: "Pause Trial",
          spec: { type: "direct", status: "active" },
        })
      )
      const { data: cust } = (await custRes.json()) as ApiResponse
      const planRes = await app.handle(
        post(`${BASE}/plans`, {
          slug: `pt-plan-${Date.now()}`,
          name: "PT Plan",
          type: "base",
          spec: { price: 0, billingInterval: "monthly", currency: "usd" },
        })
      )
      const { data: plan } = (await planRes.json()) as ApiResponse
      const subRes = await app.handle(
        post(`${BASE}/subscriptions`, {
          customerId: cust.id,
          planId: plan.id,
          spec: {
            status: "trialing",
            currentPeriodStart: "2026-01-01T00:00:00Z",
            currentPeriodEnd: "2026-01-15T00:00:00Z",
          },
        })
      )
      const { data: sub } = (await subRes.json()) as ApiResponse

      const res = await app.handle(
        action(`${BASE}/subscriptions/${sub.id}/pause`)
      )
      expect(res.status).toBe(409)
    })

    it("past_due subscription: reactivate transitions to active", async () => {
      const custRes = await app.handle(
        post(`${BASE}/customers`, {
          slug: `pd-cust-${Date.now()}`,
          name: "Past Due",
          spec: { type: "direct", status: "active" },
        })
      )
      const { data: cust } = (await custRes.json()) as ApiResponse
      const planRes = await app.handle(
        post(`${BASE}/plans`, {
          slug: `pd-plan-${Date.now()}`,
          name: "PD Plan",
          type: "base",
          spec: { price: 4999, billingInterval: "monthly", currency: "usd" },
        })
      )
      const { data: plan } = (await planRes.json()) as ApiResponse
      const subRes = await app.handle(
        post(`${BASE}/subscriptions`, {
          customerId: cust.id,
          planId: plan.id,
          spec: {
            status: "past_due",
            currentPeriodStart: "2026-01-01T00:00:00Z",
            currentPeriodEnd: "2026-02-01T00:00:00Z",
          },
        })
      )
      const { data: sub } = (await subRes.json()) as ApiResponse

      const res = await app.handle(
        action(`${BASE}/subscriptions/${sub.id}/reactivate`)
      )
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ActionResponse<{
        spec: { status: string }
      }>
      expect(data.spec.status).toBe("active")
    })

    it("past_due subscription: pause rejects (409)", async () => {
      const custRes = await app.handle(
        post(`${BASE}/customers`, {
          slug: `pd2-cust-${Date.now()}`,
          name: "Past Due 2",
          spec: { type: "direct", status: "active" },
        })
      )
      const { data: cust } = (await custRes.json()) as ApiResponse
      const planRes = await app.handle(
        post(`${BASE}/plans`, {
          slug: `pd2-plan-${Date.now()}`,
          name: "PD2 Plan",
          type: "base",
          spec: { price: 4999, billingInterval: "monthly", currency: "usd" },
        })
      )
      const { data: plan } = (await planRes.json()) as ApiResponse
      const subRes = await app.handle(
        post(`${BASE}/subscriptions`, {
          customerId: cust.id,
          planId: plan.id,
          spec: {
            status: "past_due",
            currentPeriodStart: "2026-01-01T00:00:00Z",
            currentPeriodEnd: "2026-02-01T00:00:00Z",
          },
        })
      )
      const { data: sub } = (await subRes.json()) as ApiResponse

      const res = await app.handle(
        action(`${BASE}/subscriptions/${sub.id}/pause`)
      )
      expect(res.status).toBe(409)
    })

    it("past_due subscription: reactivate rejects non-past_due (409)", async () => {
      const custRes = await app.handle(
        post(`${BASE}/customers`, {
          slug: `pd3-cust-${Date.now()}`,
          name: "PD3",
          spec: { type: "direct", status: "active" },
        })
      )
      const { data: cust } = (await custRes.json()) as ApiResponse
      const planRes = await app.handle(
        post(`${BASE}/plans`, {
          slug: `pd3-plan-${Date.now()}`,
          name: "PD3 Plan",
          type: "base",
          spec: { price: 999, billingInterval: "monthly", currency: "usd" },
        })
      )
      const { data: plan } = (await planRes.json()) as ApiResponse
      const subRes = await app.handle(
        post(`${BASE}/subscriptions`, {
          customerId: cust.id,
          planId: plan.id,
          spec: {
            status: "active",
            currentPeriodStart: "2026-01-01T00:00:00Z",
            currentPeriodEnd: "2026-02-01T00:00:00Z",
          },
        })
      )
      const { data: sub } = (await subRes.json()) as ApiResponse

      const res = await app.handle(
        action(`${BASE}/subscriptions/${sub.id}/reactivate`)
      )
      expect(res.status).toBe(409)
    })

    it("refresh after revoke on entitlement bundle rejects (409)", async () => {
      const custRes = await app.handle(
        post(`${BASE}/customers`, {
          slug: `rv-cust-${Date.now()}`,
          name: "Revoke Test",
          spec: { type: "direct", status: "active" },
        })
      )
      const { data: cust } = (await custRes.json()) as ApiResponse
      const bundleRes = await app.handle(
        post(`${BASE}/entitlement-bundles`, {
          customerId: cust.id,
          spec: {
            signedPayload: "p",
            signature: "s",
            issuer: "factory",
            bundleVersion: 1,
            expiresAt: "2027-01-01T00:00:00Z",
            capabilities: ["x"],
          },
        })
      )
      const { data: bundle } = (await bundleRes.json()) as ApiResponse

      // Revoke it
      await app.handle(
        action(`${BASE}/entitlement-bundles/${bundle.id}/revoke`)
      )

      // Refresh should fail — bundle is expired/revoked
      const res = await app.handle(
        action(`${BASE}/entitlement-bundles/${bundle.id}/refresh`)
      )
      expect(res.status).toBe(409)
    })

    it("double revoke is idempotent (succeeds)", async () => {
      const custRes = await app.handle(
        post(`${BASE}/customers`, {
          slug: `dr-cust-${Date.now()}`,
          name: "Double Revoke",
          spec: { type: "direct", status: "active" },
        })
      )
      const { data: cust } = (await custRes.json()) as ApiResponse
      const bundleRes = await app.handle(
        post(`${BASE}/entitlement-bundles`, {
          customerId: cust.id,
          spec: {
            signedPayload: "p",
            signature: "s",
            issuer: "factory",
            bundleVersion: 1,
            expiresAt: "2027-01-01T00:00:00Z",
            capabilities: [],
          },
        })
      )
      const { data: bundle } = (await bundleRes.json()) as ApiResponse

      await app.handle(
        action(`${BASE}/entitlement-bundles/${bundle.id}/revoke`)
      )
      const res = await app.handle(
        action(`${BASE}/entitlement-bundles/${bundle.id}/revoke`)
      )
      expect(res.status).toBe(200)
    })

    it("update on terminated customer still works (billing address change)", async () => {
      await app.handle(
        post(`${BASE}/customers`, {
          slug: "term-update",
          name: "Term Update",
          spec: { type: "direct", status: "terminated" },
        })
      )

      const res = await app.handle(
        post(`${BASE}/customers/term-update/update`, {
          spec: {
            type: "direct",
            status: "terminated",
            billingEmail: "final@example.com",
          },
        })
      )
      expect(res.status).toBe(200)
      const { data } = (await res.json()) as ApiResponse<{
        spec: { billingEmail: string; status: string }
      }>
      expect(data.spec.billingEmail).toBe("final@example.com")
      expect(data.spec.status).toBe("terminated")
    })

    it("subscription items CRUD works", async () => {
      const custRes = await app.handle(
        post(`${BASE}/customers`, {
          slug: `si-cust-${Date.now()}`,
          name: "SI Customer",
          spec: { type: "direct", status: "active" },
        })
      )
      const { data: cust } = (await custRes.json()) as ApiResponse
      const planRes = await app.handle(
        post(`${BASE}/plans`, {
          slug: `si-plan-${Date.now()}`,
          name: "SI Plan",
          type: "base",
          spec: { price: 1999, billingInterval: "monthly", currency: "usd" },
        })
      )
      const { data: plan } = (await planRes.json()) as ApiResponse
      const subRes = await app.handle(
        post(`${BASE}/subscriptions`, {
          customerId: cust.id,
          planId: plan.id,
          spec: {
            status: "active",
            currentPeriodStart: "2026-01-01T00:00:00Z",
            currentPeriodEnd: "2026-02-01T00:00:00Z",
          },
        })
      )
      const { data: sub } = (await subRes.json()) as ApiResponse

      // Create subscription item
      const itemRes = await app.handle(
        post(`${BASE}/subscription-items`, {
          subscriptionId: sub.id,
          spec: { status: "active", quantity: 5 },
        })
      )
      expect(itemRes.status).toBe(200)
      const { data: item } = (await itemRes.json()) as ApiResponse
      expect(item.subscriptionId).toBe(sub.id)

      // List via relation
      const relRes = await app.handle(
        new Request(`${BASE}/subscriptions/${sub.id}/items`)
      )
      expect(relRes.status).toBe(200)
      const { data: items } = (await relRes.json()) as ApiListResponse
      expect(items).toHaveLength(1)

      // List via top-level
      const listRes = await app.handle(
        new Request(`${BASE}/subscription-items`)
      )
      expect(listRes.status).toBe(200)
      const { data: allItems } = (await listRes.json()) as ApiListResponse
      expect(allItems).toHaveLength(1)

      // Delete
      const delRes = await app.handle(
        post(`${BASE}/subscription-items/${item.id}/delete`)
      )
      expect(delRes.status).toBe(200)

      const afterDel = await app.handle(
        new Request(`${BASE}/subscription-items`)
      )
      expect(((await afterDel.json()) as ApiListResponse).data).toHaveLength(0)
    })
  })
})
