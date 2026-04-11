import { and, desc, eq } from "drizzle-orm"

import type { Database } from "../../db/connection"
import { realm } from "../../db/schema/infra"
import { workbench as workbenchTable } from "../../db/schema/ops"
import { principal } from "../../db/schema/org"
import { allocateSlug } from "../../lib/slug"
import { removeSystemDeploymentRoutes } from "../infra/gateway.service"
import { parseTtlToMs } from "./utils"

// ---------------------------------------------------------------------------
// Workbench CRUD — ops schema
// ---------------------------------------------------------------------------

const DEFAULT_TTLS: Record<string, string> = {
  pr: "48h",
  agent: "2h",
  manual: "24h",
  ci: "4h",
}

function generateWorkbenchName(): string {
  return `workbench-${Math.random().toString(36).substring(2, 8)}`
}

/**
 * Resolve the default realm (k8s cluster) for a workbench.
 * Priority: isDefault=true > status=ready > any k8s-cluster.
 * Returns null if no realms are registered.
 */
export async function resolveDefaultRealm(
  db: Database
): Promise<string | null> {
  const allRealms = await db
    .select({ id: realm.id, spec: realm.spec })
    .from(realm)
    .where(eq(realm.type, "k8s-cluster"))

  const defaultRealm =
    allRealms.find((r) => (r.spec as any)?.isDefault === true) ??
    allRealms.find((r) => (r.spec as any)?.status === "ready") ??
    allRealms[0]

  return defaultRealm?.id ?? null
}

export async function listWorkbenches(
  db: Database,
  opts?: {
    ownerId?: string
    type?: string
    all?: boolean
    createdBy?: string
    trigger?: string
  }
) {
  const conditions = []
  if (opts?.ownerId) conditions.push(eq(workbenchTable.ownerId, opts.ownerId))
  if (opts?.type) conditions.push(eq(workbenchTable.type, opts.type))

  const base = db.select().from(workbenchTable)
  const rows =
    conditions.length > 0
      ? await base
          .where(and(...conditions))
          .orderBy(desc(workbenchTable.createdAt))
      : await base.orderBy(desc(workbenchTable.createdAt))

  let filtered = rows
  if (opts?.createdBy) {
    filtered = filtered.filter(
      (r) => (r.spec as any)?.createdBy === opts.createdBy
    )
  }
  if (opts?.trigger) {
    filtered = filtered.filter((r) => (r.spec as any)?.trigger === opts.trigger)
  }
  if (!opts?.all) {
    filtered = filtered.filter(
      (r) =>
        !["destroyed", "destroying"].includes((r.spec as any)?.lifecycle ?? "")
    )
  }

  return { data: filtered, total: filtered.length }
}

/**
 * Create a workbench. Inserts a DB row with proper defaults and returns it.
 * The reconciler handles actual provisioning (namespace, routes, etc).
 */
export async function createWorkbench(
  db: Database,
  input: {
    name?: string
    ownerId?: string
    createdBy?: string
    type?: string
    ttl?: string
    trigger?: string
    labels?: Record<string, unknown>
    dependencies?: Array<{
      name: string
      image: string
      port: number
      env?: Record<string, unknown>
    }>
    publishPorts?: number[]
    snapshotId?: string
    realmId?: string
  }
) {
  const name = input.name ?? generateWorkbenchName()
  const trigger = input.trigger ?? "manual"
  const ttl = input.ttl ?? DEFAULT_TTLS[trigger] ?? "24h"
  const type = input.type ?? "developer"

  const slug = await allocateSlug({
    baseLabel: name,
    isTaken: async (s) => {
      const [existing] = await db
        .select({ id: workbenchTable.id })
        .from(workbenchTable)
        .where(eq(workbenchTable.slug, s))
        .limit(1)
      return !!existing
    },
  })

  const expiresAt = new Date(Date.now() + parseTtlToMs(ttl))

  // Auto-assign default realm if none provided
  let realmId: string | null = input.realmId ?? null
  if (!realmId) {
    realmId = await resolveDefaultRealm(db)
  }
  if (!realmId) {
    throw new Error(
      "No cluster registered. Run `dx setup --role factory` to bootstrap a cluster."
    )
  }

  // Auto-create principal if it doesn't exist (local dev convenience)
  if (input.ownerId) {
    const [existingPrincipal] = await db
      .select({ id: principal.id })
      .from(principal)
      .where(eq(principal.id, input.ownerId))
      .limit(1)
    if (!existingPrincipal) {
      await db
        .insert(principal)
        .values({
          id: input.ownerId,
          slug: input.ownerId,
          name: input.ownerId,
          type: "human",
          spec: { status: "active" },
        } as any)
        .onConflictDoNothing()
    }
  }

  const [ws] = await db
    .insert(workbenchTable)
    .values({
      name,
      slug,
      type,
      realmId,
      ownerId: input.ownerId ?? null,
      spec: {
        trigger,
        createdBy: input.createdBy ?? input.ownerId ?? "system",
        lifecycle: "provisioning",
        realmType: "container",
        ttl,
        expiresAt: expiresAt.toISOString(),
        labels: input.labels ?? {},
        dependencies: input.dependencies ?? [],
      } as any,
    })
    .returning()

  return ws
}

