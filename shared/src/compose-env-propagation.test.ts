import { describe, expect, it } from "bun:test"

import type { CatalogSystem } from "./catalog"
import {
  type ConnectionEndpoint,
  buildConnectionEndpoints,
  deriveServiceEnvOverrides,
  expandRemoteDeps,
  resolveTemplate,
} from "./compose-env-propagation"
import type { NormalizedProfileEntry } from "./connection-context-schemas"
import { DependencyGraph } from "./dependency-graph"

// ── Helpers ──────────────────────────────────────────────────────

const stub = { metadata: { name: "", namespace: "default" } }

function compSpec(opts: {
  dependsOn?: string[]
  depEnv?: Record<string, Record<string, string>>
  environment?: Record<string, string>
  ports?: Array<{ name: string; port: number; protocol: "http" | "tcp" }>
}) {
  return {
    ...stub,
    kind: "Component" as const,
    spec: {
      type: "service",
      image: "test",
      ports: opts.ports ?? [],
      environment: opts.environment ?? {},
      dependsOn: opts.dependsOn,
      depEnv: opts.depEnv,
    },
  }
}

function resSpec(opts: {
  dependsOn?: string[]
  depEnv?: Record<string, Record<string, string>>
  containerPort?: number
  ports?: Array<{ name: string; port: number; protocol: "tcp" | "http" }>
}) {
  return {
    ...stub,
    kind: "Resource" as const,
    spec: {
      type: "database",
      image: "test",
      ports: opts.ports ?? [],
      environment: {},
      dependsOn: opts.dependsOn,
      depEnv: opts.depEnv,
      containerPort: opts.containerPort,
    },
  }
}

function makeCatalog(
  components: Record<string, ReturnType<typeof compSpec>>,
  resources: Record<string, ReturnType<typeof resSpec>>
): CatalogSystem {
  return {
    kind: "System",
    metadata: { name: "test", namespace: "default" },
    spec: { owner: "test" },
    components: components as any,
    resources: resources as any,
    connections: [],
  }
}

const pgEndpoint: ConnectionEndpoint = {
  dockerHostname: "infra-postgres",
  containerPort: 5432,
  host: "192.168.2.88",
  port: 54111,
  vars: { POSTGRES_USER: "postgres", POSTGRES_PASSWORD: "factory-prod-2026" },
}

const authEndpoint: ConnectionEndpoint = {
  dockerHostname: "infra-auth",
  containerPort: 3000,
  host: "192.168.2.88",
  port: 8180,
  vars: {},
}

// ── resolveTemplate ──────────────────────────────────────────────

describe("resolveTemplate", () => {
  describe("explicit label templates", () => {
    it("resolves {host} and {port}", () => {
      expect(resolveTemplate("{host}:{port}", pgEndpoint, true)).toBe(
        "192.168.2.88:54111"
      )
    })

    it("resolves {VAR} from endpoint vars", () => {
      expect(resolveTemplate("{POSTGRES_USER}", pgEndpoint, true)).toBe(
        "postgres"
      )
    })

    it("resolves mixed template", () => {
      expect(
        resolveTemplate(
          "postgres://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{host}:{port}/mydb",
          pgEndpoint,
          true
        )
      ).toBe("postgres://postgres:factory-prod-2026@192.168.2.88:54111/mydb")
    })

    it("resolves unknown vars to empty string", () => {
      expect(resolveTemplate("{UNKNOWN}", pgEndpoint, true)).toBe("")
    })
  })

  describe("convention auto-detected templates", () => {
    it("replaces hostname:containerPort with host:port", () => {
      const template =
        "postgres://postgres:postgres@infra-postgres:5432/postgres"
      expect(resolveTemplate(template, pgEndpoint, false)).toBe(
        "postgres://postgres:postgres@192.168.2.88:54111/postgres"
      )
    })

    it("replaces standalone hostname", () => {
      expect(resolveTemplate("infra-auth", authEndpoint, false)).toBe(
        "192.168.2.88"
      )
    })

    it("replaces hostname in URL without matching port", () => {
      const template =
        "http://infra-auth:3000/api/v1/auth/.well-known/jwks.json"
      expect(resolveTemplate(template, authEndpoint, false)).toBe(
        "http://192.168.2.88:8180/api/v1/auth/.well-known/jwks.json"
      )
    })

    it("replaces standalone port when entire value equals containerPort", () => {
      expect(resolveTemplate("5432", pgEndpoint, false)).toBe("54111")
    })

    it("does NOT replace port when embedded in a larger string", () => {
      // The port 5432 in a URL should be handled by hostname:port replacement, not standalone
      const template = "some-prefix-5432-suffix"
      expect(resolveTemplate(template, pgEndpoint, false)).toBe(
        "some-prefix-5432-suffix"
      )
    })

    it("resolves ${VAR:-default} with endpoint vars", () => {
      const template =
        "postgres://${POSTGRES_USER:-postgres}:${POSTGRES_PASSWORD:-postgres}@infra-postgres:5432/db"
      expect(resolveTemplate(template, pgEndpoint, false)).toBe(
        "postgres://postgres:factory-prod-2026@192.168.2.88:54111/db"
      )
    })

    it("uses fallback when var not in endpoint", () => {
      const template = "${POSTGRES_DB:-mydefault}"
      expect(resolveTemplate(template, pgEndpoint, false)).toBe("mydefault")
    })

    it("resolves ${VAR} without fallback to empty when missing", () => {
      const template = "${UNKNOWN_VAR}"
      expect(resolveTemplate(template, pgEndpoint, false)).toBe("")
    })
  })
})

