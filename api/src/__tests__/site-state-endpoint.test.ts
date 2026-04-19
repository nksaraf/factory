import type { PGlite } from "@electric-sql/pglite"
import type {
  SiteSpec as DbSiteSpec,
  SiteObservedStatus,
} from "@smp/factory-shared/schemas/ops"
import { siteStateSchema } from "@smp/factory-shared"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test"

import type { Database } from "../db/connection"
import { componentDeployment, site, systemDeployment } from "../db/schema/ops"
import { component, system } from "../db/schema/software"
import { createTestContext, truncateAllTables } from "../test-helpers"
import { getSiteState } from "../modules/ops/site-state.service"

describe("getSiteState", () => {
  let db: Database
  let client: PGlite

  beforeAll(async () => {
    const ctx = await createTestContext()
    db = ctx.db as unknown as Database
    client = ctx.client
  })

  afterAll(async () => {
    await client.close()
  })

  beforeEach(async () => {
    await truncateAllTables(client)
  })

  async function seedSite() {
    const [sys] = await db
      .insert(system)
      .values({
        slug: "trafficure",
        name: "Trafficure",
        type: "system",
        spec: { namespace: "default", lifecycle: "ga", tags: [] },
      })
      .returning()

    const [s] = await db
      .insert(site)
      .values({
        slug: "workshop-staging",
        name: "Workshop Staging",
        type: "staging",
        spec: {
          product: "trafficure",
          updatePolicy: "auto",
          lifecycle: "persistent",
          mode: "up",
        } satisfies DbSiteSpec & { mode: string },
        status: { phase: "running" } satisfies SiteObservedStatus,
      } as typeof site.$inferInsert)
      .returning()

    const [sd] = await db
      .insert(systemDeployment)
      .values({
        slug: "trafficure",
        name: "trafficure",
        type: "primary",
        systemId: sys.id,
        siteId: s.id,
        spec: { runtime: "docker-compose" },
      } as typeof systemDeployment.$inferInsert)
      .returning()

    const [comp] = await db
      .insert(component)
      .values({
        slug: "api",
        name: "api",
        type: "service",
        systemId: sys.id,
        spec: {},
      })
      .returning()

    await db.insert(componentDeployment).values({
      systemDeploymentId: sd.id,
      componentId: comp.id,
      spec: {
        desiredImage: "registry/api:v1",
        replicas: 2,
        mode: "container",
      },
    } as typeof componentDeployment.$inferInsert)

    return { site: s, system: sys, sd, component: comp }
  }

  it("returns null for non-existent site", async () => {
    const result = await getSiteState(db, "nonexistent")
    expect(result).toBeNull()
  })

  it("returns valid SiteState shape", async () => {
    await seedSite()
    const result = await getSiteState(db, "workshop-staging")
    expect(result).not.toBeNull()

    const parsed = siteStateSchema.parse(result)
    expect(parsed.spec.site.slug).toBe("workshop-staging")
    expect(parsed.spec.site.type).toBe("staging")
    expect(parsed.spec.mode).toBe("up")
    expect(parsed.spec.systemDeployments).toHaveLength(1)
    expect(parsed.spec.systemDeployments[0].slug).toBe("trafficure")
    expect(parsed.spec.systemDeployments[0].componentDeployments).toHaveLength(
      1
    )
    expect(
      parsed.spec.systemDeployments[0].componentDeployments[0].componentSlug
    ).toBe("api")
  })

  it("includes component spec fields", async () => {
    await seedSite()
    const result = await getSiteState(db, "workshop-staging")
    const cd = result!.spec.systemDeployments[0].componentDeployments[0]
    expect(cd.spec.desiredImage).toBe("registry/api:v1")
    expect(cd.spec.replicas).toBe(2)
    expect(cd.mode).toBe("container")
  })

  it("includes status fields", async () => {
    await seedSite()
    const result = await getSiteState(db, "workshop-staging")
    expect(result!.status.phase).toBe("running")
    expect(result!.status.updatedAt).toBeDefined()
  })

  it("handles system deployment with zero component deployments", async () => {
    const [sys] = await db
      .insert(system)
      .values({
        slug: "empty-sys",
        name: "Empty",
        type: "system",
        spec: { namespace: "default", lifecycle: "ga", tags: [] },
      })
      .returning()

    const [s] = await db
      .insert(site)
      .values({
        slug: "empty-site",
        name: "Empty Site",
        type: "staging",
        spec: {
          product: "test",
          updatePolicy: "auto",
          lifecycle: "persistent",
        },
        status: { phase: "pending" },
      } as typeof site.$inferInsert)
      .returning()

    await db.insert(systemDeployment).values({
      slug: "empty-sd",
      name: "empty-sd",
      type: "primary",
      systemId: sys.id,
      siteId: s.id,
      spec: {},
    } as typeof systemDeployment.$inferInsert)

    const result = await getSiteState(db, "empty-site")
    expect(result).not.toBeNull()
    const parsed = siteStateSchema.parse(result)
    expect(parsed.spec.systemDeployments).toHaveLength(1)
    expect(parsed.spec.systemDeployments[0].componentDeployments).toEqual([])
  })

  it("aggregates multiple system deployments", async () => {
    const { site: s, system: sys } = await seedSite()

    const [sys2] = await db
      .insert(system)
      .values({
        slug: "auth",
        name: "Auth",
        type: "system",
        spec: { namespace: "default", lifecycle: "ga", tags: [] },
      })
      .returning()

    await db.insert(systemDeployment).values({
      slug: "auth-sd",
      name: "auth",
      type: "primary",
      systemId: sys2.id,
      siteId: s.id,
      spec: {},
    } as typeof systemDeployment.$inferInsert)

    const result = await getSiteState(db, "workshop-staging")
    expect(result).not.toBeNull()
    expect(result!.spec.systemDeployments).toHaveLength(2)
    const slugs = result!.spec.systemDeployments.map((sd) => sd.slug).sort()
    expect(slugs).toEqual(["auth-sd", "trafficure"])
  })
})
