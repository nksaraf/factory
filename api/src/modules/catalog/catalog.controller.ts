/**
 * Catalog sync controller.
 *
 * Accepts a CatalogSystem (Backstage-aligned vocabulary from format adapters)
 * and upserts it into the v2 software schema tables:
 *   - system   → software.system
 *   - components + resources → software.component (resources are just infra-typed components)
 *   - apis     → software.api
 *
 * The entire sync runs in a single transaction for atomicity.
 * Updates are in-place (not bitemporal versioned) — catalog sync is "latest state wins".
 */
import type {
  CatalogAPI,
  CatalogComponent,
  CatalogResource,
  CatalogSyncResult,
  CatalogSystem,
} from "@smp/factory-shared/catalog"
import { catalogSystemSchema } from "@smp/factory-shared/catalog"
import type { Lifecycle } from "@smp/factory-shared/schemas/common"
import { and, eq } from "drizzle-orm"
import { Elysia } from "elysia"

import type { Database } from "../../db/connection"
import { team } from "../../db/schema/org-v2"
import { component, softwareApi, system } from "../../db/schema/software-v2"
import { currentRow } from "../../db/temporal"
import { ok } from "../../lib/responses"

// ── Helpers ──────────────────────────────────────────────────

/** Map catalog lifecycle values to v2 software lifecycle. */
function toV2Lifecycle(catalogLifecycle: string | undefined): Lifecycle {
  switch (catalogLifecycle) {
    case "development":
      return "beta"
    case "experimental":
    case "beta":
    case "production":
    case "deprecated":
    case "retired":
      return catalogLifecycle
    default:
      return "experimental"
  }
}

async function resolveOrCreateTeam(tx: Database, slug: string) {
  const [existing] = await tx
    .select()
    .from(team)
    .where(
      and(
        eq(team.slug, slug),
        currentRow({ validTo: team.validTo, systemTo: team.systemTo })
      )
    )
    .limit(1)

  if (existing) return existing

  // Use a CTE-style insert to handle concurrent inserts gracefully.
  // If a concurrent request creates the same slug between our SELECT and INSERT,
  // we catch the unique constraint violation and re-fetch.
  try {
    const [created] = await tx
      .insert(team)
      .values({ slug, name: slug })
      .returning()
    return created!
  } catch {
    // Likely unique constraint violation from concurrent insert — re-fetch
    const [refetched] = await tx
      .select()
      .from(team)
      .where(
        and(
          eq(team.slug, slug),
          currentRow({ validTo: team.validTo, systemTo: team.systemTo })
        )
      )
      .limit(1)
    if (refetched) return refetched
    throw new Error(`Failed to resolve or create team: ${slug}`)
  }
}

async function upsertSystem(
  tx: Database,
  catalog: CatalogSystem,
  ownerTeamId: string
) {
  const slug = catalog.metadata.name
  const name = catalog.metadata.title ?? catalog.metadata.name
  const now = new Date()

  const [existing] = await tx
    .select()
    .from(system)
    .where(
      and(
        eq(system.slug, slug),
        currentRow({ validTo: system.validTo, systemTo: system.systemTo })
      )
    )
    .limit(1)

  if (existing) {
    const [updated] = await tx
      .update(system)
      .set({
        name,
        ownerTeamId,
        spec: {
          namespace: catalog.metadata.namespace ?? "default",
          lifecycle: toV2Lifecycle(catalog.spec.lifecycle),
          description: catalog.metadata.description,
          tags: catalog.metadata.tags ?? [],
        },
        metadata: {
          labels: catalog.metadata.labels ?? {},
          annotations: catalog.metadata.annotations ?? {},
        },
        updatedAt: now,
      })
      .where(eq(system.id, existing.id))
      .returning()
    return { row: updated!, created: false }
  }

  const [inserted] = await tx
    .insert(system)
    .values({
      slug,
      name,
      ownerTeamId,
      spec: {
        namespace: catalog.metadata.namespace ?? "default",
        lifecycle: toV2Lifecycle(catalog.spec.lifecycle),
        description: catalog.metadata.description,
        tags: catalog.metadata.tags ?? [],
      },
      metadata: {
        labels: catalog.metadata.labels ?? {},
        annotations: catalog.metadata.annotations ?? {},
      },
    })
    .returning()
  return { row: inserted!, created: true }
}

