/**
 * Registry credential validation via HTTP probes.
 *
 * Exchanges a GCP service-account JSON key for an OAuth2 access token,
 * then hits each Artifact Registry endpoint to confirm the credentials
 * actually work end-to-end.
 */

import { createSign } from "node:crypto"
import { GCP_PROJECT, REGISTRIES } from "./registry.js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProbeResult {
  registry: string
  label: string
  status: "pass" | "fail" | "skip"
  httpStatus?: number
  message: string
  hint?: string
}

// ---------------------------------------------------------------------------
// GCP OAuth2 token exchange (JWT bearer flow, no external deps)
// ---------------------------------------------------------------------------

function base64url(input: Buffer): string {
  return input.toString("base64url")
}

export async function getGcpAccessToken(saJson: string): Promise<string> {
  const sa = JSON.parse(saJson) as {
    client_email: string
    private_key: string
    token_uri?: string
  }

  const tokenUri = sa.token_uri ?? "https://oauth2.googleapis.com/token"
  const now = Math.floor(Date.now() / 1000)

  const header = base64url(
    Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" }))
  )
  const payload = base64url(
    Buffer.from(
      JSON.stringify({
        iss: sa.client_email,
        scope: "https://www.googleapis.com/auth/cloud-platform",
        aud: tokenUri,
        iat: now,
        exp: now + 3600,
      })
    )
  )

  const unsigned = `${header}.${payload}`
  const signer = createSign("RSA-SHA256")
  signer.update(unsigned)
  const signature = signer.sign(sa.private_key, "base64url")

  const assertion = `${unsigned}.${signature}`

  const resp = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${assertion}`,
    signal: AbortSignal.timeout(10_000),
  })

  if (!resp.ok) {
    const body = await resp.text().catch(() => "")
    throw new Error(
      `Token exchange failed (${resp.status}): ${body.slice(0, 200)}`
    )
  }

  const data = (await resp.json()) as { access_token?: string }
  if (!data.access_token) {
    throw new Error("Token response missing access_token")
  }
  return data.access_token
}

// ---------------------------------------------------------------------------
// Per-registry probes
// ---------------------------------------------------------------------------

const PROBE_TIMEOUT = 10_000

interface ProbeConfig {
  url: string
  method?: string
  /** Whether a 404 is treated as "authenticated but empty repo" (default: true) */
  accept404?: boolean
}

/** Probe configs derived from REGISTRIES + GCP_PROJECT — single source of truth. */
const PROBE_CONFIGS: Record<string, ProbeConfig> = {
  docker: {
    url: `https://${REGISTRIES.docker.host}/v2/`,
    accept404: false,
  },
  npm: {
    url: `https://${REGISTRIES.npm.host}/${GCP_PROJECT}/${REGISTRIES.npm.repo}/`,
  },
  maven: {
    url: `https://${REGISTRIES.maven.host}/${GCP_PROJECT}/${REGISTRIES.maven.repo}/`,
    method: "HEAD",
  },
  python: {
    url: `https://${REGISTRIES.python.host}/${GCP_PROJECT}/${REGISTRIES.python.repo}/simple/`,
  },
}

async function probeRegistry(
  config: ProbeConfig,
  token: string
): Promise<{ ok: boolean; status: number; message: string; hint?: string }> {
  const accept404 = config.accept404 !== false
  const resp = await fetch(config.url, {
    method: config.method ?? "GET",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(PROBE_TIMEOUT),
  })

  if (resp.ok || (accept404 && resp.status === 404)) {
    return {
      ok: true,
      status: resp.status,
      message: resp.ok ? "authenticated" : "authenticated (empty repo)",
    }
  }
  return {
    ok: false,
    status: resp.status,
    message: `${resp.status} ${resp.statusText}`,
    hint: hintForStatus(resp.status),
  }
}

function hintForStatus(status: number): string {
  if (status === 401) {
    return "Credentials expired or revoked — re-run `dx pkg auth --key-file <path>`"
  }
  if (status === 403) {
    return `Service account lacks Artifact Registry Reader/Writer role on project ${GCP_PROJECT}`
  }
  return "Unexpected status — check registry and credentials"
}

export async function probeAllRegistries(
  saJson: string
): Promise<ProbeResult[]> {
  let token: string
  try {
    token = await getGcpAccessToken(saJson)
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "Unknown error during token exchange"
    // All registries skip if we can't get a token
    return Object.entries(REGISTRIES).map(([name, reg]) => ({
      registry: name,
      label: reg.label,
      status: "fail" as const,
      message: `Token exchange failed: ${msg}`,
      hint: "Check that the service account key is valid and not expired",
    }))
  }

  const results = await Promise.allSettled(
    Object.entries(PROBE_CONFIGS).map(async ([name, config]) => {
      const reg = REGISTRIES[name]
      try {
        const result = await probeRegistry(config, token)
        return {
          registry: name,
          label: reg.label,
          status: result.ok ? ("pass" as const) : ("fail" as const),
          httpStatus: result.status,
          message: result.message,
          hint: result.hint,
        }
      } catch (err) {
        const isTimeout = err instanceof Error && err.name === "TimeoutError"
        return {
          registry: name,
          label: reg.label,
          status: "skip" as const,
          message: isTimeout
            ? "Timed out after 10s"
            : `Network error: ${err instanceof Error ? err.message : "unknown"}`,
          hint: "Could not reach registry — check network connectivity",
        }
      }
    })
  )

  return results.map((r) => {
    if (r.status === "fulfilled") return r.value
    return {
      registry: "unknown",
      label: "Unknown",
      status: "skip" as const,
      message: r.reason?.message ?? "Unknown error",
      hint: "Unexpected probe failure",
    }
  })
}
