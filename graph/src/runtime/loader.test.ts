import { describe, expect, it, mock } from "bun:test"
import { Effect } from "effect"
import { makeCustomerLoader } from "./loader"

describe("makeCustomerLoader", () => {
  it("loads object_type rows into EntityIR, reading non-column fields from metadata", async () => {
    const fakeDb = {
      select: mock().mockReturnValue({
        from: mock().mockReturnThis(),
        where: mock().mockResolvedValue([
          {
            id: "ot_1",
            graphId: "g_smart",
            kind: "customer_segment",
            specSchema: { type: "object" },
            statusSchema: null,
            annotations: null,
            traits: [],
            access: null,
            metadata: {
              namespace: "commerce",
              prefix: "seg",
              plural: "customer_segments",
              description: "Customer segmentation bucket",
              bitemporal: true,
              reconciliation: false,
              links: { team: { cardinality: "many-to-one", target: "team" } },
            },
          },
        ]),
      }),
    }
    const loader = makeCustomerLoader({
      db: fakeDb as any,
      tables: { objectType: { graphId: "graph_id" } as any },
    })
    const result = await Effect.runPromise(loader("g_smart"))
    const seg = result.objectTypes.customer_segment
    expect(seg).toBeDefined()
    expect(seg?.namespace).toBe("commerce")
    expect(seg?.prefix).toBe("seg")
    expect(seg?.plural).toBe("customer_segments")
    expect(seg?.description).toBe("Customer segmentation bucket")
    expect(seg?.bitemporal).toBe(true)
    expect(seg?.schemas.spec).toEqual({ type: "object" })
    expect(seg?.links.team?.target).toBe("team")
  })

  it("falls back to defaults for fields missing from metadata", async () => {
    const fakeDb = {
      select: mock().mockReturnValue({
        from: mock().mockReturnThis(),
        where: mock().mockResolvedValue([
          {
            id: "ot_2",
            graphId: "g_min",
            kind: "tag",
            specSchema: {},
            statusSchema: null,
            annotations: null,
            traits: null,
            access: null,
            metadata: null,
          },
        ]),
      }),
    }
    const loader = makeCustomerLoader({
      db: fakeDb as any,
      tables: { objectType: {} as any },
    })
    const result = await Effect.runPromise(loader("g_min"))
    const tag = result.objectTypes.tag
    expect(tag?.namespace).toBe("customer")
    expect(tag?.prefix).toBe("tag")
    expect(tag?.plural).toBe("tags")
    expect(tag?.bitemporal).toBe(false)
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
