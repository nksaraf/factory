/**
 * Auto-fetch registry credentials from Factory API.
 *
 * During `dx setup`, if the developer is authenticated with a Factory,
 * this module fetches the org-level GAR credential secret via
 * GET /secrets/GOOGLE_APPLICATION_CREDENTIALS_BASE64 and writes it
 * to the local secret store — eliminating manual key handling.
 */
import { localSecretGet, localSecretSetMany } from "../secret-local-store.js"
import { registryAuthStore } from "./registry-auth-store.js"
import { REGISTRIES, decodeSaBase64, extractEmail } from "./registry.js"

export interface AutoFetchResult {
  fetched: boolean
  email?: string
}

const SECRET_SLUG = "GOOGLE_APPLICATION_CREDENTIALS_BASE64"

/**
 * Attempt to fetch registry credentials from the Factory API's org-level secrets.
 * Returns `{fetched: false}` silently on any failure (not authenticated, no Factory,
 * secret not set, network error, etc.).
 */
export async function tryFetchRegistryCredentialsFromFactory(): Promise<AutoFetchResult> {
  try {
    const { readConfig, resolveFactoryUrl } = await import("../../config.js")
    const { getFactoryApiToken } = await import("../../client.js")

    const token = await getFactoryApiToken()
    if (!token) return { fetched: false }

    const config = await readConfig()
    const factoryUrl = resolveFactoryUrl(config)
    if (!factoryUrl) return { fetched: false }

    const res = await fetch(
      `${factoryUrl}/api/factory/secrets/${SECRET_SLUG}?scopeType=org&scopeId=default`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(10_000),
      }
    )

    if (!res.ok) return { fetched: false }

    const data = (await res.json()) as { value?: string }
    if (!data.value) return { fetched: false }

    // Validate — must be decodable SA JSON with client_email
    const saJson = decodeSaBase64(data.value)
    if (!saJson) return { fetched: false }

    const email = extractEmail(saJson)
    if (!email) return { fetched: false }

    // Build full update map (same pattern as pkgAuth)
    const updates: Record<string, string> = {
      [SECRET_SLUG]: data.value,
    }
    for (const reg of Object.values(REGISTRIES)) {
      updates[reg.envVar] = data.value
    }
    updates._REGISTRY_CREDENTIALS_FETCHED_AT = new Date().toISOString()

    // Write to local secret store (0600) + global store (backward compat)
    localSecretSetMany(updates)
    await registryAuthStore.update((prev) => ({
      ...prev,
      ...Object.fromEntries(
        Object.entries(updates).filter(([k]) => !k.startsWith("_"))
      ),
    }))

    return { fetched: true, email }
  } catch {
    return { fetched: false }
  }
}

/**
 * Check whether locally-cached registry credentials are stale (>24h old).
 */
export function shouldRefreshRegistryCredentials(): boolean {
  const fetchedAt = localSecretGet("_REGISTRY_CREDENTIALS_FETCHED_AT")
  if (!fetchedAt) return true
  const ts = new Date(fetchedAt).getTime()
  if (isNaN(ts)) return true
  const age = Date.now() - ts
  return age > 24 * 60 * 60 * 1000
}
