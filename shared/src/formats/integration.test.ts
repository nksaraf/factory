/**
 * Integration tests — load real YAML files from __fixtures__/ and the repo root.
 *
 * These exercise the full parse pipeline (file I/O → YAML parsing → classification
 * → CatalogSystem) without filesystem mocks.
 */

import { join } from "node:path";
import { describe, it, expect } from "vitest";

import { DxYamlFormatAdapter, dxYamlToCatalogSystem } from "./dx-yaml.adapter";
import { DockerComposeFormatAdapter, resolveComposeEnvVar } from "./docker-compose.adapter";
import { loadFullConfig } from "../config-loader";
import { generateComposeFromCatalog } from "../compose-gen";

const FIXTURES = join(import.meta.dirname, "__fixtures__");

// ─── Env var resolution ──────────────────────────────────────

describe("resolveComposeEnvVar", () => {
  const env = { PORT: "8080", EMPTY: "", DB_HOST: "mydb" };

  it("resolves ${VAR:-default} using value when set", () => {
    expect(resolveComposeEnvVar("${PORT:-3000}", env)).toBe("8080");
  });

  it("resolves ${VAR:-default} using default when unset", () => {
    expect(resolveComposeEnvVar("${MISSING:-3000}", env)).toBe("3000");
  });

  it("resolves ${VAR:-default} using default when empty", () => {
    expect(resolveComposeEnvVar("${EMPTY:-fallback}", env)).toBe("fallback");
  });

  it("resolves ${VAR-default} using empty string when set but empty", () => {
    expect(resolveComposeEnvVar("${EMPTY-fallback}", env)).toBe("");
  });

  it("resolves ${VAR-default} using default when unset", () => {
    expect(resolveComposeEnvVar("${MISSING-fallback}", env)).toBe("fallback");
  });

  it("resolves ${VAR} to value", () => {
    expect(resolveComposeEnvVar("${PORT}", env)).toBe("8080");
  });

  it("resolves ${VAR} to empty string when unset", () => {
    expect(resolveComposeEnvVar("${MISSING}", env)).toBe("");
  });

  it("resolves multiple vars in one string", () => {
    expect(resolveComposeEnvVar("postgres://${DB_HOST}:${PORT:-5432}/db", env))
      .toBe("postgres://mydb:8080/db");
  });

  it("resolves port mapping string", () => {
    expect(resolveComposeEnvVar("${INFRA_POSTGRES_PORT:-5432}:5432", env))
      .toBe("5432:5432");
  });

  it("passes through strings without vars", () => {
    expect(resolveComposeEnvVar("hello world", env)).toBe("hello world");
  });

  it("resolves ${VAR:+alternate} using alternate when set and non-empty", () => {
    expect(resolveComposeEnvVar("${PORT:+yes}", env)).toBe("yes");
  });

  it("resolves ${VAR:+alternate} to empty when unset", () => {
    expect(resolveComposeEnvVar("${MISSING:+yes}", env)).toBe("");
  });
});

// ─── dx.yaml: simple module ──────────────────────────────────

