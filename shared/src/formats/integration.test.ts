/**
 * Integration tests — load real YAML files from __fixtures__/ and the repo root.
 *
 * These exercise the full parse pipeline (file I/O → YAML parsing → classification
 * → CatalogSystem) without filesystem mocks.
 */

import { join } from "node:path";
import { describe, it, expect } from "vitest";

import { DockerComposeFormatAdapter, resolveComposeEnvVar } from "./docker-compose.adapter";
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
