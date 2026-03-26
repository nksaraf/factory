import { describe, expect, it, vi } from "vitest";

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

import type { CatalogSystem } from "../catalog";
import { getCatalogFormat, detectCatalogFormat } from "../catalog-registry";
import { generateComposeFromCatalog } from "../compose-gen";
import type { DxComponentYaml, DxYaml } from "../config-schemas";
import { dxYamlToCatalogSystem } from "./dx-yaml.adapter";

// Import index to trigger adapter registration
import "./index";

// ─── dx.yaml → CatalogSystem → compose ──────────────────────

describe("dx.yaml → CatalogSystem → compose round-trip", () => {
  const dxConfig: DxYaml = {
    module: "ecommerce",
    team: "shop-team",
    components: {
      api: { path: "./services/api", port: 4000, worker: false },
      worker: { path: "./services/worker", worker: true },
    },
    resources: {
      postgres: {
        image: "postgres:16-alpine",
        port: 5432,
        env: {
          POSTGRES_DB: "shop",
          POSTGRES_USER: "dev",
          POSTGRES_PASSWORD: "secret",
        },
        volumes: ["pgdata:/var/lib/postgresql/data"],
        healthcheck: "pg_isready -U dev",
      },
      redis: {
        image: "redis:7-alpine",
        port: 6379,
        env: {},
        volumes: [],
      },
    },
    connections: {
      payments: {
        module: "payments",
        component: "api",
        env_var: "PAYMENTS_URL",
        local_default: "http://localhost:5000",
        optional: false,
      },
    },
  };

  const compCfgs: Record<string, DxComponentYaml> = {
    api: {
      build: { context: ".", dockerfile: "Dockerfile" },
      dev: { command: "npm run dev", sync: ["./src:/app/src"] },
    },
    worker: {},
  };

  it("converts dx.yaml to CatalogSystem correctly", () => {
    const sys = dxYamlToCatalogSystem("/repo", dxConfig, compCfgs);

    expect(sys.kind).toBe("System");
    expect(sys.metadata.name).toBe("ecommerce");
    expect(sys.spec.owner).toBe("shop-team");

    // Components
    expect(sys.components.api).toBeDefined();
    expect(sys.components.api.spec.type).toBe("service");
    expect(sys.components.api.spec.ports[0]?.port).toBe(4000);

    expect(sys.components.worker).toBeDefined();
    expect(sys.components.worker.spec.type).toBe("worker");

    // Resources
    expect(sys.resources.postgres).toBeDefined();
    expect(sys.resources.postgres.spec.type).toBe("database");
    expect(sys.resources.redis).toBeDefined();
    expect(sys.resources.redis.spec.type).toBe("cache");

    // Connections
    expect(sys.connections).toHaveLength(1);
    expect(sys.connections[0].envVar).toBe("PAYMENTS_URL");
  });

  it("generates compose output with correct services", () => {
    const sys = dxYamlToCatalogSystem("/repo", dxConfig, compCfgs);
    const compose = generateComposeFromCatalog(sys);

    // Resource services
    expect(compose.services["dep-postgres"]).toBeDefined();
    expect(compose.services["dep-postgres"].image).toBe("postgres:16-alpine");
    expect(compose.services["dep-postgres"].ports).toContain("5432:5432");
    expect(compose.services["dep-postgres"].environment?.POSTGRES_DB).toBe(
      "shop",
    );

    expect(compose.services["dep-redis"]).toBeDefined();
    expect(compose.services["dep-redis"].image).toBe("redis:7-alpine");
  });

  it("generates compose with correct component ports", () => {
    const sys = dxYamlToCatalogSystem("/repo", dxConfig, compCfgs);
    const compose = generateComposeFromCatalog(sys);

    const apiSvc = compose.services["ecommerce-api"];
    expect(apiSvc).toBeDefined();
    expect(apiSvc.ports).toContain("4000:4000");
  });

  it("generates compose with depends_on for resources", () => {
    const sys = dxYamlToCatalogSystem("/repo", dxConfig, compCfgs);
    const compose = generateComposeFromCatalog(sys);

    const apiSvc = compose.services["ecommerce-api"];
    expect(apiSvc.depends_on).toContain("dep-postgres");
    expect(apiSvc.depends_on).toContain("dep-redis");
  });

  it("generates compose with connection-based environment vars", () => {
    const sys = dxYamlToCatalogSystem("/repo", dxConfig, compCfgs);
    const compose = generateComposeFromCatalog(sys);

    const apiSvc = compose.services["ecommerce-api"];
    // local_default should be injected
    expect(apiSvc.environment?.PAYMENTS_URL).toBe("http://localhost:5000");
    // Auto-generated DATABASE_URL from postgres resource
    expect(apiSvc.environment?.DATABASE_URL).toContain("postgresql://");
    // Auto-generated REDIS_URL from redis resource
    expect(apiSvc.environment?.REDIS_URL).toContain("redis://");
  });

  it("generates compose volumes from resources", () => {
    const sys = dxYamlToCatalogSystem("/repo", dxConfig, compCfgs);
    const compose = generateComposeFromCatalog(sys);

    expect(compose.volumes.pgdata).toBeDefined();
    expect(compose.services["dep-postgres"].volumes).toContain(
      "pgdata:/var/lib/postgresql/data",
    );
  });

  it("generates compose with resource healthcheck", () => {
    const sys = dxYamlToCatalogSystem("/repo", dxConfig, compCfgs);
    const compose = generateComposeFromCatalog(sys);

    const pgSvc = compose.services["dep-postgres"];
    expect(pgSvc.healthcheck?.test).toEqual([
      "CMD-SHELL",
      "pg_isready -U dev",
    ]);
  });
});

