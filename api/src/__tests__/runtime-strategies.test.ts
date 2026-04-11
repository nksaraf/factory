import { beforeEach, describe, expect, it } from "vitest"

import {
  clearReconcilerStrategies,
  getReconcilerStrategy,
  registerReconcilerStrategy,
} from "../reconciler/runtime-strategy"
import { ComposeStrategy } from "../reconciler/strategies/compose"
import { NoopStrategy } from "../reconciler/strategies/noop"
import { SystemdStrategy } from "../reconciler/strategies/systemd"
import {
  IisStrategy,
  WindowsServiceStrategy,
} from "../reconciler/strategies/windows"

describe("Runtime Strategy Registry", () => {
  beforeEach(() => {
    clearReconcilerStrategies()
    registerReconcilerStrategy("compose", () => new ComposeStrategy())
    registerReconcilerStrategy("systemd", () => new SystemdStrategy())
    registerReconcilerStrategy(
      "windows_service",
      () => new WindowsServiceStrategy()
    )
    registerReconcilerStrategy("iis", () => new IisStrategy())
    registerReconcilerStrategy("process", () => new NoopStrategy())
  })

  it("returns compose strategy", () => {
    const strategy = getReconcilerStrategy("compose")
    expect(strategy.runtime).toBe("compose")
  })

  it("returns systemd strategy", () => {
    const strategy = getReconcilerStrategy("systemd")
    expect(strategy.runtime).toBe("systemd")
  })

  it("returns windows_service strategy", () => {
    const strategy = getReconcilerStrategy("windows_service")
    expect(strategy.runtime).toBe("windows_service")
  })

  it("returns iis strategy", () => {
    const strategy = getReconcilerStrategy("iis")
    expect(strategy.runtime).toBe("iis")
  })

  it("returns noop for process runtime", () => {
    const strategy = getReconcilerStrategy("process")
    expect(strategy.runtime).toBe("noop")
  })

  it("throws for unknown runtime", () => {
    expect(() => getReconcilerStrategy("unknown_runtime")).toThrow(
      /No strategy for runtime: unknown_runtime/
    )
  })
})

describe("NoopStrategy", () => {
  it("returns running for server component", async () => {
    const strategy = new NoopStrategy()
    const result = await strategy.reconcile({
      workload: {
        workloadId: "cdp_test",
        desiredImage: "img:v1",
        replicas: 1,
        envOverrides: {},
        resourceOverrides: {},
        moduleVersionId: "rel_test",
      },
      component: {
        name: "my-service",
        kind: "server",
        ports: [{ name: "http", port: 8080, protocol: "http" }],
        healthcheck: null,
        isPublic: false,
        stateful: false,
        defaultCpu: "100m",
        defaultMemory: "128Mi",
        defaultReplicas: 1,
      },
      target: {
        systemDeploymentId: "sdp_test",
        name: "test-target",
        kind: "production",
        runtime: "process",
        hostId: "host_test",
        namespace: null,
      },
      moduleName: "test-system",
    })

    expect(result.status).toBe("running")
    expect(result.driftDetected).toBe(false)
  })

  it("returns completed for task component", async () => {
    const strategy = new NoopStrategy()
    const result = await strategy.reconcile({
      workload: {
        workloadId: "cdp_test",
        desiredImage: "img:v1",
        replicas: 1,
        envOverrides: {},
        resourceOverrides: {},
        moduleVersionId: "rel_test",
      },
      component: {
        name: "my-task",
        kind: "task",
        ports: [],
        healthcheck: null,
        isPublic: false,
        stateful: false,
        defaultCpu: "100m",
        defaultMemory: "128Mi",
        defaultReplicas: 1,
      },
      target: {
        systemDeploymentId: "sdp_test",
        name: "test-target",
        kind: "dev",
        runtime: "process",
        hostId: null,
        namespace: null,
      },
      moduleName: "test-system",
    })

    expect(result.status).toBe("completed")
  })
})
