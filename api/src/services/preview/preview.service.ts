import { and, eq, isNull, lt, or, sql } from "drizzle-orm"

import type { Database } from "../../db/connection"
import { route } from "../../db/schema/infra-v2"
import { preview } from "../../db/schema/ops"
import { createRoute, updateRoute } from "../../modules/infra/gateway.service"

export function buildPreviewSlug(input: {
  prNumber?: number
  sourceBranch: string
  siteName: string
}): string {
  const branch = input.sourceBranch
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")

  const site = input.siteName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")

  if (input.prNumber != null) {
    return `pr-${input.prNumber}--${branch}--${site}`
  }
  return `${branch}--${site}`
}

export async function createPreview(
  db: Database,
  input: {
    name: string
    sourceBranch: string
    commitSha: string
    repo: string
    prNumber?: number
    siteName: string
    siteId: string
    ownerId: string
    createdBy: string
    authMode?: string
    expiresAt?: Date
    imageRef?: string
  }
): Promise<{ preview: any; route: any }> {
  const slug = buildPreviewSlug(input)

  // Determine initial phase based on whether image is already provided
  const initialPhase = input.imageRef ? "deploying" : "building"

  // Create preview record
  const [prev] = await db
    .insert(preview)
    .values({
      siteId: input.siteId,
      sourceBranch: input.sourceBranch,
      prNumber: input.prNumber ?? null,
      ownerId: input.ownerId,
      phase: initialPhase,
      spec: {
        name: input.name,
        slug,
        commitSha: input.commitSha,
        repo: input.repo,
        runtimeClass: "warm" as const,
        authMode: (input.authMode ?? "team") as "public" | "team" | "private",
        imageRef: input.imageRef ?? null,
        createdBy: input.createdBy,
        expiresAt: input.expiresAt,
      },
    })
    .returning()

  // Create route
  const previewRoute = await createRoute(db, {
    type: "preview",
    domain: `${slug}.preview.${process.env.DX_GATEWAY_DOMAIN ?? "dx.dev"}`,
    targetService: slug,
    protocol: "http",
    status: "active",
    createdBy: input.createdBy,
  })

  return {
    preview: {
      ...prev,
      // Backward compat: flatten common spec fields
      slug: prev.spec.slug ?? slug,
      name: input.name,
    },
    route: previewRoute,
  }
}

export async function getPreview(db: Database, previewId: string) {
  const [row] = await db
    .select()
    .from(preview)
    .where(eq(preview.id, previewId))
    .limit(1)
  return row ?? null
}

export async function getPreviewBySlug(db: Database, slug: string) {
  // slug is in spec JSONB — filter server-side
  const [row] = await db
    .select()
    .from(preview)
    .where(sql`${preview.spec}->>'slug' = ${slug}`)
    .limit(1)
  return row ?? null
}

export async function updatePreviewStatus(
  db: Database,
  previewId: string,
  updates: {
    status?: string
    runtimeClass?: string
    statusMessage?: string
    commitSha?: string
    imageRef?: string | null
    githubDeploymentId?: number
    githubCommentId?: number
    lastAccessedAt?: Date
  }
) {
  const existing = await getPreview(db, previewId)
  if (!existing) return null

  // Map status to phase for the column
  const phase = updates.status ?? existing.phase

  // Merge other updates into spec
  const newSpec = {
    ...existing.spec,
    ...(updates.runtimeClass !== undefined
      ? { runtimeClass: updates.runtimeClass as "hot" | "warm" | "cold" }
      : {}),
    ...(updates.statusMessage !== undefined
      ? { statusMessage: updates.statusMessage }
      : {}),
    ...(updates.commitSha !== undefined
      ? { commitSha: updates.commitSha }
      : {}),
    ...(updates.imageRef !== undefined ? { imageRef: updates.imageRef } : {}),
    ...(updates.githubDeploymentId !== undefined
      ? { githubDeploymentId: updates.githubDeploymentId }
      : {}),
    ...(updates.githubCommentId !== undefined
      ? { githubCommentId: updates.githubCommentId }
      : {}),
    ...(updates.lastAccessedAt !== undefined
      ? { lastAccessedAt: updates.lastAccessedAt }
      : {}),
  }

  const [row] = await db
    .update(preview)
    .set({ phase, spec: newSpec, updatedAt: new Date() })
    .where(eq(preview.id, previewId))
    .returning()

  return row ?? null
}

