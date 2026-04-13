import type { CatalogSystem } from "@smp/factory-shared/catalog"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import {
  type TestProject,
  createTestProject,
} from "../__tests__/create-test-project.js"
import { NativeExecutor } from "../site/execution/native.js"
import { SiteManager } from "./site-manager.js"

let project: TestProject

function makeCatalog(): CatalogSystem {
  return {
    kind: "System",
    metadata: {
      name: "test",
      namespace: "default",
    },
    spec: {
      owner: "test-team",
      domain: "test",
      lifecycle: "development",
    },
    components: {
      api: {
        kind: "Component",
        metadata: { name: "api", namespace: "default" },
        spec: {
          type: "service",
          lifecycle: "development",
          owner: "test-team",
          runtime: "node",
          build: { context: "./api", dockerfile: "./api/Dockerfile" },
          ports: [{ port: 14100, name: "http" }],
        },
      },
      worker: {
        kind: "Component",
        metadata: { name: "worker", namespace: "default" },
        spec: {
          type: "service",
          lifecycle: "development",
          owner: "test-team",
          runtime: "python",
          build: { context: "./worker", dockerfile: "./worker/Dockerfile" },
        },
      },
    },
    resources: {
      postgres: {
        kind: "Resource",
        metadata: { name: "postgres", namespace: "default" },
        spec: {
          type: "database",
          owner: "test-team",
          lifecycle: "development",
          image: "postgres:16-alpine",
          ports: [{ port: 5433, name: "postgres" }],
          env: { POSTGRES_DB: "test" },
        },
      },
    },
    apis: {},
    connections: [],
  } as unknown as CatalogSystem
}

const SD_SLUG = "test-dev"

function makeTestSite(rootDir: string): SiteManager {
  const site = SiteManager.init(
    rootDir,
    { slug: "test-dev", type: "development" },
    { slug: "test-wb", type: "worktree", ownerType: "user" }
  )
  site.ensureSystemDeployment(SD_SLUG, "test", "docker-compose", [])
  return site
}

function makeExecutor(
  rootDir: string,
  catalog: CatalogSystem,
  site?: SiteManager
): NativeExecutor {
  const s = site ?? makeTestSite(rootDir)
  return new NativeExecutor({ rootDir, catalog, site: s, sdSlug: SD_SLUG })
}

beforeEach(() => {
  project = createTestProject({
    components: {
      api: { type: "node", port: 14100 },
      worker: { type: "python" },
    },
    dependencies: {
      postgres: { image: "postgres:16-alpine", port: 5433 },
    },
  })
})

afterEach(() => {
  project.cleanup()
})