// ─── Adapter registry ────────────────────────────────────────

describe("adapter registry", () => {
  it("registers dx-yaml format adapter", () => {
    const adapter = getCatalogFormat("dx-yaml");
    expect(adapter).toBeDefined();
    expect(adapter.format).toBe("dx-yaml");
  });

  it("registers docker-compose format adapter", () => {
    const adapter = getCatalogFormat("docker-compose");
    expect(adapter).toBeDefined();
    expect(adapter.format).toBe("docker-compose");
  });

  it("retrieves helm adapter", () => {
    const adapter = getCatalogFormat("helm");
    expect(adapter).toBeDefined();
    expect(adapter.format).toBe("helm");
  });

  it("throws for unknown format", () => {
    expect(() => getCatalogFormat("unknown-format" as any)).toThrow(
      /No catalog format adapter/,
    );
  });
});

// ─── Format detection ────────────────────────────────────────

describe("detectCatalogFormat", () => {
  it("returns 'dx-yaml' when dx.yaml exists (mocked)", async () => {
    mockExistsSync.mockImplementation((p: string) =>
      p.endsWith("dx.yaml"),
    );
    try {
      const format = await detectCatalogFormat("/some/project");
      expect(format).toBe("dx-yaml");
    } finally {
      mockExistsSync.mockReset();
    }
  });

  it("returns null when no format is detected", async () => {
    mockExistsSync.mockReturnValue(false);
    try {
      const format = await detectCatalogFormat("/empty/dir");
      expect(format).toBeNull();
    } finally {
      mockExistsSync.mockReset();
    }
  });
});

// ─── Slug stability ──────────────────────────────────────────

describe("slug stability through full round-trip", () => {
  it("component and resource names survive dx.yaml → catalog → compose", () => {
    const dx: DxYaml = {
      module: "inventory",
      team: "warehouse",
      components: {
        "api-gateway": { path: "./gateway", port: 8080, worker: false },
        "order-processor": { path: "./processor", worker: true },
      },
      resources: {
        "main-database": {
          image: "postgres:16",
          port: 5432,
          env: {},
          volumes: [],
        },
        "session-cache": {
          image: "redis:7",
          port: 6379,
          env: {},
          volumes: [],
        },
      },
      connections: {},
    };

    const sys = dxYamlToCatalogSystem("/repo", dx, {});

    // Names are preserved as keys in the CatalogSystem
    expect(sys.components["api-gateway"]).toBeDefined();
    expect(sys.components["order-processor"]).toBeDefined();
    expect(sys.resources["main-database"]).toBeDefined();
    expect(sys.resources["session-cache"]).toBeDefined();

    // metadata.name matches the key
    expect(sys.components["api-gateway"].metadata.name).toBe("api-gateway");
    expect(sys.resources["main-database"].metadata.name).toBe("main-database");

    // After compose generation, services are named predictably
    const compose = generateComposeFromCatalog(sys);
    expect(compose.services["dep-main-database"]).toBeDefined();
    expect(compose.services["dep-session-cache"]).toBeDefined();
    expect(compose.services["inventory-api-gateway"]).toBeDefined();
    expect(compose.services["inventory-order-processor"]).toBeDefined();
  });

  it("resource names can be used as lookup keys after round-trip", () => {
    const dx: DxYaml = {
      module: "analytics",
      team: "data-team",
      components: {},
      resources: {
        clickhouse: {
          image: "clickhouse/clickhouse-server:23",
          port: 8123,
          env: {},
          volumes: [],
        },
      },
      connections: {},
    };

    const sys = dxYamlToCatalogSystem("/repo", dx, {});

    // Lookup by name
    const res = sys.resources["clickhouse"];
    expect(res).toBeDefined();
    expect(res.spec.type).toBe("database");
    expect(res.spec.image).toBe("clickhouse/clickhouse-server:23");
  });
});
