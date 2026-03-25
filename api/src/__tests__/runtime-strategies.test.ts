import { describe, expect, it, beforeEach } from "vitest";
import {
  getRuntimeStrategy,
  registerRuntimeStrategy,
  clearRuntimeStrategies,
} from "../reconciler/runtime-strategy";
import { NoopStrategy } from "../reconciler/strategies/noop";
import { ComposeStrategy } from "../reconciler/strategies/compose";
import { SystemdStrategy } from "../reconciler/strategies/systemd";
import {
  WindowsServiceStrategy,
  IisStrategy,
} from "../reconciler/strategies/windows";

describe("Runtime Strategy Registry", () => {
  beforeEach(() => {
    clearRuntimeStrategies();
    registerRuntimeStrategy("compose", () => new ComposeStrategy());
    registerRuntimeStrategy("systemd", () => new SystemdStrategy());
    registerRuntimeStrategy(
      "windows_service",
      () => new WindowsServiceStrategy()
    );
    registerRuntimeStrategy("iis", () => new IisStrategy());
    registerRuntimeStrategy("process", () => new NoopStrategy());
  });

  it("returns compose strategy", () => {
    const strategy = getRuntimeStrategy("compose");
    expect(strategy.runtime).toBe("compose");
  });

  it("returns systemd strategy", () => {
    const strategy = getRuntimeStrategy("systemd");
    expect(strategy.runtime).toBe("systemd");
  });

  it("returns windows_service strategy", () => {
    const strategy = getRuntimeStrategy("windows_service");
    expect(strategy.runtime).toBe("windows_service");
  });

  it("returns iis strategy", () => {
    const strategy = getRuntimeStrategy("iis");
    expect(strategy.runtime).toBe("iis");
  });

  it("returns noop for process runtime", () => {
    const strategy = getRuntimeStrategy("process");
    expect(strategy.runtime).toBe("noop");
  });

  it("throws for unknown runtime", () => {
    expect(() => getRuntimeStrategy("unknown_runtime")).toThrow(
      /No strategy for runtime: unknown_runtime/
    );
  });
});

describe("NoopStrategy", () => {
  it("returns running for server component", async () => {
    const strategy = new NoopStrategy();
    const result = await strategy.reconcile({
      workload: {
        workloadId: "wl_test",
        desiredImage: "img:v1",
        replicas: 1,
        envOverrides: {},
        resourceOverrides: {},
        moduleVersionId: "mv_test",
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
        deploymentTargetId: "dt_test",
        name: "test-target",
        kind: "production",
        runtime: "process",
        hostId: "host_test",
        vmId: null,
        clusterId: null,
        namespace: null,
      },
      moduleName: "test-module",
    });

    expect(result.status).toBe("running");
    expect(result.driftDetected).toBe(false);
  });

  it("returns completed for task component", async () => {
    const strategy = new NoopStrategy();
    const result = await strategy.reconcile({
      workload: {
        workloadId: "wl_test",
        desiredImage: "img:v1",
        replicas: 1,
        envOverrides: {},
        resourceOverrides: {},
        moduleVersionId: "mv_test",
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
        deploymentTargetId: "dt_test",
        name: "test-target",
        kind: "dev",
        runtime: "process",
        hostId: null,
        vmId: null,
        clusterId: null,
        namespace: null,
      },
      moduleName: "test-module",
    });

    expect(result.status).toBe("completed");
  });
});