describe("NativeExecutor", () => {
  describe("inspect", () => {
    test("returns empty when no servers tracked", async () => {
      const catalog = makeCatalog()
      const exec = makeExecutor(project.rootDir, catalog)

      const states = await exec.inspect()
      expect(states).toEqual([])
    })

    test("reads state from site.json", async () => {
      const catalog = makeCatalog()
      const site = makeTestSite(project.rootDir)
      site.setComponentMode(SD_SLUG, "api", "native")
      site.updateComponentStatus(SD_SLUG, "api", {
        pid: process.pid,
        port: 14100,
        phase: "running",
      })
      site.save()

      const exec = makeExecutor(project.rootDir, catalog, site)

      const states = await exec.inspect()
      expect(states).toHaveLength(1)
      expect(states[0].name).toBe("api")
      expect(states[0].status).toBe("running")
      expect(states[0].ports).toEqual([
        { host: 14100, container: 14100, protocol: "tcp" },
      ])
    })

    test("reports stopped for stale PID", async () => {
      const catalog = makeCatalog()
      const site = makeTestSite(project.rootDir)
      site.setComponentMode(SD_SLUG, "api", "native")
      site.updateComponentStatus(SD_SLUG, "api", {
        pid: 99999999,
        port: 14100,
        phase: "running",
      })
      site.save()

      const exec = makeExecutor(project.rootDir, catalog, site)

      const states = await exec.inspect()
      expect(states).toHaveLength(1)
      expect(states[0].status).toBe("stopped")
    })
  })

  describe("stop", () => {
    test("updates site state for stale PID", async () => {
      const catalog = makeCatalog()
      const site = makeTestSite(project.rootDir)
      site.setComponentMode(SD_SLUG, "api", "native")
      site.updateComponentStatus(SD_SLUG, "api", {
        pid: 99999999,
        port: 14100,
        phase: "running",
      })
      site.save()

      const exec = makeExecutor(project.rootDir, catalog, site)

      await exec.stop("api")

      const sd = site.getSystemDeployment(SD_SLUG)
      const cd = sd?.componentDeployments.find((c) => c.componentSlug === "api")
      expect(cd?.status.phase).toBe("stopped")
    })
  })

  describe("logs", () => {
    test("returns log file content", async () => {
      const catalog = makeCatalog()
      const exec = makeExecutor(project.rootDir, catalog)

      const logDir = join(project.rootDir, ".dx", "dev")
      mkdirSync(logDir, { recursive: true })
      writeFileSync(join(logDir, "api.log"), "some log output", "utf-8")

      const content = await exec.logs("api")
      expect(content).toBe("some log output")
    })

    test("throws when no log file exists", async () => {
      const catalog = makeCatalog()
      const exec = makeExecutor(project.rootDir, catalog)

      expect(exec.logs("api")).rejects.toThrow("No log file found")
    })

    test("supports tail option", async () => {
      const catalog = makeCatalog()
      const exec = makeExecutor(project.rootDir, catalog)

      const logDir = join(project.rootDir, ".dx", "dev")
      mkdirSync(logDir, { recursive: true })
      writeFileSync(
        join(logDir, "api.log"),
        "line1\nline2\nline3\nline4\n",
        "utf-8"
      )

      const content = await exec.logs("api", { tail: 2 })
      expect(content).toBe("line4\n")
    })
  })

  describe("healthCheck", () => {
    test("returns healthy for running process", async () => {
      const catalog = makeCatalog()
      const site = makeTestSite(project.rootDir)
      site.setComponentMode(SD_SLUG, "api", "native")
      site.updateComponentStatus(SD_SLUG, "api", {
        pid: process.pid,
        port: 14100,
        phase: "running",
      })
      site.save()

      const exec = makeExecutor(project.rootDir, catalog, site)

      const health = await exec.healthCheck("api")
      expect(health).toBe("healthy")
    })

    test("returns unhealthy for dead process", async () => {
      const catalog = makeCatalog()
      const site = makeTestSite(project.rootDir)
      site.setComponentMode(SD_SLUG, "api", "native")
      site.updateComponentStatus(SD_SLUG, "api", {
        pid: 99999999,
        port: 14100,
        phase: "running",
      })
      site.save()

      const exec = makeExecutor(project.rootDir, catalog, site)

      const health = await exec.healthCheck("api")
      expect(health).toBe("unhealthy")
    })
  })
})

describe("SiteManager helpers", () => {
  test("bumpGeneration increments spec generation", () => {
    const site = makeTestSite(project.rootDir)
    site.setComponentMode(SD_SLUG, "api", "native")

    const sd = site.getSystemDeployment(SD_SLUG)
    const cd = sd?.componentDeployments.find((c) => c.componentSlug === "api")
    expect(cd?.spec.generation).toBe(1)

    site.bumpGeneration(SD_SLUG, "api")
    expect(cd?.spec.generation).toBe(2)
  })

  test("setCondition upserts conditions", () => {
    const site = makeTestSite(project.rootDir)
    site.setComponentMode(SD_SLUG, "api", "native")

    site.setCondition(SD_SLUG, "api", {
      type: "Ready",
      status: "True",
    })

    const sd = site.getSystemDeployment(SD_SLUG)
    const cd = sd?.componentDeployments.find((c) => c.componentSlug === "api")
    expect(cd?.status.conditions).toHaveLength(1)
    expect(cd?.status.conditions[0].type).toBe("Ready")
    expect(cd?.status.conditions[0].status).toBe("True")

    // Upsert same type
    site.setCondition(SD_SLUG, "api", {
      type: "Ready",
      status: "False",
      reason: "port not bound",
    })
    expect(cd?.status.conditions).toHaveLength(1)
    expect(cd?.status.conditions[0].status).toBe("False")
    expect(cd?.status.conditions[0].reason).toBe("port not bound")
  })

  test("getComponentMode returns mode", () => {
    const site = makeTestSite(project.rootDir)
    site.setComponentMode(SD_SLUG, "api", "native")

    expect(site.getComponentMode(SD_SLUG, "api")).toBe("native")
    expect(site.getComponentMode(SD_SLUG, "unknown")).toBeNull()
  })

  test("toManifest converts site state to manifest", () => {
    const catalog = makeCatalog()
    const site = makeTestSite(project.rootDir)
    site.setComponentMode(SD_SLUG, "api", "native")
    site.setComponentMode(SD_SLUG, "postgres", "container")

    const manifest = site.toManifest(SD_SLUG, catalog)
    expect(manifest).not.toBeNull()
    expect(manifest!.systemDeployment.name).toBe("test")
    expect(manifest!.componentDeployments).toHaveLength(2)
    expect(manifest!.catalog).toBe(catalog)
  })
})
