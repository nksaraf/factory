import { eq, and, desc, lt, sql, count, isNotNull } from "drizzle-orm";
import crypto from "node:crypto";
import dns from "node:dns/promises";

import type { Database } from "../../db/connection";
import { route, domain as domainTable, tunnel } from "../../db/schema";

/**
 * Route change listener for cache invalidation.
 * The factory gateway registers its cache.invalidate here.
 */
let onRouteChanged: ((domain: string) => void) | null = null;

export function setRouteChangeListener(listener: (domain: string) => void): void {
  onRouteChanged = listener;
}

function notifyRouteChanged(domain: string): void {
  onRouteChanged?.(domain);
}

// ---------------------------------------------------------------------------
// Route CRUD
// ---------------------------------------------------------------------------

export async function listRoutes(
  db: Database,
  opts?: {
    kind?: string;
    siteId?: string;
    deploymentTargetId?: string;
    clusterId?: string;
    status?: string;
  }
): Promise<{ data: any[]; total: number }> {
  const conditions = [];
  if (opts?.kind) conditions.push(eq(route.kind, opts.kind));
  if (opts?.siteId) conditions.push(eq(route.siteId, opts.siteId));
  if (opts?.deploymentTargetId)
    conditions.push(eq(route.deploymentTargetId, opts.deploymentTargetId));
  if (opts?.clusterId) conditions.push(eq(route.clusterId, opts.clusterId));
  if (opts?.status) conditions.push(eq(route.status, opts.status));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const base = db.select().from(route);
  const rows = where
    ? await base.where(where).orderBy(desc(route.createdAt))
    : await base.orderBy(desc(route.createdAt));

  const [totalRow] = where
    ? await db.select({ count: count() }).from(route).where(where)
    : await db.select({ count: count() }).from(route);

  return { data: rows, total: totalRow?.count ?? 0 };
}

export async function createRoute(
  db: Database,
  input: {
    siteId?: string;
    deploymentTargetId?: string;
    clusterId?: string;
    kind: string;
    domain: string;
    pathPrefix?: string;
    targetService: string;
    targetPort?: number;
    protocol?: string;
    tlsMode?: string;
    tlsCertRef?: string;
    priority?: number;
    middlewares?: unknown[];
    metadata?: Record<string, unknown>;
    status?: string;
    createdBy: string;
    expiresAt?: Date;
  }
) {
  const [row] = await db
    .insert(route)
    .values({
      siteId: input.siteId,
      deploymentTargetId: input.deploymentTargetId,
      clusterId: input.clusterId,
      kind: input.kind,
      domain: input.domain,
      pathPrefix: input.pathPrefix,
      targetService: input.targetService,
      targetPort: input.targetPort,
      protocol: input.protocol,
      tlsMode: input.tlsMode,
      tlsCertRef: input.tlsCertRef,
      status: input.status,
      priority: input.priority,
      middlewares: input.middlewares,
      metadata: input.metadata,
      createdBy: input.createdBy,
      expiresAt: input.expiresAt,
    })
    .returning();

  notifyRouteChanged(row.domain);
  return row;
}

export async function getRoute(db: Database, routeId: string) {
  const [row] = await db
    .select()
    .from(route)
    .where(eq(route.routeId, routeId))
    .limit(1);

  return row ?? null;
}

export async function updateRoute(
  db: Database,
  routeId: string,
  updates: {
    status?: string;
    targetService?: string;
    targetPort?: number;
    tlsMode?: string;
    tlsCertRef?: string;
    priority?: number;
    middlewares?: unknown[];
    metadata?: Record<string, unknown>;
    expiresAt?: Date | null;
  }
) {
  const [row] = await db
    .update(route)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(route.routeId, routeId))
    .returning();

  if (row) notifyRouteChanged(row.domain);
  return row ?? null;
}

export async function deleteRoute(db: Database, routeId: string) {
  const existing = await getRoute(db, routeId);
  await db.delete(route).where(eq(route.routeId, routeId));
  if (existing) notifyRouteChanged(existing.domain);
}

export async function cleanupExpiredRoutes(db: Database): Promise<number> {
  const rows = await db
    .delete(route)
    .where(and(isNotNull(route.expiresAt), lt(route.expiresAt, new Date())))
    .returning();

  return rows.length;
}

/**
 * Look up a single active route by exact domain match.
 * Used by the factory gateway for fast hostname-based routing.
 */
export async function lookupRouteByDomain(
  db: Database,
  domain: string
): Promise<any | null> {
  const [row] = await db
    .select()
    .from(route)
    .where(and(eq(route.domain, domain), eq(route.status, "active")))
    .limit(1);

  return row ?? null;
}

// ---------------------------------------------------------------------------
// Domain Management
// ---------------------------------------------------------------------------

