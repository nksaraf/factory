import { getFactoryClient, getFactoryRestClient } from "../client.js"
import type { FactoryClient } from "../lib/api-client.js"
import {
  apiCall,
  actionResult,
  colorStatus,
  detailView,
  styleBold,
  styleMuted,
  styleSuccess,
  tableOrJson,
  unwrapList,
} from "../commands/list-helpers.js"
import type { DxFlags } from "../stub.js"

// ── Types ────────────────────────────────────────────────────

type Principal = {
  id: string
  slug: string
  name: string
  type: string
  spec: Record<string, unknown>
  createdAt: string
}

type IdentityLinkRow = {
  id: string
  type: string
  externalId: string
  spec: Record<string, unknown>
}

type SyncResult = {
  provider: string
  linked: number
  created: number
  skipped: number
  deactivated: number
  errors: number
}

// ── Helpers ──────────────────────────────────────────────────

function providerTag(provider: string): string {
  const colors: Record<string, string> = {
    github: "\x1b[37m",  // white
    slack: "\x1b[35m",   // magenta
    jira: "\x1b[36m",    // cyan
    google: "\x1b[33m",  // yellow
  }
  const reset = "\x1b[0m"
  return `${colors[provider] ?? ""}${provider}${reset}`
}

function specString(spec: Record<string, unknown>, key: string): string {
  const val = spec?.[key]
  return typeof val === "string" ? val : ""
}

/** Unwrap a single-entity response: apiCall returns { data: row } for single GETs. */
function unwrapSingle<T>(data: unknown): T | undefined {
  if (data && typeof data === "object" && "data" in data) {
    return (data as Record<string, unknown>).data as T
  }
  return data as T | undefined
}

async function fetchIdentities(
  rest: FactoryClient,
  principalId: string,
): Promise<IdentityLinkRow[]> {
  const res = await rest.request<{ data: IdentityLinkRow[] }>(
    "GET",
    `/api/v1/factory/org/principals/${principalId}/identities`,
  )
  return res?.data ?? []
}

// ── List ─────────────────────────────────────────────────────

export async function runIdentityList(flags: DxFlags): Promise<void> {
  const api = await getFactoryClient()
  const rest = await getFactoryRestClient()
  const data = await apiCall(flags, () =>
    api.api.v1.factory.org.principals.get({ query: { limit: 500 } }),
  )

  const principals = unwrapList<Principal>(data)

  // Fetch identities for all principals in parallel (batched)
  const identityMap = new Map<string, IdentityLinkRow[]>()
  const batchSize = 20
  for (let i = 0; i < principals.length; i += batchSize) {
    const batch = principals.slice(i, i + batchSize)
    const results = await Promise.allSettled(
      batch.map(async (p) => {
        const links = await fetchIdentities(rest, p.id)
        return { id: p.id, links }
      }),
    )
    for (const r of results) {
      if (r.status === "fulfilled") {
        identityMap.set(r.value.id, r.value.links)
      }
    }
  }

  if (flags.json) {
    const enriched = principals.map((p) => ({
      ...p,
      identities: identityMap.get(p.id) ?? [],
    }))
    console.log(JSON.stringify({ success: true, data: enriched }, null, 2))
    return
  }

  if (principals.length === 0) {
    console.log("No principals found.")
    return
  }

  // Build table with provider columns
  const providers = ["github", "slack", "jira", "google"]
  const headers = ["NAME", "EMAIL", ...providers.map((p) => p.toUpperCase())]

  const rowsWithCount = principals.map((p) => {
    const links = identityMap.get(p.id) ?? []
    const email = specString(p.spec, "email")
    const linkCount = links.length
    const cols = providers.map((prov) => {
      const link = links.find((l) => l.type === prov)
      if (!link) return styleMuted("-")
      const login = specString(link.spec, "displayName") || link.externalId
      return providerTag(prov).replace(prov, login)
    })
    return { row: [styleBold(p.name), email, ...cols], linkCount, name: p.name }
  })

  // Sort by number of providers linked (descending), then name
  rowsWithCount.sort((a, b) => {
    if (b.linkCount !== a.linkCount) return b.linkCount - a.linkCount
    return a.name.localeCompare(b.name)
  })

  const rows = rowsWithCount.map((r) => r.row)

  const { printTable } = await import("../output.js")
  console.log(printTable(headers, rows))
}

// ── Show ─────────────────────────────────────────────────────

export async function runIdentityShow(
  flags: DxFlags,
  slugOrId: string,
): Promise<void> {
  const api = await getFactoryClient()
  const rest = await getFactoryRestClient()
  const data = await apiCall(flags, () =>
    api.api.v1.factory.org.principals({ slugOrId }).get(),
  )

  const principal = unwrapSingle<Principal>(data)

  if (!principal) {
    console.log("Principal not found.")
    return
  }

  const links = await fetchIdentities(rest, principal.id)

  if (flags.json) {
    console.log(JSON.stringify({ success: true, data: { ...principal, identities: links } }, null, 2))
    return
  }

  console.log(styleBold(principal.name))
  console.log(`${styleMuted("ID")}     ${principal.id}`)
  console.log(`${styleMuted("Slug")}   ${principal.slug}`)
  console.log(`${styleMuted("Type")}   ${principal.type}`)
  console.log(`${styleMuted("Email")}  ${specString(principal.spec, "email") || styleMuted("-")}`)
  console.log()

  if (links.length === 0) {
    console.log(styleMuted("  No linked identities"))
  } else {
    console.log(styleBold("Linked Identities:"))
    for (const link of links) {
      const login = specString(link.spec, "displayName") || link.externalId
      console.log(`  ${providerTag(link.type).padEnd(20)} ${login} ${styleMuted(`(${link.externalId})`)}`)
    }
  }
}

