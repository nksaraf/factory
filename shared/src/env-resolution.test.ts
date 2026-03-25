import { describe, expect, test } from "vitest";

import type { DxYaml } from "./config-schemas";
import {
  categorizeDeps,
  computeDeterministicPort,
  formatResolvedEnv,
  resolveEnvVars,
} from "./env-resolution";

const baseDxConfig: DxYaml = {
  module: "geoanalytics",
  team: "analytics-eng",
  components: {
    api: { path: "./services/api", port: 8080, worker: false },
  },
  dependencies: {
    postgres: {
      image: "postgis/postgis:16-3.4",
      port: 5432,
      env: {
        POSTGRES_DB: "geoanalytics",
        POSTGRES_USER: "dev",
        POSTGRES_PASSWORD: "dev",
      },
      volumes: [],
    },
    redis: {
      image: "redis:7-alpine",
      port: 6379,
      env: {},
      volumes: [],
    },
  },
  connections: {
    auth: {
      module: "auth",
      component: "api",
      env_var: "AUTH_API_URL",
      local_default: "http://localhost:9090",
      optional: false,
    },
    analytics: {
      module: "analytics",
      component: "api",
      env_var: "ANALYTICS_API_URL",
      optional: true,
    },
  },
};

describe("computeDeterministicPort", () => {
  test("returns stable port for same input", () => {
    const p1 = computeDeterministicPort("staging", "postgres");
    const p2 = computeDeterministicPort("staging", "postgres");
    expect(p1).toBe(p2);
  });

  test("returns different ports for different inputs", () => {
    const p1 = computeDeterministicPort("staging", "postgres");
    const p2 = computeDeterministicPort("staging", "redis");
    expect(p1).not.toBe(p2);
  });

  test("returns port in expected range", () => {
    const port = computeDeterministicPort("staging", "postgres", 15000, 1000);
    expect(port).toBeGreaterThanOrEqual(15000);
    expect(port).toBeLessThan(16000);
  });
});

describe("categorizeDeps", () => {
  test("all local when no overrides", () => {
    const { local, remote } = categorizeDeps(baseDxConfig, {});
    expect(local.sort()).toEqual(["postgres", "redis"]);
    expect(remote).toEqual([]);
  });

  test("moves dep to remote when override present", () => {
    const { local, remote } = categorizeDeps(baseDxConfig, {
      postgres: { target: "staging", readonly: false, backend: "direct" },
    });
    expect(local).toEqual(["redis"]);
    expect(remote).toContain("postgres");
  });

  test("connection overrides are also tracked as remote", () => {
    const { remote } = categorizeDeps(baseDxConfig, {
      auth: { target: "staging", readonly: false, backend: "direct" },
    });
    expect(remote).toContain("auth");
  });
});

