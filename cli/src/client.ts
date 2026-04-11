import { type Treaty, treaty } from "@elysiajs/eden"
import type { FactoryApp } from "@smp/factory-api/app-type"

import { readConfig, resolveFactoryMode, resolveFactoryUrl } from "./config.js"
import { FactoryClient } from "./lib/api-client.js"
import { readSession, writeSession } from "./session-token.js"
import { getTraceHeaders } from "./telemetry.js"

export type FactoryEdenClient = Treaty.Create<FactoryApp>

// ---------------------------------------------------------------------------
// JWT helpers — the Factory API validates JWTs via JWKS, not opaque bearer
// tokens. The bearer token is only valid for the auth service (Better Auth).
// ---------------------------------------------------------------------------

function isJwtExpired(jwt: string): boolean {
  try {
    const parts = jwt.split(".")
    if (parts.length !== 3) return true
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))
    )
    return !payload.exp || Date.now() / 1000 > payload.exp - 60
  } catch {
    return true
  }
}

async function refreshJwt(
  factoryUrl: string,
  authBasePath: string,
  bearerToken: string
): Promise<string | null> {
  try {
    const res = await fetch(`${factoryUrl}${authBasePath}/get-session`, {
      method: "GET",
      headers: { Authorization: `Bearer ${bearerToken}` },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const headerJwt = res.headers.get("set-auth-jwt")
    if (headerJwt) {
      await writeSession({ jwt: headerJwt })
      return headerJwt
    }
    const data = (await res.json()) as Record<string, unknown>
    const bodyJwt = (data?.session as Record<string, unknown>)?.jwt ?? data?.jwt
    if (typeof bodyJwt === "string" && bodyJwt.length > 0) {
      await writeSession({ jwt: bodyJwt })
      return bodyJwt
    }
    return null
  } catch {
    return null
  }
}

/**
 * Resolve a valid JWT for the Factory API.
 *
 * Priority:
 * 1. Explicit `init.token` (caller override)
 * 2. Stored JWT (if not expired)
 * 3. Refreshed JWT (using bearer token against auth service)
 *
 * Never returns the Better Auth **opaque** `bearerToken` — the Factory API
 * verifies **compact JWS** via JWKS (`auth.plugin`). Sending the session
 * token produces `Invalid Compact JWS` from jose.
 */
async function resolveApiToken(
  factoryUrl: string,
  authBasePath: string,
  initToken?: string
): Promise<string | undefined> {
  if (initToken) return initToken

  const session = await readSession()
  const { jwt, bearerToken } = session

  // Use stored JWT if still valid
  if (jwt && !isJwtExpired(jwt)) return jwt

  // Refresh JWT using bearer token
  if (bearerToken) {
    const fresh = await refreshJwt(factoryUrl, authBasePath, bearerToken)
    if (fresh) return fresh
  }

  return undefined
}

/**
 * Resolve a valid API token (JWT) for the Factory API.
 * Convenience wrapper for callers that don't go through the Eden clients.
 */
export async function getFactoryApiToken(): Promise<string | undefined> {
  const cfg = await readConfig()
  const url = resolveFactoryUrl(cfg).replace(/\/$/, "")
  const token = await resolveApiToken(url, cfg.authBasePath)
  if (token) return token

  const { bearerToken, jwt } = await readSession()
  if (bearerToken && (!jwt || isJwtExpired(jwt))) {
    throw new Error(
      "Factory API requires a JWT, but yours is missing or stale and could not be refreshed. " +
        `The auth service must return a JWT (e.g. \`set-auth-jwt\` from GET ${url}${cfg.authBasePath}/get-session). ` +
        "Try: dx factory logout && dx factory login. " +
        "If this persists from a server or CI host, check that host can reach that URL and that prod auth is configured to issue Factory JWTs."
    )
  }

  return undefined
}

// ---------------------------------------------------------------------------
// Client factories
// ---------------------------------------------------------------------------

/**
 * Typed Eden client for the Factory API.
 */
export async function getFactoryClient(
  baseUrl?: string,
  init?: { token?: string }
): Promise<Treaty.Create<FactoryApp>> {
  const cfg = await readConfig()
  const url = (baseUrl ?? resolveFactoryUrl(cfg)).replace(/\/$/, "")

  // Auto-start local factory daemon only in local (embedded) mode.
  // In dev mode the factory runs as a container; in cloud mode it's remote.
  if (resolveFactoryMode(cfg).mode === "local") {
    const { ensureLocalDaemon } = await import("./local-daemon/lifecycle.js")
    await ensureLocalDaemon()
  }

  const token =
    init?.token ?? (await getFactoryApiToken())

  return treaty<FactoryApp>(url, {
    headers: () => ({
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...getTraceHeaders(),
    }),
  })
}

/**
 * Plain REST client for endpoints that Eden can't type (dynamic action paths,
 * hyphenated entity paths like ip-addresses).
 */
export async function getFactoryRestClient(
  baseUrl?: string,
  init?: { token?: string }
): Promise<FactoryClient> {
  const cfg = await readConfig()
  const url = (baseUrl ?? resolveFactoryUrl(cfg)).replace(/\/$/, "")
  const token =
    init?.token ?? (await getFactoryApiToken())
  return new FactoryClient(url, token)
}

/**
 * Typed Eden client for the local Site API.
 * Returns undefined if no siteUrl is configured.
 */
export async function getSiteClient(
  baseUrl?: string,
  init?: { token?: string }
): Promise<Treaty.Create<FactoryApp> | undefined> {
  const cfg = await readConfig()
  const siteUrl = baseUrl ?? cfg.siteUrl
  if (!siteUrl) return undefined

  const url = siteUrl.replace(/\/$/, "")
  // Refresh JWT against this host's auth (`get-session`), not necessarily `factoryUrl`.
  const token =
    init?.token ?? (await resolveApiToken(url, cfg.authBasePath))

  return treaty<FactoryApp>(url, {
    headers: () => ({
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...getTraceHeaders(),
    }),
  })
}