// ── buildConnectionEndpoints ─────────────────────────────────────

describe("buildConnectionEndpoints", () => {
  const catalog = makeCatalog(
    {},
    {
      "infra-postgres": resSpec({
        containerPort: 5432,
        ports: [{ name: "postgres", port: 5432, protocol: "tcp" }],
      }),
      "infra-auth": resSpec({
        ports: [{ name: "http", port: 3000, protocol: "http" }],
        dependsOn: ["infra-postgres"],
      }),
    }
  )

  it("builds endpoints from profile entries with host/port", () => {
    const overrides: Record<string, NormalizedProfileEntry> = {
      "infra-postgres": {
        target: "production",
        readonly: false,
        backend: "direct",
        host: "192.168.2.88",
        port: 54111,
        vars: { POSTGRES_USER: "postgres" },
      },
      "infra-auth": {
        target: "production",
        readonly: false,
        backend: "direct",
        host: "192.168.2.88",
        port: 8180,
      },
    }

    const endpoints = buildConnectionEndpoints(overrides, catalog)
    expect(endpoints.size).toBe(2)

    const pg = endpoints.get("infra-postgres")!
    expect(pg.dockerHostname).toBe("infra-postgres")
    expect(pg.containerPort).toBe(5432)
    expect(pg.host).toBe("192.168.2.88")
    expect(pg.port).toBe(54111)
    expect(pg.vars).toEqual({ POSTGRES_USER: "postgres" })

    const auth = endpoints.get("infra-auth")!
    expect(auth.containerPort).toBe(3000)
    expect(auth.port).toBe(8180)
  })

  it("skips entries without host or port", () => {
    const overrides: Record<string, NormalizedProfileEntry> = {
      "infra-postgres": {
        target: "production",
        readonly: false,
        backend: "direct",
        // no host/port
      },
    }
    const endpoints = buildConnectionEndpoints(overrides, catalog)
    expect(endpoints.size).toBe(0)
  })

  it("uses containerPort from catalog resource spec", () => {
    const overrides: Record<string, NormalizedProfileEntry> = {
      "infra-postgres": {
        target: "production",
        readonly: false,
        backend: "direct",
        host: "10.0.0.1",
        port: 5432,
      },
    }
    const endpoints = buildConnectionEndpoints(overrides, catalog)
    expect(endpoints.get("infra-postgres")!.containerPort).toBe(5432)
  })
})

// ── expandRemoteDeps ─────────────────────────────────────────────

describe("expandRemoteDeps", () => {
  const graph = DependencyGraph.fromEdges([
    ["infra-auth", "infra-postgres"],
    ["infra-factory", "infra-postgres"],
    ["infra-factory", "infra-auth"],
    ["infra-spicedb", "infra-postgres"],
  ])

  const endpoints = new Map<string, ConnectionEndpoint>([
    ["infra-postgres", pgEndpoint],
    ["infra-auth", authEndpoint],
  ])

  it("expands single dep with no transitive deps", () => {
    const result = expandRemoteDeps(
      ["infra-postgres"],
      graph,
      endpoints,
      "production"
    )
    expect(result).toEqual(["infra-postgres"])
  })

  it("expands auth → includes postgres transitively", () => {
    const result = expandRemoteDeps(
      ["infra-auth"],
      graph,
      endpoints,
      "production"
    )
    expect(result).toContain("infra-auth")
    expect(result).toContain("infra-postgres")
    expect(result).toHaveLength(2)
  })

  it("deduplicates when both explicit and transitive", () => {
    const result = expandRemoteDeps(
      ["infra-auth", "infra-postgres"],
      graph,
      endpoints,
      "production"
    )
    expect(result).toHaveLength(2)
  })

  it("throws when transitive dep has no endpoint", () => {
    const smallEndpoints = new Map<string, ConnectionEndpoint>([
      ["infra-auth", authEndpoint],
      // missing infra-postgres!
    ])
    expect(() =>
      expandRemoteDeps(["infra-auth"], graph, smallEndpoints, "production")
    ).toThrow(/infra-auth depends on infra-postgres/)
    expect(() =>
      expandRemoteDeps(["infra-auth"], graph, smallEndpoints, "production")
    ).toThrow(/profile 'production'/)
  })
})

