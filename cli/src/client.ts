import { type Treaty, treaty } from "@elysiajs/eden"
import type { FactoryApp } from "@smp/factory-api/app-type"

import { readConfig, resolveFactoryUrl } from "./config.js"
import { getStoredBearerToken } from "./session-token.js"
import { getTraceHeaders } from "./telemetry.js"

export type FactoryEdenClient = Treaty.Create<FactoryApp>

/**
 * Typed Eden client for the Factory API.
 */
export async function getFactoryClient(
  baseUrl?: string,
  init?: { token?: string }
): Promise<Treaty.Create<FactoryApp>> {
  const cfg = await readConfig()
  const url = (baseUrl ?? resolveFactoryUrl(cfg)).replace(/\/$/, "")

  // Auto-start local factory daemon if targeting localhost
  if (isLocalFactoryUrl(url)) {
    const { ensureLocalDaemon } = await import("./local-daemon/lifecycle.js")
    await ensureLocalDaemon()
  }

  const stored = await getStoredBearerToken()
  const token = init?.token ?? stored

  return treaty<FactoryApp>(url, {
    headers: () => ({
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...getTraceHeaders(),
    }),
  })
}

function isLocalFactoryUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  } catch {
    return false
  }
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
  const stored = await getStoredBearerToken()
  const token = init?.token ?? stored

  return treaty<FactoryApp>(url, {
    headers: () => ({
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...getTraceHeaders(),
    }),
  })
}