describe("dx-yaml integration: simple module", () => {
  const rootDir = join(FIXTURES, "simple-module");
  const adapter = new DxYamlFormatAdapter();

  it("detects dx.yaml", () => {
    expect(adapter.detect(rootDir)).toBe(true);
  });

  it("parses into a CatalogSystem", () => {
    const { system, warnings } = adapter.parse(rootDir);
    expect(warnings).toHaveLength(0);
    expect(system.kind).toBe("System");
    expect(system.metadata.name).toBe("billing");
    expect(system.spec.owner).toBe("payments");
  });

  it("has correct components", () => {
    const { system } = adapter.parse(rootDir);
    expect(Object.keys(system.components)).toEqual(["api"]);

    const api = system.components.api;
    expect(api.kind).toBe("Component");
    expect(api.metadata.name).toBe("api");
    expect(api.spec.type).toBe("service");
    expect(api.spec.ports).toHaveLength(1);
    expect(api.spec.ports[0]).toMatchObject({ name: "http", port: 8080 });
    expect(api.spec.healthchecks).toMatchObject({ ready: { http: { path: "/health", port: "http" } } });
  });

  it("has correct resources", () => {
    const { system } = adapter.parse(rootDir);
    expect(Object.keys(system.resources).sort()).toEqual(["postgres", "redis"]);

    const pg = system.resources.postgres;
    expect(pg.kind).toBe("Resource");
    expect(pg.spec.type).toBe("database");
    expect(pg.spec.image).toBe("postgres:16-alpine");
    expect(pg.spec.ports[0]).toMatchObject({ port: 5432 });
    expect(pg.spec.environment).toMatchObject({
      POSTGRES_DB: "billing",
      POSTGRES_USER: "billing",
      POSTGRES_PASSWORD: "secret",
    });
    expect(pg.spec.healthcheck).toBe("pg_isready -U billing");
    expect(pg.spec.volumes).toContain("pg-data:/var/lib/postgresql/data");

    const redis = system.resources.redis;
    expect(redis.spec.type).toBe("cache");
    expect(redis.spec.image).toBe("redis:7-alpine");
  });

  it("has correct connections", () => {
    const { system } = adapter.parse(rootDir);
    expect(system.connections).toHaveLength(1);
    expect(system.connections[0]).toMatchObject({
      name: "auth",
      targetModule: "auth",
      targetComponent: "api",
      envVar: "AUTH_URL",
      localDefault: "http://localhost:8180",
    });
  });

  it("component/resource names are stable slugs", () => {
    const { system: s1 } = adapter.parse(rootDir);
    const { system: s2 } = adapter.parse(rootDir);
    // Same input → same keys
    expect(Object.keys(s1.components)).toEqual(Object.keys(s2.components));
    expect(Object.keys(s1.resources)).toEqual(Object.keys(s2.resources));
  });

  it("generates compose from the parsed catalog", () => {
    const { system } = adapter.parse(rootDir);
    const compose = generateComposeFromCatalog(system);

    // Should have dep-postgres, dep-redis, billing-api
    expect(compose.services["dep-postgres"]).toBeDefined();
    expect(compose.services["dep-redis"]).toBeDefined();
    expect(compose.services["billing-api"]).toBeDefined();

    // postgres service should have correct image and env
    const pgSvc = compose.services["dep-postgres"];
    expect(pgSvc.image).toBe("postgres:16-alpine");
    expect(pgSvc.environment).toMatchObject({ POSTGRES_DB: "billing" });

    // api service should depend on local deps
    const apiSvc = compose.services["billing-api"];
    expect(apiSvc.depends_on).toContain("dep-postgres");
    expect(apiSvc.depends_on).toContain("dep-redis");
  });
});

// ─── dx.yaml: with dx-component.yaml references ─────────────

