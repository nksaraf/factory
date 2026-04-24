import { describe, test, expect } from "bun:test"
import { planChanges } from "../../site/reconcile.js"
import {
  makeManifest,
  makeRunningState,
  makeStoppedState,
  makeExitedState,
  testCatalog,
} from "./fixtures"

describe("planChanges", () => {
  test("new component not in actual → deploy step", () => {
    const manifest = makeManifest([{ componentName: "api" }])
    const plan = planChanges(manifest, [])

    expect(plan.steps).toHaveLength(1)
    expect(plan.steps[0]!.action).toBe("deploy")
    expect(plan.steps[0]!.component).toBe("api")
    expect(plan.steps[0]!.reason).toContain("not running")
  })

  test("running component with matching image → upToDate", () => {
    const manifest = makeManifest([
      { componentName: "api", desiredImage: "test/api:latest" },
    ])
    const actual = [makeRunningState("api", "test/api:latest")]
    const plan = planChanges(manifest, actual)

    expect(plan.steps).toHaveLength(0)
    expect(plan.upToDate).toContain("api")
  })

  test("running component with different image → deploy (image drift)", () => {
    const manifest = makeManifest([
      { componentName: "api", desiredImage: "test/api:v2" },
    ])
    const actual = [makeRunningState("api", "test/api:v1")]
    const plan = planChanges(manifest, actual)

    expect(plan.steps).toHaveLength(1)
    expect(plan.steps[0]!.action).toBe("deploy")
    expect(plan.steps[0]!.reason).toContain("image drift")
  })

  test("exited component → deploy step", () => {
    const manifest = makeManifest([{ componentName: "api" }])
    const actual = [makeExitedState("api")]
    const plan = planChanges(manifest, actual)

    expect(plan.steps).toHaveLength(1)
    expect(plan.steps[0]!.action).toBe("deploy")
    expect(plan.steps[0]!.reason).toContain("exited")
  })

  test("desired status stopped + currently running → stop step", () => {
    const manifest = makeManifest([{ componentName: "api", status: "stopped" }])
    const actual = [makeRunningState("api")]
    const plan = planChanges(manifest, actual)

    expect(plan.steps).toHaveLength(1)
    expect(plan.steps[0]!.action).toBe("stop")
    expect(plan.steps[0]!.reason).toContain("stopped")
  })

  test("desired status stopped + not running → no step", () => {
    const manifest = makeManifest([{ componentName: "api", status: "stopped" }])
    const plan = planChanges(manifest, [])

    expect(plan.steps).toHaveLength(0)
  })

  test("orphaned component (in actual, not in desired) → stop step", () => {
    const manifest = makeManifest([])
    const actual = [makeRunningState("old-service")]
    const plan = planChanges(manifest, actual)

    expect(plan.steps).toHaveLength(1)
    expect(plan.steps[0]!.action).toBe("stop")
    expect(plan.steps[0]!.component).toBe("old-service")
    expect(plan.steps[0]!.reason).toContain("orphaned")
  })

  test("orphaned init container → NOT stopped", () => {
    const manifest = makeManifest([{ componentName: "api" }])
    const actual = [makeRunningState("api"), makeRunningState("init-db")]
    const plan = planChanges(manifest, actual)

    const stopSteps = plan.steps.filter((s) => s.action === "stop")
    expect(stopSteps).toHaveLength(0)
  })

  test("empty manifest + empty actual → no steps", () => {
    const manifest = makeManifest([])
    const plan = planChanges(manifest, [])

    expect(plan.steps).toHaveLength(0)
    expect(plan.upToDate).toHaveLength(0)
  })

  test("multiple components: deploy + stop in same plan", () => {
    const manifest = makeManifest([{ componentName: "api" }])
    const actual = [makeRunningState("old-service")]
    const plan = planChanges(manifest, actual)

    expect(plan.steps).toHaveLength(2)
    const actions = plan.steps.map((s) => `${s.action}:${s.component}`)
    expect(actions).toContain("deploy:api")
    expect(actions).toContain("stop:old-service")
  })

  test("component with empty desiredImage and matching actual → upToDate", () => {
    const manifest = makeManifest([{ componentName: "api", desiredImage: "" }])
    const actual = [makeRunningState("api", "something")]
    const plan = planChanges(manifest, actual)

    expect(plan.upToDate).toContain("api")
  })
})

describe("topologicalOrder (via planChanges)", () => {
  test("dependent component ordered after dependency", () => {
    const manifest = makeManifest([
      { componentName: "api" },
      { componentName: "web" },
    ])
    const plan = planChanges(manifest, [])

    const apiIdx = plan.steps.findIndex((s) => s.component === "api")
    const webIdx = plan.steps.findIndex((s) => s.component === "web")
    expect(apiIdx).toBeLessThan(webIdx)
  })

  test("init container ordered before its service", () => {
    const manifest = makeManifest([
      { componentName: "api" },
      { componentName: "init-db" },
    ])
    const plan = planChanges(manifest, [])

    const initIdx = plan.steps.findIndex((s) => s.component === "init-db")
    const apiIdx = plan.steps.findIndex((s) => s.component === "api")
    expect(initIdx).toBeLessThan(apiIdx)
  })
})
