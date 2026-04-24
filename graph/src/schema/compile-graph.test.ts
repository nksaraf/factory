import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { defineEntity } from "./entity"
import { compileGraph } from "./entity"

const Host = defineEntity("host", {
  namespace: "infra",
  prefix: "host",
  spec: z.object({ hostname: z.string() }),
})

const Site = defineEntity("site", {
  namespace: "ops",
  prefix: "site",
  spec: z.object({}),
})

const Segment = defineEntity("segment", {
  namespace: "commerce",
  prefix: "seg",
  spec: z.object({ priority: z.string() }),
})

describe("compileGraph with extends", () => {
  test("child inherits entities + namespaces from parent", () => {
    const parent = compileGraph([Host, Site])
    const child = compileGraph([Segment], { extends: parent })

    expect(Object.keys(child.entities).sort()).toEqual([
      "host",
      "segment",
      "site",
    ])
    expect(Object.keys(child.namespaces).sort()).toEqual([
      "commerce",
      "infra",
      "ops",
    ])
    expect(child.namespaces.infra?.entityKinds).toEqual(["host"])
    expect(child.namespaces.commerce?.entityKinds).toEqual(["segment"])
  })

  test("child redefining a parent kind throws", () => {
    const parent = compileGraph([Host])
    const SecondHost = defineEntity("host", {
      namespace: "infra",
      prefix: "host",
      spec: z.object({}),
    })
    expect(() => compileGraph([SecondHost], { extends: parent })).toThrow(
      /already defined in the parent graph/
    )
  })

  test("child with duplicate kind within its own entities throws", () => {
    const A = defineEntity("foo", {
      namespace: "x",
      prefix: "foo",
      spec: z.object({}),
    })
    const B = defineEntity("foo", {
      namespace: "x",
      prefix: "foo",
      spec: z.object({}),
    })
    expect(() => compileGraph([A, B])).toThrow(/duplicate entity kind/)
  })
})
