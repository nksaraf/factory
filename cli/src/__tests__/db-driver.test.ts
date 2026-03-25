import { describe, expect, it } from "vitest";

import type { DependencyConfig } from "@smp/factory-shared/config-schemas";

import {
  detectDbType,
  findDbDependencies,
  getDriver,
  registerDriver,
} from "../lib/db-driver.js";
// Register postgres driver
import "../lib/db-driver-postgres.js";

// ── detectDbType ─────────────────────────────────────────────────────────────

describe("detectDbType", () => {
  function dep(image: string): DependencyConfig {
    return { image, port: 5432, env: {}, volumes: [] };
  }

  it("detects postgres from key name", () => {
    expect(detectDbType("postgres", dep("some-custom-image"))).toBe("postgres");
    expect(detectDbType("postgresql", dep("anything"))).toBe("postgres");
    expect(detectDbType("pg", dep("anything"))).toBe("postgres");
  });

  it("detects postgres from image name", () => {
    expect(detectDbType("mydb", dep("postgres:16-alpine"))).toBe("postgres");
    expect(detectDbType("mydb", dep("postgis/postgis:16-3.4"))).toBe("postgres");
    expect(detectDbType("mydb", dep("timescaledb/timescaledb:latest"))).toBe("postgres");
  });

  it("detects mysql from key name", () => {
    expect(detectDbType("mysql", dep("anything"))).toBe("mysql");
    expect(detectDbType("mariadb", dep("anything"))).toBe("mysql");
  });

  it("detects mysql from image name", () => {
    expect(detectDbType("mydb", dep("mysql:8"))).toBe("mysql");
    expect(detectDbType("mydb", dep("mariadb:11"))).toBe("mysql");
  });

  it("detects clickhouse from key name", () => {
    expect(detectDbType("clickhouse", dep("anything"))).toBe("clickhouse");
  });

  it("detects clickhouse from image name", () => {
    expect(detectDbType("mydb", dep("clickhouse/clickhouse-server:24"))).toBe("clickhouse");
  });

  it("detects sqlite from key name", () => {
    expect(detectDbType("sqlite", dep("anything"))).toBe("sqlite");
  });

  it("returns null for non-database dependencies", () => {
    expect(detectDbType("redis", dep("redis:7-alpine"))).toBeNull();
    expect(detectDbType("rabbitmq", dep("rabbitmq:3-management"))).toBeNull();
    expect(detectDbType("nginx", dep("nginx:alpine"))).toBeNull();
  });
});

// ── findDbDependencies ───────────────────────────────────────────────────────

describe("findDbDependencies", () => {
  it("finds postgres dependency from dx.yaml config", () => {
    const ctx = {
      moduleConfig: {
        module: "test-mod",
        team: "test",
        components: {},
        dependencies: {
          postgres: {
            image: "postgres:16-alpine",
            port: 5433,
            env: {
              POSTGRES_DB: "testdb",
              POSTGRES_USER: "dev",
              POSTGRES_PASSWORD: "dev",
            },
            volumes: [],
          },
        },
        connections: {},
      },
    } as any;

    const dbs = findDbDependencies(ctx);
    expect(dbs).toHaveLength(1);
    expect(dbs[0].name).toBe("postgres");
    expect(dbs[0].dbType).toBe("postgres");
    expect(dbs[0].dep.port).toBe(5433);
  });

  it("finds multiple database dependencies", () => {
    const ctx = {
      moduleConfig: {
        module: "analytics",
        team: "data",
        components: {},
        dependencies: {
          postgres: {
            image: "postgres:16",
            port: 5432,
            env: { POSTGRES_DB: "app" },
            volumes: [],
          },
          clickhouse: {
            image: "clickhouse/clickhouse-server:24",
            port: 8123,
            env: { CLICKHOUSE_DB: "analytics" },
            volumes: [],
          },
          redis: {
            image: "redis:7-alpine",
            port: 6379,
            env: {},
            volumes: [],
          },
        },
        connections: {},
      },
    } as any;

    const dbs = findDbDependencies(ctx);
    expect(dbs).toHaveLength(2);
    expect(dbs.map((d) => d.name)).toEqual(["postgres", "clickhouse"]);
  });

  it("returns empty when no database dependencies exist", () => {
    const ctx = {
      moduleConfig: {
        module: "frontend",
        team: "ui",
        components: {},
        dependencies: {
          redis: {
            image: "redis:7",
            port: 6379,
            env: {},
            volumes: [],
          },
        },
        connections: {},
      },
    } as any;

    const dbs = findDbDependencies(ctx);
    expect(dbs).toHaveLength(0);
  });
});

// ── Postgres driver ──────────────────────────────────────────────────────────

describe("postgres driver", () => {
  it("is registered and retrievable", () => {
    const driver = getDriver("postgres");
    expect(driver.type).toBe("postgres");
  });

  it("builds URL from dependency config", () => {
    const driver = getDriver("postgres");
    const dep: DependencyConfig = {
      image: "postgres:16-alpine",
      port: 5433,
      env: {
        POSTGRES_DB: "myapp",
        POSTGRES_USER: "appuser",
        POSTGRES_PASSWORD: "secret",
      },
      volumes: [],
    };

    const url = driver.buildUrl(dep, "postgres");
    expect(url).toBe("postgresql://appuser:secret@localhost:5433/myapp");
  });

  it("uses default credentials when env vars are missing", () => {
    const driver = getDriver("postgres");
    const dep: DependencyConfig = {
      image: "postgres:16",
      port: 5432,
      env: {},
      volumes: [],
    };

    const url = driver.buildUrl(dep, "postgres");
    expect(url).toBe("postgresql://postgres:postgres@localhost:5432/postgres");
  });

  it("URL-encodes special characters in credentials", () => {
    const driver = getDriver("postgres");
    const dep: DependencyConfig = {
      image: "postgres:16",
      port: 5432,
      env: {
        POSTGRES_DB: "mydb",
        POSTGRES_USER: "user@org",
        POSTGRES_PASSWORD: "p@ss/w#rd",
      },
      volumes: [],
    };

    const url = driver.buildUrl(dep, "postgres");
    expect(url).toContain("user%40org");
    expect(url).toContain("p%40ss%2Fw%23rd");
    expect(url).toContain("localhost:5432/mydb");
  });

  it("throws for unregistered driver type", () => {
    expect(() => getDriver("cockroachdb")).toThrow(
      /No driver registered for database type "cockroachdb"/
    );
  });
});

// ── Driver registry ──────────────────────────────────────────────────────────

describe("driver registry", () => {
  it("allows registering custom drivers", () => {
    const mockDriver = {
      type: "test-db",
      buildUrl: () => "test://localhost",
      connect: async () => ({ query: async () => [], close: async () => {} }),
      spawnInteractive: () => 0,
      listTables: async () => [],
      describeTable: async () => [],
      listIndexes: async () => [],
      listConstraints: async () => [],
      listSequences: async () => [],
      listExtensions: async () => [],
      listActivity: async () => [],
      listLocks: async () => [],
      listLongQueries: async () => [],
      killQuery: async () => true,
    };

    registerDriver("test-db", () => mockDriver as any);
    const driver = getDriver("test-db");
    expect(driver.type).toBe("test-db");
    expect(driver.buildUrl({} as any, "x")).toBe("test://localhost");
  });
});
