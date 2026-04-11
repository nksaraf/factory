/**
 * AES-256-GCM encryption for secret values.
 *
 * Master key is loaded from FACTORY_SECRET_MASTER_KEY env var (64-char hex = 32 bytes).
 * For local/dev use, a deterministic fallback key is derived so the feature works
 * without explicit configuration (not suitable for production).
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

const ALGO = "aes-256-gcm"
const IV_BYTES = 12 // GCM standard

let _warnedFallback = false
const _warnedVersions = new Set<number>()

function getMasterKey(version?: number): Buffer {
  const v = version ?? 1
  const envVar =
    v === 1 ? "FACTORY_SECRET_MASTER_KEY" : `FACTORY_SECRET_MASTER_KEY_V${v}`
  const hex = process.env[envVar]
  if (hex && hex.length === 64) {
    return Buffer.from(hex, "hex")
  }
  // If a versioned key is missing, fall back to v1 key with a warning
  if (v > 1) {
    if (!_warnedVersions.has(v)) {
      _warnedVersions.add(v)
      console.warn(
        `[secrets] ${envVar} not set — falling back to FACTORY_SECRET_MASTER_KEY`
      )
    }
    return getMasterKey(1)
  }
  // Deterministic fallback for local development (PGlite daemon, tests).
  // NOT suitable for production — log a warning once.
  if (!_warnedFallback) {
    _warnedFallback = true
    console.warn(
      "[secrets] FACTORY_SECRET_MASTER_KEY not set — using local dev fallback key"
    )
  }
  return Buffer.from(
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "hex"
  )
}

export interface EncryptedPayload {
  ciphertext: string // base64
  iv: string // base64
  authTag: string // base64
  keyVersion?: number // encryption key version (defaults to 1)
}

export function encrypt(
  plaintext: string,
  keyVersion?: number
): EncryptedPayload {
  const v = keyVersion ?? 1
  const key = getMasterKey(v)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, key, iv)
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    keyVersion: v,
  }
}

export function decrypt(payload: EncryptedPayload): string {
  const key = getMasterKey(payload.keyVersion ?? 1)
  const iv = Buffer.from(payload.iv, "base64")
  const authTag = Buffer.from(payload.authTag, "base64")
  const ciphertext = Buffer.from(payload.ciphertext, "base64")

  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(authTag)
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ])

  return decrypted.toString("utf8")
}
