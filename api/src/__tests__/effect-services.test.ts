/**
 * Tests for the Effect Graph, Secrets, and SpecResolver services
 * against an in-memory PGlite database.
 *
 * Uses the same pattern as effect-db-layer.test.ts:
 *   - createMigratedTestPglite() in beforeAll
 *   - createAppLayer(db) for the full service stack
 *   - run()/runExit() helpers to provide the layer
 */

import { describe, it, expect, beforeAll } from "bun:test"
import { Effect, Exit, Cause, Option } from "effect"
import type { PGlite } from "@electric-sql/pglite"

import type { Database } from "../db/connection"
import { createMigratedTestPglite } from "../test-helpers"
import { newId } from "../lib/id"
import { createAppLayer, type AppLayer } from "../effect/runtime"
import { Graph } from "../effect/services/graph"
import { Secrets } from "../effect/services/secrets"
import { SpecResolver } from "../effect/services/spec-resolver"
import { Db, query } from "../effect"
import { team } from "../db/schema/org"
import { estate } from "../db/schema/infra"
import { configVar } from "../db/schema/org"

let client: PGlite
let db: Database
let appLayer: ReturnType<typeof createAppLayer>

beforeAll(async () => {
  const ctx = await createMigratedTestPglite()
  client = ctx.client
  db = ctx.db as unknown as Database
  appLayer = createAppLayer(db)
})

function run<A, E>(effect: Effect.Effect<A, E, AppLayer>) {
  return Effect.runPromise(Effect.provide(effect, appLayer))
}

function runExit<A, E>(effect: Effect.Effect<A, E, AppLayer>) {
  return Effect.runPromiseExit(Effect.provide(effect, appLayer))
}

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

describe("Graph", () => {
  describe("team (org domain)", () => {
    it("get(slug) — returns a team by slug", async () => {
      const slug = `ont-slug-${Date.now()}`
      const id = newId("team")

      // Insert via raw Db layer so Graph reads it back
      await run(
        Effect.gen(function* () {
          const db = yield* Db
          yield* query(
            db.insert(team).values({
              id,
              slug,
              name: "Graph Team Slug",
              type: "team",
            })
          )
        })
      )

      const result = await run(
        Effect.gen(function* () {
          const graph = yield* Graph
          return yield* graph.team.get(slug)
        })
      )

      expect(result.slug).toBe(slug)
      expect(result.id).toBe(id)
      expect(result.name).toBe("Graph Team Slug")
    })

    it("get(id) — returns a team by ID", async () => {
      const slug = `ont-id-${Date.now()}`
      const id = newId("team")

      await run(
        Effect.gen(function* () {
          const db = yield* Db
          yield* query(
            db.insert(team).values({
              id,
              slug,
              name: "Graph Team ID",
              type: "team",
            })
          )
        })
      )

      const result = await run(
        Effect.gen(function* () {
          const graph = yield* Graph
          return yield* graph.team.get(id)
        })
      )

      expect(result.id).toBe(id)
      expect(result.slug).toBe(slug)
    })

    it("get(nonexistent) — fails with EntityNotFoundError", async () => {
      const exit = await runExit(
        Effect.gen(function* () {
          const graph = yield* Graph
          return yield* graph.team.get("nonexistent-team-xyz")
        })
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause)
        expect(Option.isSome(failure)).toBe(true)
        if (Option.isSome(failure)) {
          expect(failure.value._tag).toBe("EntityNotFoundError")
        }
      }
    })

    it("find(nonexistent) — returns null without error", async () => {
      const result = await run(
        Effect.gen(function* () {
          const graph = yield* Graph
          return yield* graph.team.find("nonexistent-team-find-xyz")
        })
      )

      expect(result).toBeNull()
    })

    it("list() — returns all teams", async () => {
      const prefix = `ont-list-${Date.now()}`
      const slugs = [`${prefix}-a`, `${prefix}-b`, `${prefix}-c`]

      await run(
        Effect.gen(function* () {
          const db = yield* Db
          for (const slug of slugs) {
            yield* query(
              db.insert(team).values({
                id: newId("team"),
                slug,
                name: `Team ${slug}`,
                type: "team",
              })
            )
          }
        })
      )

      const result = await run(
        Effect.gen(function* () {
          const graph = yield* Graph
          return yield* graph.team.list()
        })
      )

      // Should contain at least the 3 we inserted (plus any from other tests)
      const resultSlugs = result.map((r) => r.slug)
      for (const slug of slugs) {
        expect(resultSlugs).toContain(slug)
      }
    })

    it("list({ limit: 2 }) — respects pagination", async () => {
      const result = await run(
        Effect.gen(function* () {
          const graph = yield* Graph
          return yield* graph.team.list({ limit: 2 })
        })
      )

      expect(result.length).toBeLessThanOrEqual(2)
    })
  })

  describe("estate (infra domain)", () => {
    it("get(slug) — cross-domain entity access works", async () => {
      const slug = `ont-estate-${Date.now()}`
      const id = newId("est")

      await run(
        Effect.gen(function* () {
          const db = yield* Db
          yield* query(
            db.insert(estate).values({
              id,
              slug,
              name: "Test Estate",
              type: "cloud",
              spec: {},
            })
          )
        })
      )

      const result = await run(
        Effect.gen(function* () {
          const graph = yield* Graph
          return yield* graph.estate.get(slug)
        })
      )

      expect(result.slug).toBe(slug)
      expect(result.id).toBe(id)
      expect(result.name).toBe("Test Estate")
    })
  })

  describe("dynamic get(kind, slugOrId)", () => {
    it("resolves a team by kind string", async () => {
      const slug = `ont-dynamic-${Date.now()}`
      const id = newId("team")

      await run(
        Effect.gen(function* () {
          const db = yield* Db
          yield* query(
            db.insert(team).values({
              id,
              slug,
              name: "Dynamic Team",
              type: "team",
            })
          )
        })
      )

      const result = await run(
        Effect.gen(function* () {
          const graph = yield* Graph
          return yield* graph.get("team", slug)
        })
      )

      expect((result as any).slug).toBe(slug)
      expect((result as any).id).toBe(id)
    })

    it("fails with EntityNotFoundError for unknown kind", async () => {
      const exit = await runExit(
        Effect.gen(function* () {
          const graph = yield* Graph
          return yield* graph.get("nonexistent-kind", "x")
        })
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause)
        expect(Option.isSome(failure)).toBe(true)
        if (Option.isSome(failure)) {
          expect(failure.value._tag).toBe("EntityNotFoundError")
        }
      }
    })
  })
})

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

