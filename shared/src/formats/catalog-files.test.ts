/**
 * Smoke tests that verify all three catalog file formats parse correctly
 * for the factory project itself. These test the real files at the repo root.
 */

import { join } from "node:path";
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { parse as parseYaml } from "yaml";

import { DockerComposeFormatAdapter } from "./docker-compose.adapter";

const repoRoot = join(import.meta.dirname, "../../..");

// ─── docker-compose.yaml ────────────────────────────────────

describe("factory docker-compose.yaml (original)", () => {
  const adapter = new DockerComposeFormatAdapter();

  it("detects docker-compose.yaml at repo root", () => {
    expect(adapter.detect(repoRoot)).toBe(true);
  });

  it("parses into a valid CatalogSystem", () => {
    const { system } = adapter.parse(repoRoot);
    expect(system.kind).toBe("System");
  });

  it("classifies infra-factory as Component (has build)", () => {
    const { system } = adapter.parse(repoRoot);
    expect(system.components["infra-factory"]).toBeDefined();
    expect(system.components["infra-factory"].spec.build).toBeDefined();
  });

  it("classifies infra-postgres as database Resource", () => {
    const { system } = adapter.parse(repoRoot);
    expect(system.resources["infra-postgres"]).toBeDefined();
    expect(system.resources["infra-postgres"].spec.type).toBe("database");
  });

  it("resolves ${INFRA_POSTGRES_PORT:-5432} to 5432", () => {
    const { system } = adapter.parse(repoRoot);
    const pg = system.resources["infra-postgres"];
    expect(pg.spec.ports[0].port).toBe(5432);
  });

  it("resolves ${TRAEFIK_IMAGE:-traefik:v3.6.8} in image", () => {
    const { system } = adapter.parse(repoRoot);
    const proxy = system.resources["infra-reverse-proxy"];
    expect(proxy.spec.image).toBe("traefik:v3.6.8");
    expect(proxy.spec.type).toBe("gateway");
  });

  it("infers connections from env var URLs", () => {
    const { system } = adapter.parse(repoRoot);
    const dbConns = system.connections.filter((c) => c.targetComponent === "infra-postgres");
    expect(dbConns.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── catalog-info.yaml (Backstage format) ────────────────────

describe("factory catalog-info.yaml", () => {
  function loadEntities() {
    const raw = readFileSync(join(repoRoot, "catalog-info.yaml"), "utf-8");
    const { parseAllDocuments } = require("yaml") as typeof import("yaml");
    return parseAllDocuments(raw).map((d) => d.toJSON()).filter(Boolean);
  }

  it("parses as valid multi-document YAML", () => {
    const entities = loadEntities();
    expect(entities.length).toBeGreaterThanOrEqual(8);
    const kinds = entities.map((e: any) => e.kind);
    expect(kinds).toContain("System");
    expect(kinds).toContain("Component");
    expect(kinds).toContain("Resource");
    expect(kinds).toContain("API");
  });

  it("System entity has correct structure", () => {
    const entities = loadEntities();
    const system = entities.find((e: any) => e.kind === "System");
    expect(system).toBeDefined();
    expect(system.metadata.name).toBe("factory");
    expect(system.spec.owner).toBe("team:default/platform");
  });

  it("all entities reference system:default/factory", () => {
    const entities = loadEntities();
    const withSystem = entities.filter((e: any) => e.spec?.system);
    expect(withSystem.length).toBeGreaterThanOrEqual(6);
    for (const e of withSystem) {
      expect(e.spec.system).toBe("system:default/factory");
    }
  });

  it("Component entities have owner as entity reference", () => {
    const entities = loadEntities();
    const components = entities.filter((e: any) => e.kind === "Component");
    expect(components.length).toBe(3);
    for (const c of components) {
      expect(c.spec.owner).toMatch(/^team:/);
    }
  });

  it("API entities have definitions", () => {
    const entities = loadEntities();
    const apis = entities.filter((e: any) => e.kind === "API");
    expect(apis.length).toBe(2);
    for (const a of apis) {
      expect(a.spec.definition).toBeDefined();
      expect(a.spec.type).toBe("openapi");
    }
  });

  it("Resource entities include all infrastructure", () => {
    const entities = loadEntities();
    const resources = entities.filter((e: any) => e.kind === "Resource");
    const names = resources.map((r: any) => r.metadata.name).sort();
    expect(names).toEqual([
      "factory-api-docs",
      "factory-auth",
      "factory-gateway",
      "factory-postgres",
      "factory-reverse-proxy",
    ]);
  });

  it("dependency references use entity ref format", () => {
    const entities = loadEntities();
    const pg = entities.find((e: any) => e.metadata.name === "factory-postgres");
    expect(pg.spec.dependencyOf).toContain("component:default/factory-api");

    const auth = entities.find((e: any) => e.metadata.name === "factory-auth");
    expect(auth.spec.dependsOn).toContain("resource:default/factory-postgres");

    const docs = entities.find((e: any) => e.metadata.name === "factory-api-docs");
    expect(docs.spec.dependsOn).toContain("resource:default/factory-gateway");
  });

  // ─── Self-sufficiency: runtime data for compose generation ──

  it("factory-api has image, build, ports, env, volumes, healthchecks", () => {
    const entities = loadEntities();
    const api = entities.find((e: any) => e.metadata.name === "factory-api");
    expect(api.spec.image).toMatch(/factory-service/);
    expect(api.spec.build).toMatchObject({
      context: "./",
      dockerfile: "./api/Dockerfile",
    });
    expect(api.spec.build.args).toBeDefined();
    expect(api.spec.ports).toHaveLength(1);
    expect(api.spec.ports[0]).toMatchObject({
      name: "http",
      port: 8181,
      containerPort: 3000,
      protocol: "http",
    });
    expect(api.spec.environment).toMatchObject({
      FACTORY_DATABASE_URL: expect.stringContaining("factory-postgres:5432"),
      FACTORY_AUTH_JWKS_URL: expect.stringContaining("factory-auth:3000"),
    });
    expect(api.spec.volumes).toHaveLength(1);
    expect(api.spec.volumes[0].containerPath).toBe("/app/config/application.yml");
    // healthchecks (not old healthcheck)
    expect(api.spec.healthchecks.ready.http).toMatchObject({
      path: "/api/v1/factory/openapi",
      port: 3000,
    });
  });

  it("factory-postgres has image, port, env, volumes, healthcheck", () => {
    const entities = loadEntities();
    const pg = entities.find((e: any) => e.metadata.name === "factory-postgres");
    expect(pg.spec.image).toBe("postgres:16-alpine");
    expect(pg.spec.ports[0]).toMatchObject({ name: "postgres", port: 5432, protocol: "tcp" });
    expect(pg.spec.environment).toMatchObject({
      POSTGRES_USER: "${POSTGRES_USER:-postgres}",
      POSTGRES_PASSWORD: "${POSTGRES_PASSWORD}",
      POSTGRES_DB: "${POSTGRES_DB:-postgres}",
    });
    expect(pg.spec.volumes).toHaveLength(1);
    expect(pg.spec.volumes[0]).toMatchObject({
      name: "postgres-data",
      containerPath: "/var/lib/postgresql/data",
      persistent: { size: "10Gi", class: "standard", mode: "read-write-once" },
    });
    expect(pg.spec.healthcheck).toMatch(/pg_isready/);
  });

  it("factory-auth has image, port mapping, env with connection strings, healthcheck", () => {
    const entities = loadEntities();
    const auth = entities.find((e: any) => e.metadata.name === "factory-auth");
    expect(auth.spec.image).toMatch(/auth-service/);
    expect(auth.spec.ports[0]).toMatchObject({
      name: "http",
      port: 8180,
      containerPort: 3000,
    });
    expect(auth.spec.environment.AUTH_DATABASE_URL).toMatch(/factory-postgres:5432/);
    expect(auth.spec.volumes).toHaveLength(1);
    expect(auth.spec.volumes[0].containerPath).toBe("/app/config/application.yml");
    expect(auth.spec.healthcheck).toMatch(/auth\/reference/);
  });

  it("factory-gateway has image, port, env, volumes, healthcheck", () => {
    const entities = loadEntities();
    const gw = entities.find((e: any) => e.metadata.name === "factory-gateway");
    expect(gw.spec.image).toMatch(/apisix/);
    expect(gw.spec.ports[0]).toMatchObject({ name: "http", port: 8005 });
    expect(gw.spec.volumes).toHaveLength(2);
    expect(gw.spec.healthcheck).toMatch(/health/);
  });

  it("factory-reverse-proxy has image, port mapping, volumes, command", () => {
    const entities = loadEntities();
    const rp = entities.find((e: any) => e.metadata.name === "factory-reverse-proxy");
    expect(rp.spec.image).toMatch(/traefik/);
    expect(rp.spec.ports[0]).toMatchObject({
      name: "http",
      port: 3001,
      containerPort: 80,
    });
    expect(rp.spec.volumes).toHaveLength(1);
    expect(rp.spec.command).toBeInstanceOf(Array);
    expect(rp.spec.command.length).toBeGreaterThan(5);
    expect(rp.spec.command).toContain("--ping=true");
  });

  it("factory-api-docs has image, port, volume", () => {
    const entities = loadEntities();
    const docs = entities.find((e: any) => e.metadata.name === "factory-api-docs");
    expect(docs.spec.image).toBe("nginx:alpine");
    expect(docs.spec.ports[0]).toMatchObject({ name: "http", port: 80 });
    expect(docs.spec.volumes).toHaveLength(1);
    expect(docs.spec.volumes[0].containerPath).toBe("/usr/share/nginx/html/index.html");
  });

  // ─── Healthchecks (live/ready/start) ──────────────────────

  it("factory-api has live, ready, and start healthchecks", () => {
    const entities = loadEntities();
    const api = entities.find((e: any) => e.metadata.name === "factory-api");
    const hc = api.spec.healthchecks;
    expect(hc).toBeDefined();

    expect(hc.live.http).toMatchObject({ path: "/api/v1/health", port: 3000 });
    expect(hc.live.delay).toBe(10);
    expect(hc.live.retries).toBe(3);

    expect(hc.ready.http).toMatchObject({ path: "/api/v1/factory/openapi", port: 3000 });

    expect(hc.start.http).toMatchObject({ path: "/api/v1/health", port: 3000 });
    expect(hc.start.retries).toBe(12);
  });

  it("factory-postgres has command-based healthchecks", () => {
    const entities = loadEntities();
    const pg = entities.find((e: any) => e.metadata.name === "factory-postgres");
    expect(pg.spec.healthchecks.live.command).toContain("pg_isready");
    expect(pg.spec.healthchecks.ready.command).toContain("pg_isready");
  });

  // ─── Compute (min/max) ────────────────────────────────────

  it("factory-api has compute min and max", () => {
    const entities = loadEntities();
    const api = entities.find((e: any) => e.metadata.name === "factory-api");
    expect(api.spec.compute).toMatchObject({
      min: { cpu: "250m", memory: "512Mi" },
      max: { cpu: "1", memory: "1Gi" },
    });
    expect(api.spec.replicas).toBe(2);
  });

  it("all resources have compute min and max", () => {
    const entities = loadEntities();
    const resources = entities.filter((e: any) => e.kind === "Resource");
    for (const r of resources) {
      expect(r.spec.compute).toBeDefined();
      expect(r.spec.compute.min).toBeDefined();
      expect(r.spec.compute.max).toBeDefined();
      expect(r.spec.replicas).toBeGreaterThanOrEqual(1);
    }
  });

  // ─── Routes (was ingress) ─────────────────────────────────

  it("factory-api has routes with TLS", () => {
    const entities = loadEntities();
    const api = entities.find((e: any) => e.metadata.name === "factory-api");
    expect(api.spec.routes).toHaveLength(1);
    expect(api.spec.routes[0]).toMatchObject({
      host: "factory.internal",
      path: "/api/v1/factory",
      pathMatch: "prefix",
      portName: "http",
      tls: { enabled: true, secretName: "factory-tls" },
      provider: "nginx",
    });
  });

  it("factory-auth has routes", () => {
    const entities = loadEntities();
    const auth = entities.find((e: any) => e.metadata.name === "factory-auth");
    expect(auth.spec.routes).toHaveLength(1);
    expect(auth.spec.routes[0]).toMatchObject({
      host: "factory.internal",
      path: "/api/v1/auth",
      portName: "http",
    });
  });

  // ─── Secrets ──────────────────────────────────────────────

  it("factory-api has secrets separate from environment", () => {
    const entities = loadEntities();
    const api = entities.find((e: any) => e.metadata.name === "factory-api");
    expect(api.spec.secrets).toHaveLength(1);
    expect(api.spec.secrets[0]).toMatchObject({
      envVar: "GCP_NPM_SA_JSON_BASE64",
      ref: expect.stringContaining("gcp-npm-sa-json-base64"),
      localDefault: "",
    });
  });

  it("factory-auth has OAuth secrets", () => {
    const entities = loadEntities();
    const auth = entities.find((e: any) => e.metadata.name === "factory-auth");
    expect(auth.spec.secrets.length).toBe(4);
    const secretEnvVars = auth.spec.secrets.map((s: any) => s.envVar).sort();
    expect(secretEnvVars).toEqual([
      "AUTH_GITHUB_CLIENT_ID",
      "AUTH_GITHUB_CLIENT_SECRET",
      "AUTH_GOOGLE_CLIENT_ID",
      "AUTH_GOOGLE_CLIENT_SECRET",
    ]);
  });

  // ─── Persistent volumes (was PVC) ─────────────────────────

  it("factory-postgres has persistent volume with size and class", () => {
    const entities = loadEntities();
    const pg = entities.find((e: any) => e.metadata.name === "factory-postgres");
    expect(pg.spec.stateful).toBe(true);
    expect(pg.spec.volumes[0].persistent).toMatchObject({
      size: "10Gi",
      class: "standard",
      mode: "read-write-once",
    });
  });

  it("factory-postgres has secret ref for password", () => {
    const entities = loadEntities();
    const pg = entities.find((e: any) => e.metadata.name === "factory-postgres");
    expect(pg.spec.secrets).toHaveLength(1);
    expect(pg.spec.secrets[0]).toMatchObject({
      envVar: "POSTGRES_PASSWORD",
      ref: expect.stringContaining("factory-postgres-password"),
      localDefault: "postgres",
    });
  });

  it("factory-gateway has admin port and secret for API key", () => {
    const entities = loadEntities();
    const gw = entities.find((e: any) => e.metadata.name === "factory-gateway");
    expect(gw.spec.ports).toHaveLength(2);
    expect(gw.spec.ports[1]).toMatchObject({ name: "admin", port: 9180 });
    expect(gw.spec.secrets).toHaveLength(1);
    expect(gw.spec.secrets[0].envVar).toBe("CLICKSTACK_API_KEY");
  });
});
