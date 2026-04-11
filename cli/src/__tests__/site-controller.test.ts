/**
 * Integration tests for the SiteController.
 *
 * Uses a mock executor to verify the reconcile cycle:
 *   - Diffs manifest vs actual state
 *   - Executes deploy/stop steps in correct order
 *   - Records state and image history
 *   - Reports errors per-step without aborting
 */
import type { CatalogSystem } from "@smp/factory-shared/catalog"
import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { SiteController } from "../site/controller.js"
import type {
  ComponentState,
  DeployResult,
  DesiredComponentState,
  Executor,
  HealthStatus,
  LogOpts,
  RunResult,
} from "../site/execution/executor.js"
import { HealthMonitor } from "../site/health.js"
import type { SiteManifest } from "../site/manifest.js"
import { StateStore } from "../site/state.js"

// ---------------------------------------------------------------------------
// Mock executor
// ---------------------------------------------------------------------------

function createMockExecutor(initialStates: ComponentState[] = []): Executor & {
  deployed: Array<{ component: string; desired: DesiredComponentState }>
  stopped: string[]
  inspectResult: ComponentState[]
} {
  const deployed: Array<{ component: string; desired: DesiredComponentState }> =
    []
  const stopped: string[] = []
  let inspectResult = [...initialStates]

  return {
    type: "compose",
    deployed,
    stopped,
    get inspectResult() {
      return inspectResult
    },
    set inspectResult(v) {
      inspectResult = v
    },

    async parseCatalog(): Promise<CatalogSystem> {
      return {
        kind: "System",
        metadata: { name: "test", namespace: "default" },
        spec: { owner: "team" },
        components: {},
        resources: {},
        connections: [],
      } as CatalogSystem
    },

    async inspect(): Promise<ComponentState[]> {
      return inspectResult
    },

    async inspectOne(component: string): Promise<ComponentState> {
      return (
        inspectResult.find((s) => s.name === component) ?? {
          name: component,
          image: "",
          status: "unknown",
          health: "none",
          ports: [],
        }
      )
    },

    async deploy(
      component: string,
      desired: DesiredComponentState
    ): Promise<DeployResult> {
      deployed.push({ component, desired })
      const state: ComponentState = {
        name: component,
        image: desired.image,
        status: "running",
        health: "healthy",
        ports: [],
      }
      inspectResult = inspectResult.filter((s) => s.name !== component)
      inspectResult.push(state)
      return { actualImage: desired.image, status: "running" }
    },

    async stop(component: string): Promise<void> {
      stopped.push(component)
      inspectResult = inspectResult.filter((s) => s.name !== component)
    },

    async scale(): Promise<void> {},
    async restart(): Promise<void> {},
    async runInit(): Promise<{ exitCode: number; output: string }> {
      return { exitCode: 0, output: "" }
    },
    async logs(): Promise<string> {
      return ""
    },
    async run(): Promise<RunResult> {
      return { exitCode: 0, stdout: "", stderr: "" }
    },
    async healthCheck(): Promise<HealthStatus> {
      return "healthy"
    },
    async healthCheckAll(): Promise<Record<string, HealthStatus>> {
      const result: Record<string, HealthStatus> = {}
      for (const s of inspectResult) result[s.name] = s.health
      return result
    },
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "site-ctrl-test-"))
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

function makeManifest(
  cds: Array<{ name: string; image: string; status?: string }>
): SiteManifest {
  return {
    version: 1,
    systemDeployment: {
      id: "sd-1",
      name: "test",
      site: "test-site",
      realmType: "compose",
    },
    componentDeployments: cds.map((cd) => ({
      id: `cd-${cd.name}`,
      componentName: cd.name,
      desiredImage: cd.image,
      replicas: 1,
      envOverrides: {},
      resourceOverrides: {},
      status: (cd.status ?? "running") as any,
    })),
    catalog: {
      kind: "System",
      metadata: { name: "test", namespace: "default" },
      spec: { owner: "team" },
      components: {},
      resources: {},
      connections: [],
    } as CatalogSystem,
  }
}

