import { createPrivateKey, createPublicKey, sign, verify, generateKeyPairSync } from "node:crypto"

/** The payload embedded in a signed bundle */
export interface EntitlementBundlePayload {
  version: 1
  customerId: string
  siteId: string
  issuedAt: string
  expiresAt: string
  gracePeriodDays: number
  entitlements: Array<{
    entitlementId: string
    moduleId: string
    status: string
    quotas: Record<string, number>
  }>
}

/** A signed bundle — the artifact shipped to sites */
export interface SignedEntitlementBundle {
  payload: EntitlementBundlePayload
  signature: string  // base64 Ed25519 signature
}

/** Generate a new Ed25519 key pair for bundle signing */
export function generateSigningKeyPair(): {
  privateKey: string
  publicKey: string
} {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519")
  return {
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    publicKey: publicKey.export({ type: "spki", format: "pem" }) as string,
  }
}

/** Sign a bundle payload with the Factory's private key */
export function signBundle(
  payload: EntitlementBundlePayload,
  privateKeyPem: string
): SignedEntitlementBundle {
  const key = createPrivateKey(privateKeyPem)
  const data = Buffer.from(JSON.stringify(payload), "utf-8")
  const sig = sign(null, data, key)
  return {
    payload,
    signature: sig.toString("base64"),
  }
}

/** Verify a signed bundle. Returns payload if valid, throws if tampered. */
export function verifyBundle(
  bundle: SignedEntitlementBundle,
  publicKeyPem: string
): EntitlementBundlePayload {
  const key = createPublicKey(publicKeyPem)
  const data = Buffer.from(JSON.stringify(bundle.payload), "utf-8")
  const sig = Buffer.from(bundle.signature, "base64")
  const valid = verify(null, data, key, sig)
  if (!valid) {
    throw new Error("ENTITLEMENT_BUNDLE_SIGNATURE_INVALID")
  }
  return bundle.payload
}

/** Enforcement state based on bundle expiry */
export type EnforcementState = "active" | "grace" | "lockout"

/** Check enforcement state of a verified bundle */
export function checkEnforcementState(
  payload: EntitlementBundlePayload,
  now: Date = new Date()
): { state: EnforcementState; daysRemaining: number } {
  const expiresAt = new Date(payload.expiresAt)
  const graceEnd = new Date(expiresAt)
  graceEnd.setDate(graceEnd.getDate() + payload.gracePeriodDays)
  const msPerDay = 86_400_000

  if (now < expiresAt) {
    return {
      state: "active",
      daysRemaining: Math.ceil((expiresAt.getTime() - now.getTime()) / msPerDay),
    }
  }
  if (now < graceEnd) {
    return {
      state: "grace",
      daysRemaining: Math.ceil((graceEnd.getTime() - now.getTime()) / msPerDay),
    }
  }
  return { state: "lockout", daysRemaining: 0 }
}

/** Validate that a bundle is bound to the expected site */
export function validateSiteBinding(
  payload: EntitlementBundlePayload,
  expectedSiteId: string
): boolean {
  return payload.siteId === expectedSiteId
}

/** Decode a base64-encoded signed bundle string */
export function decodeBundle(encoded: string): SignedEntitlementBundle {
  const json = Buffer.from(encoded, "base64").toString("utf-8")
  return JSON.parse(json) as SignedEntitlementBundle
}

/** Encode a SignedEntitlementBundle to base64 for transport */
export function encodeBundle(bundle: SignedEntitlementBundle): string {
  return Buffer.from(JSON.stringify(bundle), "utf-8").toString("base64")
}
