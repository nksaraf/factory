import { beforeEach, describe, expect, it } from "vitest"

import {
  clearRealmStrategies,
  getRealmStrategy,
  registerRealmStrategy,
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
    clearRealmStrategies()
    registerRealmStrategy("compose", () => new ComposeStrategy())
    registerRealmStrategy("systemd", () => new SystemdStrategy())
    registerRealmStrategy("windows_service", () => new WindowsServiceStrategy())
    registerRealmStrategy("iis", () => new IisStrategy())
    registerRealmStrategy("process", () => new NoopStrategy())
  })

  it("returns compose strategy", () => {
    const strategy = getRealmStrategy("compose")
    expect(strategy.runtime).toBe("compose")
  })

  it("returns systemd strategy", () => {
    const strategy = getRealmStrategy("systemd")
    expect(strategy.runtime).toBe("systemd")
  })

  it("returns windows_service strategy", () => {
    const strategy = getRealmStrategy("windows_service")
    expect(strategy.runtime).toBe("windows_service")
  })

  it("returns iis strategy", () => {
    const strategy = getRealmStrategy("iis")
    expect(strategy.runtime).toBe("iis")
  })

  it("returns noop for process runtime", () => {
    const strategy = getRealmStrategy("process")
    expect(strategy.runtime).toBe("noop")
  })

  it("throws for unknown runtime", () => {
    expect(() => getRealmStrategy("unknown_runtime")).toThrow(
      /No strategy for runtime: unknown_runtime/
    )
  })
})

// v2: workload → componentDeployment, target → systemDeployment, module → system
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
        deploymentTargetId: "sdp_test",
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
        deploymentTargetId: "sdp_test",
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
