import type { PGlite } from "@electric-sql/pglite"
import type {
  ComponentDeploymentObservedStatus,
  ComponentDeploymentSpec,
  SiteObservedStatus,
  SiteSpec,
  SystemDeploymentObservedStatus,
  SystemDeploymentSpec,
} from "@smp/factory-shared/schemas/ops"
import type {
  ComponentSpec,
  SystemSpec,
} from "@smp/factory-shared/schemas/software"
import { eq } from "drizzle-orm"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test"

import type { Database } from "../db/connection"
import { componentDeployment, site, systemDeployment } from "../db/schema/ops"
import { component, system } from "../db/schema/software"
import {
  createTestContext,
  type TestApp,
  truncateAllTables,
} from "../test-helpers"

describe("Image delivery endpoint", () => {
  let db: Database
  let client: PGlite
  let app: TestApp

  async function createSystem(name = "test-system") {
    const spec: SystemSpec = {
      namespace: "default",
      lifecycle: "experimental",
      tags: [],
    }
    const [sys] = await db
      .insert(system)
      .values({ name, slug: name, spec })
      .returning()
    return sys
  }

  async function createSite(name = "prod-site", overrides?: Partial<SiteSpec>) {
    const spec: SiteSpec = {
      product: "smp",
      updatePolicy: "auto",
      lifecycle: "persistent",
      ...overrides,
    }
    const [s] = await db
      .insert(site)
      .values({
        name,
        slug: name,
        type: "production",
        spec,
        status: { phase: "active" } satisfies SiteObservedStatus,
      } as typeof site.$inferInsert)
      .returning()
    return s
  }

  async function createComponent(
    systemId: string,
    name = "api-server",
    imageName = "registry.example.com/org/api-server"
  ) {
    const spec = {
      imageName,
      port: 8080,
      stateful: false,
    } as ComponentSpec
    const [comp] = await db
      .insert(component)
      .values({
        name,
        slug: name,
        type: "service",
        systemId,
        spec,
      })
      .returning()
    return comp
  }

  async function createSystemDeployment(
    systemId: string,
    siteId: string,
    name = "sd-1"
  ) {
    const spec: SystemDeploymentSpec = {
      trigger: "release",
      deploymentStrategy: "rolling",
      labels: {},
      runtime: "kubernetes",
    }
    const [sd] = await db
      .insert(systemDeployment)
      .values({
        name,
        slug: name,
        type: "production",
        systemId,
        siteId,
        spec,
        status: { phase: "active" } satisfies SystemDeploymentObservedStatus,
      })
      .returning()
    return sd
  }

  async function createComponentDeployment(
    sdId: string,
    componentId: string,
    overrides?: { spec?: Partial<ComponentDeploymentSpec> }
  ) {
    const spec: ComponentDeploymentSpec = {
      mode: "deployed",
      replicas: 1,
      envOverrides: {},
      resourceOverrides: {},
      ...overrides?.spec,
    }
    const [cd] = await db
      .insert(componentDeployment)
      .values({
        systemDeploymentId: sdId,
        componentId,
        spec,
        status: {
          phase: "running",
          driftDetected: false,
        } satisfies ComponentDeploymentObservedStatus,
      })
      .returning()
    return cd
  }

  async function deliver(body: {
    repo: string
    commitSha: string
    imageRef: string
    branch?: string
  }) {
    const req = new Request(
      "http://localhost/api/v1/factory/build/images/deliver",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }
    )
    return app.handle(req)
  }

  beforeAll(async () => {
    const ctx = await createTestContext()
    db = ctx.db as unknown as Database
    client = ctx.client
    app = ctx.app
  })

  afterAll(async () => {
    await client.close()
  })

  beforeEach(async () => {
    await truncateAllTables(client)
  })

  it("returns zero matches when no component has the image", async () => {
    const res = await deliver({
      repo: "org/repo",
      commitSha: "abc123",
      imageRef: "registry.example.com/org/unknown-image:latest",
    })

    expect(res.status).toBe(200)
    const json = (await res.json()) as Record<string, unknown>
    expect(json.matched).toBe(0)
    expect(json.updated).toBe(0)
    expect(json.created).toBe(0)
  })

  it("updates an existing component deployment with the delivered image", async () => {
    const sys = await createSystem()
    const s = await createSite()
    const comp = await createComponent(
      sys.id,
      "api-server",
      "registry.example.com/org/api-server"
    )
    const sd = await createSystemDeployment(sys.id, s.id)
    const cd = await createComponentDeployment(sd.id, comp.id)

    const res = await deliver({
      repo: "org/repo",
      commitSha: "abc123def456",
      imageRef: "registry.example.com/org/api-server:abc123de",
      branch: "main",
    })

    expect(res.status).toBe(200)
    const json = (await res.json()) as Record<string, unknown>
    expect(json.matched).toBe(1)
    expect(json.updated).toBe(1)
    expect(json.created).toBe(0)

    const [updatedCd] = await db
      .select()
      .from(componentDeployment)
      .where(eq(componentDeployment.id, cd.id))

    const spec = updatedCd.spec as ComponentDeploymentSpec
    expect(spec.desiredImage).toBe(
      "registry.example.com/org/api-server:abc123de"
    )
    expect(spec.sourceCommitSha).toBe("abc123def456")
    expect(spec.sourceBranch).toBe("main")
    expect(updatedCd.status?.phase).toBe("provisioning")
  })

  it("creates a new component deployment when none exists under active SD", async () => {
    const sys = await createSystem()
    const s = await createSite()
    const comp = await createComponent(
      sys.id,
      "api-server",
      "registry.example.com/org/api-server"
    )
    const sd = await createSystemDeployment(sys.id, s.id)

    const res = await deliver({
      repo: "org/repo",
      commitSha: "abc123def456",
      imageRef: "registry.example.com/org/api-server:abc123de",
      branch: "main",
    })

    expect(res.status).toBe(200)
    const json = (await res.json()) as Record<string, unknown>
    expect(json.matched).toBe(1)
    expect(json.created).toBe(1)
    expect(json.updated).toBe(0)

    const cds = await db
      .select()
      .from(componentDeployment)
      .where(eq(componentDeployment.systemDeploymentId, sd.id))
    expect(cds).toHaveLength(1)

    const spec = cds[0].spec as ComponentDeploymentSpec
    expect(spec.desiredImage).toBe(
      "registry.example.com/org/api-server:abc123de"
    )
    expect(spec.mode).toBe("deployed")
  })

  it("skips component deployments in destroying/stopped phase", async () => {
    const sys = await createSystem()
    const s = await createSite()
    const comp = await createComponent(
      sys.id,
      "api-server",
      "registry.example.com/org/api-server"
    )
    const sd = await createSystemDeployment(sys.id, s.id)
    await createComponentDeployment(sd.id, comp.id)

    // Mark the CD as destroying
    const [existingCd] = await db
      .select()
      .from(componentDeployment)
      .where(eq(componentDeployment.systemDeploymentId, sd.id))
    await db
      .update(componentDeployment)
      .set({
        status: {
          phase: "destroying",
          driftDetected: false,
        } satisfies ComponentDeploymentObservedStatus,
      })
      .where(eq(componentDeployment.id, existingCd.id))

    const res = await deliver({
      repo: "org/repo",
      commitSha: "abc123def456",
      imageRef: "registry.example.com/org/api-server:abc123de",
    })

    expect(res.status).toBe(200)
    const json = (await res.json()) as Record<string, unknown>
    expect(json.matched).toBe(1)
    expect(json.updated).toBe(0)
  })

  it("strips tag from imageRef when matching component imageName", async () => {
    const sys = await createSystem()
    const s = await createSite()
    await createComponent(sys.id, "web-app", "registry.example.com/org/web-app")
    const sd = await createSystemDeployment(sys.id, s.id)
    await createComponentDeployment(
      sd.id,
      (
        await db.select().from(component).where(eq(component.slug, "web-app"))
      )[0].id
    )

    const res = await deliver({
      repo: "org/repo",
      commitSha: "def789",
      imageRef: "registry.example.com/org/web-app:v2.0.0",
    })

    expect(res.status).toBe(200)
    const json = (await res.json()) as Record<string, unknown>
    expect(json.matched).toBe(1)
    expect(json.updated).toBe(1)
  })
})
