import type { CatalogSystem } from "@smp/factory-shared/catalog"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import {
  type TestProject,
  createTestProject,
} from "../__tests__/create-test-project.js"
import { DevController } from "./dev-controller.js"

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

describe("DevController", () => {
  describe("resolveComponent", () => {
    test("resolves a node component from filesystem markers", () => {
      const catalog = makeCatalog()
      const ctrl = new DevController(project.rootDir, catalog, [])

      const resolved = ctrl.resolveComponent("api")
      expect(resolved.name).toBe("api")
      expect(resolved.type).toBe("node")
      expect(resolved.absPath).toBe(join(project.rootDir, "api"))
      expect(resolved.preferredPort).toBe(14100)
    })

    test("resolves a python component", () => {
      const catalog = makeCatalog()
      const ctrl = new DevController(project.rootDir, catalog, [])

      const resolved = ctrl.resolveComponent("worker")
      expect(resolved.type).toBe("python")
    })

    test("uses catalog runtime override", () => {
      const catalog = makeCatalog()
      // Override the api component to be java via the runtime field
      ;(catalog.components.api.spec as any).runtime = "java"
      const ctrl = new DevController(project.rootDir, catalog, [])

      const resolved = ctrl.resolveComponent("api")
      expect(resolved.type).toBe("java")
    })

    test("throws for unknown component", () => {
      const catalog = makeCatalog()
      const ctrl = new DevController(project.rootDir, catalog, [])

      expect(() => ctrl.resolveComponent("nonexistent")).toThrow(
        'Component "nonexistent" not found'
      )
    })

    test("throws for component with no detectable type", () => {
      const catalog = makeCatalog()
      // Add a component with no marker files and no runtime
      ;(catalog.components as any).empty = {
        kind: "Component",
        metadata: { name: "empty", namespace: "default" },
        spec: {
          type: "service",
          lifecycle: "development",
          owner: "test-team",
          build: { context: "./empty", dockerfile: "./empty/Dockerfile" },
        },
      }
      mkdirSync(join(project.rootDir, "empty"), { recursive: true })

      const ctrl = new DevController(project.rootDir, catalog, [])

      expect(() => ctrl.resolveComponent("empty")).toThrow(
        "Cannot determine service type"
      )
    })
  })

  describe("state management", () => {
    test("ps returns empty when no servers tracked", () => {
      const catalog = makeCatalog()
      const ctrl = new DevController(project.rootDir, catalog, [])

      expect(ctrl.ps()).toEqual([])
    })

    test("ps reads state files", () => {
      const catalog = makeCatalog()
      const ctrl = new DevController(project.rootDir, catalog, [])

      // Simulate a running server by writing state files with our own PID
      const stateDir = join(project.rootDir, ".dx", "dev")
      mkdirSync(stateDir, { recursive: true })
      writeFileSync(join(stateDir, "api.pid"), String(process.pid), "utf-8")
      writeFileSync(join(stateDir, "api.port"), "14100", "utf-8")

      const servers = ctrl.ps()
      expect(servers).toHaveLength(1)
      expect(servers[0].name).toBe("api")
      expect(servers[0].port).toBe(14100)
      expect(servers[0].pid).toBe(process.pid)
      expect(servers[0].running).toBe(true)
    })

    test("ps reports stopped for stale PID", () => {
      const catalog = makeCatalog()
      const ctrl = new DevController(project.rootDir, catalog, [])

      const stateDir = join(project.rootDir, ".dx", "dev")
      mkdirSync(stateDir, { recursive: true })
      // PID 99999999 should not exist
      writeFileSync(join(stateDir, "api.pid"), "99999999", "utf-8")
      writeFileSync(join(stateDir, "api.port"), "14100", "utf-8")

      const servers = ctrl.ps()
      expect(servers).toHaveLength(1)
      expect(servers[0].running).toBe(false)
      expect(servers[0].pid).toBeNull()
    })

    test("stop cleans up state files for stale PID", () => {
      const catalog = makeCatalog()
      const ctrl = new DevController(project.rootDir, catalog, [])

      const stateDir = join(project.rootDir, ".dx", "dev")
      mkdirSync(stateDir, { recursive: true })
      writeFileSync(join(stateDir, "api.pid"), "99999999", "utf-8")
      writeFileSync(join(stateDir, "api.port"), "14100", "utf-8")

      const stopped = ctrl.stop("api")
      // Process wasn't running, so nothing was actually stopped
      expect(stopped).toEqual([])
      // But files should be cleaned up
      expect(existsSync(join(stateDir, "api.pid"))).toBe(false)
      expect(existsSync(join(stateDir, "api.port"))).toBe(false)
    })

    test("stop with no arg cleans up all state files", () => {
      const catalog = makeCatalog()
      const ctrl = new DevController(project.rootDir, catalog, [])

      const stateDir = join(project.rootDir, ".dx", "dev")
      mkdirSync(stateDir, { recursive: true })
      writeFileSync(join(stateDir, "api.pid"), "99999999", "utf-8")
      writeFileSync(join(stateDir, "api.port"), "14100", "utf-8")
      writeFileSync(join(stateDir, "worker.pid"), "99999998", "utf-8")
      writeFileSync(join(stateDir, "worker.port"), "8000", "utf-8")

      ctrl.stop()
      expect(existsSync(join(stateDir, "api.pid"))).toBe(false)
      expect(existsSync(join(stateDir, "worker.pid"))).toBe(false)
    })

    test("logs returns log file path", () => {
      const catalog = makeCatalog()
      const ctrl = new DevController(project.rootDir, catalog, [])

      const stateDir = join(project.rootDir, ".dx", "dev")
      mkdirSync(stateDir, { recursive: true })
      writeFileSync(join(stateDir, "api.log"), "some log output", "utf-8")

      const logPath = ctrl.logs("api")
      expect(logPath).toBe(join(stateDir, "api.log"))
    })

    test("logs throws when no log file exists", () => {
      const catalog = makeCatalog()
      const ctrl = new DevController(project.rootDir, catalog, [])

      expect(() => ctrl.logs("api")).toThrow("No log file found")
    })
  })
})