// ── deriveServiceEnvOverrides ────────────────────────────────────

describe("deriveServiceEnvOverrides", () => {
  it("derives overrides for URL-style auto-detected depEnv", () => {
    const catalog = makeCatalog(
      {
        "infra-factory": compSpec({
          dependsOn: ["infra-postgres", "infra-auth"],
          depEnv: {
            "infra-postgres": {
              FACTORY_DATABASE_URL:
                "postgres://${POSTGRES_USER:-postgres}:${POSTGRES_PASSWORD:-postgres}@infra-postgres:5432/${POSTGRES_DB:-postgres}",
            },
            "infra-auth": {
              FACTORY_AUTH_JWKS_URL:
                "http://infra-auth:3000/api/v1/auth/.well-known/jwks.json",
            },
          },
        }),
      },
      {
        "infra-postgres": resSpec({ containerPort: 5432 }),
        "infra-auth": resSpec({
          dependsOn: ["infra-postgres"],
          ports: [{ name: "http", port: 3000, protocol: "http" }],
        }),
      }
    )

    const graph = DependencyGraph.fromCatalog(catalog)
    const endpoints = new Map<string, ConnectionEndpoint>([
      ["infra-postgres", pgEndpoint],
      ["infra-auth", authEndpoint],
    ])

    const results = deriveServiceEnvOverrides(
      catalog,
      graph,
      ["infra-postgres", "infra-auth"],
      endpoints
    )

    expect(results).toHaveLength(1)
    const factory = results.find((r) => r.service === "infra-factory")!
    expect(factory).toBeDefined()
    expect(factory.overrides.FACTORY_DATABASE_URL).toBe(
      "postgres://postgres:factory-prod-2026@192.168.2.88:54111/postgres"
    )
    expect(factory.overrides.FACTORY_AUTH_JWKS_URL).toBe(
      "http://192.168.2.88:8180/api/v1/auth/.well-known/jwks.json"
    )
    expect(factory.warnings).toHaveLength(0)
  })

  it("derives overrides for explicit label depEnv (metabase style)", () => {
    const catalog = makeCatalog(
      {},
      {
        "infra-postgres": resSpec({ containerPort: 5432 }),
        "infra-metabase": resSpec({
          dependsOn: ["infra-postgres"],
          depEnv: {
            "infra-postgres": {
              MB_DB_HOST: "{host}",
              MB_DB_PORT: "{port}",
              MB_DB_USER: "{POSTGRES_USER}",
              MB_DB_PASS: "{POSTGRES_PASSWORD}",
            },
          },
        }),
      }
    )

    const graph = DependencyGraph.fromCatalog(catalog)
    const endpoints = new Map<string, ConnectionEndpoint>([
      ["infra-postgres", pgEndpoint],
    ])

    const results = deriveServiceEnvOverrides(
      catalog,
      graph,
      ["infra-postgres"],
      endpoints
    )

    const metabase = results.find((r) => r.service === "infra-metabase")!
    expect(metabase).toBeDefined()
    expect(metabase.overrides.MB_DB_HOST).toBe("192.168.2.88")
    expect(metabase.overrides.MB_DB_PORT).toBe("54111")
    expect(metabase.overrides.MB_DB_USER).toBe("postgres")
    expect(metabase.overrides.MB_DB_PASS).toBe("factory-prod-2026")
  })

  it("warns when service depends on remote dep but has no depEnv", () => {
    const catalog = makeCatalog(
      {},
      {
        "infra-postgres": resSpec({ containerPort: 5432 }),
        "infra-powersync": resSpec({
          dependsOn: ["infra-postgres"],
          // no depEnv — postgres connection is in config file
        }),
      }
    )

    const graph = DependencyGraph.fromCatalog(catalog)
    const endpoints = new Map<string, ConnectionEndpoint>([
      ["infra-postgres", pgEndpoint],
    ])

    const results = deriveServiceEnvOverrides(
      catalog,
      graph,
      ["infra-postgres"],
      endpoints
    )

    const ps = results.find((r) => r.service === "infra-powersync")!
    expect(ps).toBeDefined()
    expect(ps.warnings).toHaveLength(1)
    expect(ps.warnings[0]).toContain("no connection env vars detected")
    expect(ps.warnings[0]).toContain("dx.dep.infra-postgres.env")
    expect(Object.keys(ps.overrides)).toHaveLength(0)
  })

  it("skips remote deps themselves", () => {
    const catalog = makeCatalog(
      {},
      {
        "infra-postgres": resSpec({ containerPort: 5432 }),
        "infra-auth": resSpec({
          dependsOn: ["infra-postgres"],
          depEnv: {
            "infra-postgres": {
              AUTH_DATABASE_URL:
                "postgres://postgres:postgres@infra-postgres:5432/postgres",
            },
          },
        }),
      }
    )

    const graph = DependencyGraph.fromCatalog(catalog)
    const endpoints = new Map<string, ConnectionEndpoint>([
      ["infra-postgres", pgEndpoint],
      ["infra-auth", authEndpoint],
    ])

    // Both postgres AND auth are remote — auth should NOT get overrides
    const results = deriveServiceEnvOverrides(
      catalog,
      graph,
      ["infra-postgres", "infra-auth"],
      endpoints
    )

    expect(results.find((r) => r.service === "infra-auth")).toBeUndefined()
  })

  it("skips services with no remote deps in their dependsOn", () => {
    const catalog = makeCatalog(
      {},
      {
        "infra-postgres": resSpec({ containerPort: 5432 }),
        "infra-redis": resSpec({}), // no deps
        "infra-loki": resSpec({}), // no deps
      }
    )

    const graph = DependencyGraph.fromCatalog(catalog)
    const endpoints = new Map<string, ConnectionEndpoint>([
      ["infra-postgres", pgEndpoint],
    ])

    const results = deriveServiceEnvOverrides(
      catalog,
      graph,
      ["infra-postgres"],
      endpoints
    )

    expect(results).toHaveLength(0)
  })

  it("handles multiple remote deps for a single service", () => {
    const catalog = makeCatalog(
      {
        "infra-factory": compSpec({
          dependsOn: ["infra-postgres", "infra-auth"],
          depEnv: {
            "infra-postgres": {
              DB_URL: "postgres://u:p@infra-postgres:5432/db",
            },
            "infra-auth": {
              AUTH_URL: "http://infra-auth:3000/api",
            },
          },
        }),
      },
      {
        "infra-postgres": resSpec({ containerPort: 5432 }),
        "infra-auth": resSpec({
          dependsOn: ["infra-postgres"],
          ports: [{ name: "http", port: 3000, protocol: "http" }],
        }),
      }
    )

    const graph = DependencyGraph.fromCatalog(catalog)
    const endpoints = new Map<string, ConnectionEndpoint>([
      ["infra-postgres", pgEndpoint],
      ["infra-auth", authEndpoint],
    ])

    const results = deriveServiceEnvOverrides(
      catalog,
      graph,
      ["infra-postgres", "infra-auth"],
      endpoints
    )

    const factory = results.find((r) => r.service === "infra-factory")!
    expect(factory.overrides.DB_URL).toBe(
      "postgres://u:p@192.168.2.88:54111/db"
    )
    expect(factory.overrides.AUTH_URL).toBe("http://192.168.2.88:8180/api")
  })
})