async function upsertComponent(
  tx: Database,
  systemId: string,
  ownerTeamId: string,
  slug: string,
  entry: CatalogComponent | CatalogResource
) {
  const name = entry.metadata.title ?? entry.metadata.name
  const type = entry.spec.type
  const lifecycle = toV2Lifecycle(
    "lifecycle" in entry.spec ? entry.spec.lifecycle : undefined
  )
  const now = new Date()

  const [existing] = await tx
    .select()
    .from(component)
    .where(
      and(
        eq(component.systemId, systemId),
        eq(component.slug, slug),
        currentRow({
          validTo: component.validTo,
          systemTo: component.systemTo,
        })
      )
    )
    .limit(1)

  if (existing) {
    const [updated] = await tx
      .update(component)
      .set({
        name,
        type,
        lifecycle,
        ownerTeamId,
        spec: entry.spec as Record<string, unknown>,
        metadata: {
          labels: entry.metadata.labels ?? {},
          annotations: entry.metadata.annotations ?? {},
        },
        updatedAt: now,
      })
      .where(eq(component.id, existing.id))
      .returning()
    return { row: updated!, created: false }
  }

  const [inserted] = await tx
    .insert(component)
    .values({
      slug,
      name,
      type,
      systemId,
      ownerTeamId,
      lifecycle,
      spec: entry.spec as Record<string, unknown>,
      metadata: {
        labels: entry.metadata.labels ?? {},
        annotations: entry.metadata.annotations ?? {},
      },
    })
    .returning()
  return { row: inserted!, created: true }
}

async function upsertApi(
  tx: Database,
  systemId: string,
  slug: string,
  entry: CatalogAPI
) {
  const name = entry.metadata.title ?? entry.metadata.name
  const type = entry.spec.type
  const now = new Date()
  const meta = {
    labels: entry.metadata.labels ?? {},
    annotations: entry.metadata.annotations ?? {},
  }

  // softwareApi has a true unique index on (system_id, slug) — use ON CONFLICT
  const [row] = await tx
    .insert(softwareApi)
    .values({
      slug,
      name,
      type,
      systemId,
      spec: entry.spec as Record<string, unknown>,
      metadata: meta,
    })
    .onConflictDoUpdate({
      target: [softwareApi.systemId, softwareApi.slug],
      set: {
        name,
        type,
        spec: entry.spec as Record<string, unknown>,
        metadata: meta,
        updatedAt: now,
      },
    })
    .returning()

  // If createdAt === updatedAt (within tolerance), it was just inserted
  const created =
    !row!.updatedAt || row!.createdAt.getTime() === row!.updatedAt.getTime()
  return { row: row!, created }
}

// ── Controller ───────────────────────────────────────────────

export function catalogController(db: Database) {
  return new Elysia({ prefix: "/catalog" }).post(
    "/sync",
    async ({ body }) => {
      const catalog = catalogSystemSchema.parse(body)

      // Run the entire sync in a single transaction
      const result: CatalogSyncResult = await db.transaction(async (tx) => {
        // Resolve owner team
        const ownerTeam = await resolveOrCreateTeam(tx, catalog.spec.owner)

        // Upsert system
        const { row: systemRow, created: systemCreated } = await upsertSystem(
          tx,
          catalog,
          ownerTeam.id
        )

        // Upsert components
        const createdComponents: string[] = []
        const updatedComponents: string[] = []

        for (const [slug, comp] of Object.entries(catalog.components)) {
          const r = await upsertComponent(
            tx,
            systemRow.id,
            ownerTeam.id,
            slug,
            comp
          )
          ;(r.created ? createdComponents : updatedComponents).push(slug)
        }

        // Upsert resources as components (infra types)
        for (const [slug, res] of Object.entries(catalog.resources)) {
          const r = await upsertComponent(
            tx,
            systemRow.id,
            ownerTeam.id,
            slug,
            res
          )
          ;(r.created ? createdComponents : updatedComponents).push(slug)
        }

        // Upsert APIs
        const createdApis: string[] = []
        const updatedApis: string[] = []

        if (catalog.apis) {
          for (const [slug, api] of Object.entries(catalog.apis)) {
            const r = await upsertApi(tx, systemRow.id, slug, api)
            ;(r.created ? createdApis : updatedApis).push(slug)
          }
        }

        return {
          systemId: systemRow.id,
          systemSlug: systemRow.slug,
          systemCreated,
          componentsUpserted:
            createdComponents.length + updatedComponents.length,
          apisUpserted: createdApis.length + updatedApis.length,
          created: {
            components: createdComponents,
            apis: createdApis,
          },
          updated: {
            components: updatedComponents,
            apis: updatedApis,
          },
        }
      })

      return ok(result)
    },
    {
      detail: {
        tags: ["catalog"],
        summary: "Sync a catalog system to the v2 software schema",
      },
    }
  )
}
