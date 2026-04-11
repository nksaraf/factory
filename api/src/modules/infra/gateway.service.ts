import { and, count, desc, eq, isNotNull, lt, sql } from "drizzle-orm"
import crypto from "node:crypto"
import dns from "node:dns/promises"

import type { Database } from "../../db/connection"
import { dnsDomain, route, tunnel } from "../../db/schema/infra-v2"
import { principal } from "../../db/schema/org-v2"

/**
 * Route change listener for cache invalidation.
 * The factory gateway registers its cache.invalidate here.
 */
let onRouteChanged: ((domain: string) => void) | null = null

export function setRouteChangeListener(
  listener: (domain: string) => void
): void {
  onRouteChanged = listener
}

function notifyRouteChanged(domain: string): void {
  onRouteChanged?.(domain)
}

// ---------------------------------------------------------------------------
// Route CRUD
// ---------------------------------------------------------------------------

export async function listRoutes(
  db: Database,
  opts?: {
    type?: string
    realmId?: string
    status?: string
  }
): Promise<{ data: any[]; total: number }> {
  const conditions = []
  if (opts?.type) conditions.push(eq(route.type, opts.type))
  if (opts?.realmId) conditions.push(eq(route.realmId, opts.realmId))
  // status is in spec JSONB — filter after query for now

  const where = conditions.length > 0 ? and(...conditions) : undefined

  const base = db.select().from(route)
  let rows = where
    ? await base.where(where).orderBy(desc(route.createdAt))
    : await base.orderBy(desc(route.createdAt))

  // filter by spec.status if needed
  if (opts?.status) {
    rows = rows.filter((r) => (r.spec as any)?.status === opts.status)
  }

  return { data: rows, total: rows.length }
}