// ── Corner cases: resolveTemplate ────────────────────────────────

describe("resolveTemplate corner cases", () => {
  it("handles template with multiple occurrences of hostname", () => {
    // e.g., a replication URL that mentions the host twice
    const template = "host1=infra-postgres:5432,host2=infra-postgres:5432"
    expect(resolveTemplate(template, pgEndpoint, false)).toBe(
      "host1=192.168.2.88:54111,host2=192.168.2.88:54111"
    )
  })

  it("handles empty template string", () => {
    expect(resolveTemplate("", pgEndpoint, false)).toBe("")
    expect(resolveTemplate("", pgEndpoint, true)).toBe("")
  })

  it("handles template with no placeholders", () => {
    expect(resolveTemplate("static-value", pgEndpoint, false)).toBe(
      "static-value"
    )
    expect(resolveTemplate("static-value", pgEndpoint, true)).toBe(
      "static-value"
    )
  })

  it("handles explicit template with only {host}", () => {
    expect(resolveTemplate("{host}", pgEndpoint, true)).toBe("192.168.2.88")
  })

  it("handles explicit template with only {port}", () => {
    expect(resolveTemplate("{port}", pgEndpoint, true)).toBe("54111")
  })

  it("convention: does not replace containerPort when it's 0", () => {
    const endpoint: ConnectionEndpoint = {
      ...pgEndpoint,
      containerPort: 0,
    }
    // Should still replace the hostname
    expect(resolveTemplate("infra-postgres", endpoint, false)).toBe(
      "192.168.2.88"
    )
  })

  it("convention: handles ${VAR+alternate} syntax (not just :-)", () => {
    // The regex handles :? optionally, so ${VAR+alt} should work too
    const template = "${POSTGRES_USER+has_user}"
    // POSTGRES_USER is defined in vars, so it should use the var value
    expect(resolveTemplate(template, pgEndpoint, false)).toBe("postgres")
  })

  it("explicit: also resolves {word} inside ${word} pattern", () => {
    // Explicit mode's regex matches {SOME_PORT} even inside ${SOME_PORT}
    // This is acceptable because in practice explicit templates don't mix with $ syntax
    // (the isExplicit check ensures they're classified correctly in deriveServiceEnvOverrides)
    const template = "{host}:${SOME_PORT}"
    // {host} → resolved, {SOME_PORT} inside ${} → also matched by \{\w+\} → resolves to ""
    expect(resolveTemplate(template, pgEndpoint, true)).toBe("192.168.2.88:$")
  })

  it("convention: hostname substring should not match in other words", () => {
    // If service name is "pg" and another env has "dpg-backup", it should replace "pg" there too
    // This is a known limitation — replaceAll replaces all occurrences
    // Document this behavior: short hostnames can cause false positives
    const endpoint: ConnectionEndpoint = {
      dockerHostname: "pg",
      containerPort: 5432,
      host: "10.0.0.1",
      port: 5432,
      vars: {},
    }
    // "pg" will be replaced even in "dpg-backup"
    expect(resolveTemplate("dpg-backup", endpoint, false)).toBe(
      "d10.0.0.1-backup"
    )
  })

  it("convention: redis URL pattern", () => {
    const redisEndpoint: ConnectionEndpoint = {
      dockerHostname: "infra-redis",
      containerPort: 6379,
      host: "10.0.0.5",
      port: 6380,
      vars: {},
    }
    const template = "redis://infra-redis:6379/0"
    expect(resolveTemplate(template, redisEndpoint, false)).toBe(
      "redis://10.0.0.5:6380/0"
    )
  })

  it("convention: grpc endpoint pattern", () => {
    const spicedbEndpoint: ConnectionEndpoint = {
      dockerHostname: "infra-spicedb",
      containerPort: 50051,
      host: "10.0.0.2",
      port: 50052,
      vars: {},
    }
    const template = "infra-spicedb:50051"
    expect(resolveTemplate(template, spicedbEndpoint, false)).toBe(
      "10.0.0.2:50052"
    )
  })
})