export async function destroyWorkbench(db: Database, id: string) {
  await removeSystemDeploymentRoutes(db, id)

  const [existing] = await db
    .select()
    .from(workbenchTable)
    .where(eq(workbenchTable.id, id))
    .limit(1)

  if (!existing) throw new Error(`Workbench not found: ${id}`)

  const [updated] = await db
    .update(workbenchTable)
    .set({
      spec: {
        ...(existing.spec as any),
        lifecycle: "destroying",
      } as any,
    })
    .where(eq(workbenchTable.id, id))
    .returning()

  return updated
}

export async function cleanupExpiredWorkbenches(db: Database) {
  const all = await db.select().from(workbenchTable)
  const now = new Date()

  const expired = all.filter((w) => {
    const spec = w.spec as any
    if (spec?.lifecycle !== "active") return false
    const ea = spec?.expiresAt ? new Date(spec.expiresAt) : null
    return ea && ea < now
  })

  let cleaned = 0
  for (const ws of expired) {
    await destroyWorkbench(db, ws.id)
    cleaned++
  }

  return { cleaned }
}

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------

export async function resizeWorkbench(
  db: Database,
  workbenchId: string,
  resize: { cpu?: string; memory?: string; storageGb?: number }
) {
  const [existing] = await db
    .select()
    .from(workbenchTable)
    .where(eq(workbenchTable.id, workbenchId))
    .limit(1)
  if (!existing) throw new Error(`Workbench not found: ${workbenchId}`)

  const spec = (existing.spec ?? {}) as Record<string, any>
  const [updated] = await db
    .update(workbenchTable)
    .set({
      spec: {
        ...spec,
        ...(resize.cpu !== undefined ? { cpu: resize.cpu } : {}),
        ...(resize.memory !== undefined ? { memory: resize.memory } : {}),
        ...(resize.storageGb !== undefined
          ? { storageGb: resize.storageGb }
          : {}),
      } as any,
      updatedAt: new Date(),
    })
    .where(eq(workbenchTable.id, workbenchId))
    .returning()
  return updated!
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export async function updateWorkbenchHealth(
  db: Database,
  workbenchId: string,
  healthStatus: string,
  statusMessage?: string
) {
  const [existing] = await db
    .select()
    .from(workbenchTable)
    .where(eq(workbenchTable.id, workbenchId))
    .limit(1)
  if (!existing) return

  const spec = (existing.spec ?? {}) as Record<string, any>
  await db
    .update(workbenchTable)
    .set({
      spec: {
        ...spec,
        healthStatus,
        healthCheckedAt: new Date().toISOString(),
        ...(statusMessage !== undefined ? { statusMessage } : {}),
      } as any,
      updatedAt: new Date(),
    })
    .where(eq(workbenchTable.id, workbenchId))
}

// ---------------------------------------------------------------------------
// TTL / Expiry
// ---------------------------------------------------------------------------

export async function expireStale(db: Database): Promise<number> {
  const now = new Date()
  const all = await db.select().from(workbenchTable)

  const expired = all.filter((w) => {
    const spec = w.spec as any
    if (spec?.lifecycle !== "active") return false
    const ea = spec?.expiresAt ? new Date(spec.expiresAt) : null
    return ea != null && ea < now
  })

  for (const ws of expired) {
    const spec = (ws.spec ?? {}) as Record<string, any>
    await db
      .update(workbenchTable)
      .set({
        spec: { ...spec, lifecycle: "destroying" } as any,
        updatedAt: now,
      })
      .where(eq(workbenchTable.id, ws.id))
  }

  return expired.length
}