describe("resolveEnvVars", () => {
  test("Layer 1: builds defaults from dx.yaml", () => {
    const result = resolveEnvVars({ dxConfig: baseDxConfig });
    expect(result.envVars.DATABASE_URL?.value).toBe(
      "postgresql://dev:dev@localhost:5432/geoanalytics"
    );
    expect(result.envVars.DATABASE_URL?.source).toBe("default");
    expect(result.envVars.REDIS_URL?.value).toBe("redis://localhost:6379");
    expect(result.envVars.AUTH_API_URL?.value).toBe("http://localhost:9090");
    expect(result.envVars.ANALYTICS_API_URL).toBeUndefined(); // no local_default
  });

  test("Layer 2: tier overlay overrides defaults", () => {
    const result = resolveEnvVars({
      dxConfig: baseDxConfig,
      tierOverlay: {
        DATABASE_URL: "postgresql://staging:5432/geoanalytics",
        LOG_LEVEL: "debug",
      },
    });
    expect(result.envVars.DATABASE_URL?.value).toBe(
      "postgresql://staging:5432/geoanalytics"
    );
    expect(result.envVars.DATABASE_URL?.source).toBe("tier");
    expect(result.envVars.LOG_LEVEL?.value).toBe("debug");
    expect(result.envVars.LOG_LEVEL?.source).toBe("tier");
    // Redis not in tier overlay, stays as default
    expect(result.envVars.REDIS_URL?.source).toBe("default");
  });

  test("Layer 3: connection overrides with direct backend use tier values", () => {
    const result = resolveEnvVars({
      dxConfig: baseDxConfig,
      tierOverlay: {
        DATABASE_URL: "postgresql://staging:5432/geoanalytics",
      },
      connectionOverrides: {
        postgres: { target: "staging", readonly: false, backend: "direct" },
      },
    });
    expect(result.envVars.DATABASE_URL?.value).toBe(
      "postgresql://staging:5432/geoanalytics"
    );
    expect(result.envVars.DATABASE_URL?.source).toBe("connection");
    expect(result.remoteDeps).toContain("postgres");
    expect(result.localDeps).toEqual(["redis"]);
    expect(result.tunnels).toHaveLength(1);
    expect(result.tunnels[0].name).toBe("postgres");
    expect(result.tunnels[0].backend).toBe("direct");
  });

  test("Layer 3: connection overrides with kubectl backend use tunnel port", () => {
    const result = resolveEnvVars({
      dxConfig: baseDxConfig,
      connectionOverrides: {
        postgres: { target: "staging", readonly: false, backend: "kubectl" },
      },
    });
    const port = result.tunnels[0].localPort;
    expect(result.envVars.DATABASE_URL?.value).toBe(
      `postgresql://dev:dev@localhost:${port}/geoanalytics`
    );
    expect(result.envVars.DATABASE_URL?.source).toBe("connection");
  });

  test("Layer 3: module connection override with direct backend", () => {
    const result = resolveEnvVars({
      dxConfig: baseDxConfig,
      tierOverlay: { AUTH_API_URL: "http://auth-staging:8080" },
      connectionOverrides: {
        auth: { target: "staging", readonly: false, backend: "direct" },
      },
    });
    expect(result.envVars.AUTH_API_URL?.value).toBe("http://auth-staging:8080");
    expect(result.envVars.AUTH_API_URL?.source).toBe("connection");
    expect(result.remoteDeps).toContain("auth");
  });

  test("Layer 4: CLI env flags override everything", () => {
    const result = resolveEnvVars({
      dxConfig: baseDxConfig,
      tierOverlay: { DATABASE_URL: "postgresql://staging:5432/db" },
      cliEnvFlags: {
        DATABASE_URL: "postgresql://custom:5432/test",
        RATE_LIMIT: "9999",
      },
    });
    expect(result.envVars.DATABASE_URL?.value).toBe(
      "postgresql://custom:5432/test"
    );
    expect(result.envVars.DATABASE_URL?.source).toBe("cli");
    expect(result.envVars.RATE_LIMIT?.value).toBe("9999");
    expect(result.envVars.RATE_LIMIT?.source).toBe("cli");
  });

  test("empty input produces defaults only", () => {
    const result = resolveEnvVars({ dxConfig: baseDxConfig });
    expect(result.tunnels).toEqual([]);
    expect(result.remoteDeps).toEqual([]);
    expect(result.localDeps.sort()).toEqual(["postgres", "redis"]);
  });
});

describe("formatResolvedEnv", () => {
  test("annotated mode shows sources", () => {
    const output = formatResolvedEnv({
      DB: { value: "pg://localhost", source: "default", sourceDetail: "auto" },
    });
    expect(output).toBe("DB=pg://localhost  # ← auto");
  });

  test("export mode produces shell-eval format", () => {
    const output = formatResolvedEnv(
      { DB: { value: "pg://localhost", source: "default" } },
      "export"
    );
    expect(output).toBe("export DB=pg://localhost");
  });
});