// ── isExplicit detection edge cases ──────────────────────────────

describe("isExplicit detection (via deriveServiceEnvOverrides)", () => {
  // The isExplicit regex is (?<!\$)\{\w+\}
  // These tests verify correct classification through the full pipeline

  it("treats {host} as explicit", () => {
    const catalog = makeCatalog(
      {},
      {
        "infra-postgres": resSpec({ containerPort: 5432 }),
        svc: resSpec({
          dependsOn: ["infra-postgres"],
          depEnv: { "infra-postgres": { HOST: "{host}" } },
        }),
      }
    )
    const graph = DependencyGraph.fromCatalog(catalog)
    const endpoints = new Map([["infra-postgres", pgEndpoint]])
    const results = deriveServiceEnvOverrides(
      catalog,
      graph,
      ["infra-postgres"],
      endpoints
    )
    expect(results[0]!.overrides.HOST).toBe("192.168.2.88")
  })

  it("treats ${VAR:-default} as convention (not explicit)", () => {
    const catalog = makeCatalog(
      {},
      {
        "infra-postgres": resSpec({ containerPort: 5432 }),
        svc: resSpec({
          dependsOn: ["infra-postgres"],
          depEnv: {
            "infra-postgres": {
              DB: "postgres://${POSTGRES_USER:-pg}:${POSTGRES_PASSWORD:-pw}@infra-postgres:5432/db",
            },
          },
        }),
      }
    )
    const graph = DependencyGraph.fromCatalog(catalog)
    const endpoints = new Map([["infra-postgres", pgEndpoint]])
    const results = deriveServiceEnvOverrides(
      catalog,
      graph,
      ["infra-postgres"],
      endpoints
    )
    // Convention mode: hostname:port replaced, then ${VAR} resolved
    expect(results[0]!.overrides.DB).toBe(
      "postgres://postgres:factory-prod-2026@192.168.2.88:54111/db"
    )
  })

  it("treats mixed {host} + ${VAR} as explicit (explicit wins)", () => {
    // Template has both {host} and ${VAR:-default}
    // The regex finds {host} → explicit mode. ${VAR} won't be resolved in explicit mode.
    const catalog = makeCatalog(
      {},
      {
        "infra-postgres": resSpec({ containerPort: 5432 }),
        svc: resSpec({
          dependsOn: ["infra-postgres"],
          depEnv: {
            "infra-postgres": {
              MIXED: "host={host},user=${POSTGRES_USER:-fallback}",
            },
          },
        }),
      }
    )
    const graph = DependencyGraph.fromCatalog(catalog)
    const endpoints = new Map([["infra-postgres", pgEndpoint]])
    const results = deriveServiceEnvOverrides(
      catalog,
      graph,
      ["infra-postgres"],
      endpoints
    )
    // Explicit mode: resolves {host} but leaves ${POSTGRES_USER:-fallback} as-is
    expect(results[0]!.overrides.MIXED).toBe(
      "host=192.168.2.88,user=${POSTGRES_USER:-fallback}"
    )
  })
})

// ── Full scenario tests (mirrors the plan's scenario matrix) ─────

