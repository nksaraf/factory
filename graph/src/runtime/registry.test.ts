import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import { z } from "zod"
import { compileGraph, defineEntity } from "../schema/index"
import { makeGraphRegistry } from "./registry"

const base = compileGraph([
  defineEntity("host", {
    namespace: "infra",
    prefix: "host",
    spec: z.object({}),
  }),
])

describe("GraphRegistry", () => {
  it("returns base IR with no customer entities", async () => {
    const registry = makeGraphRegistry({
      base,
      loadCustomer: () => Effect.succeed({ objectTypes: {} }),
    })
    const ir = await Effect.runPromise(registry.forGraph("g_test"))
    expect(Object.keys(ir.entities)).toEqual(["host"])
  })

  it("merges customer entities into the base IR", async () => {
    const segment = compileGraph([
      defineEntity("segment", {
        namespace: "commerce",
        prefix: "seg",
        spec: z.object({}),
      }),
    ]).entities.segment

    const registry = makeGraphRegistry({
      base,
      loadCustomer: () => Effect.succeed({ objectTypes: { segment } }),
    })
    const ir = await Effect.runPromise(registry.forGraph("g_smart"))
    expect(Object.keys(ir.entities).sort()).toEqual(["host", "segment"])
    expect(ir.namespaces.commerce?.entityKinds).toEqual(["segment"])
  })

  it("caches per graph_id, invalidate drops the cache", async () => {
    let loadCalls = 0
    const registry = makeGraphRegistry({
      base,
      loadCustomer: () => {
        loadCalls++
        return Effect.succeed({ objectTypes: {} })
      },
    })
    await Effect.runPromise(registry.forGraph("g_a"))
    await Effect.runPromise(registry.forGraph("g_a"))
    expect(loadCalls).toBe(1)

    await Effect.runPromise(registry.invalidate("g_a"))
    await Effect.runPromise(registry.forGraph("g_a"))
    expect(loadCalls).toBe(2)
  })

  it("rejects customer redefining a base entity kind", async () => {
    const badHost = compileGraph([
      defineEntity("host", {
        namespace: "infra",
        prefix: "host",
        spec: z.object({ evil: z.boolean() }),
      }),
    ]).entities.host

    const registry = makeGraphRegistry({
      base,
      loadCustomer: () => Effect.succeed({ objectTypes: { host: badHost } }),
    })
    const result = await Effect.runPromise(
      Effect.either(registry.forGraph("g_x"))
    )
    expect(result._tag).toBe("Left")
  })
})
