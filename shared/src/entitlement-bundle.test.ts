import { describe, expect, it } from "bun:test"
import {
  generateSigningKeyPair,
  signBundle,
  verifyBundle,
  checkEnforcementState,
  validateSiteBinding,
  encodeBundle,
  decodeBundle,
  type EntitlementBundlePayload,
} from "./entitlement-bundle"

describe("entitlement bundle", () => {
  const keys = generateSigningKeyPair()

  const payload: EntitlementBundlePayload = {
    version: 1,
    customerId: "cust_test",
    siteId: "site_prod_1",
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
    gracePeriodDays: 30,
    entitlements: [
      {
        entitlementId: "ent_1",
        moduleId: "mod_geo",
        status: "active",
        quotas: { maxSeats: 50 },
      },
    ],
  }

  it("signs and verifies a bundle", () => {
    const signed = signBundle(payload, keys.privateKey)
    const verified = verifyBundle(signed, keys.publicKey)
    expect(verified.customerId).toBe("cust_test")
    expect(verified.entitlements).toHaveLength(1)
  })

  it("rejects a tampered bundle", () => {
    const signed = signBundle(payload, keys.privateKey)
    signed.payload.entitlements[0]!.quotas.maxSeats = 99999
    expect(() => verifyBundle(signed, keys.publicKey)).toThrow(
      "ENTITLEMENT_BUNDLE_SIGNATURE_INVALID"
    )
  })

  it("rejects a bundle signed with a different key", () => {
    const otherKeys = generateSigningKeyPair()
    const signed = signBundle(payload, otherKeys.privateKey)
    expect(() => verifyBundle(signed, keys.publicKey)).toThrow(
      "ENTITLEMENT_BUNDLE_SIGNATURE_INVALID"
    )
  })

  it("encodes and decodes roundtrip", () => {
    const signed = signBundle(payload, keys.privateKey)
    const encoded = encodeBundle(signed)
    const decoded = decodeBundle(encoded)
    const verified = verifyBundle(decoded, keys.publicKey)
    expect(verified.siteId).toBe("site_prod_1")
  })

  it("checks enforcement state: active", () => {
    const result = checkEnforcementState(payload)
    expect(result.state).toBe("active")
    expect(result.daysRemaining).toBeGreaterThan(0)
  })

  it("checks enforcement state: grace", () => {
    const expired = {
      ...payload,
      expiresAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    }
    const result = checkEnforcementState(expired)
    expect(result.state).toBe("grace")
    expect(result.daysRemaining).toBeLessThanOrEqual(25)
  })

  it("checks enforcement state: lockout", () => {
    const longExpired = {
      ...payload,
      expiresAt: new Date(Date.now() - 60 * 86_400_000).toISOString(),
      gracePeriodDays: 30,
    }
    const result = checkEnforcementState(longExpired)
    expect(result.state).toBe("lockout")
    expect(result.daysRemaining).toBe(0)
  })

  it("validates site binding", () => {
    expect(validateSiteBinding(payload, "site_prod_1")).toBe(true)
    expect(validateSiteBinding(payload, "site_stolen")).toBe(false)
  })
})