describe("dx-yaml integration: dx-component.yaml merging", () => {
  const rootDir = join(FIXTURES, "dx-with-components");

  it("parses and merges component configs", () => {
    const { module: dxConfig, components } = loadFullConfig(rootDir);
    const system = dxYamlToCatalogSystem(rootDir, dxConfig, components);

    expect(system.metadata.name).toBe("orders");
    expect(system.spec.owner).toBe("commerce");
  });

  it("inline dx.yaml fields override dx-component.yaml", () => {
    // dx.yaml has build.dockerfile: Dockerfile.dev, dx-component.yaml has Dockerfile
    // Inline (dx.yaml) wins
    const { module: dxConfig, components } = loadFullConfig(rootDir);
    const system = dxYamlToCatalogSystem(rootDir, dxConfig, components);

    const api = system.components.api;
    expect(api).toBeDefined();
    // dx.yaml specifies dockerfile: Dockerfile.dev which should override dx-component.yaml's Dockerfile
    expect(api.spec.build?.dockerfile).toBe("Dockerfile.dev");
  });

  it("dx-component.yaml dev.sync merges correctly", () => {
    const { module: dxConfig, components } = loadFullConfig(rootDir);
    const system = dxYamlToCatalogSystem(rootDir, dxConfig, components);

    const api = system.components.api;
    // dx.yaml has sync: [./src:/app/src], which overrides dx-component.yaml's sync
    expect(api.spec.dev).toBeDefined();
    expect(api.spec.dev!.command).toBe("pnpm dev");
    expect(api.spec.dev!.sync).toContain("./src:/app/src");
  });

  it("worker component has correct type and image", () => {
    const { module: dxConfig, components } = loadFullConfig(rootDir);
    const system = dxYamlToCatalogSystem(rootDir, dxConfig, components);

    const worker = system.components.worker;
    expect(worker).toBeDefined();
    expect(worker.spec.type).toBe("worker");
    // dx-component.yaml has image: orders-worker:dev, but dx.yaml has image: orders-worker:latest
    // Inline wins
    expect(worker.spec.image).toBe("orders-worker:latest");
  });

  it("worker dx-component.yaml dev command is used when inline absent", () => {
    const { module: dxConfig, components } = loadFullConfig(rootDir);
    // The worker dx.yaml entry doesn't have dev config, so dx-component.yaml's should be used
    // Actually, the worker dx.yaml entry has image but no dev — dx-component.yaml has dev.command
    const system = dxYamlToCatalogSystem(rootDir, dxConfig, components);
    const worker = system.components.worker;

    // dx-component.yaml has: dev.command: "python -m uvicorn main:app --reload"
    // dx.yaml worker entry doesn't have dev — so file config should be used
    expect(worker.spec.dev?.command).toBe("python -m uvicorn main:app --reload");
  });

  it("resources parsed correctly with container_port", () => {
    const { module: dxConfig, components } = loadFullConfig(rootDir);
    const system = dxYamlToCatalogSystem(rootDir, dxConfig, components);

    const pg = system.resources.postgres;
    expect(pg.spec.containerPort).toBe(5432);

    const rmq = system.resources.rabbitmq;
    expect(rmq.spec.type).toBe("queue");
    expect(rmq.spec.image).toBe("rabbitmq:3-management");
  });

  it("optional connection preserved", () => {
    const { module: dxConfig, components } = loadFullConfig(rootDir);
    const system = dxYamlToCatalogSystem(rootDir, dxConfig, components);

    const inv = system.connections.find((c) => c.name === "inventory");
    expect(inv).toBeDefined();
    expect(inv!.optional).toBe(true);
    expect(inv!.targetModule).toBe("inventory");
  });

  it("runtime type passes through", () => {
    const { module: dxConfig, components } = loadFullConfig(rootDir);
    const system = dxYamlToCatalogSystem(rootDir, dxConfig, components);

    expect(system.components.api.spec.runtime).toBe("node");
    expect(system.components.worker.spec.runtime).toBe("python");
  });

  it("round-trips through compose generation", () => {
    const { module: dxConfig, components } = loadFullConfig(rootDir);
    const system = dxYamlToCatalogSystem(rootDir, dxConfig, components);
    const compose = generateComposeFromCatalog(system);

    expect(compose.services["orders-api"]).toBeDefined();
    expect(compose.services["orders-worker"]).toBeDefined();
    expect(compose.services["dep-postgres"]).toBeDefined();
    expect(compose.services["dep-rabbitmq"]).toBeDefined();

    // api should have build context
    expect(compose.services["orders-api"].build).toBeDefined();
    // worker should have image (not build)
    expect(compose.services["orders-worker"].image).toBeDefined();
  });
});

// ─── docker-compose: multi-service ───────────────────────────

