import { describe, expect, it } from "bun:test"

import { composeToYaml, generateComposeFromCatalog } from "./compose-gen"
import type { CatalogSystem } from "./catalog"
import type { ResolvedConnectionContext } from "./connection-context-schemas"

const sample: CatalogSystem = {
  kind: "System",
  metadata: { name: "billing", namespace: "default" },
  spec: { owner: "platform-eng", domain: "payments", lifecycle: "production" },
  components: {
    api: {
      kind: "Component",
      metadata: { name: "api", namespace: "default" },
      spec: {
        type: "service",
        lifecycle: "production",
        owner: "platform-eng",
        build: { context: "./services/api", dockerfile: "Dockerfile" },
        ports: [{ name: "http", port: 8080, protocol: "http" }],
        dev: { command: "python -m http.server", sync: [] },
      },
    },
  },
  resources: {
    postgres: {
      kind: "Resource",
      metadata: { name: "postgres", namespace: "default" },
      spec: {
        type: "database",
        owner: "platform-eng",
        lifecycle: "production",
        image: "postgres:16-alpine",
        ports: [{ name: "postgres", port: 5432, protocol: "tcp" }],
        environment: {
          POSTGRES_DB: "billing",
          POSTGRES_USER: "dev",
          POSTGRES_PASSWORD: "dev",
        },
      },
    },
    redis: {
      kind: "Resource",
      metadata: { name: "redis", namespace: "default" },
      spec: {
        type: "cache",
        owner: "platform-eng",
        lifecycle: "production",
        image: "redis:7-alpine",
        ports: [{ name: "redis", port: 6379, protocol: "tcp" }],
      },
    },
  },
  apis: {},
  connections: [],
} as unknown as CatalogSystem

describe("generateComposeFromCatalog", () => {
  it("creates resource and component services", () => {
    const out = generateComposeFromCatalog(sample)
    expect(out.services["dep-postgres"]).toBeDefined()
    expect(out.services["dep-redis"]).toBeDefined()
    expect(out.services["billing-api"]).toBeDefined()
    const api = out.services["billing-api"]
    expect(api?.ports).toContain("8080:8080")
    expect(api?.environment?.DATABASE_URL).toContain("postgresql://")
    expect(api?.environment?.REDIS_URL).toContain("redis://")
  })

  it("omits remote deps when connectionContext is provided", () => {
    const connCtx: ResolvedConnectionContext = {
      envVars: {
        DATABASE_URL: {
          value: "postgresql://staging:5432/billing",
          source: "connection",
        },
        REDIS_URL: { value: "redis://localhost:6379", source: "default" },
      },
      tunnels: [],
      remoteDeps: ["postgres"],
      localDeps: ["redis"],
    }
    const out = generateComposeFromCatalog(sample, {
      connectionContext: connCtx,
    })
    expect(out.services["dep-postgres"]).toBeUndefined()
    expect(out.services["dep-redis"]).toBeDefined()
    const api = out.services["billing-api"]
    expect(api?.environment?.DATABASE_URL).toBe(
      "postgresql://staging:5432/billing"
    )
    expect(api?.depends_on).toEqual(["dep-redis"])
  })

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
    }
    const out = generateComposeFromCatalog(sample, {
      connectionContext: connCtx,
    })
    expect(out.services["dep-postgres"]).toBeUndefined()
    expect(out.services["dep-redis"]).toBeUndefined()
    const api = out.services["billing-api"]
    expect(api?.environment?.LOG_LEVEL).toBe("debug")
    expect(api?.depends_on).toBeUndefined()
  })

  it("portMap overrides resource host ports", () => {
    const out = generateComposeFromCatalog(sample, {
      portMap: { "dep-postgres": 15432 },
    })
    expect(out.services["dep-postgres"]?.ports).toContain("15432:5432")
  })

  it("portMap overrides component host ports", () => {
    const out = generateComposeFromCatalog(sample, {
      portMap: { "billing-api": 19000 },
    })
    expect(out.services["billing-api"]?.ports).toContain("19000:8080")
  })

  it("portMap takes precedence over portOffset", () => {
    const out = generateComposeFromCatalog(sample, {
      portOffset: 1000,
      portMap: { "dep-postgres": 15432 },
    })
    expect(out.services["dep-postgres"]?.ports).toContain("15432:5432")
    expect(out.services["dep-redis"]?.ports).toContain("7379:6379")
  })

  it("partial portMap: unmapped services use default", () => {
    const out = generateComposeFromCatalog(sample, {
      portMap: { "dep-postgres": 15432 },
    })
    expect(out.services["dep-redis"]?.ports).toContain("6379:6379")
  })

  it("composeToYaml returns parseable yaml text", () => {
    const out = generateComposeFromCatalog(sample)
    const y = composeToYaml(out)
    expect(y).toContain("services:")
    expect(y).toContain("billing-api:")
  })
})
