import { desc, eq } from "drizzle-orm"

import type { Database } from "../../db/connection"
import { release } from "../../db/schema/software-v2"
import { allocateSlug } from "../../lib/slug"

// ---------------------------------------------------------------------------
// Release CRUD — v2: spec JSONB for version, status, systemPins
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<string, string> = {
  draft: "staging",
  staging: "production",
  production: "superseded",
}

export async function listReleases(db: Database, opts?: { status?: string }) {
  const rows = await db.select().from(release).orderBy(desc(release.createdAt))
  if (opts?.status) {
    const filtered = rows.filter((r) => (r.spec as any)?.status === opts.status)
    return { data: filtered, total: filtered.length }
  }
  return { data: rows, total: rows.length }
}

export async function createRelease(
  db: Database,
  input: {
    version: string
    createdBy: string
    systemId?: string
    modulePins?: Array<{ moduleVersionId: string }>
  }
) {
  const slug = await allocateSlug({
    baseLabel: input.version,
    isTaken: async (s) => {
      const [existing] = await db
        .select({ id: release.id })
        .from(release)
        .where(eq(release.slug, s))
        .limit(1)
      return !!existing
    },
  })

  const [row] = await db
    .insert(release)
    .values({
      name: input.version,
      slug,
      systemId: input.systemId ?? "unknown",
      spec: {
        version: input.version,
        status: "draft",
        createdBy: input.createdBy,
        systemPins: input.modulePins?.map((p) => p.moduleVersionId) ?? [],
      } as any,
    })
    .returning()

  return row
}

export async function getRelease(db: Database, version: string) {
  // Try slug lookup first (indexed), fall back to full scan for spec.version match
  const [bySlug] = await db
    .select()
    .from(release)
    .where(eq(release.slug, version))
    .limit(1)
  const row =
    bySlug ??
    (await db.select().from(release)).find(
      (r) => (r.spec as any)?.version === version
    )
  if (!row) return null
  return {
    ...row,
    modulePins: (row.spec as any)?.systemPins ?? [],
    releaseId: row.id,
  }
}

export async function promoteRelease(
  db: Database,
  version: string,
  target: string
) {
  return await db.transaction(async (tx) => {
    // Try slug lookup first (indexed), fall back to full scan for spec.version match
    const [bySlug] = await tx
      .select()
      .from(release)
      .where(eq(release.slug, version))
      .limit(1)
    const rows = bySlug ? undefined : await tx.select().from(release)
    const row =
      bySlug ?? rows?.find((r) => (r.spec as any)?.version === version)
    if (!row) throw new Error(`Release not found: ${version}`)

    const currentStatus = (row.spec as any)?.status ?? "draft"
    const allowedTarget = VALID_TRANSITIONS[currentStatus]
    if (!allowedTarget || allowedTarget !== target) {
      throw new Error(
        `Invalid promotion: cannot transition from '${currentStatus}' to '${target}'`
      )
    }

    if (target === "production") {
      const allReleases = rows ?? (await tx.select().from(release))
      for (const r of allReleases) {
        if ((r.spec as any)?.status === "production") {
          await tx
            .update(release)
            .set({ spec: { ...(r.spec as any), status: "superseded" } as any })
            .where(eq(release.id, r.id))
        }
      }
    }

    const [updated] = await tx
      .update(release)
      .set({ spec: { ...(row.spec as any), status: target } as any })
      .where(eq(release.id, row.id))
      .returning()

    return updated
  })
}

// ---------------------------------------------------------------------------
// Release Pin Management — v2: pins in release.spec.systemPins
// ---------------------------------------------------------------------------

export async function addModulePin(
  db: Database,
  releaseId: string,
  moduleVersionId: string
) {
  const [row] = await db
    .select()
    .from(release)
    .where(eq(release.id, releaseId))
    .limit(1)
  if (!row) throw new Error(`Release not found: ${releaseId}`)

  const pins: string[] = (row.spec as any)?.systemPins ?? []
  if (!pins.includes(moduleVersionId)) pins.push(moduleVersionId)

  const [updated] = await db
    .update(release)
    .set({ spec: { ...(row.spec as any), systemPins: pins } as any })
    .where(eq(release.id, releaseId))
    .returning()

  return updated
}

export async function removeModulePin(
  db: Database,
  releaseId: string,
  moduleVersionId: string
) {
  const [row] = await db
    .select()
    .from(release)
    .where(eq(release.id, releaseId))
    .limit(1)
  if (!row) return null

  const newPins = ((row.spec as any)?.systemPins ?? []).filter(
    (p: string) => p !== moduleVersionId
  )
  const [updated] = await db
    .update(release)
    .set({ spec: { ...(row.spec as any), systemPins: newPins } as any })
    .where(eq(release.id, releaseId))
    .returning()

  return updated
}

export async function listReleasePins(db: Database, releaseId: string) {
  const [row] = await db
    .select()
    .from(release)
    .where(eq(release.id, releaseId))
    .limit(1)
  if (!row) return { data: [] }
  const pins: string[] = (row.spec as any)?.systemPins ?? []
  return { data: pins.map((id) => ({ moduleVersionId: id })) }
}