export async function createRoute(
  db: Database,
  input: {
    name?: string
    slug?: string
    type: string
    domain: string
    realmId?: string
    spec?: Record<string, unknown>
    metadata?: Record<string, unknown>
    // Convenience fields — stored in spec
    siteId?: string
    systemDeploymentId?: string
    clusterId?: string // compat — stored in spec as realmId
    pathPrefix?: string
    targetService?: string
    targetPort?: number
    protocol?: string
    tlsMode?: string
    tlsCertRef?: string
    priority?: number
    middlewares?: unknown[]
    status?: string
    createdBy?: string
    expiresAt?: Date
  }
) {
  const slug =
    input.slug ??
    input.domain
      .replace(/[^a-z0-9-]/gi, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
  const name = input.name ?? input.domain

  const spec = {
    ...input.spec,
    pathPrefix: input.pathPrefix,
    targetService: input.targetService,
    targetPort: input.targetPort,
    protocol: input.protocol ?? "http",
    tlsMode: input.tlsMode,
    tlsCertRef: input.tlsCertRef,
    priority: input.priority,
    middlewares: input.middlewares,
    status: input.status ?? "active",
    createdBy: input.createdBy,
    expiresAt: input.expiresAt?.toISOString(),
    siteId: input.siteId,
    systemDeploymentId: input.systemDeploymentId,
  }

  const [row] = await db
    .insert(route)
    .values({
      slug,
      name,
      type: input.type,
      domain: input.domain,
      realmId: input.realmId ?? input.clusterId,
      spec: spec as any,
      metadata: input.metadata as any,
    })
    .returning()

  notifyRouteChanged(row.domain)

  // Return with flattened fields for backward compat
  return {
    ...row,
    // Backward compat aliases
    routeId: row.id,
    kind: row.type,
    status: (row.spec as any)?.status ?? "active",
    targetService: (row.spec as any)?.targetService,
    targetPort: (row.spec as any)?.targetPort,
  }
}

export async function getRoute(db: Database, routeId: string) {
  const [row] = await db
    .select()
    .from(route)
    .where(eq(route.id, routeId))
    .limit(1)

  if (!row) return null
  return {
    ...row,
    routeId: row.id,
    kind: row.type,
    status: (row.spec as any)?.status ?? "active",
  }
}

export async function updateRoute(
  db: Database,
  routeId: string,
  updates: {
    status?: string
    targetService?: string
    targetPort?: number
    tlsMode?: string
    tlsCertRef?: string
    priority?: number
    middlewares?: unknown[]
    metadata?: Record<string, unknown>
    expiresAt?: Date | null
  }
) {
  // Read current spec, merge updates into it
  const existing = await getRoute(db, routeId)
  if (!existing) return null

  const newSpec = {
    ...(existing.spec as any),
    ...(updates.status !== undefined ? { status: updates.status } : {}),
    ...(updates.targetService !== undefined
      ? { targetService: updates.targetService }
      : {}),
    ...(updates.targetPort !== undefined
      ? { targetPort: updates.targetPort }
      : {}),
    ...(updates.tlsMode !== undefined ? { tlsMode: updates.tlsMode } : {}),
    ...(updates.tlsCertRef !== undefined
      ? { tlsCertRef: updates.tlsCertRef }
      : {}),
    ...(updates.priority !== undefined ? { priority: updates.priority } : {}),
    ...(updates.middlewares !== undefined
      ? { middlewares: updates.middlewares }
      : {}),
    ...(updates.expiresAt !== undefined
      ? { expiresAt: updates.expiresAt?.toISOString() ?? null }
      : {}),
  }

  const setValues: Record<string, unknown> = {
    spec: newSpec,
    updatedAt: new Date(),
  }
  if (updates.metadata !== undefined) setValues.metadata = updates.metadata

  const [row] = await db
    .update(route)
    .set(setValues as any)
    .where(eq(route.id, routeId))
    .returning()

  if (row) notifyRouteChanged(row.domain)
  return row
    ? {
        ...row,
        routeId: row.id,
        kind: row.type,
        status: (row.spec as any)?.status,
      }
    : null
}

export async function deleteRoute(db: Database, routeId: string) {
  const existing = await getRoute(db, routeId)
  await db.delete(route).where(eq(route.id, routeId))
  if (existing) notifyRouteChanged(existing.domain)
}

export async function cleanupExpiredRoutes(db: Database): Promise<number> {
  const now = new Date().toISOString()
  const deleted = await db
    .delete(route)
    .where(
      sql`${route.spec}->>'expiresAt' IS NOT NULL AND ${route.spec}->>'expiresAt' < ${now}`
    )
    .returning()
  return deleted.length
}

/**
 * Look up a single active route by exact domain match.
 * Used by the factory gateway for fast hostname-based routing.
 */
export async function lookupRouteByDomain(
  db: Database,
  domain: string
): Promise<any | null> {
  const rows = await db
    .select()
    .from(route)
    .where(eq(route.domain, domain))
    .limit(5)

  // status is in spec JSONB
  const active = rows.find((r) => (r.spec as any)?.status === "active")
  if (!active) return null

  return {
    ...active,
    routeId: active.id,
    kind: active.type,
    status: (active.spec as any)?.status,
    domain: active.domain,
    targetService: (active.spec as any)?.targetService,
    targetPort: (active.spec as any)?.targetPort,
  }
}

// ---------------------------------------------------------------------------
// Domain Management (v2: domain → dnsDomain)
// ---------------------------------------------------------------------------

export async function listDomains(
  db: Database,
  opts?: {
    siteId?: string
    status?: string
  }
): Promise<{ data: any[]; total: number }> {
  const conditions = []
  if (opts?.siteId) conditions.push(eq(dnsDomain.siteId, opts.siteId))

  const where = conditions.length > 0 ? and(...conditions) : undefined

  const base = db.select().from(dnsDomain)
  let rows = where
    ? await base.where(where).orderBy(desc(dnsDomain.createdAt))
    : await base.orderBy(desc(dnsDomain.createdAt))

  // status is in spec JSONB
  if (opts?.status) {
    rows = rows.filter((r) => (r.spec as any)?.status === opts.status)
  }

  return { data: rows, total: rows.length }
}

export async function registerDomain(
  db: Database,
  input: {
    siteId?: string
    fqdn: string
    type: string
    createdBy: string
  }
) {
  const verificationToken = `dx-verify-${crypto.randomUUID().slice(0, 16)}`
  const slug = input.fqdn
    .replace(/[^a-z0-9-]/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")

  const [row] = await db
    .insert(dnsDomain)
    .values({
      slug,
      name: input.fqdn,
      type: input.type,
      fqdn: input.fqdn,
      siteId: input.siteId,
      spec: {
        verificationToken,
        createdBy: input.createdBy,
        dnsVerified: false,
        status: "pending",
      } as any,
    })
    .returning()

  return {
    ...row,
    domainId: row.id,
    verificationToken: (row.spec as any)?.verificationToken,
    createdBy: (row.spec as any)?.createdBy,
    dnsVerified: (row.spec as any)?.dnsVerified ?? false,
    status: (row.spec as any)?.status,
  }
}

export async function getDomain(db: Database, domainId: string) {
  const [row] = await db
    .select()
    .from(dnsDomain)
    .where(eq(dnsDomain.id, domainId))
    .limit(1)

  if (!row) return null
  return {
    ...row,
    domainId: row.id,
    verificationToken: (row.spec as any)?.verificationToken,
    createdBy: (row.spec as any)?.createdBy,
    dnsVerified: (row.spec as any)?.dnsVerified ?? false,
    status: (row.spec as any)?.status,
  }
}

export async function getDomainByFqdn(db: Database, fqdn: string) {
  const [row] = await db
    .select()
    .from(dnsDomain)
    .where(eq(dnsDomain.fqdn, fqdn))
    .limit(1)

  if (!row) return null
  return {
    ...row,
    domainId: row.id,
    verificationToken: (row.spec as any)?.verificationToken,
    createdBy: (row.spec as any)?.createdBy,
    dnsVerified: (row.spec as any)?.dnsVerified ?? false,
    status: (row.spec as any)?.status,
  }
}

export async function updateDomain(
  db: Database,
  domainId: string,
  updates: {
    dnsVerified?: boolean
    status?: string
    tlsCertRef?: string
  }
) {
  const existing = await getDomain(db, domainId)
  if (!existing) return null

  const newSpec = {
    ...(existing.spec as any),
    ...(updates.dnsVerified !== undefined
      ? { dnsVerified: updates.dnsVerified }
      : {}),
    ...(updates.status !== undefined ? { status: updates.status } : {}),
    ...(updates.tlsCertRef !== undefined
      ? { tlsCertRef: updates.tlsCertRef }
      : {}),
  }

  const [row] = await db
    .update(dnsDomain)
    .set({ spec: newSpec as any, updatedAt: new Date() })
    .where(eq(dnsDomain.id, domainId))
    .returning()

  if (!row) return null
  return {
    ...row,
    domainId: row.id,
    dnsVerified: (row.spec as any)?.dnsVerified ?? false,
    status: (row.spec as any)?.status,
  }
}

export async function removeDomain(db: Database, domainId: string) {
  await db.delete(dnsDomain).where(eq(dnsDomain.id, domainId))
}

/**
 * Verify a custom domain by checking DNS TXT records.
 */
export async function verifyDomain(
  db: Database,
  domainId: string
): Promise<{ verified: boolean; domain: any; route?: any; error?: string }> {
  const dom = await getDomain(db, domainId)
  if (!dom) {
    return { verified: false, domain: null, error: "Domain not found" }
  }

  if (dom.dnsVerified) {
    return { verified: true, domain: dom }
  }

  try {
    const txtHost = `_dx-verify.${dom.fqdn}`
    const records = await dns.resolveTxt(txtHost)
    const flatRecords = records.map((r) => r.join(""))
    const found = flatRecords.some((r) => r === dom.verificationToken)

    if (!found) {
      return {
        verified: false,
        domain: dom,
        error: `TXT record not found. Add TXT record at ${txtHost} with value: ${dom.verificationToken}`,
      }
    }
  } catch (err: any) {
    if (err?.code === "ENOTFOUND" || err?.code === "ENODATA") {
      return {
        verified: false,
        domain: dom,
        error: `No DNS records found for _dx-verify.${dom.fqdn}. Add a TXT record with value: ${dom.verificationToken}`,
      }
    }
    return {
      verified: false,
      domain: dom,
      error: `DNS lookup failed: ${err?.message ?? String(err)}`,
    }
  }

  // Mark verified
  const updated = await updateDomain(db, domainId, {
    dnsVerified: true,
    status: "verified",
  })

  // Auto-create a custom-domain route for this domain
  const newRoute = await createRoute(db, {
    type: "custom-domain",
    domain: dom.fqdn,
    targetService: dom.fqdn,
    tlsMode: "custom",
    status: "active",
    createdBy: dom.createdBy,
  })

  return { verified: true, domain: updated, route: newRoute }
}

// ---------------------------------------------------------------------------
// Workspace Route Helpers
// ---------------------------------------------------------------------------

export async function createWorkspaceRoutes(
  db: Database,
  input: {
    systemDeploymentId?: string
    realmId?: string
    workspaceSlug: string
    siteId?: string
    publishPorts?: number[]
    createdBy: string
  }
) {
  const gatewayDomain = process.env.DX_GATEWAY_DOMAIN ?? "dx.dev"
  // Site-scoped workspaces use site ID as subdomain; generic workspaces use "workspace"
  const routeScope = input.siteId ? input.siteId : "workspace"
  const baseDomain = `${input.workspaceSlug}.${routeScope}.${gatewayDomain}`

  const routes: any[] = []

  const primary = await createRoute(db, {
    type: "workspace",
    domain: baseDomain,
    realmId: input.realmId,
    targetService: input.workspaceSlug,
    protocol: "http",
    status: "active",
    createdBy: input.createdBy,
    systemDeploymentId: input.systemDeploymentId,
  })
  routes.push(primary)

  if (input.publishPorts) {
    for (const port of input.publishPorts) {
      const portDomain = `${input.workspaceSlug}-${port}.${routeScope}.${gatewayDomain}`

      const portRoute = await createRoute(db, {
        type: "workspace",
        domain: portDomain,
        realmId: input.realmId,
        targetService: input.workspaceSlug,
        targetPort: port,
        protocol: "http",
        status: "active",
        createdBy: input.createdBy,
        systemDeploymentId: input.systemDeploymentId,
      })
      routes.push(portRoute)
    }
  }

  return routes
}

export async function removeSystemDeploymentRoutes(
  db: Database,
  systemDeploymentId: string
): Promise<number> {
  const deleted = await db
    .delete(route)
    .where(sql`${route.spec}->>'systemDeploymentId' = ${systemDeploymentId}`)
    .returning()
  return deleted.length
}

// ---------------------------------------------------------------------------
// Tunnel Lifecycle
// ---------------------------------------------------------------------------

export async function registerTunnel(
  db: Database,
  input: {
    subdomain: string
    principalId: string
    localAddr: string
    brokerNodeId?: string
    expiresAt?: Date
    createdBy: string
    routeFamily?: "workspace" | "tunnel"
    systemDeploymentId?: string
    routeKind?: string
  }
): Promise<{ tunnel: any; route: any }> {
  const family = input.routeFamily ?? "tunnel"
  const gatewayDomain = process.env.DX_GATEWAY_DOMAIN ?? "dx.dev"
  const domainSuffix =
    family === "workspace"
      ? `.workspace.${gatewayDomain}`
      : `.tunnel.${gatewayDomain}`
  const routeType = family === "workspace" ? "workspace" : "tunnel"

  const tunnelRoute = await createRoute(db, {
    type: input.routeKind ?? routeType,
    domain: `${input.subdomain}${domainSuffix}`,
    targetService: "tunnel-broker",
    systemDeploymentId: input.systemDeploymentId,
    status: "active",
    createdBy: input.createdBy,
  })

  // Ensure principal exists; auto-create if missing (local dev / first use)
  let resolvedPrincipalId = input.principalId
  const [found] = await db
    .select({ id: principal.id })
    .from(principal)
    .where(eq(principal.id, resolvedPrincipalId))
    .limit(1)
  if (!found) {
    await db
      .insert(principal)
      .values({
        id: resolvedPrincipalId,
        slug: resolvedPrincipalId,
        name: resolvedPrincipalId,
        type: "human",
        spec: { status: "active" },
      } as any)
      .onConflictDoNothing()
  }

  const [tunnelRow] = await db
    .insert(tunnel)
    .values({
      type: "http",
      routeId: tunnelRoute.id,
      principalId: resolvedPrincipalId,
      subdomain: input.subdomain,
      phase: "connected",
      spec: {
        localAddr: input.localAddr,
        brokerNodeId: input.brokerNodeId,
        expiresAt: input.expiresAt?.toISOString(),
      } as any,
    })
    .returning()

  return {
    tunnel: {
      ...tunnelRow,
      tunnelId: tunnelRow.id,
      status: tunnelRow.phase,
      localAddr: (tunnelRow.spec as any)?.localAddr,
    },
    route: tunnelRoute,
  }
}

export async function closeTunnel(db: Database, tunnelId: string) {
  const [row] = await db
    .select()
    .from(tunnel)
    .where(eq(tunnel.id, tunnelId))
    .limit(1)

  if (!row) return

  await deleteRoute(db, row.routeId)
  // Cascade should delete tunnel too, but let's be explicit
  await db.delete(tunnel).where(eq(tunnel.id, tunnelId))
}

export async function heartbeatTunnel(db: Database, tunnelId: string) {
  const existing = await getTunnel(db, tunnelId)
  if (!existing) return

  await db
    .update(tunnel)
    .set({
      spec: {
        ...(existing.spec as any),
        lastHeartbeatAt: new Date().toISOString(),
      } as any,
      updatedAt: new Date(),
    })
    .where(eq(tunnel.id, tunnelId))
}

export async function getTunnel(db: Database, tunnelId: string) {
  const [row] = await db
    .select()
    .from(tunnel)
    .where(eq(tunnel.id, tunnelId))
    .limit(1)

  if (!row) return null
  return {
    ...row,
    tunnelId: row.id,
    status: row.phase,
    localAddr: (row.spec as any)?.localAddr,
    lastHeartbeatAt: (row.spec as any)?.lastHeartbeatAt,
  }
}

export async function listTunnels(
  db: Database,
  opts?: {
    principalId?: string
    status?: string
  }
): Promise<{ data: any[]; total: number }> {
  const conditions = []
  if (opts?.principalId)
    conditions.push(eq(tunnel.principalId, opts.principalId))
  if (opts?.status) conditions.push(eq(tunnel.phase, opts.status))

  const where = conditions.length > 0 ? and(...conditions) : undefined

  const base = db.select().from(tunnel)
  const rows = where
    ? await base.where(where).orderBy(desc(tunnel.createdAt))
    : await base.orderBy(desc(tunnel.createdAt))

  return { data: rows, total: rows.length }
}

export async function cleanupStaleTunnels(
  db: Database,
  staleThresholdMs: number = 60_000
): Promise<number> {
  const cutoff = new Date(Date.now() - staleThresholdMs)

  const activeTunnels = await db
    .select()
    .from(tunnel)
    .where(eq(tunnel.phase, "connected"))

  const stale = activeTunnels.filter((t) => {
    const heartbeat = (t.spec as any)?.lastHeartbeatAt
    return heartbeat && new Date(heartbeat) < cutoff
  })

  if (stale.length === 0) return 0

  for (const t of stale) {
    await db
      .update(tunnel)
      .set({ phase: "disconnected", updatedAt: new Date() })
      .where(eq(tunnel.id, t.id))

    await deleteRoute(db, t.routeId)
  }

  return stale.length
}