export async function listDomains(
  db: Database,
  opts?: {
    siteId?: string;
    status?: string;
  }
): Promise<{ data: any[]; total: number }> {
  const conditions = [];
  if (opts?.siteId) conditions.push(eq(domainTable.siteId, opts.siteId));
  if (opts?.status) conditions.push(eq(domainTable.status, opts.status));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const base = db.select().from(domainTable);
  const rows = where
    ? await base.where(where).orderBy(desc(domainTable.createdAt))
    : await base.orderBy(desc(domainTable.createdAt));

  const [totalRow] = where
    ? await db.select({ count: count() }).from(domainTable).where(where)
    : await db.select({ count: count() }).from(domainTable);

  return { data: rows, total: totalRow?.count ?? 0 };
}

export async function registerDomain(
  db: Database,
  input: {
    siteId?: string;
    fqdn: string;
    kind: string;
    createdBy: string;
  }
) {
  const verificationToken = `dx-verify-${crypto.randomUUID().slice(0, 16)}`;

  const [row] = await db
    .insert(domainTable)
    .values({
      siteId: input.siteId,
      fqdn: input.fqdn,
      kind: input.kind,
      verificationToken,
      createdBy: input.createdBy,
    })
    .returning();

  return row;
}

export async function getDomain(db: Database, domainId: string) {
  const [row] = await db
    .select()
    .from(domainTable)
    .where(eq(domainTable.domainId, domainId))
    .limit(1);

  return row ?? null;
}

export async function getDomainByFqdn(db: Database, fqdn: string) {
  const [row] = await db
    .select()
    .from(domainTable)
    .where(eq(domainTable.fqdn, fqdn))
    .limit(1);

  return row ?? null;
}

export async function updateDomain(
  db: Database,
  domainId: string,
  updates: {
    dnsVerified?: boolean;
    status?: string;
    tlsCertRef?: string;
  }
) {
  const [row] = await db
    .update(domainTable)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(domainTable.domainId, domainId))
    .returning();

  return row ?? null;
}

export async function removeDomain(db: Database, domainId: string) {
  await db.delete(domainTable).where(eq(domainTable.domainId, domainId));
}

/**
 * Verify a custom domain by checking DNS TXT records.
 * Looks for a TXT record at `_dx-verify.<fqdn>` matching the stored verification token.
 * On success, marks domain as verified and creates a custom_domain route.
 */
export async function verifyDomain(
  db: Database,
  domainId: string
): Promise<{ verified: boolean; domain: any; route?: any; error?: string }> {
  const dom = await getDomain(db, domainId);
  if (!dom) {
    return { verified: false, domain: null, error: "Domain not found" };
  }

  if (dom.dnsVerified) {
    return { verified: true, domain: dom };
  }

  try {
    const txtHost = `_dx-verify.${dom.fqdn}`;
    const records = await dns.resolveTxt(txtHost);
    const flatRecords = records.map((r) => r.join(""));
    const found = flatRecords.some((r) => r === dom.verificationToken);

    if (!found) {
      return {
        verified: false,
        domain: dom,
        error: `TXT record not found. Add TXT record at ${txtHost} with value: ${dom.verificationToken}`,
      };
    }
  } catch (err: any) {
    if (err?.code === "ENOTFOUND" || err?.code === "ENODATA") {
      return {
        verified: false,
        domain: dom,
        error: `No DNS records found for _dx-verify.${dom.fqdn}. Add a TXT record with value: ${dom.verificationToken}`,
      };
    }
    return {
      verified: false,
      domain: dom,
      error: `DNS lookup failed: ${err?.message ?? String(err)}`,
    };
  }

  // Mark verified
  const updated = await updateDomain(db, domainId, {
    dnsVerified: true,
    status: "verified",
  });

  // Auto-create a custom_domain route for this domain
  const newRoute = await createRoute(db, {
    kind: "custom_domain",
    domain: dom.fqdn,
    siteId: dom.siteId ?? undefined,
    targetService: dom.fqdn,
    tlsMode: "custom",
    status: "active",
    createdBy: dom.createdBy,
  });

  return { verified: true, domain: updated, route: newRoute };
}

// ---------------------------------------------------------------------------
// Sandbox / Preview Route Helpers
// ---------------------------------------------------------------------------

export async function createSandboxRoutes(
  db: Database,
  input: {
    deploymentTargetId: string;
    siteId?: string;
    clusterId?: string;
    sandboxSlug: string;
    publishPorts?: number[];
    createdBy: string;
  }
) {
  const baseDomain = input.siteId
    ? `${input.sandboxSlug}.${input.siteId}.dx.dev`
    : `${input.sandboxSlug}.preview.dx.dev`;

  const routes: any[] = [];

  const primary = await createRoute(db, {
    deploymentTargetId: input.deploymentTargetId,
    siteId: input.siteId,
    clusterId: input.clusterId,
    kind: "sandbox",
    domain: baseDomain,
    targetService: input.sandboxSlug,
    protocol: "http",
    status: "active",
    createdBy: input.createdBy,
  });
  routes.push(primary);

  if (input.publishPorts) {
    for (const port of input.publishPorts) {
      const portDomain = input.siteId
        ? `${input.sandboxSlug}-${port}.${input.siteId}.dx.dev`
        : `${input.sandboxSlug}-${port}.preview.dx.dev`;

      const portRoute = await createRoute(db, {
        deploymentTargetId: input.deploymentTargetId,
        siteId: input.siteId,
        clusterId: input.clusterId,
        kind: "sandbox",
        domain: portDomain,
        targetService: input.sandboxSlug,
        targetPort: port,
        protocol: "http",
        status: "active",
        createdBy: input.createdBy,
      });
      routes.push(portRoute);
    }
  }

  return routes;
}