describe("Secrets", () => {
  it("set() + get() — stores and retrieves a secret", async () => {
    const key = `test-secret-${Date.now()}`

    await run(
      Effect.gen(function* () {
        const secrets = yield* Secrets
        yield* secrets.set({
          key,
          value: "super-secret-value",
          scopeType: "org",
          scopeId: "default",
        })
      })
    )

    const result = await run(
      Effect.gen(function* () {
        const secrets = yield* Secrets
        return yield* secrets.get({
          key,
          scopeType: "org",
          scopeId: "default",
        })
      })
    )

    expect(result).toBe("super-secret-value")
  })

  it("get() on nonexistent key — returns null", async () => {
    const result = await run(
      Effect.gen(function* () {
        const secrets = yield* Secrets
        return yield* secrets.get({
          key: `nonexistent-secret-${Date.now()}`,
          scopeType: "org",
          scopeId: "default",
        })
      })
    )

    expect(result).toBeNull()
  })

  it("list() — returns stored secret metadata", async () => {
    const prefix = `list-sec-${Date.now()}`
    const keys = [`${prefix}-a`, `${prefix}-b`, `${prefix}-c`]

    await run(
      Effect.gen(function* () {
        const secrets = yield* Secrets
        for (const key of keys) {
          yield* secrets.set({
            key,
            value: `value-${key}`,
            scopeType: "org",
            scopeId: "default",
          })
        }
      })
    )

    const result = await run(
      Effect.gen(function* () {
        const secrets = yield* Secrets
        return yield* secrets.list({
          scopeType: "org",
          scopeId: "default",
        })
      })
    )

    const resultKeys = result.map((e) => e.key)
    for (const key of keys) {
      expect(resultKeys).toContain(key)
    }
  })

  it("remove() — deletes a secret so get() returns null", async () => {
    const key = `remove-sec-${Date.now()}`

    await run(
      Effect.gen(function* () {
        const secrets = yield* Secrets
        yield* secrets.set({
          key,
          value: "to-be-removed",
          scopeType: "org",
          scopeId: "default",
        })
      })
    )

    // Verify it exists first
    const before = await run(
      Effect.gen(function* () {
        const secrets = yield* Secrets
        return yield* secrets.get({
          key,
          scopeType: "org",
          scopeId: "default",
        })
      })
    )
    expect(before).toBe("to-be-removed")

    // Remove it
    const removed = await run(
      Effect.gen(function* () {
        const secrets = yield* Secrets
        return yield* secrets.remove({
          key,
          scopeType: "org",
          scopeId: "default",
        })
      })
    )
    expect(removed).toBe(true)

    // Verify it's gone
    const after = await run(
      Effect.gen(function* () {
        const secrets = yield* Secrets
        return yield* secrets.get({
          key,
          scopeType: "org",
          scopeId: "default",
        })
      })
    )
    expect(after).toBeNull()
  })

  it("resolve() — resolves secrets with scope precedence", async () => {
    const teamId = newId("team")
    const prefix = `resolve-${Date.now()}`
    const key1 = `${prefix}-org`
    const key2 = `${prefix}-team`

    // Insert team row for FK constraints (if needed by resolve)
    await run(
      Effect.gen(function* () {
        const db = yield* Db
        yield* query(
          db.insert(team).values({
            id: teamId,
            slug: `resolve-team-${Date.now()}`,
            name: "Resolve Team",
            type: "team",
          })
        )
      })
    )

    // Set org-scoped and team-scoped secrets
    await run(
      Effect.gen(function* () {
        const secrets = yield* Secrets
        yield* secrets.set({
          key: key1,
          value: "org-level-secret",
          scopeType: "org",
          scopeId: "default",
        })
        yield* secrets.set({
          key: key2,
          value: "team-level-secret",
          scopeType: "team",
          scopeId: teamId,
        })
      })
    )

    // Resolve for the team scope — should see team-scoped secrets
    const result = await run(
      Effect.gen(function* () {
        const secrets = yield* Secrets
        return yield* secrets.resolve({ teamId })
      })
    )

    // At minimum, team-scoped secret should appear
    const resultKeys = result.map((e) => e.key)
    expect(resultKeys).toContain(key2)
  })
})