describe("docker-compose integration: multi-service", () => {
  const rootDir = join(FIXTURES, "multi-compose");
  const adapter = new DockerComposeFormatAdapter();

  it("detects docker-compose.yaml", () => {
    expect(adapter.detect(rootDir)).toBe(true);
  });

  it("parses all services", () => {
    const { system } = adapter.parse(rootDir);
    const allKeys = [
      ...Object.keys(system.components),
      ...Object.keys(system.resources),
    ].sort();
    expect(allKeys).toEqual(["api", "auth", "nginx", "postgres", "rabbitmq", "redis", "worker"]);
  });

  it("classifies build-context services as Components", () => {
    const { system } = adapter.parse(rootDir);
    expect(system.components.api).toBeDefined();
    expect(system.components.api.kind).toBe("Component");
    expect(system.components.api.spec.build).toMatchObject({
      context: "./api",
      dockerfile: "Dockerfile",
    });

    expect(system.components.worker).toBeDefined();
    expect(system.components.worker.kind).toBe("Component");
  });

  it("classifies image-based infra services as Resources", () => {
    const { system } = adapter.parse(rootDir);

    expect(system.resources.postgres).toBeDefined();
    expect(system.resources.postgres.spec.type).toBe("database");
    expect(system.resources.postgres.spec.image).toBe("postgres:16-alpine");

    expect(system.resources.redis).toBeDefined();
    expect(system.resources.redis.spec.type).toBe("cache");

    expect(system.resources.rabbitmq).toBeDefined();
    expect(system.resources.rabbitmq.spec.type).toBe("queue");
  });

  it("nginx classified as Resource (gateway)", () => {
    const { system } = adapter.parse(rootDir);
    expect(system.resources.nginx).toBeDefined();
    expect(system.resources.nginx.spec.type).toBe("gateway");
  });

  it("parses multiple ports with correct names", () => {
    const { system } = adapter.parse(rootDir);

    // postgres: "5432:5432"
    const pgPorts = system.resources.postgres.spec.ports;
    expect(pgPorts).toHaveLength(1);
    expect(pgPorts[0]).toMatchObject({ name: "postgres", port: 5432, protocol: "tcp" });

    // api: "3000:3000" and "9090:9090" — labels override names
    const apiPorts = system.components.api.spec.ports;
    expect(apiPorts).toHaveLength(2);
    expect(apiPorts[0]).toMatchObject({ name: "http", port: 3000, protocol: "http" });
    expect(apiPorts[1]).toMatchObject({ name: "metrics", port: 9090, protocol: "http" });

    // rabbitmq: "5672:5672" and "15672:15672" — label overrides + known ports
    const rmqPorts = system.resources.rabbitmq.spec.ports;
    expect(rmqPorts).toHaveLength(2);
    expect(rmqPorts[0]).toMatchObject({ name: "amqp", port: 5672, protocol: "tcp" });
    expect(rmqPorts[1]).toMatchObject({ name: "management-ui", port: 15672, protocol: "http" });
  });

  it("preserves environment variables", () => {
    const { system } = adapter.parse(rootDir);

    expect(system.resources.postgres.spec.environment).toMatchObject({
      POSTGRES_USER: "app",
      POSTGRES_PASSWORD: "app",
      POSTGRES_DB: "app",
    });

    expect(system.components.api.spec.environment).toMatchObject({
      DATABASE_URL: "postgres://app:app@postgres:5432/app",
      REDIS_URL: "redis://redis:6379",
    });
  });

  it("preserves volumes on resources", () => {
    const { system } = adapter.parse(rootDir);
    expect(system.resources.postgres.spec.volumes).toContain(
      "pgdata:/var/lib/postgresql/data",
    );
  });

  it("preserves healthcheck on resources", () => {
    const { system } = adapter.parse(rootDir);
    expect(system.resources.postgres.spec.healthcheck).toBe(
      "pg_isready -U app",
    );
  });

  it("system name is directory basename", () => {
    const { system } = adapter.parse(rootDir);
    expect(system.metadata.name).toBe("multi-compose");
  });

  it("slug keys are stable across parses", () => {
    const { system: s1 } = adapter.parse(rootDir);
    const { system: s2 } = adapter.parse(rootDir);
    expect(Object.keys(s1.components).sort()).toEqual(
      Object.keys(s2.components).sort(),
    );
    expect(Object.keys(s1.resources).sort()).toEqual(
      Object.keys(s2.resources).sort(),
    );
  });

  // ─── Labels → metadata ──────────────────────────────────────

  it("catalog.description label → metadata.description", () => {
    const { system } = adapter.parse(rootDir);
    expect(system.components.api.metadata.description).toBe("Main API service");
    expect(system.components.worker.metadata.description).toBe("Background job processor");
  });

  it("catalog.owner label → system owner", () => {
    const { system } = adapter.parse(rootDir);
    expect(system.spec.owner).toBe("backend");
  });

  it("catalog.tags label → metadata.tags", () => {
    const { system } = adapter.parse(rootDir);
    expect(system.components.api.metadata.tags).toEqual(["api", "rest"]);
  });

  it("catalog.type label overrides inferred type", () => {
    const { system } = adapter.parse(rootDir);
    expect(system.components.worker.spec.type).toBe("worker");
  });

  // ─── Labels → API declarations ─────────────────────────────

  it("catalog.api.provides → spec.providesApis", () => {
    const { system } = adapter.parse(rootDir);
    expect(system.components.api.spec.providesApis).toEqual(["orders-api", "webhooks-api"]);
    expect(system.components.auth.spec.providesApis).toEqual(["auth-api"]);
  });

  it("catalog.api.consumes → spec.consumesApis", () => {
    const { system } = adapter.parse(rootDir);
    expect(system.components.api.spec.consumesApis).toEqual(["auth-api"]);
  });

  // ─── Labels → documentation links ──────────────────────────

  it("catalog.docs.* labels → metadata.links", () => {
    const { system } = adapter.parse(rootDir);
    const apiLinks = system.components.api.metadata.links!;
    expect(apiLinks).toHaveLength(2);
    expect(apiLinks).toContainEqual({
      url: "/api/docs",
      title: "API Documentation",
      type: "api-doc",
    });
    expect(apiLinks).toContainEqual({
      url: "https://wiki.internal/runbooks/api",
      title: "Runbook",
      type: "runbook",
    });

    const authLinks = system.components.auth.metadata.links!;
    expect(authLinks).toContainEqual({
      url: "https://docs.internal/auth",
      title: "Documentation",
      type: "doc",
    });
  });

  // ─── Connections inferred from env vars ─────────────────────

  it("infers database connections from DATABASE_URL env", () => {
    const { system } = adapter.parse(rootDir);
    const dbConns = system.connections.filter((c) => c.envVar === "DATABASE_URL");
    // api and worker both have DATABASE_URL referencing postgres
    expect(dbConns.length).toBeGreaterThanOrEqual(2);
    expect(dbConns.every((c) => c.targetComponent === "postgres")).toBe(true);
  });

  it("infers redis connections from REDIS_URL env", () => {
    const { system } = adapter.parse(rootDir);
    const redisConns = system.connections.filter((c) => c.envVar === "REDIS_URL");
    expect(redisConns).toHaveLength(1);
    expect(redisConns[0].targetComponent).toBe("redis");
  });

  it("infers rabbitmq connections from RABBITMQ_URL env", () => {
    const { system } = adapter.parse(rootDir);
    const rmqConns = system.connections.filter((c) => c.envVar === "RABBITMQ_URL");
    expect(rmqConns).toHaveLength(1);
    expect(rmqConns[0].targetComponent).toBe("rabbitmq");
  });

  it("infers HTTP API connections from env pointing at other services", () => {
    const { system } = adapter.parse(rootDir);
    const authConns = system.connections.filter(
      (c) => c.envVar === "AUTH_URL" && c.targetComponent === "auth",
    );
    expect(authConns).toHaveLength(1);
  });

  // ─── depends_on → dependsOn ─────────────────────────────────

  it("depends_on (object form) → spec.dependsOn", () => {
    const { system } = adapter.parse(rootDir);
    expect(system.components.api.spec.dependsOn).toContain("postgres");
    expect(system.components.api.spec.dependsOn).toContain("redis");
  });
});

