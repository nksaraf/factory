import { eq } from "drizzle-orm"

import type { Database } from "../../db/connection"
import { entitlement, entitlementBundle } from "../../db/schema/commerce"
import {
  type EntitlementBundlePayload,
  signBundle,
  encodeBundle,
} from "@smp/factory-shared/entitlement-bundle"

export class BundleService {
  constructor(
    private readonly db: Database,
    private readonly signingKey: string
  ) {}

  async generateBundle(opts: {
    customerId: string
    siteId: string
    expiresAt: string
    gracePeriodDays?: number
  }) {
    const entitlements = await this.db
      .select()
      .from(entitlement)
      .where(eq(entitlement.customerId, opts.customerId))

    const activeEntitlements = entitlements
      .filter((e) => e.status === "active")
      .map((e) => ({
        entitlementId: e.entitlementId,
        moduleId: e.moduleId,
        status: e.status,
        quotas: (e.quotas ?? {}) as Record<string, number>,
      }))

    const payload: EntitlementBundlePayload = {
      version: 1,
      customerId: opts.customerId,
      siteId: opts.siteId,
      issuedAt: new Date().toISOString(),
      expiresAt: opts.expiresAt,
      gracePeriodDays: opts.gracePeriodDays ?? 30,
      entitlements: activeEntitlements,
    }

    const signed = signBundle(payload, this.signingKey)

    const [row] = await this.db
      .insert(entitlementBundle)
      .values({
        customerId: opts.customerId,
        siteId: opts.siteId,
        payload: payload as unknown as Record<string, unknown>,
        signature: signed.signature,
        expiresAt: new Date(opts.expiresAt),
        gracePeriodDays: opts.gracePeriodDays ?? 30,
      })
      .returning()

    return {
      bundleId: row!.bundleId,
      encoded: encodeBundle(signed),
      payload,
    }
  }
}