// ── Link ─────────────────────────────────────────────────────

export async function runIdentityLink(
  flags: DxFlags,
  principalSlug: string,
  provider: string,
  externalId: string,
  displayName?: string,
): Promise<void> {
  const rest = await getFactoryRestClient()
  const data = await rest.request<{ data: unknown }>(
    "POST",
    `/api/v1/factory/org/principals/${principalSlug}/link-identity`,
    { type: provider, externalId, displayName },
  )
  actionResult(flags, data, styleSuccess(`Linked ${provider}:${externalId} to ${principalSlug}`))
}

// ── Unlink ───────────────────────────────────────────────────

export async function runIdentityUnlink(
  flags: DxFlags,
  principalSlug: string,
  provider: string,
): Promise<void> {
  const rest = await getFactoryRestClient()
  const data = await rest.request<{ data: unknown }>(
    "POST",
    `/api/v1/factory/org/principals/${principalSlug}/unlink-identity`,
    { provider },
  )
  actionResult(flags, data, styleSuccess(`Unlinked ${provider} from ${principalSlug}`))
}

// ── Merge ────────────────────────────────────────────────────

export async function runIdentityMerge(
  flags: DxFlags,
  keepSlug: string,
  duplicateSlug: string,
): Promise<void> {
  // Resolve the duplicate's ID first
  const api = await getFactoryClient()
  const dupData = await apiCall(flags, () =>
    api.api.v1.factory.org.principals({ slugOrId: duplicateSlug }).get(),
  )
  const dup = unwrapSingle<{ id: string }>(dupData)

  if (!dup?.id) {
    console.error(`Principal not found: ${duplicateSlug}`)
    process.exit(1)
  }

  const rest = await getFactoryRestClient()
  const data = await rest.request<{ data: unknown }>(
    "POST",
    `/api/v1/factory/org/principals/${keepSlug}/merge`,
    { duplicateId: dup.id },
  )
  actionResult(flags, data, styleSuccess(`Merged ${duplicateSlug} into ${keepSlug}`))
}

// ── Sync ─────────────────────────────────────────────────────

export async function runIdentitySync(flags: DxFlags): Promise<void> {
  console.log("Triggering identity sync...")
  const rest = await getFactoryRestClient()
  const data = await rest.request<{ status: string; data: SyncResult[] }>(
    "POST",
    "/api/v1/factory/org/sync/identities",
    {},
  )

  if (flags.json) {
    console.log(JSON.stringify({ success: true, data }, null, 2))
    return
  }

  const results = data?.data ?? []

  if (results.length === 0) {
    console.log("No providers configured.")
    return
  }

  for (const r of results) {
    const parts = [
      r.linked && `linked=${r.linked}`,
      r.created && `created=${r.created}`,
      r.skipped && `skipped=${r.skipped}`,
      r.deactivated && `deactivated=${r.deactivated}`,
      r.errors && `errors=${r.errors}`,
    ].filter(Boolean)
    console.log(`  ${styleBold(r.provider)}: ${parts.join(" ")}`)
  }
  console.log(styleSuccess("\nSync complete."))
}

// ── Unmatched ────────────────────────────────────────────────

export async function runIdentityUnmatched(
  flags: DxFlags,
  opts?: { provider?: string },
): Promise<void> {
  const api = await getFactoryClient()
  const rest = await getFactoryRestClient()
  const data = await apiCall(flags, () =>
    api.api.v1.factory.org.principals.get({ query: { limit: 500 } }),
  )

  const principals = unwrapList<Principal>(data)

  // Fetch identities for all
  const identityMap = new Map<string, IdentityLinkRow[]>()
  const batchSize = 20
  for (let i = 0; i < principals.length; i += batchSize) {
    const batch = principals.slice(i, i + batchSize)
    const results = await Promise.allSettled(
      batch.map(async (p) => {
        const links = await fetchIdentities(rest, p.id)
        return { id: p.id, links }
      }),
    )
    for (const r of results) {
      if (r.status === "fulfilled") {
        identityMap.set(r.value.id, r.value.links)
      }
    }
  }

  // Filter to those missing the specified provider (or with only 1 provider)
  const targetProvider = opts?.provider
  const unmatched = principals.filter((p) => {
    const links = identityMap.get(p.id) ?? []
    if (targetProvider) {
      return !links.some((l) => l.type === targetProvider)
    }
    return links.length <= 1
  })

  if (flags.json) {
    const enriched = unmatched.map((p) => ({
      ...p,
      identities: identityMap.get(p.id) ?? [],
    }))
    console.log(JSON.stringify({ success: true, data: enriched }, null, 2))
    return
  }

  if (unmatched.length === 0) {
    const msg = targetProvider
      ? `All principals have a ${targetProvider} identity linked.`
      : "All principals have multiple provider links."
    console.log(styleSuccess(msg))
    return
  }

  const label = targetProvider ? `missing ${targetProvider}` : "with single provider"
  console.log(`${styleBold(String(unmatched.length))} principals ${label}:\n`)

  const providers = ["github", "slack", "jira", "google"]
  const headers = ["NAME", "EMAIL", ...providers.map((p) => p.toUpperCase())]

  const rows = unmatched.map((p) => {
    const links = identityMap.get(p.id) ?? []
    const email = specString(p.spec, "email")
    const cols = providers.map((prov) => {
      const link = links.find((l) => l.type === prov)
      if (!link) return styleMuted("-")
      return specString(link.spec, "displayName") || link.externalId
    })
    return [p.name, email, ...cols]
  })

  const { printTable } = await import("../output.js")
  console.log(printTable(headers, rows))
}
