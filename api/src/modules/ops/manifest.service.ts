import type { ManifestV1 } from "@smp/factory-shared/types"
import { desc, eq } from "drizzle-orm"

import type { Database } from "../../db/connection"
import { site, siteManifest } from "../../db/schema/ops"
import { release } from "../../db/schema/software-v2"
import { computeManifest } from "../../lib/manifest"
import { listDomains, listRoutes } from "../infra/gateway.service"

// ---------------------------------------------------------------------------
// Manifest & Check-in — v2: spec JSONB
// ---------------------------------------------------------------------------

export async function siteCheckin(
  db: Database,
  siteName: string,
  input: {
    healthSnapshot: Record<string, unknown>
    lastAppliedManifestVersion: number
  }
): Promise<{
  manifestChanged: boolean
  latestVersion: number
  manifest?: ManifestV1
}> {
  const [s] = await db
    .select()
    .from(site)
    .where(eq(site.name, siteName))
    .limit(1)
  if (!s) throw new Error(`Site not found: ${siteName}`)

  await db
    .update(site)
    .set({
      spec: {
        ...(s.spec as any),
        lastCheckinAt: new Date().toISOString(),
      } as any,
    })
    .where(eq(site.id, s.id))

  const manifests = await db
    .select()
    .from(siteManifest)
    .where(eq(siteManifest.siteId, s.id))
    .orderBy(desc(siteManifest.createdAt))

  if (manifests.length === 0) {
    return { manifestChanged: false, latestVersion: 0 }
  }

  const latest = manifests[0]
  const latestVersion = (latest.spec as any)?.manifestVersion ?? 0

  if (input.lastAppliedManifestVersion !== latestVersion) {
    return {
      manifestChanged: true,
      latestVersion,
      manifest: (latest.spec as any)?.content as ManifestV1,
    }
  }

  return { manifestChanged: false, latestVersion }
}

export async function assignReleaseToSite(
  db: Database,
  siteName: string,
  releaseVersion: string
) {
  const [s] = await db
    .select()
    .from(site)
    .where(eq(site.name, siteName))
    .limit(1)
  if (!s) throw new Error(`Site not found: ${siteName}`)

  const allReleases = await db.select().from(release)
  const rel = allReleases.find(
    (r) =>
      (r.spec as any)?.version === releaseVersion || r.slug === releaseVersion
  )
  if (!rel) throw new Error(`Release not found: ${releaseVersion}`)

  const pins = ((rel.spec as any)?.systemPins ?? []).map((id: string) => ({
    moduleVersionId: id,
  }))

  const existingManifests = await db
    .select()
    .from(siteManifest)
    .where(eq(siteManifest.siteId, s.id))

  const previousVersion =
    existingManifests.length > 0
      ? Math.max(
          ...existingManifests.map((m) => (m.spec as any)?.manifestVersion ?? 0)
        )
      : 0

  const [siteRoutes, siteDomains] = await Promise.all([
    listRoutes(db, { status: "active" }),
    listDomains(db, { status: "active" }),
  ])

  const manifest = computeManifest({
    site: { siteId: s.id, name: s.name, product: (s.spec as any)?.product },
    release: {
      releaseId: rel.id,
      version: (rel.spec as any)?.version ?? rel.slug,
      pins,
    },
    routes: siteRoutes.data.map((r) => ({
      routeId: r.id,
      kind: r.type,
      domain: r.domain,
      pathPrefix: (r.spec as any)?.pathPrefix,
      targetService: (r.spec as any)?.targetService,
      targetPort: (r.spec as any)?.targetPort,
      protocol: (r.spec as any)?.protocol,
      tlsMode: (r.spec as any)?.tlsMode,
      middlewares: ((r.spec as any)?.middlewares as unknown[]) ?? [],
      priority: (r.spec as any)?.priority,
    })),
    domains: siteDomains.data.map((d) => ({
      domainId: d.id,
      fqdn: (d.spec as any)?.fqdn,
      kind: d.type,
      tlsCertRef: (d.spec as any)?.tlsCertRef,
    })),
    previousVersion,
  })

  await db.insert(siteManifest).values({
    siteId: s.id,
    releaseId: rel.id,
    spec: {
      manifestVersion: manifest.manifestVersion,
      manifestHash: manifest.manifestHash,
      content: manifest,
    } as any,
  })

  await db
    .update(site)
    .set({
      spec: {
        ...(s.spec as any),
        currentManifestVersion: manifest.manifestVersion,
      } as any,
    })
    .where(eq(site.id, s.id))

  return manifest
}

export async function getSiteManifest(
  db: Database,
  siteName: string
): Promise<ManifestV1 | null> {
  const [s] = await db
    .select()
    .from(site)
    .where(eq(site.name, siteName))
    .limit(1)
  if (!s) return null

  const manifests = await db
    .select()
    .from(siteManifest)
    .where(eq(siteManifest.siteId, s.id))
    .orderBy(desc(siteManifest.createdAt))

  if (manifests.length === 0) return null
  return ((manifests[0].spec as any)?.content as ManifestV1) ?? null
}
