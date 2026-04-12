/**
 * Tests for site controller reconcile logic.
 *
 * Covers:
 *   - planChanges(): diffing desired manifest vs actual state
 *   - topologicalOrder(): dependency-aware ordering with cycle detection
 *   - Edge cases: orphaned containers, stopped desired, init containers
 */
import type { CatalogSystem } from "@smp/factory-shared/catalog"
import { describe, expect, it } from "bun:test"

import type { ComponentState } from "../site/execution/executor.js"
import type {
  ManifestComponentDeployment,
  SiteManifest,
} from "../site/manifest.js"
import { planChanges } from "../site/reconcile.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeManifest(
  componentDeployments: ManifestComponentDeployment[],
  catalog?: Partial<CatalogSystem>
): SiteManifest {
  return {
    version: 1,
    systemDeployment: {
      id: "sd-1",
      name: "test-system",
      site: "test-site",
      realmType: "docker-compose",
    },
    componentDeployments,
    catalog: {
      kind: "System",
      metadata: { name: "test", namespace: "default" },
      spec: { owner: "team" },
      components: catalog?.components ?? {},
      resources: catalog?.resources ?? {},
      connections: [],
    } as CatalogSystem,
  }
}

function cd(
  name: string,
  image: string,
  opts?: Partial<ManifestComponentDeployment>
): ManifestComponentDeployment {
  return {
    id: `cd-${name}`,
    componentName: name,
    desiredImage: image,
    replicas: 1,
    envOverrides: {},
    resourceOverrides: {},
    status: "running",
    ...opts,
  }
}

function actual(
  name: string,
  image: string,
  opts?: Partial<ComponentState>
): ComponentState {
  return {
    name,
    image,
    status: "running",
    health: "healthy",
    ports: [],
    ...opts,
  }
}

// ---------------------------------------------------------------------------
// planChanges
// ---------------------------------------------------------------------------

describe("planChanges", () => {
  it("produces no steps when actual matches desired", () => {
    const manifest = makeManifest([
      cd("api", "registry/api:v1"),
      cd("web", "registry/web:v1"),
    ])
    const actualState = [
      actual("api", "registry/api:v1"),
      actual("web", "registry/web:v1"),
    ]

    const plan = planChanges(manifest, actualState)

    expect(plan.steps).toHaveLength(0)
    expect(plan.upToDate).toEqual(expect.arrayContaining(["api", "web"]))
  })

  it("deploys components with image drift", () => {
    const manifest = makeManifest([cd("api", "registry/api:v2")])
    const actualState = [actual("api", "registry/api:v1")]

    const plan = planChanges(manifest, actualState)

    expect(plan.steps).toHaveLength(1)
    expect(plan.steps[0]).toMatchObject({
      action: "deploy",
      component: "api",
      reason: expect.stringContaining("image drift"),
    })
  })

  it("deploys components that are not running", () => {
    const manifest = makeManifest([cd("api", "registry/api:v1")])

    const plan = planChanges(manifest, [])

    expect(plan.steps).toHaveLength(1)
    expect(plan.steps[0]).toMatchObject({
      action: "deploy",
      component: "api",
      reason: expect.stringContaining("not running"),
    })
  })

  it("deploys exited components", () => {
    const manifest = makeManifest([cd("api", "registry/api:v1")])
    const actualState = [actual("api", "registry/api:v1", { status: "exited" })]

    const plan = planChanges(manifest, actualState)

    expect(plan.steps).toHaveLength(1)
    expect(plan.steps[0]).toMatchObject({
      action: "deploy",
      component: "api",
      reason: expect.stringContaining("exited"),
    })
  })

  it("stops components when desired status is stopped", () => {
    const manifest = makeManifest([
      cd("api", "registry/api:v1", { status: "stopped" }),
    ])
    const actualState = [actual("api", "registry/api:v1")]

    const plan = planChanges(manifest, actualState)

    expect(plan.steps).toHaveLength(1)
    expect(plan.steps[0]).toMatchObject({
      action: "stop",
      component: "api",
      reason: "desired state is stopped",
    })
  })

  it("does nothing for already-stopped components when desired is stopped", () => {
    const manifest = makeManifest([
      cd("api", "registry/api:v1", { status: "stopped" }),
    ])
    const actualState = [actual("api", "registry/api:v1", { status: "exited" })]

    const plan = planChanges(manifest, actualState)

    expect(plan.steps).toHaveLength(0)
  })

  it("stops orphaned containers not in manifest", () => {
    const manifest = makeManifest([cd("api", "registry/api:v1")])
    const actualState = [
      actual("api", "registry/api:v1"),
      actual("old-worker", "registry/worker:v1"),
    ]

    const plan = planChanges(manifest, actualState)

    expect(plan.steps).toHaveLength(1)
    expect(plan.steps[0]).toMatchObject({
      action: "stop",
      component: "old-worker",
      reason: expect.stringContaining("orphaned"),
    })
  })

  it("does not stop orphaned init containers", () => {
    const catalog = {
      components: {
        "db-migrate": {
          kind: "Component" as const,
          metadata: { name: "db-migrate", namespace: "default" },
          spec: { type: "init", initFor: "api", ports: [] },
        },
      },
      resources: {},
    }
    const manifest = makeManifest([cd("api", "registry/api:v1")], catalog)
    const actualState = [
      actual("api", "registry/api:v1"),
      actual("db-migrate", "registry/migrate:v1"),
    ]

    const plan = planChanges(manifest, actualState)

    expect(plan.steps).toHaveLength(0)
  })

  it("handles multiple components with mixed states", () => {
    const manifest = makeManifest([
      cd("api", "registry/api:v2"),
      cd("web", "registry/web:v1"),
      cd("worker", "registry/worker:v1"),
    ])
    const actualState = [
      actual("api", "registry/api:v1"),
      actual("web", "registry/web:v1"),
    ]

    const plan = planChanges(manifest, actualState)

    const actions = plan.steps.map((s) => `${s.action}:${s.component}`)
    expect(actions).toContain("deploy:api")
    expect(actions).toContain("deploy:worker")
    expect(plan.upToDate).toContain("web")
  })
})

