import { describe, expect, it } from "vitest";

import { composeToYaml, generateCompose } from "./compose-gen";
import type { DxYaml } from "./config-schemas";
import type { ResolvedConnectionContext } from "./connection-context-schemas";

const sample: DxYaml = {
  module: "billing",
  team: "platform-eng",
  components: {
    api: { path: "./services/api", port: 8080, worker: false },
  },
  dependencies: {
    postgres: {
      image: "postgres:16-alpine",
      port: 5432,
      env: {
        POSTGRES_DB: "billing",
        POSTGRES_USER: "dev",
        POSTGRES_PASSWORD: "dev",
      },
    },
    redis: { image: "redis:7-alpine", port: 6379, env: {} },
  },
  connections: {},
};

describe("generateCompose", () => {
  it("creates dependency and component services", () => {
    const out = generateCompose("/repo/root", sample, {
      api: {
        dev: { command: "python -m http.server", sync: [] },
        build: { dockerfile: "Dockerfile", context: "." },
      },
    });
    expect(out.services["dep-postgres"]).toBeDefined();
    expect(out.services["dep-redis"]).toBeDefined();
    expect(out.services["billing-api"]).toBeDefined();
    const api = out.services["billing-api"];
    expect(api?.ports).toContain("8080:8080");
    expect(api?.environment?.DATABASE_URL).toContain("postgresql://");
    expect(api?.environment?.REDIS_URL).toContain("redis://");
  });

  it("omits remote deps when connectionContext is provided", () => {
    const connCtx: ResolvedConnectionContext = {
      envVars: {
        DATABASE_URL: { value: "postgresql://staging:5432/billing", source: "connection" },
        REDIS_URL: { value: "redis://localhost:6379", source: "default" },
      },
      tunnels: [],
      remoteDeps: ["postgres"],
      localDeps: ["redis"],
    };
    const out = generateCompose("/repo/root", sample, { api: {} }, { connectionContext: connCtx });
    // postgres should be omitted from compose
    expect(out.services["dep-postgres"]).toBeUndefined();
    // redis stays local
    expect(out.services["dep-redis"]).toBeDefined();
    // component gets resolved env vars
    const api = out.services["billing-api"];
    expect(api?.environment?.DATABASE_URL).toBe("postgresql://staging:5432/billing");
    // depends_on should only reference local deps
    expect(api?.depends_on).toEqual(["dep-redis"]);
  });

  it("uses all resolved env vars from connectionContext", () => {
    const connCtx: ResolvedConnectionContext = {
      envVars: {
        DATABASE_URL: { value: "pg://tunnel", source: "connection" },
        REDIS_URL: { value: "redis://tunnel", source: "connection" },
        LOG_LEVEL: { value: "debug", source: "tier" },
      },
      tunnels: [],
      remoteDeps: ["postgres", "redis"],
      localDeps: [],
    };
    const out = generateCompose("/repo/root", sample, { api: {} }, { connectionContext: connCtx });
    expect(out.services["dep-postgres"]).toBeUndefined();
    expect(out.services["dep-redis"]).toBeUndefined();
    const api = out.services["billing-api"];
    expect(api?.environment?.LOG_LEVEL).toBe("debug");
    expect(api?.depends_on).toBeUndefined();
  });

  it("composeToYaml returns parseable yaml text", () => {
    const out = generateCompose("/r", sample, {});
    const y = composeToYaml(out);
    expect(y).toContain("services:");
    expect(y).toContain("billing-api:");
  });
});
