import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { createTestProject, type TestProject } from "../__tests__/create-test-project.js";
import { DevController } from "./dev-controller.js";

import type { DxYaml, DxComponentYaml } from "@smp/factory-shared/config-schemas";

let project: TestProject;

function makeConfig(project: TestProject): {
  moduleConfig: DxYaml;
  componentConfigs: Record<string, DxComponentYaml>;
} {
  return {
    moduleConfig: {
      module: "test",
      team: "test-team",
      components: {
        api: { path: "./api", port: 14100, worker: false },
        worker: { path: "./worker", worker: true },
      },
      resources: {
        postgres: {
          image: "postgres:16-alpine",
          port: 5433,
          env: { POSTGRES_DB: "test" },
          volumes: [],
        },
      },
      connections: {},
    },
    componentConfigs: {},
  };
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
  });
});

afterEach(() => {
  project.cleanup();
});

describe("DevController", () => {
  describe("resolveComponent", () => {
    test("resolves a node component from filesystem markers", () => {
      const { moduleConfig, componentConfigs } = makeConfig(project);
      const ctrl = new DevController(project.rootDir, moduleConfig, componentConfigs);

      const resolved = ctrl.resolveComponent("api");
      expect(resolved.name).toBe("api");
      expect(resolved.type).toBe("node");
      expect(resolved.absPath).toBe(join(project.rootDir, "api"));
      expect(resolved.preferredPort).toBe(14100);
    });

    test("resolves a python component", () => {
      const { moduleConfig, componentConfigs } = makeConfig(project);
      const ctrl = new DevController(project.rootDir, moduleConfig, componentConfigs);

      const resolved = ctrl.resolveComponent("worker");
      expect(resolved.type).toBe("python");
    });

    test("uses dx.yaml type override", () => {
      const { moduleConfig, componentConfigs } = makeConfig(project);
      // Override the api component to be java via the type field
      (moduleConfig.components.api as any).type = "java";
      const ctrl = new DevController(project.rootDir, moduleConfig, componentConfigs);

      const resolved = ctrl.resolveComponent("api");
      expect(resolved.type).toBe("java");
    });

    test("throws for unknown component", () => {
      const { moduleConfig, componentConfigs } = makeConfig(project);
      const ctrl = new DevController(project.rootDir, moduleConfig, componentConfigs);

      expect(() => ctrl.resolveComponent("nonexistent")).toThrow(
        'Component "nonexistent" not found',
      );
    });

    test("throws for component with no detectable type", () => {
      const { moduleConfig, componentConfigs } = makeConfig(project);
      // Add a component with no marker files
      moduleConfig.components.empty = { path: "./empty", worker: false };
      mkdirSync(join(project.rootDir, "empty"), { recursive: true });

      const ctrl = new DevController(project.rootDir, moduleConfig, componentConfigs);

      expect(() => ctrl.resolveComponent("empty")).toThrow(
        "Cannot determine service type",
      );
    });
  });

  describe("state management", () => {
    test("ps returns empty when no servers tracked", () => {
      const { moduleConfig, componentConfigs } = makeConfig(project);
      const ctrl = new DevController(project.rootDir, moduleConfig, componentConfigs);

      expect(ctrl.ps()).toEqual([]);
    });

    test("ps reads state files", () => {
      const { moduleConfig, componentConfigs } = makeConfig(project);
      const ctrl = new DevController(project.rootDir, moduleConfig, componentConfigs);

      // Simulate a running server by writing state files with our own PID
      const stateDir = join(project.rootDir, ".dx", "dev");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "api.pid"), String(process.pid), "utf-8");
      writeFileSync(join(stateDir, "api.port"), "14100", "utf-8");

      const servers = ctrl.ps();
      expect(servers).toHaveLength(1);
      expect(servers[0].name).toBe("api");
      expect(servers[0].port).toBe(14100);
      expect(servers[0].pid).toBe(process.pid);
      expect(servers[0].running).toBe(true);
    });

    test("ps reports stopped for stale PID", () => {
      const { moduleConfig, componentConfigs } = makeConfig(project);
      const ctrl = new DevController(project.rootDir, moduleConfig, componentConfigs);

      const stateDir = join(project.rootDir, ".dx", "dev");
      mkdirSync(stateDir, { recursive: true });
      // PID 99999999 should not exist
      writeFileSync(join(stateDir, "api.pid"), "99999999", "utf-8");
      writeFileSync(join(stateDir, "api.port"), "14100", "utf-8");

      const servers = ctrl.ps();
      expect(servers).toHaveLength(1);
      expect(servers[0].running).toBe(false);
      expect(servers[0].pid).toBeNull();
    });

    test("stop cleans up state files for stale PID", () => {
      const { moduleConfig, componentConfigs } = makeConfig(project);
      const ctrl = new DevController(project.rootDir, moduleConfig, componentConfigs);

      const stateDir = join(project.rootDir, ".dx", "dev");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "api.pid"), "99999999", "utf-8");
      writeFileSync(join(stateDir, "api.port"), "14100", "utf-8");

      const stopped = ctrl.stop("api");
      // Process wasn't running, so nothing was actually stopped
      expect(stopped).toEqual([]);
      // But files should be cleaned up
      expect(existsSync(join(stateDir, "api.pid"))).toBe(false);
      expect(existsSync(join(stateDir, "api.port"))).toBe(false);
    });

    test("stop with no arg cleans up all state files", () => {
      const { moduleConfig, componentConfigs } = makeConfig(project);
      const ctrl = new DevController(project.rootDir, moduleConfig, componentConfigs);

      const stateDir = join(project.rootDir, ".dx", "dev");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "api.pid"), "99999999", "utf-8");
      writeFileSync(join(stateDir, "api.port"), "14100", "utf-8");
      writeFileSync(join(stateDir, "worker.pid"), "99999998", "utf-8");
      writeFileSync(join(stateDir, "worker.port"), "8000", "utf-8");

      ctrl.stop();
      expect(existsSync(join(stateDir, "api.pid"))).toBe(false);
      expect(existsSync(join(stateDir, "worker.pid"))).toBe(false);
    });

    test("logs returns log file path", () => {
      const { moduleConfig, componentConfigs } = makeConfig(project);
      const ctrl = new DevController(project.rootDir, moduleConfig, componentConfigs);

      const stateDir = join(project.rootDir, ".dx", "dev");
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(join(stateDir, "api.log"), "some log output", "utf-8");

      const logPath = ctrl.logs("api");
      expect(logPath).toBe(join(stateDir, "api.log"));
    });

    test("logs throws when no log file exists", () => {
      const { moduleConfig, componentConfigs } = makeConfig(project);
      const ctrl = new DevController(project.rootDir, moduleConfig, componentConfigs);

      expect(() => ctrl.logs("api")).toThrow("No log file found");
    });
  });
});
