import { describe, expect, it } from "bun:test"

import type { DbResourceConfig } from "../lib/db-driver.js"
import {
  detectDbType,
  findDbDependencies,
  getDriver,
  registerDriver,
} from "../lib/db-driver.js"

// Register postgres driver
import "../lib/db-driver-postgres.js"

// ── detectDbType ─────────────────────────────────────────────────────────────

describe("detectDbType", () => {
  function dep(image: string): DbResourceConfig {
    return { image, port: 5432, env: {} }
  }

  it("detects postgres from key name", () => {
    expect(detectDbType("postgres", dep("some-custom-image"))).toBe("postgres")
    expect(detectDbType("postgresql", dep("anything"))).toBe("postgres")
    expect(detectDbType("pg", dep("anything"))).toBe("postgres")
  })

  it("detects postgres from image name", () => {
    expect(detectDbType("mydb", dep("postgres:16-alpine"))).toBe("postgres")
    expect(detectDbType("mydb", dep("postgis/postgis:16-3.4"))).toBe("postgres")
    expect(detectDbType("mydb", dep("timescaledb/timescaledb:latest"))).toBe(
      "postgres"
    )
  })

  it("detects mysql from key name", () => {
    expect(detectDbType("mysql", dep("anything"))).toBe("mysql")
    expect(detectDbType("mariadb", dep("anything"))).toBe("mysql")
  })

  it("detects mysql from image name", () => {
    expect(detectDbType("mydb", dep("mysql:8"))).toBe("mysql")
    expect(detectDbType("mydb", dep("mariadb:11"))).toBe("mysql")
  })

  it("detects clickhouse from key name", () => {
    expect(detectDbType("clickhouse", dep("anything"))).toBe("clickhouse")
  })

  it("detects clickhouse from image name", () => {
    expect(detectDbType("mydb", dep("clickhouse/clickhouse-server:24"))).toBe(
      "clickhouse"
    )
  })

  it("detects sqlite from key name", () => {
    expect(detectDbType("sqlite", dep("anything"))).toBe("sqlite")
  })

  it("returns null for non-database dependencies", () => {
    expect(detectDbType("redis", dep("redis:7-alpine"))).toBeNull()
    expect(detectDbType("rabbitmq", dep("rabbitmq:3-management"))).toBeNull()
    expect(detectDbType("nginx", dep("nginx:alpine"))).toBeNull()
  })
})

// ── findDbDependencies ───────────────────────────────────────────────────────

describe("findDbDependencies", () => {
  it("finds postgres dependency from catalog resources", () => {
    const ctx = {
      catalog: {
        resources: {
          postgres: {
            kind: "Resource",
            metadata: { name: "postgres", namespace: "default" },
            spec: {
              type: "database",
              owner: "test",
              lifecycle: "development",
              image: "postgres:16-alpine",
              ports: [{ port: 5433, name: "postgres" }],
              environment: {
                POSTGRES_DB: "testdb",
                POSTGRES_USER: "dev",
                POSTGRES_PASSWORD: "dev",
              },
            },
          },
        },
      },
    } as any

    const dbs = findDbDependencies(ctx.catalog)
    expect(dbs).toHaveLength(1)
    expect(dbs[0].name).toBe("postgres")
    expect(dbs[0].dbType).toBe("postgres")
    expect(dbs[0].res.port).toBe(5433)
  })

  it("finds multiple database dependencies", () => {
    const ctx = {
      catalog: {
        resources: {
          postgres: {
            kind: "Resource",
            metadata: { name: "postgres", namespace: "default" },
            spec: {
              type: "database",
              owner: "data",
              lifecycle: "development",
              image: "postgres:16",
              ports: [{ port: 5432, name: "postgres" }],
              environment: { POSTGRES_DB: "app" },
            },
          },
          clickhouse: {
            kind: "Resource",
            metadata: { name: "clickhouse", namespace: "default" },
            spec: {
              type: "database",
              owner: "data",
              lifecycle: "development",
              image: "clickhouse/clickhouse-server:24",
              ports: [{ port: 8123, name: "http" }],
              environment: { CLICKHOUSE_DB: "analytics" },
            },
          },
          redis: {
            kind: "Resource",
            metadata: { name: "redis", namespace: "default" },
            spec: {
              type: "cache",
              owner: "data",
              lifecycle: "development",
              image: "redis:7-alpine",
              ports: [{ port: 6379, name: "redis" }],
            },
          },
        },
      },
    } as any

    const dbs = findDbDependencies(ctx.catalog)
    expect(dbs).toHaveLength(2)
    expect(dbs.map((d) => d.name)).toEqual(["postgres", "clickhouse"])
  })

  it("returns empty when no database dependencies exist", () => {
    const ctx = {
      catalog: {
        resources: {
          redis: {
            kind: "Resource",
            metadata: { name: "redis", namespace: "default" },
            spec: {
              type: "cache",
              owner: "ui",
              lifecycle: "development",
              image: "redis:7",
              ports: [{ port: 6379, name: "redis" }],
            },
          },
        },
      },
    } as any

    const dbs = findDbDependencies(ctx.catalog)
    expect(dbs).toHaveLength(0)
  })
})

// ── Postgres driver ──────────────────────────────────────────────────────────

describe("postgres driver", () => {
  it("is registered and retrievable", () => {
    const driver = getDriver("postgres")
    expect(driver.type).toBe("postgres")
  })

  it("builds URL from dependency config", () => {
    const driver = getDriver("postgres")
    const dep: DbResourceConfig = {
      image: "postgres:16-alpine",
      port: 5433,
      env: {
        POSTGRES_DB: "myapp",
        POSTGRES_USER: "appuser",
        POSTGRES_PASSWORD: "secret",
      },
    }

    const url = driver.buildUrl(dep, "postgres")
    expect(url).toBe("postgresql://appuser:secret@localhost:5433/myapp")
  })

  it("uses default credentials when env vars are missing", () => {
    const driver = getDriver("postgres")
    const dep: DbResourceConfig = {
      image: "postgres:16",
      port: 5432,
      env: {},
    }

    const url = driver.buildUrl(dep, "postgres")
    expect(url).toBe("postgresql://postgres:postgres@localhost:5432/postgres")
  })

  it("URL-encodes special characters in credentials", () => {
    const driver = getDriver("postgres")
    const dep: DbResourceConfig = {
      image: "postgres:16",
      port: 5432,
      env: {
        POSTGRES_DB: "mydb",
        POSTGRES_USER: "user@org",
        POSTGRES_PASSWORD: "p@ss/w#rd",
      },
    }

    const url = driver.buildUrl(dep, "postgres")
    expect(url).toContain("user%40org")
    expect(url).toContain("p%40ss%2Fw%23rd")
    expect(url).toContain("localhost:5432/mydb")
  })

  it("throws for unregistered driver type", () => {
    expect(() => getDriver("cockroachdb")).toThrow(
      /No driver registered for database type "cockroachdb"/
    )
  })
})

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
    }

    registerDriver("test-db", () => mockDriver as any)
    const driver = getDriver("test-db")
    expect(driver.type).toBe("test-db")
    expect(driver.buildUrl({} as any, "x")).toBe("test://localhost")
  })
})
