import { and, desc, eq, sql } from "drizzle-orm"

import type { Database } from "../../db/connection"
import { allocateSlug } from "../../lib/slug"
import {
  customerAccount,
  commercePlan,
  entitlement,
} from "../../db/schema/commerce"

export type CreateCustomerBody = { name: string; slug?: string | null }
export type UpdateCustomerBody = {
  status: "trial" | "active" | "suspended" | "terminated"
}
export type CreatePlanBody = {
  name: string
  slug?: string | null
  includedModules?: string[]
}
export type CreateEntitlementBody = {
  customerId: string
  moduleId: string
  quotas?: Record<string, number>
  expiresAt?: string
  siteId?: string
}

export class CommercePlaneService {
  constructor(private readonly db: Database) {}

  async createCustomer(body: CreateCustomerBody) {
    const slug = await allocateSlug({
      baseLabel: body.name,
      explicitSlug: body.slug,
      isTaken: async (s) => {
        const [hit] = await this.db
          .select({ customerId: customerAccount.customerId })
          .from(customerAccount)
          .where(eq(customerAccount.slug, s))
          .limit(1)
        return !!hit
      },
    })
    const [row] = await this.db
      .insert(customerAccount)
      .values({ name: body.name, slug })
      .returning()
    return row
  }

  async getCustomer(customerId: string) {
    const [row] = await this.db
      .select()
      .from(customerAccount)
      .where(eq(customerAccount.customerId, customerId))
      .limit(1)
    return row ?? null
  }

  async listCustomers(q?: {
    status?: string
    limit?: number
    offset?: number
  }) {
    const limit = Math.min(q?.limit ?? 50, 200)
    const offset = q?.offset ?? 0
    const conditions = q?.status
      ? eq(customerAccount.status, q.status)
      : undefined
    const rows = await this.db
      .select()
      .from(customerAccount)
      .where(conditions)
      .orderBy(desc(customerAccount.createdAt))
      .limit(limit)
      .offset(offset)
    return { data: rows, total: rows.length }
  }

  async updateCustomerStatus(customerId: string, body: UpdateCustomerBody) {
    const [row] = await this.db
      .update(customerAccount)
      .set({ status: body.status })
      .where(eq(customerAccount.customerId, customerId))
      .returning()
    return row ?? null
  }

  async createPlan(body: CreatePlanBody) {
    const slug = await allocateSlug({
      baseLabel: body.name,
      explicitSlug: body.slug,
      isTaken: async (s) => {
        const [hit] = await this.db
          .select({ planId: commercePlan.planId })
          .from(commercePlan)
          .where(eq(commercePlan.slug, s))
          .limit(1)
        return !!hit
      },
    })
    const [row] = await this.db
      .insert(commercePlan)
      .values({
        name: body.name,
        slug,
        includedModules: body.includedModules ?? [],
      })
      .returning()
    return row
  }

  async listPlans(q?: { limit?: number; offset?: number }) {
    const limit = Math.min(q?.limit ?? 50, 200)
    const offset = q?.offset ?? 0
    const rows = await this.db
      .select()
      .from(commercePlan)
      .orderBy(desc(commercePlan.createdAt))
      .limit(limit)
      .offset(offset)
    return { data: rows, total: rows.length }
  }

  async grantEntitlement(body: CreateEntitlementBody) {
    const [row] = await this.db
      .insert(entitlement)
      .values({
        customerId: body.customerId,
        moduleId: body.moduleId,
        quotas: body.quotas ?? {},
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        siteId: body.siteId ?? null,
      })
      .returning()
    return row
  }

  async listEntitlements(q?: {
    customerId?: string
    status?: string
    limit?: number
    offset?: number
  }) {
    const limit = Math.min(q?.limit ?? 50, 200)
    const offset = q?.offset ?? 0
    const conditions = []
    if (q?.customerId)
      conditions.push(eq(entitlement.customerId, q.customerId))
    if (q?.status) conditions.push(eq(entitlement.status, q.status))
    const where = conditions.length > 0 ? and(...conditions) : undefined
    const rows = await this.db
      .select()
      .from(entitlement)
      .where(where)
      .orderBy(desc(entitlement.createdAt))
      .limit(limit)
      .offset(offset)
    return { data: rows, total: rows.length }
  }

  async revokeEntitlement(entitlementId: string) {
    const [row] = await this.db
      .update(entitlement)
      .set({ status: "revoked" })
      .where(eq(entitlement.entitlementId, entitlementId))
      .returning()
    return row ?? null
  }

  async usageSummary(q?: { customerId?: string }) {
    const conditions = q?.customerId
      ? eq(entitlement.customerId, q.customerId)
      : undefined
    const rows = await this.db
      .select({
        customerId: entitlement.customerId,
        activeEntitlements:
          sql<number>`count(*) filter (where ${entitlement.status} = 'active')::int`.as(
            "active_entitlements"
          ),
        totalEntitlements: sql<number>`count(*)::int`.as("total_entitlements"),
      })
      .from(entitlement)
      .where(conditions)
      .groupBy(entitlement.customerId)
    return { data: rows }
  }
}
