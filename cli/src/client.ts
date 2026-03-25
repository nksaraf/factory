import { type Treaty, treaty } from "@elysiajs/eden"
import type { FactoryApp } from "@smp/factory-api/app-type"

import { loadConfig } from "./config.js"
import { getStoredBearerToken } from "./session-token.js"

export type FactoryEdenClient = Treaty.Create<FactoryApp>

/**
 * Typed Eden (treaty) client for the Factory Elysia API.
 */
export async function getFactoryClient(
  baseUrl?: string,
  init?: { token?: string }
): Promise<Treaty.Create<FactoryApp>> {
  const cfg = loadConfig()
  const url = (baseUrl ?? cfg.apiUrl).replace(/\/$/, "")
  const stored = await getStoredBearerToken()
  const token = init?.token ?? stored ?? cfg.token

  return treaty<FactoryApp>(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
}