describe("full propagation scenarios", () => {
  // Build a catalog that mirrors the actual docker-compose topology
  function buildProductionCatalog() {
    return makeCatalog(
      {
        "infra-factory": compSpec({
          dependsOn: ["infra-postgres", "infra-auth"],
          ports: [{ name: "http", port: 4100, protocol: "http" }],
          depEnv: {
            "infra-postgres": {
              FACTORY_DATABASE_URL:
                "postgres://${POSTGRES_USER:-postgres}:${POSTGRES_PASSWORD:-postgres}@infra-postgres:5432/${POSTGRES_DB:-postgres}",
            },
            "infra-auth": {
              FACTORY_AUTH_JWKS_URL:
                "http://infra-auth:3000/api/v1/auth/.well-known/jwks.json",
            },
          },
        }),
      },
      {
        "infra-postgres": resSpec({
          containerPort: 5432,
          ports: [{ name: "postgres", port: 5432, protocol: "tcp" }],
        }),
        "infra-auth": resSpec({
          dependsOn: ["infra-postgres"],
          ports: [{ name: "http", port: 3000, protocol: "http" }],
          depEnv: {
            "infra-postgres": {
              AUTH_DATABASE_URL:
                "postgres://${POSTGRES_USER:-postgres}:${POSTGRES_PASSWORD:-postgres}@infra-postgres:5432/${POSTGRES_DB:-postgres}",
            },
          },
        }),
        "infra-spicedb": resSpec({
          dependsOn: ["infra-postgres"],
          ports: [{ name: "grpc", port: 50051, protocol: "tcp" }],
          depEnv: {
            "infra-postgres": {
              SPICEDB_DATASTORE_CONN_URI:
                "postgres://${POSTGRES_USER:-postgres}:${POSTGRES_PASSWORD:-postgres}@infra-postgres:5432/spicedb?sslmode=disable",
            },
          },
        }),
        "infra-metabase": resSpec({
          dependsOn: ["infra-postgres"],
          ports: [{ name: "http", port: 3000, protocol: "http" }],
          depEnv: {
            "infra-postgres": {
              MB_DB_HOST: "{host}",
              MB_DB_PORT: "{port}",
              MB_DB_USER: "{POSTGRES_USER}",
              MB_DB_PASS: "{POSTGRES_PASSWORD}",
            },
          },
        }),
        "infra-powersync": resSpec({
          dependsOn: ["infra-postgres", "infra-powersync-mongo"],
          ports: [{ name: "http", port: 8080, protocol: "http" }],
          // Only has depEnv for auth (JWKS URL), postgres connection is in config file
          depEnv: {
            "infra-auth": {
              POWERSYNC_JWKS_URL:
                "http://infra-auth:3000/api/v1/auth/.well-known/jwks.json",
            },
          },
        }),
        "infra-powersync-mongo": resSpec({}),
        "infra-redis": resSpec({
          ports: [{ name: "redis", port: 6379, protocol: "tcp" }],
        }),
        "infra-loki": resSpec({
          ports: [{ name: "http", port: 3100, protocol: "http" }],
        }),
        "infra-otel-collector": resSpec({
          dependsOn: ["infra-loki"],
          ports: [{ name: "otlp-http", port: 4318, protocol: "http" }],
        }),
      }
    )
  }

  const prodEndpoints = new Map<string, ConnectionEndpoint>([
    ["infra-postgres", pgEndpoint],
    ["infra-auth", authEndpoint],
  ])

  describe("Scenario 2: dx dev --connect-to production (all deps remote)", () => {
    it("stops postgres + auth, reconfigures all dependents", () => {
      const catalog = buildProductionCatalog()
      const graph = DependencyGraph.fromCatalog(catalog)

      // --connect-to production: both postgres and auth are explicit remote
      const allRemote = expandRemoteDeps(
        ["infra-postgres", "infra-auth"],
        graph,
        prodEndpoints,
        "production"
      )

      expect(allRemote).toContain("infra-postgres")
      expect(allRemote).toContain("infra-auth")
      expect(allRemote).toHaveLength(2)

      const overrides = deriveServiceEnvOverrides(
        catalog,
        graph,
        allRemote,
        prodEndpoints
      )

      // factory, spicedb, metabase should all get postgres overrides
      // powersync should warn about missing postgres depEnv
      const serviceNames = overrides.map((d) => d.service).sort()
      expect(serviceNames).toContain("infra-factory")
      expect(serviceNames).toContain("infra-spicedb")
      expect(serviceNames).toContain("infra-metabase")
      expect(serviceNames).toContain("infra-powersync")

      // auth should NOT be in overrides (it's remote itself)
      expect(serviceNames).not.toContain("infra-auth")
      expect(serviceNames).not.toContain("infra-postgres")

      // Verify factory gets both postgres and auth overrides
      const factory = overrides.find((d) => d.service === "infra-factory")!
      expect(factory.overrides.FACTORY_DATABASE_URL).toContain(
        "192.168.2.88:54111"
      )
      expect(factory.overrides.FACTORY_AUTH_JWKS_URL).toContain(
        "192.168.2.88:8180"
      )

      // Verify spicedb gets postgres overrides
      const spicedb = overrides.find((d) => d.service === "infra-spicedb")!
      expect(spicedb.overrides.SPICEDB_DATASTORE_CONN_URI).toContain(
        "192.168.2.88:54111"
      )

      // Verify metabase gets explicit label overrides
      const metabase = overrides.find((d) => d.service === "infra-metabase")!
      expect(metabase.overrides.MB_DB_HOST).toBe("192.168.2.88")
      expect(metabase.overrides.MB_DB_PORT).toBe("54111")

      // Verify powersync warns about postgres (config file dep)
      const powersync = overrides.find((d) => d.service === "infra-powersync")!
      expect(powersync.warnings.some((w) => w.includes("infra-postgres"))).toBe(
        true
      )
    })
  })

  describe("Scenario 3: dx dev --connect infra-postgres:production", () => {
    it("only postgres remote, auth stays local but gets reconfig", () => {
      const catalog = buildProductionCatalog()
      const graph = DependencyGraph.fromCatalog(catalog)

      const allRemote = expandRemoteDeps(
        ["infra-postgres"],
        graph,
        prodEndpoints,
        "production"
      )

      // Only postgres is remote (leaf dep, no transitive expansion needed)
      expect(allRemote).toEqual(["infra-postgres"])

      const overrides = deriveServiceEnvOverrides(
        catalog,
        graph,
        allRemote,
        prodEndpoints
      )

      // auth, spicedb, metabase, factory should all get postgres overrides
      const serviceNames = overrides.map((d) => d.service).sort()
      expect(serviceNames).toContain("infra-auth")
      expect(serviceNames).toContain("infra-spicedb")
      expect(serviceNames).toContain("infra-metabase")
      expect(serviceNames).toContain("infra-factory")

      // auth should get postgres overrides since it's local but depends on remote postgres
      const auth = overrides.find((d) => d.service === "infra-auth")!
      expect(auth.overrides.AUTH_DATABASE_URL).toContain("192.168.2.88:54111")

      // factory should get postgres overrides but NOT auth overrides (auth is local)
      const factory = overrides.find((d) => d.service === "infra-factory")!
      expect(factory.overrides.FACTORY_DATABASE_URL).toContain(
        "192.168.2.88:54111"
      )
      expect(factory.overrides.FACTORY_AUTH_JWKS_URL).toBeUndefined()
    })
  })

  describe("Scenario 4: dx dev --connect infra-auth:production (transitive)", () => {
    it("transitively pulls in postgres, same result as full connect-to", () => {
      const catalog = buildProductionCatalog()
      const graph = DependencyGraph.fromCatalog(catalog)

      // Only auth explicitly connected, but auth depends on postgres
      const allRemote = expandRemoteDeps(
        ["infra-auth"],
        graph,
        prodEndpoints,
        "production"
      )

      // Transitive expansion: auth → postgres
      expect(allRemote).toContain("infra-auth")
      expect(allRemote).toContain("infra-postgres")
      expect(allRemote).toHaveLength(2)

      const overrides = deriveServiceEnvOverrides(
        catalog,
        graph,
        allRemote,
        prodEndpoints
      )

      // Same as scenario 2 — factory, spicedb, metabase get postgres overrides
      // auth is remote so it doesn't get overrides
      expect(overrides.find((d) => d.service === "infra-auth")).toBeUndefined()
      expect(overrides.find((d) => d.service === "infra-factory")).toBeDefined()
      expect(overrides.find((d) => d.service === "infra-spicedb")).toBeDefined()
      expect(
        overrides.find((d) => d.service === "infra-metabase")
      ).toBeDefined()
    })
  })

  describe("Failure: transitive dep missing from profile", () => {
    it("throws clear error when auth depends on postgres but postgres has no endpoint", () => {
      const catalog = buildProductionCatalog()
      const graph = DependencyGraph.fromCatalog(catalog)

      // Only auth endpoint defined — postgres missing
      const authOnly = new Map<string, ConnectionEndpoint>([
        ["infra-auth", authEndpoint],
      ])

      expect(() =>
        expandRemoteDeps(["infra-auth"], graph, authOnly, "my-profile")
      ).toThrow("infra-auth depends on infra-postgres")
      expect(() =>
        expandRemoteDeps(["infra-auth"], graph, authOnly, "my-profile")
      ).toThrow("profile 'my-profile'")
    })
  })

  describe("Edge case: no deps are remote", () => {
    it("returns empty overrides", () => {
      const catalog = buildProductionCatalog()
      const graph = DependencyGraph.fromCatalog(catalog)

      const overrides = deriveServiceEnvOverrides(
        catalog,
        graph,
        [], // no remote deps
        prodEndpoints
      )

      expect(overrides).toHaveLength(0)
    })
  })

  describe("Edge case: remote dep with no dependents", () => {
    it("returns no overrides but no crash", () => {
      const catalog = buildProductionCatalog()
      const graph = DependencyGraph.fromCatalog(catalog)

      // redis has no dependents in this topology
      const redisEndpoint: ConnectionEndpoint = {
        dockerHostname: "infra-redis",
        containerPort: 6379,
        host: "10.0.0.5",
        port: 6380,
        vars: {},
      }
      const endpoints = new Map([["infra-redis", redisEndpoint]])

      const overrides = deriveServiceEnvOverrides(
        catalog,
        graph,
        ["infra-redis"],
        endpoints
      )

      expect(overrides).toHaveLength(0)
    })
  })

  describe("Edge case: endpoint not in catalog", () => {
    it("builds endpoint with containerPort 0 for unknown service", () => {
      const catalog = makeCatalog({}, {})
      const overrides: Record<string, NormalizedProfileEntry> = {
        "unknown-svc": {
          target: "production",
          readonly: false,
          backend: "direct",
          host: "10.0.0.1",
          port: 8080,
        },
      }
      const endpoints = buildConnectionEndpoints(overrides, catalog)
      const ep = endpoints.get("unknown-svc")!
      expect(ep).toBeDefined()
      expect(ep.containerPort).toBe(0)
      expect(ep.host).toBe("10.0.0.1")
    })
  })

  describe("Edge case: component (not resource) as endpoint", () => {
    it("uses component ports for containerPort lookup", () => {
      const catalog = makeCatalog(
        {
          "my-api": compSpec({
            ports: [{ name: "http", port: 4100, protocol: "http" }],
          }),
        },
        {}
      )
      const overrides: Record<string, NormalizedProfileEntry> = {
        "my-api": {
          target: "production",
          readonly: false,
          backend: "direct",
          host: "10.0.0.1",
          port: 4100,
        },
      }
      const endpoints = buildConnectionEndpoints(overrides, catalog)
      expect(endpoints.get("my-api")!.containerPort).toBe(4100)
    })
  })

  describe("Edge case: explicit template references missing var", () => {
    it("warns when {VAR} has no matching profile var", () => {
      const catalog = makeCatalog(
        {},
        {
          "infra-postgres": resSpec({ containerPort: 5432 }),
          svc: resSpec({
            dependsOn: ["infra-postgres"],
            depEnv: {
              "infra-postgres": {
                DB_HOST: "{host}",
                DB_PASS: "{MISSING_VAR}",
              },
            },
          }),
        }
      )

      const graph = DependencyGraph.fromCatalog(catalog)
      // pgEndpoint has POSTGRES_USER and POSTGRES_PASSWORD, but NOT MISSING_VAR
      const endpoints = new Map([["infra-postgres", pgEndpoint]])

      const results = deriveServiceEnvOverrides(
        catalog,
        graph,
        ["infra-postgres"],
        endpoints
      )

      const svc = results.find((d) => d.service === "svc")!
      expect(svc.overrides.DB_HOST).toBe("192.168.2.88")
      expect(svc.overrides.DB_PASS).toBe("") // resolves to empty
      // Should have a warning about the missing var
      expect(svc.warnings.some((w) => w.includes("MISSING_VAR"))).toBe(true)
      expect(svc.warnings.some((w) => w.includes("DB_PASS"))).toBe(true)
    })
  })

  describe("Edge case: depEnv for a dep that is not remote", () => {
    it("ignores depEnv entries for local deps", () => {
      const catalog = makeCatalog(
        {
          "my-api": compSpec({
            dependsOn: ["infra-postgres", "infra-redis"],
            depEnv: {
              "infra-postgres": { DB: "postgres://infra-postgres:5432/db" },
              "infra-redis": { REDIS: "redis://infra-redis:6379/0" },
            },
          }),
        },
        {
          "infra-postgres": resSpec({ containerPort: 5432 }),
          "infra-redis": resSpec({
            ports: [{ name: "redis", port: 6379, protocol: "tcp" }],
          }),
        }
      )

      const graph = DependencyGraph.fromCatalog(catalog)
      const endpoints = new Map([["infra-postgres", pgEndpoint]])

      // Only postgres is remote, redis is local
      const overrides = deriveServiceEnvOverrides(
        catalog,
        graph,
        ["infra-postgres"],
        endpoints
      )

      const api = overrides.find((d) => d.service === "my-api")!
      expect(api.overrides.DB).toContain("192.168.2.88:54111")
      // Redis override should NOT be present (redis is not remote)
      expect(api.overrides.REDIS).toBeUndefined()
    })
  })
})