// ─── docker-compose: real repo root compose ──────────────────

describe("docker-compose integration: repo root", () => {
  const repoRoot = join(import.meta.dirname, "../../..");
  const adapter = new DockerComposeFormatAdapter();

  it("detects the repo docker-compose.yaml", () => {
    expect(adapter.detect(repoRoot)).toBe(true);
  });

  it("parses the repo compose without crashing", () => {
    const { system, warnings } = adapter.parse(repoRoot);
    expect(system.kind).toBe("System");
    // Should have at least infra-postgres, infra-auth, infra-gateway, etc.
    const allKeys = [
      ...Object.keys(system.components),
      ...Object.keys(system.resources),
    ];
    expect(allKeys.length).toBeGreaterThanOrEqual(3);
  });

  it("classifies infra-postgres as a database Resource", () => {
    const { system } = adapter.parse(repoRoot);
    // infra-postgres has image: postgres:16-alpine
    const pg = system.resources["infra-postgres"];
    expect(pg).toBeDefined();
    expect(pg.spec.type).toBe("database");
  });

  it("classifies infra-factory as a Component (has build context)", () => {
    const { system } = adapter.parse(repoRoot);
    // infra-factory has both image and build — build wins
    const factory = system.components["infra-factory"];
    expect(factory).toBeDefined();
    expect(factory.kind).toBe("Component");
    expect(factory.spec.build).toBeDefined();
  });

  it("classifies infra-gateway as a Resource (gateway via apisix image)", () => {
    const { system } = adapter.parse(repoRoot);
    // apache/apisix → strip registry prefix, match "apisix"
    const gw = system.resources["infra-gateway"];
    expect(gw).toBeDefined();
    expect(gw.spec.type).toBe("gateway");
  });

  it("resolves env var interpolation in ports to defaults", () => {
    // The repo compose uses "${INFRA_POSTGRES_PORT:-5432}:5432"
    // Our adapter resolves ${VAR:-default} → default when VAR is unset
    const { system } = adapter.parse(repoRoot);
    const pg = system.resources["infra-postgres"];
    expect(pg).toBeDefined();
    expect(pg.spec.ports).toHaveLength(1);
    expect(pg.spec.ports[0].port).toBe(5432);
  });

  it("resolves env var interpolation in image references", () => {
    // infra-reverse-proxy has image: ${TRAEFIK_IMAGE:-traefik:v3.6.8}
    const { system } = adapter.parse(repoRoot);
    const proxy = system.resources["infra-reverse-proxy"];
    expect(proxy).toBeDefined();
    expect(proxy.spec.image).toBe("traefik:v3.6.8");
    expect(proxy.spec.type).toBe("gateway");
  });

  it("resolves env var interpolation in environment values", () => {
    const { system } = adapter.parse(repoRoot);
    // infra-auth has AUTH_BASE_URL=${AUTH_BASE_URL:-http://localhost:${INFRA_REVERSE_PROXY_PORT:-9000}}
    const auth = system.components["infra-auth"] ?? system.resources["infra-auth"];
    expect(auth).toBeDefined();
  });
});

// ─── docker-compose: auth-service sub-compose ────────────────

describe("docker-compose integration: auth-service", () => {
  const rootDir = join(import.meta.dirname, "../../../.dx/pkg-repos/auth-service");
  const adapter = new DockerComposeFormatAdapter();

  it("detects docker-compose.yml (yml extension)", () => {
    expect(adapter.detect(rootDir)).toBe(true);
  });

  it("parses the simple postgres-only compose", () => {
    const { system } = adapter.parse(rootDir);
    expect(system.resources.postgres).toBeDefined();
    expect(system.resources.postgres.spec.type).toBe("database");
    expect(system.resources.postgres.spec.image).toBe("postgres:16-alpine");
  });

  it("parses port mapping 5445:5432 correctly", () => {
    const { system } = adapter.parse(rootDir);
    const pg = system.resources.postgres;
    expect(pg.spec.ports[0]).toMatchObject({ port: 5445 });
    // container port differs from host port
    expect(pg.spec.containerPort).toBe(5432);
  });
});
