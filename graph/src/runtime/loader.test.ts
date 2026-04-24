import { describe, expect, it, mock } from "bun:test"
import { Effect } from "effect"
import { makeCustomerLoader } from "./loader"

describe("makeCustomerLoader", () => {
  it("loads object_type rows into EntityIR indexed by kind", async () => {
    const fakeDb = {
      select: mock().mockReturnValue({
        from: mock().mockReturnThis(),
        where: mock().mockResolvedValue([
          {
            id: "ot_1",
            graphId: "g_smart",
            kind: "customer_segment",
            namespace: "commerce",
            prefix: "seg",
            specSchema: { type: "object" },
            statusSchema: null,
            annotations: null,
            traits: [],
            links: {},
            access: null,
          },
        ]),
      }),
    }
    const loader = makeCustomerLoader({
      db: fakeDb as any,
      tables: { objectType: { graphId: "graph_id" } as any },
    })
    const result = await Effect.runPromise(loader("g_smart"))
    expect(Object.keys(result.objectTypes)).toEqual(["customer_segment"])
    expect(result.objectTypes.customer_segment?.namespace).toBe("commerce")
    expect(result.objectTypes.customer_segment?.schemas.spec).toEqual({
      type: "object",
    })
  })

  it("returns empty map when no rows match", async () => {
    const fakeDb = {
      select: mock().mockReturnValue({
        from: mock().mockReturnThis(),
        where: mock().mockResolvedValue([]),
      }),
    }
    const loader = makeCustomerLoader({
      db: fakeDb as any,
      tables: { objectType: {} as any },
    })
    const result = await Effect.runPromise(loader("g_empty"))
    expect(result.objectTypes).toEqual({})
  })
})