export async function expirePreview(db: Database, previewId: string) {
  const prev = await getPreview(db, previewId)
  if (!prev) return null

  await updatePreviewStatus(db, previewId, { status: "expired" })

  // Expire related routes (stored in spec.systemDeploymentId or matched by domain)
  const slug = prev.spec.slug
  if (slug) {
    const gatewayDomain = process.env.DX_GATEWAY_DOMAIN ?? "dx.dev"
    const previewDomain = `${slug}.preview.${gatewayDomain}`
    const routes = await db
      .select()
      .from(route)
      .where(eq(route.domain, previewDomain))

    for (const r of routes) {
      await updateRoute(db, r.id, { status: "expired" })
    }
  }

  return await getPreview(db, previewId)
}

export async function extendPreview(
  db: Database,
  previewId: string,
  days: number
) {
  const prev = await getPreview(db, previewId)
  if (!prev) return null

  const currentExpiry = prev.spec.expiresAt
  const baseDate =
    currentExpiry && new Date(currentExpiry) > new Date()
      ? new Date(currentExpiry)
      : new Date()
  const newExpiry = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000)

  // Update preview spec with new expiry
  const newSpec = { ...prev.spec, expiresAt: newExpiry }
  await db
    .update(preview)
    .set({ spec: newSpec, updatedAt: new Date() })
    .where(eq(preview.id, previewId))

  return await getPreview(db, previewId)
}

/**
 * Periodic cleanup job for preview lifecycle transitions.
 */
export async function runPreviewCleanup(db: Database): Promise<{
  expired: number
  scaledToWarm: number
  scaledToCold: number
  deleted: number
}> {
  const now = new Date()
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000)
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  // Fetch all active previews for processing
  const activePreviews = await db
    .select()
    .from(preview)
    .where(eq(preview.phase, "active"))

  let expired = 0
  let scaledToWarm = 0
  let scaledToCold = 0

  for (const p of activePreviews) {
    const spec = p.spec

    // 1. Expire active previews past expiresAt
    if (spec.expiresAt && new Date(spec.expiresAt) < now) {
      await db
        .update(preview)
        .set({ phase: "expired", updatedAt: now })
        .where(eq(preview.id, p.id))
      expired++
      continue
    }

    // Determine last activity time
    const lastAccess = spec.lastAccessedAt
      ? new Date(spec.lastAccessedAt)
      : p.createdAt

    // 2. Hot → Warm (idle > 2h)
    if (spec.runtimeClass === "hot" && lastAccess < twoHoursAgo) {
      const newSpec = { ...spec, runtimeClass: "warm" as const }
      await db
        .update(preview)
        .set({ spec: newSpec, updatedAt: now })
        .where(eq(preview.id, p.id))
      scaledToWarm++
      continue
    }

    // 3. Warm → Cold (idle > 24h)
    if (spec.runtimeClass === "warm" && lastAccess < twentyFourHoursAgo) {
      const newSpec = { ...spec, runtimeClass: "cold" as const }
      await db
        .update(preview)
        .set({ spec: newSpec, updatedAt: now })
        .where(eq(preview.id, p.id))
      scaledToCold++
    }
  }

  // 4. Hard delete expired previews older than 30 days
  const expiredPreviews = await db
    .select()
    .from(preview)
    .where(eq(preview.phase, "expired"))

  let deleted = 0
  for (const p of expiredPreviews) {
    const spec = p.spec
    const checkDate = spec.expiresAt ? new Date(spec.expiresAt) : p.updatedAt
    if (checkDate < thirtyDaysAgo) {
      await db.delete(preview).where(eq(preview.id, p.id))
      deleted++
    }
  }

  return { expired, scaledToWarm, scaledToCold, deleted }
}

export async function listPreviews(
  db: Database,
  opts?: {
    siteId?: string
    phase?: string
    sourceBranch?: string
    repo?: string
  }
) {
  const conditions = []
  if (opts?.siteId) conditions.push(eq(preview.siteId, opts.siteId))
  if (opts?.phase) conditions.push(eq(preview.phase, opts.phase))
  if (opts?.sourceBranch)
    conditions.push(eq(preview.sourceBranch, opts.sourceBranch))
  // repo is in spec JSONB — filter after query

  const where = conditions.length > 0 ? and(...conditions) : undefined
  const base = db.select().from(preview)
  let rows = where ? await base.where(where) : await base

  if (opts?.repo) {
    rows = rows.filter((r) => r.spec.repo === opts.repo)
  }

  return rows
}
