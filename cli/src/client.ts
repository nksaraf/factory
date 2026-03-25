import { type Treaty, treaty } from "@elysiajs/eden"
import type { FactoryApp } from "@smp/factory-api/app-type"

import { readConfig, resolveFactoryUrl } from "./config.js"
import { getStoredBearerToken } from "./session-token.js"

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
  const stored = await getStoredBearerToken()
  const token = init?.token ?? stored

  return treaty<FactoryApp>(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
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
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
}
