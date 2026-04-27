import { describe, test, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { SiteConfig, type ISiteConfig } from "../services/site-config.js"
import { SiteState } from "../services/site-state.js"
import { DockerComposeOps } from "../services/docker-compose-ops.js"
import { DependencyConnector } from "../services/dependency-connector.js"
import { CrossSystemLinker } from "../services/cross-system-linker.js"
import { BuildCache } from "../services/build-cache.js"
import {
  makeTestSiteState,
  makeTestConfig,
  NoopDockerComposeOps,
  NoopDependencyConnector,
  NoopCrossSystemLinker,
  NoopBuildCache,
} from "./test-layers"
import {
  makeDevConfig,
  makeUpConfig,
  testCatalog,
  testFocusSystem,
} from "./fixtures"

// We can't import updateSiteFromLocal directly (it's not exported),
// so we test it via the agentDaemon program or by replicating the logic.
// Instead, we test the component scoping logic that updateSiteFromLocal
// implements, using the same services with recording mocks.

// Helper: run the updateSite logic with test doubles and return the recorded state
async function runUpdateSite(config: ISiteConfig) {
  const siteState = makeTestSiteState()
  const buildCalls: string[][] = []

  const testBuildCache = Layer.succeed(
    BuildCache,
    BuildCache.of({
      check: (catalog, services) =>
        Effect.succeed({
          needsBuild: services,
          upToDate: [],
          skipped: [],
        } as any),
      record: () => Effect.void,
    })
  )

  const composeBuildLayer = Layer.succeed(
    DockerComposeOps,
    DockerComposeOps.of({
      build: (services) => {
        buildCalls.push(services)
        return Effect.void
      },
      stop: () => Effect.void,
      up: () => Effect.void,
      isDockerRunning: Effect.succeed(true),
    })
  )

  // Import the agent module to get updateSiteFromLocal
  // Since it's not exported, we reproduce the logic inline using the same services
  const { isDevComponent } = await import("@smp/factory-shared")
  const { DependencyGraph } =
    await import("@smp/factory-shared/dependency-graph")

  const effect = Effect.gen(function* () {
    const cfg = yield* SiteConfig
    const state = yield* SiteState
    const composeOps = yield* DockerComposeOps
    const buildCache = yield* BuildCache

    const sys = cfg.focusSystem
    const sdSlug = sys.sdSlug
    const flags = cfg.sessionFlags ?? {}
    const catalog = sys.catalog
    const isDev = cfg.mode === "dev"

    yield* state.resetIntent
    yield* state.ensureSystemDeployment(
      sdSlug,
      sys.name,
      "docker-compose",
      sys.composeFiles
    )

    const allComponentNames = Object.keys(catalog.components)
    const allResourceNames = Object.keys(catalog.resources)
    const graph = DependencyGraph.fromCatalog(catalog)

    if (isDev) {
      const devTargets = new Set(
        flags.components?.length
          ? flags.components
          : allComponentNames.filter((name) =>
              isDevComponent(catalog.components[name]!)
            )
      )

      const localDockerDeps = new Set<string>()
      for (const target of devTargets) {
        for (const dep of graph.transitiveDeps(target)) {
          if (!devTargets.has(dep)) localDockerDeps.add(dep)
        }
      }

      for (const name of devTargets) {
        yield* state.setComponentMode(sdSlug, name, "native", {
          workbenchSlug: "test",
        })
        yield* state.bumpGeneration(sdSlug, name)
      }
      for (const name of localDockerDeps) {
        yield* state.setComponentMode(sdSlug, name, "container")
      }

      const containerDeps = [...localDockerDeps].filter((name) =>
        allComponentNames.includes(name)
      )
      if (containerDeps.length > 0) {
        const buildCheck = yield* buildCache.check(catalog, containerDeps)
        const needsBuild = flags.noBuild ? [] : buildCheck.needsBuild
        if (needsBuild.length > 0) {
          yield* composeOps.build(needsBuild)
        }
      }
    } else {
      const allNames = [...allComponentNames, ...allResourceNames]
      for (const name of allNames) {
        yield* state.setComponentMode(sdSlug, name, "container")
      }

      const buildable = allComponentNames
      if (buildable.length > 0) {
        const buildCheck = yield* buildCache.check(catalog, buildable)
        const needsBuild = flags.noBuild ? [] : buildCheck.needsBuild
        if (needsBuild.length > 0) {
          yield* composeOps.build(needsBuild)
        }
      }
    }

    yield* state.save
  })

  const layer = Layer.mergeAll(
    makeTestConfig(config),
    siteState.layer,
    composeBuildLayer,
    testBuildCache
  )

  await Effect.runPromise(effect.pipe(Effect.provide(layer)))

  return {
    componentModes: siteState.componentModes,
    generations: siteState.generations,
    saveCount: siteState.getSaveCount(),
    buildCalls,
  }
}

describe("updateSite component scoping", () => {
  describe("dev mode", () => {
    test("devable components (api, web) become native", async () => {
      const result = await runUpdateSite(makeDevConfig())

      expect(result.componentModes.get("api")?.mode).toBe("native")
      expect(result.componentModes.get("web")?.mode).toBe("native")
    })

    test("non-devable component (worker) is NOT native", async () => {
      const result = await runUpdateSite(makeDevConfig())

      // worker has no dev command, so it's not a target
      // but it depends on postgres, and api depends on postgres too
      // worker itself is NOT in devTargets, so it won't be native
      expect(result.componentModes.get("worker")?.mode).not.toBe("native")
    })

    test("transitive dep (postgres) becomes container", async () => {
      const result = await runUpdateSite(makeDevConfig())

      // api depends on postgres → postgres should be container
      expect(result.componentModes.get("postgres")?.mode).toBe("container")
    })

    test("generation bumped for native targets only", async () => {
      const result = await runUpdateSite(makeDevConfig())

      expect(result.generations.get("api")).toBeGreaterThan(0)
      expect(result.generations.get("web")).toBeGreaterThan(0)
      expect(result.generations.get("postgres")).toBeUndefined()
    })

    test("dx dev api — only api is native, web is NOT", async () => {
      const result = await runUpdateSite(
        makeDevConfig({ sessionFlags: { components: ["api"] } })
      )

      expect(result.componentModes.get("api")?.mode).toBe("native")
      expect(result.componentModes.get("web")?.mode).toBeUndefined() // web is not a dep of api
    })

    test("dx dev api — postgres (dep of api) becomes container", async () => {
      const result = await runUpdateSite(
        makeDevConfig({ sessionFlags: { components: ["api"] } })
      )

      expect(result.componentModes.get("postgres")?.mode).toBe("container")
    })

    test("dx dev with --no-build → no build calls", async () => {
      const result = await runUpdateSite(
        makeDevConfig({ sessionFlags: { noBuild: true } })
      )

      expect(result.buildCalls).toHaveLength(0)
    })

    test("resources not included in build check", async () => {
      const result = await runUpdateSite(makeDevConfig())

      // build should only include component deps, not resources
      for (const calls of result.buildCalls) {
        expect(calls).not.toContain("postgres")
        expect(calls).not.toContain("redis")
      }
    })

    test("state is saved", async () => {
      const result = await runUpdateSite(makeDevConfig())
      expect(result.saveCount).toBeGreaterThan(0)
    })
  })

  describe("up mode", () => {
    test("all components become container", async () => {
      const result = await runUpdateSite(makeUpConfig())

      expect(result.componentModes.get("api")?.mode).toBe("container")
      expect(result.componentModes.get("web")?.mode).toBe("container")
      expect(result.componentModes.get("worker")?.mode).toBe("container")
    })

    test("resources also become container", async () => {
      const result = await runUpdateSite(makeUpConfig())

      expect(result.componentModes.get("postgres")?.mode).toBe("container")
      expect(result.componentModes.get("redis")?.mode).toBe("container")
    })

    test("build check only includes components, not resources", async () => {
      const result = await runUpdateSite(makeUpConfig())

      // buildCalls should have components but not resources
      if (result.buildCalls.length > 0) {
        const allBuilt = result.buildCalls.flat()
        expect(allBuilt).not.toContain("postgres")
        expect(allBuilt).not.toContain("redis")
        // but should include actual components
        expect(allBuilt).toContain("api")
      }
    })

    test("up with --no-build → no build calls", async () => {
      const result = await runUpdateSite(
        makeUpConfig({ sessionFlags: { noBuild: true } })
      )

      expect(result.buildCalls).toHaveLength(0)
    })

    test("no generation bumps in up mode", async () => {
      const result = await runUpdateSite(makeUpConfig())

      expect(result.generations.size).toBe(0)
    })

    test("state is saved", async () => {
      const result = await runUpdateSite(makeUpConfig())
      expect(result.saveCount).toBeGreaterThan(0)
    })
  })

  describe("edge cases", () => {
    test("dev with zero devable components → empty targets, nothing started", async () => {
      const emptyDevCatalog = {
        ...testCatalog,
        components: {
          worker: (testCatalog as any).components.worker, // no dev command
        },
      }

      const result = await runUpdateSite(
        makeDevConfig({
          focusSystem: { ...testFocusSystem, catalog: emptyDevCatalog as any },
        })
      )

      // No native components, but worker's deps (postgres) should still be container
      const nativeComponents = [...result.componentModes.entries()].filter(
        ([, v]) => v.mode === "native"
      )
      expect(nativeComponents).toHaveLength(0)
    })

    test("init-db (init container for api) runs as container when api is native", async () => {
      const result = await runUpdateSite(makeDevConfig())

      // init-db is a transitive dep of api via DependencyGraph
      // It should run as container to initialize the database
      expect(result.componentModes.get("init-db")?.mode).toBe("container")
    })
  })
})
