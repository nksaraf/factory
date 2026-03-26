import { describe, expect, it, vi } from "vitest";

import type { CatalogSystem } from "../catalog";
import type { DxComponentYaml, DxYaml } from "../config-schemas";

vi.mock("node:fs", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync as (...args: unknown[]) => unknown),
    readFileSync: vi.fn(actual.readFileSync as (...args: unknown[]) => unknown),
  };
});

import { existsSync } from "node:fs";
const mockExistsSync = existsSync as unknown as ReturnType<typeof vi.fn>;

import { dxYamlToCatalogSystem, DxYamlFormatAdapter } from "./dx-yaml.adapter";

// ─── Helpers ──────────────────────────────────────────────────

function minimalDxYaml(overrides?: Partial<DxYaml>): DxYaml {
  return {
    module: "myapp",
    team: "platform-eng",
    components: {},
    resources: {},
    connections: {},
    ...overrides,
  };
}

// ─── dxYamlToCatalogSystem ───────────────────────────────────

describe("dxYamlToCatalogSystem", () => {
  describe("basic conversion", () => {
    it("returns a CatalogSystem with correct kind and metadata", () => {
      const dx = minimalDxYaml();
      const sys = dxYamlToCatalogSystem("/repo", dx, {});

      expect(sys.kind).toBe("System");
      expect(sys.metadata.name).toBe("myapp");
      expect(sys.metadata.namespace).toBe("default");
    });

    it("populates components, resources, and connections from dx config", () => {
      const dx = minimalDxYaml({
        components: {
          api: { path: "./services/api", port: 3000, worker: false },
        },
        resources: {
          postgres: {
            image: "postgres:16",
            port: 5432,
            env: { POSTGRES_DB: "mydb" },
            volumes: [],
          },
        },
        connections: {
          billing: {
            module: "billing",
            component: "api",
            env_var: "BILLING_URL",
            optional: false,
          },
        },
      });

      const sys = dxYamlToCatalogSystem("/repo", dx, {});

      expect(Object.keys(sys.components)).toEqual(["api"]);
      expect(Object.keys(sys.resources)).toEqual(["postgres"]);
      expect(sys.connections).toHaveLength(1);
    });
  });

  describe("system metadata", () => {
    it("uses module name as system name", () => {
      const dx = minimalDxYaml({ module: "payments" });
      const sys = dxYamlToCatalogSystem("/repo", dx, {});
      expect(sys.metadata.name).toBe("payments");
    });

    it("uses team as owner", () => {
      const dx = minimalDxYaml({ team: "backend-team" });
      const sys = dxYamlToCatalogSystem("/repo", dx, {});
      expect(sys.spec.owner).toBe("backend-team");
    });

    it("stores rootDir in formatExtensions", () => {
      const sys = dxYamlToCatalogSystem("/my/root", minimalDxYaml(), {});
      expect(sys.formatExtensions?.["dx-yaml"]?.rootDir).toBe("/my/root");
    });
  });

  describe("component mapping", () => {
    it("sets spec.type to 'service' for regular components", () => {
      const dx = minimalDxYaml({
        components: {
          api: { path: "./api", port: 3000, worker: false },
        },
      });
      const sys = dxYamlToCatalogSystem("/repo", dx, {});
      expect(sys.components.api.spec.type).toBe("service");
    });

    it("sets spec.type to 'worker' when worker: true", () => {
      const dx = minimalDxYaml({
        components: {
          worker: { path: "./worker", worker: true },
        },
      });
      const sys = dxYamlToCatalogSystem("/repo", dx, {});
      expect(sys.components.worker.spec.type).toBe("worker");
    });

    it("maps ref.port to spec.ports[0] with http protocol", () => {
      const dx = minimalDxYaml({
        components: {
          api: { path: "./api", port: 8080, worker: false },
        },
      });
      const sys = dxYamlToCatalogSystem("/repo", dx, {});
      const ports = sys.components.api.spec.ports;
      expect(ports).toHaveLength(1);
      expect(ports[0]).toEqual({ name: "http", port: 8080, protocol: "http" });
    });

    it("has empty ports when ref.port is not set", () => {
      const dx = minimalDxYaml({
        components: {
          worker: { path: "./worker", worker: true },
        },
      });
      const sys = dxYamlToCatalogSystem("/repo", dx, {});
      expect(sys.components.worker.spec.ports).toEqual([]);
    });

    it("resolves build context from rootDir + ref.path", () => {
      const dx = minimalDxYaml({
        components: {
          api: { path: "./services/api", port: 3000, worker: false },
        },
      });
      const sys = dxYamlToCatalogSystem("/repo", dx, {});
      // resolve("/repo", "./services/api")
      expect(sys.components.api.spec.build?.context).toContain("services/api");
    });

    it("resolves build context with compCfg.build.context", () => {
      const dx = minimalDxYaml({
        components: {
          api: { path: "./services/api", port: 3000, worker: false },
        },
      });
      const compCfgs: Record<string, DxComponentYaml> = {
        api: { build: { context: "./src", dockerfile: "Dockerfile.dev" } },
      };
      const sys = dxYamlToCatalogSystem("/repo", dx, compCfgs);
      expect(sys.components.api.spec.build?.context).toContain("src");
      expect(sys.components.api.spec.build?.dockerfile).toBe("Dockerfile.dev");
    });

    it("maps healthcheck path correctly", () => {
      const dx = minimalDxYaml({
        components: {
          api: { path: "./api", port: 3000, healthcheck: "/health", worker: false },
        },
      });
      const sys = dxYamlToCatalogSystem("/repo", dx, {});
      expect(sys.components.api.spec.healthchecks).toEqual({
        ready: {
          http: { path: "/health", port: "http" },
        },
      });
    });

    it("maps dev config (command, sync)", () => {
      const dx = minimalDxYaml({
        components: {
          api: { path: "./api", port: 3000, worker: false },
        },
      });
      const compCfgs: Record<string, DxComponentYaml> = {
        api: {
          dev: { command: "npm run dev", sync: ["./src:/app/src"] },
        },
      };
      const sys = dxYamlToCatalogSystem("/repo", dx, compCfgs);
      expect(sys.components.api.spec.dev?.command).toBe("npm run dev");
      expect(sys.components.api.spec.dev?.sync).toEqual(["./src:/app/src"]);
    });

    it("passes through runtime type", () => {
      const dx = minimalDxYaml({
        components: {
          api: { path: "./api", port: 3000, type: "node", worker: false },
        },
      });
      const sys = dxYamlToCatalogSystem("/repo", dx, {});
      expect(sys.components.api.spec.runtime).toBe("node");
    });

    it("passes through image from component config", () => {
      const dx = minimalDxYaml({
        components: {
          api: { path: "./api", port: 3000, worker: false },
        },
      });
      const compCfgs: Record<string, DxComponentYaml> = {
        api: { image: "myapp/api:latest" },
      };
      const sys = dxYamlToCatalogSystem("/repo", dx, compCfgs);
      expect(sys.components.api.spec.image).toBe("myapp/api:latest");
    });
  });

  describe("resource mapping", () => {
    const makeRes = (image: string, port = 5432) =>
      minimalDxYaml({
        resources: {
          myres: { image, port, env: {}, volumes: [] },
        },
      });

    it.each([
      ["postgres:16", "database"],
      ["redis:7-alpine", "cache"],
      ["rabbitmq:3-management", "queue"],
      ["minio/minio:latest", "storage"],
      ["elasticsearch:8.10", "search"],
      ["traefik:v3", "gateway"],
    ] as const)("infers type '%s' → '%s'", (image, expectedType) => {
      const sys = dxYamlToCatalogSystem("/repo", makeRes(image), {});
      expect(sys.resources.myres.spec.type).toBe(expectedType);
    });

    it("maps port correctly", () => {
      const dx = minimalDxYaml({
        resources: {
          pg: { image: "postgres:16", port: 5433, env: {}, volumes: [] },
        },
      });
      const sys = dxYamlToCatalogSystem("/repo", dx, {});
      expect(sys.resources.pg.spec.ports[0]).toEqual({
        name: "default",
        port: 5433,
        protocol: "tcp",
      });
    });

    it("maps container_port correctly", () => {
      const dx = minimalDxYaml({
        resources: {
          pg: {
            image: "postgres:16",
            port: 5433,
            container_port: 5432,
            env: {},
            volumes: [],
          },
        },
      });
      const sys = dxYamlToCatalogSystem("/repo", dx, {});
      expect(sys.resources.pg.spec.containerPort).toBe(5432);
    });

    it("passes environment vars through", () => {
      const dx = minimalDxYaml({
        resources: {
          pg: {
            image: "postgres:16",
            port: 5432,
            env: { POSTGRES_DB: "testdb", POSTGRES_USER: "admin" },
            volumes: [],
          },
        },
      });
      const sys = dxYamlToCatalogSystem("/repo", dx, {});
      expect(sys.resources.pg.spec.environment).toEqual({
        POSTGRES_DB: "testdb",
        POSTGRES_USER: "admin",
      });
    });

    it("passes volumes through", () => {
      const dx = minimalDxYaml({
        resources: {
          pg: {
            image: "postgres:16",
            port: 5432,
            env: {},
            volumes: ["pgdata:/var/lib/postgresql/data"],
          },
        },
      });
      const sys = dxYamlToCatalogSystem("/repo", dx, {});
      expect(sys.resources.pg.spec.volumes).toEqual([
        "pgdata:/var/lib/postgresql/data",
      ]);
    });

    it("passes healthcheck through", () => {
      const dx = minimalDxYaml({
        resources: {
          pg: {
            image: "postgres:16",
            port: 5432,
            env: {},
            volumes: [],
            healthcheck: "pg_isready -U postgres",
          },
        },
      });
      const sys = dxYamlToCatalogSystem("/repo", dx, {});
      expect(sys.resources.pg.spec.healthcheck).toBe(
        "pg_isready -U postgres",
      );
    });
  });

  describe("connection mapping", () => {
    it("maps all connection fields correctly", () => {
      const dx = minimalDxYaml({
        connections: {
          billing: {
            module: "billing",
            component: "api",
            env_var: "BILLING_URL",
            local_default: "http://localhost:4000",
            optional: true,
          },
        },
      });
      const sys = dxYamlToCatalogSystem("/repo", dx, {});
      expect(sys.connections).toEqual([
        {
          name: "billing",
          targetModule: "billing",
          targetComponent: "api",
          envVar: "BILLING_URL",
          localDefault: "http://localhost:4000",
          optional: true,
        },
      ]);
    });

    it("handles connection without optional fields", () => {
      const dx = minimalDxYaml({
        connections: {
          auth: {
            module: "auth",
            component: "service",
            env_var: "AUTH_URL",
            optional: false,
          },
        },
      });
      const sys = dxYamlToCatalogSystem("/repo", dx, {});
      const conn = sys.connections[0];
      expect(conn.name).toBe("auth");
      expect(conn.localDefault).toBeUndefined();
      expect(conn.optional).toBe(false);
    });
  });

  describe("slug-based lookups", () => {
    it("preserves component names as stable lookup keys", () => {
      const dx = minimalDxYaml({
        components: {
          "api-server": { path: "./api", port: 3000, worker: false },
          "background-worker": { path: "./worker", worker: true },
        },
      });
      const sys = dxYamlToCatalogSystem("/repo", dx, {});
      expect(sys.components["api-server"]).toBeDefined();
      expect(sys.components["background-worker"]).toBeDefined();
      expect(sys.components["api-server"].metadata.name).toBe("api-server");
      expect(sys.components["background-worker"].metadata.name).toBe(
        "background-worker",
      );
    });

    it("preserves resource names as stable lookup keys", () => {
      const dx = minimalDxYaml({
        resources: {
          "main-db": {
            image: "postgres:16",
            port: 5432,
            env: {},
            volumes: [],
          },
          "cache-store": {
            image: "redis:7",
            port: 6379,
            env: {},
            volumes: [],
          },
        },
      });
      const sys = dxYamlToCatalogSystem("/repo", dx, {});
      expect(sys.resources["main-db"]).toBeDefined();
      expect(sys.resources["cache-store"]).toBeDefined();
      expect(sys.resources["main-db"].metadata.name).toBe("main-db");
      expect(sys.resources["cache-store"].metadata.name).toBe("cache-store");
    });
  });
});

