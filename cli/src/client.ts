import { type Treaty, treaty } from "@elysiajs/eden"
import type { FactoryApp } from "@smp/factory-api/app-type"

import { readConfig, resolveFactoryUrl, resolveFactoryMode } from "./config.js"
import { FactoryClient } from "./lib/api-client.js"
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

  // Auto-start local factory daemon only in local (embedded) mode.
  // In dev mode the factory runs as a container; in cloud mode it's remote.
  if (resolveFactoryMode(cfg).mode === "local") {
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
  const stored = await getStoredBearerToken()
  const token = init?.token ?? stored
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
  const stored = await getStoredBearerToken()
  const token = init?.token ?? stored

  return treaty<FactoryApp>(url, {
    headers: () => ({
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...getTraceHeaders(),
    }),
  })
}