// ---------------------------------------------------------------------------
// Topological ordering
// ---------------------------------------------------------------------------

describe("topological ordering", () => {
  it("orders init containers before their targets", () => {
    const catalog = {
      components: {
        "db-migrate": {
          kind: "Component" as const,
          metadata: { name: "db-migrate", namespace: "default" },
          spec: { type: "init", initFor: "api", ports: [] },
        },
        api: {
          kind: "Component" as const,
          metadata: { name: "api", namespace: "default" },
          spec: { type: "service", ports: [] },
        },
      },
      resources: {},
    }
    const manifest = makeManifest(
      [cd("api", "registry/api:v1"), cd("db-migrate", "registry/migrate:v1")],
      catalog
    )

    const plan = planChanges(manifest, [])

    const deployOrder = plan.steps
      .filter((s) => s.action === "deploy")
      .map((s) => s.component)
    const migrateIdx = deployOrder.indexOf("db-migrate")
    const apiIdx = deployOrder.indexOf("api")
    expect(migrateIdx).toBeLessThan(apiIdx)
  })

  it("orders dependencies before dependents", () => {
    const catalog = {
      components: {
        api: {
          kind: "Component" as const,
          metadata: { name: "api", namespace: "default" },
          spec: {
            type: "service",
            dependsOn: ["resource:infra-postgres"],
            ports: [],
          },
        },
        "infra-postgres": {
          kind: "Component" as const,
          metadata: { name: "infra-postgres", namespace: "default" },
          spec: { type: "service", ports: [] },
        },
      },
      resources: {},
    }
    const manifest = makeManifest(
      [cd("api", "registry/api:v1"), cd("infra-postgres", "postgres:16")],
      catalog
    )

    const plan = planChanges(manifest, [])

    const deployOrder = plan.steps
      .filter((s) => s.action === "deploy")
      .map((s) => s.component)
    const pgIdx = deployOrder.indexOf("infra-postgres")
    const apiIdx = deployOrder.indexOf("api")
    expect(pgIdx).toBeLessThan(apiIdx)
  })

  it("detects circular dependencies", () => {
    const catalog = {
      components: {
        a: {
          kind: "Component" as const,
          metadata: { name: "a", namespace: "default" },
          spec: { type: "service", dependsOn: ["component:b"], ports: [] },
        },
        b: {
          kind: "Component" as const,
          metadata: { name: "b", namespace: "default" },
          spec: { type: "service", dependsOn: ["component:a"], ports: [] },
        },
      },
      resources: {},
    }
    const manifest = makeManifest(
      [cd("a", "img:v1"), cd("b", "img:v1")],
      catalog
    )

    expect(() => planChanges(manifest, [])).toThrow(/Circular dependency/)
  })

  it("handles components with no dependencies", () => {
    const manifest = makeManifest([
      cd("alpha", "img:v1"),
      cd("beta", "img:v1"),
      cd("gamma", "img:v1"),
    ])

    const plan = planChanges(manifest, [])

    expect(plan.steps).toHaveLength(3)
    const names = plan.steps.map((s) => s.component)
    expect(names).toContain("alpha")
    expect(names).toContain("beta")
    expect(names).toContain("gamma")
  })
})