// ─── DxYamlFormatAdapter ─────────────────────────────────────

describe("DxYamlFormatAdapter", () => {
  describe("detect", () => {
    it("returns true when dx.yaml exists", () => {
      mockExistsSync.mockImplementation((p: string) =>
        p.endsWith("dx.yaml"),
      );
      const adapter = new DxYamlFormatAdapter();
      expect(adapter.detect("/some/dir")).toBe(true);
      mockExistsSync.mockReset();
    });

    it("returns false when dx.yaml does not exist", () => {
      mockExistsSync.mockReturnValue(false);
      const adapter = new DxYamlFormatAdapter();
      expect(adapter.detect("/some/dir")).toBe(false);
      mockExistsSync.mockReset();
    });
  });

  describe("generate (reverse direction)", () => {
    it("generates dx.yaml content from CatalogSystem", () => {
      const adapter = new DxYamlFormatAdapter();
      const system: CatalogSystem = {
        kind: "System",
        metadata: { name: "myapp", namespace: "default" },
        spec: { owner: "platform-eng" },
        components: {
          api: {
            kind: "Component",
            metadata: { name: "api", namespace: "default" },
            spec: {
              type: "service",
              lifecycle: "production",
              image: "myapp/api:latest",
              build: { context: "/repo/services/api" },
              ports: [{ name: "http", port: 3000, protocol: "http" }],
              environment: {},
              dev: { command: "npm run dev", sync: ["./src:/app/src"] },
            },
          },
        },
        resources: {
          postgres: {
            kind: "Resource",
            metadata: { name: "postgres", namespace: "default" },
            spec: {
              type: "database",
              lifecycle: "production",
              image: "postgres:16",
              ports: [{ name: "default", port: 5432, protocol: "tcp" }],
              environment: { POSTGRES_DB: "mydb" },
              volumes: ["pgdata:/var/lib/postgresql/data"],
              healthcheck: "pg_isready -U postgres",
            },
          },
        },
        connections: [
          {
            name: "billing",
            targetModule: "billing",
            targetComponent: "api",
            envVar: "BILLING_URL",
            localDefault: "http://localhost:4000",
          },
        ],
      };

      const result = adapter.generate(system);

      expect(result.files["dx.yaml"]).toBeDefined();
      const content = result.files["dx.yaml"];

      // Verify key data is present in the YAML output
      expect(content).toContain("module: myapp");
      expect(content).toContain("team: platform-eng");
      expect(content).toContain("postgres:");
      expect(content).toContain("image: postgres:16");
      expect(content).toContain("port: 5432");
      expect(content).toContain("POSTGRES_DB: mydb");
      expect(content).toContain("billing:");
      expect(content).toContain("module: billing");
      expect(content).toContain("env_var: BILLING_URL");
      expect(content).toContain("local_default: http://localhost:4000");
    });

    it("round-trip preserves key data", () => {
      const dx = minimalDxYaml({
        module: "payments",
        team: "payments-team",
        components: {
          api: { path: "./api", port: 8080, worker: false },
          worker: { path: "./worker", worker: true },
        },
        resources: {
          postgres: {
            image: "postgres:16",
            port: 5432,
            env: { POSTGRES_DB: "payments" },
            volumes: ["pgdata:/var/lib/postgresql/data"],
          },
          redis: {
            image: "redis:7",
            port: 6379,
            env: {},
            volumes: [],
          },
        },
        connections: {
          auth: {
            module: "auth",
            component: "service",
            env_var: "AUTH_URL",
            local_default: "http://localhost:9000",
            optional: true,
          },
        },
      });

      // dx.yaml → CatalogSystem
      const sys = dxYamlToCatalogSystem("/repo", dx, {});

      // CatalogSystem → dx.yaml YAML
      const adapter = new DxYamlFormatAdapter();
      const result = adapter.generate(sys);
      const content = result.files["dx.yaml"];

      // Verify round-trip preserves module/team
      expect(content).toContain("module: payments");
      expect(content).toContain("team: payments-team");
      // Resources preserved
      expect(content).toContain("image: postgres:16");
      expect(content).toContain("image: redis:7");
      // Connections preserved
      expect(content).toContain("module: auth");
      expect(content).toContain("component: service");
      expect(content).toContain("env_var: AUTH_URL");
      expect(content).toContain("optional: true");
    });

    it("generates worker flag for worker components", () => {
      const system: CatalogSystem = {
        kind: "System",
        metadata: { name: "myapp", namespace: "default" },
        spec: { owner: "team" },
        components: {
          bg: {
            kind: "Component",
            metadata: { name: "bg", namespace: "default" },
            spec: {
              type: "worker",
              build: { context: "/repo/bg" },
              ports: [],
            },
          },
        },
        resources: {},
        connections: [],
      };

      const adapter = new DxYamlFormatAdapter();
      const result = adapter.generate(system);
      expect(result.files["dx.yaml"]).toContain("worker: true");
    });
  });
});