function createController(
  executor: Executor,
  stateDir: string,
  manifest?: SiteManifest
) {
  const state = new StateStore(stateDir)
  const healthMonitor = new HealthMonitor(executor, { intervalMs: 60_000 })
  const controller = new SiteController(
    {
      siteName: "test-site",
      mode: "standalone",
      reconcileIntervalMs: 60_000,
      workingDir: stateDir,
    },
    executor,
    null,
    healthMonitor,
    state
  )
  if (manifest) {
    controller.setManifest(manifest)
  }
  return controller
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SiteController", () => {
  const dirs: Array<() => void> = []

  afterEach(() => {
    for (const cleanup of dirs) cleanup()
    dirs.length = 0
  })

  it("deploys all components on first reconcile with empty actual state", async () => {
    const { dir, cleanup } = tempDir()
    dirs.push(cleanup)

    const executor = createMockExecutor([])
    const manifest = makeManifest([
      { name: "api", image: "registry/api:v1" },
      { name: "web", image: "registry/web:v1" },
    ])
    const controller = createController(executor, dir, manifest)

    const result = await controller.reconcile()

    expect(result.success).toBe(true)
    expect(result.stepsApplied).toBe(2)
    expect(executor.deployed).toHaveLength(2)
    expect(executor.deployed.map((d) => d.component).sort()).toEqual([
      "api",
      "web",
    ])
  })

  it("does nothing when actual matches desired", async () => {
    const { dir, cleanup } = tempDir()
    dirs.push(cleanup)

    const executor = createMockExecutor([
      {
        name: "api",
        image: "registry/api:v1",
        status: "running",
        health: "healthy",
        ports: [],
      },
    ])
    const manifest = makeManifest([{ name: "api", image: "registry/api:v1" }])
    const controller = createController(executor, dir, manifest)

    const result = await controller.reconcile()

    expect(result.success).toBe(true)
    expect(result.stepsApplied).toBe(0)
    expect(executor.deployed).toHaveLength(0)
  })

  it("deploys on image drift", async () => {
    const { dir, cleanup } = tempDir()
    dirs.push(cleanup)

    const executor = createMockExecutor([
      {
        name: "api",
        image: "registry/api:v1",
        status: "running",
        health: "healthy",
        ports: [],
      },
    ])
    const manifest = makeManifest([{ name: "api", image: "registry/api:v2" }])
    const controller = createController(executor, dir, manifest)

    const result = await controller.reconcile()

    expect(result.success).toBe(true)
    expect(result.stepsApplied).toBe(1)
    expect(executor.deployed[0].component).toBe("api")
    expect(executor.deployed[0].desired.image).toBe("registry/api:v2")
  })

  it("records image history on deploy", async () => {
    const { dir, cleanup } = tempDir()
    dirs.push(cleanup)

    const executor = createMockExecutor([])
    const manifest = makeManifest([{ name: "api", image: "registry/api:v1" }])
    const controller = createController(executor, dir, manifest)

    await controller.reconcile()

    const state = new StateStore(dir)
    const history = state.getImageHistory("api")
    expect(history).toHaveLength(1)
    expect(history[0].image).toBe("registry/api:v1")
  })

  it("continues on per-step errors", async () => {
    const { dir, cleanup } = tempDir()
    dirs.push(cleanup)

    const executor = createMockExecutor([])
    const manifest = makeManifest([
      { name: "failing", image: "registry/fail:v1" },
      { name: "succeeding", image: "registry/ok:v1" },
    ])

    let callCount = 0
    const origDeploy = executor.deploy.bind(executor)
    executor.deploy = async (
      component: string,
      desired: DesiredComponentState
    ) => {
      callCount++
      if (component === "failing") {
        throw new Error("simulated deploy failure")
      }
      return origDeploy(component, desired)
    }

    const controller = createController(executor, dir, manifest)
    const result = await controller.reconcile()

    expect(result.success).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].step.component).toBe("failing")
    expect(result.stepsApplied).toBe(1)
  })

  it("returns empty result when no manifest is loaded", async () => {
    const { dir, cleanup } = tempDir()
    dirs.push(cleanup)

    const executor = createMockExecutor([])
    const controller = createController(executor, dir)

    const result = await controller.reconcile()

    expect(result.success).toBe(false)
    expect(result.stepsApplied).toBe(0)
  })

  it("reports correct status", () => {
    const { dir, cleanup } = tempDir()
    dirs.push(cleanup)

    const executor = createMockExecutor([])
    const manifest = makeManifest([{ name: "api", image: "img:v1" }])
    const controller = createController(executor, dir, manifest)

    const status = controller.getStatus()

    expect(status.siteName).toBe("test-site")
    expect(status.mode).toBe("standalone")
    expect(status.executorType).toBe("compose")
    expect(status.manifestVersion).toBe(1)
    expect(status.lastReconcileAt).toBeNull()
  })

  it("emits reconcile events", async () => {
    const { dir, cleanup } = tempDir()
    dirs.push(cleanup)

    const executor = createMockExecutor([])
    const manifest = makeManifest([{ name: "api", image: "img:v1" }])
    const controller = createController(executor, dir, manifest)

    await controller.reconcile()

    const events = controller.getEvents()
    const types = events.map((e) => e.type)
    expect(types).toContain("reconcile-start")
    expect(types).toContain("step-applied")
    expect(types).toContain("reconcile-complete")
  })
})