export async function createPreviewRoutes(
  db: Database,
  input: {
    deploymentTargetId: string;
    siteId?: string;
    clusterId?: string;
    prNumber: number;
    createdBy: string;
  }
) {
  const previewDomain = `pr-${input.prNumber}.preview.dx.dev`;

  return await createRoute(db, {
    deploymentTargetId: input.deploymentTargetId,
    siteId: input.siteId,
    clusterId: input.clusterId,
    kind: "preview",
    domain: previewDomain,
    targetService: `pr-${input.prNumber}`,
    protocol: "http",
    status: "active",
    createdBy: input.createdBy,
  });
}

export async function removeTargetRoutes(
  db: Database,
  deploymentTargetId: string
): Promise<number> {
  const rows = await db
    .delete(route)
    .where(eq(route.deploymentTargetId, deploymentTargetId))
    .returning();

  return rows.length;
}

// ---------------------------------------------------------------------------
// Tunnel Lifecycle
// ---------------------------------------------------------------------------

export async function registerTunnel(
  db: Database,
  input: {
    subdomain: string;
    principalId: string;
    localAddr: string;
    brokerNodeId?: string;
    expiresAt?: Date;
    createdBy: string;
  }
): Promise<{ tunnel: any; route: any }> {
  const tunnelRoute = await createRoute(db, {
    kind: "tunnel",
    domain: `${input.subdomain}.tunnel.dx.dev`,
    targetService: "tunnel-broker",
    status: "active",
    createdBy: input.createdBy,
  });

  const [tunnelRow] = await db
    .insert(tunnel)
    .values({
      routeId: tunnelRoute.routeId,
      principalId: input.principalId,
      subdomain: input.subdomain,
      localAddr: input.localAddr,
      brokerNodeId: input.brokerNodeId,
      expiresAt: input.expiresAt,
    })
    .returning();

  return { tunnel: tunnelRow, route: tunnelRoute };
}

export async function closeTunnel(db: Database, tunnelId: string) {
  const [row] = await db
    .select()
    .from(tunnel)
    .where(eq(tunnel.tunnelId, tunnelId))
    .limit(1);

  if (!row) return;

  await db.delete(route).where(eq(route.routeId, row.routeId));
}

export async function heartbeatTunnel(db: Database, tunnelId: string) {
  await db
    .update(tunnel)
    .set({ lastHeartbeatAt: new Date() })
    .where(eq(tunnel.tunnelId, tunnelId));
}

export async function getTunnel(db: Database, tunnelId: string) {
  const [row] = await db
    .select()
    .from(tunnel)
    .where(eq(tunnel.tunnelId, tunnelId))
    .limit(1);

  return row ?? null;
}

export async function listTunnels(
  db: Database,
  opts?: {
    principalId?: string;
    status?: string;
  }
): Promise<{ data: any[]; total: number }> {
  const conditions = [];
  if (opts?.principalId)
    conditions.push(eq(tunnel.principalId, opts.principalId));
  if (opts?.status) conditions.push(eq(tunnel.status, opts.status));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const base = db.select().from(tunnel);
  const rows = where
    ? await base.where(where).orderBy(desc(tunnel.connectedAt))
    : await base.orderBy(desc(tunnel.connectedAt));

  const [totalRow] = where
    ? await db.select({ count: count() }).from(tunnel).where(where)
    : await db.select({ count: count() }).from(tunnel);

  return { data: rows, total: totalRow?.count ?? 0 };
}

export async function cleanupStaleTunnels(
  db: Database,
  staleThresholdMs: number = 60_000
): Promise<number> {
  const cutoff = new Date(Date.now() - staleThresholdMs);

  const staleTunnels = await db
    .select()
    .from(tunnel)
    .where(
      and(eq(tunnel.status, "active"), lt(tunnel.lastHeartbeatAt, cutoff))
    );

  if (staleTunnels.length === 0) return 0;

  for (const t of staleTunnels) {
    await db
      .update(tunnel)
      .set({ status: "disconnected" })
      .where(eq(tunnel.tunnelId, t.tunnelId));

    await db.delete(route).where(eq(route.routeId, t.routeId));
  }

  return staleTunnels.length;
}