// ---------------------------------------------------------------------------
// SpecResolver
// ---------------------------------------------------------------------------

describe("SpecResolver", () => {
  it("resolve() — passthrough for non-ref values", async () => {
    const result = await run(
      Effect.gen(function* () {
        const specResolver = yield* SpecResolver
        return yield* specResolver.resolve({
          plain: "value",
          count: 42,
          flag: true,
        })
      })
    )

    expect(result.plain).toBe("value")
    expect(result.count).toBe(42)
    expect(result.flag).toBe(true)
  })

  it("resolve() — resolves $secret() references", async () => {
    const key = `spec-secret-${Date.now()}`

    // Store the secret first
    await run(
      Effect.gen(function* () {
        const secrets = yield* Secrets
        yield* secrets.set({
          key,
          value: "resolved-token-value",
          scopeType: "org",
          scopeId: "default",
        })
      })
    )

    const result = await run(
      Effect.gen(function* () {
        const specResolver = yield* SpecResolver
        return yield* specResolver.resolve({
          token: `$secret(${key})`,
        })
      })
    )

    expect(result.token).toBe("resolved-token-value")
  })

  it("resolve() — mixed plain and $secret() values", async () => {
    const key = `spec-mixed-${Date.now()}`

    await run(
      Effect.gen(function* () {
        const secrets = yield* Secrets
        yield* secrets.set({
          key,
          value: "mixed-secret-value",
          scopeType: "org",
          scopeId: "default",
        })
      })
    )

    const result = await run(
      Effect.gen(function* () {
        const specResolver = yield* SpecResolver
        return yield* specResolver.resolve({
          host: "example.com",
          token: `$secret(${key})`,
          port: 443,
        })
      })
    )

    expect(result.host).toBe("example.com")
    expect(result.token).toBe("mixed-secret-value")
    expect(result.port).toBe(443)
  })

  it("resolve() — unresolvable $secret() becomes null", async () => {
    const result = await run(
      Effect.gen(function* () {
        const specResolver = yield* SpecResolver
        return yield* specResolver.resolve({
          missing: `$secret(nonexistent-key-${Date.now()})`,
        })
      })
    )

    expect(result.missing).toBeNull()
  })

  it("resolve() — resolves $var() references from config_var table", async () => {
    const varSlug = `spec-var-${Date.now()}`

    // Insert a config var directly
    await run(
      Effect.gen(function* () {
        const db = yield* Db
        yield* query(
          db.insert(configVar).values({
            id: newId("cvar"),
            slug: varSlug,
            name: `Test Var ${varSlug}`,
            scopeType: "org",
            scopeId: "default",
            value: "config-var-value",
          })
        )
      })
    )

    const result = await run(
      Effect.gen(function* () {
        const specResolver = yield* SpecResolver
        return yield* specResolver.resolve(
          { endpoint: `$var(${varSlug})` },
          { scopeType: "org", scopeId: "default" }
        )
      })
    )

    expect(result.endpoint).toBe("config-var-value")
  })

  it("resolve() — unresolvable $var() becomes null", async () => {
    const result = await run(
      Effect.gen(function* () {
        const specResolver = yield* SpecResolver
        return yield* specResolver.resolve({
          endpoint: `$var(nonexistent-var-${Date.now()})`,
        })
      })
    )

    expect(result.endpoint).toBeNull()
  })
})
