import { describe, expect, it, mock } from "bun:test"
import { Effect } from "effect"
import { makePostgresDynamicAdapter } from "./index"

describe("postgres-dynamic adapter", () => {
  it("reads instance rows filtered by graphId + kind", async () => {
    const fakeDb = {
      select: mock().mockReturnValue({
        from: mock().mockReturnThis(),
        where: mock().mockReturnThis(),
        limit: mock().mockResolvedValue([
          {
            id: "inst_1",
            graphId: "g_smart",
            kind: "customer_segment",
            slug: "vip",
            title: "VIP",
            spec: { priority: "high" },
            status: null,
            metadata: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
      }),
    }
    const adapter = makePostgresDynamicAdapter({
      db: fakeDb as any,
      tables: { instance: {} as any, link: {} as any },
    })
    const row = await Effect.runPromise(
      adapter.get("customer_segment", "vip", "g_smart")
    )
    expect(row?.kind).toBe("customer_segment")
    expect(row?.spec).toEqual({ priority: "high" })
    expect(row?.graphId).toBe("g_smart")
  })

  it("returns null when no row matches", async () => {
    const fakeDb = {
      select: mock().mockReturnValue({
        from: mock().mockReturnThis(),
        where: mock().mockReturnThis(),
        limit: mock().mockResolvedValue([]),
      }),
    }
    const adapter = makePostgresDynamicAdapter({
      db: fakeDb as any,
      tables: { instance: {} as any, link: {} as any },
    })
    const row = await Effect.runPromise(
      adapter.get("customer_segment", "missing", "g_smart")
    )
    expect(row).toBeNull()
  })

  it("maps link rows, keeping link_type_name as linkName", async () => {
    const fakeDb = {
      select: mock().mockReturnValue({
        from: mock().mockReturnThis(),
        where: mock().mockResolvedValue([
          {
            graphId: "g_smart",
            sourceKind: "customer_segment",
            sourceId: "inst_1",
            linkTypeName: "owned_by",
            targetKind: "team",
            targetId: "team_ops",
          },
        ]),
      }),
    }
    const adapter = makePostgresDynamicAdapter({
      db: fakeDb as any,
      tables: { instance: {} as any, link: {} as any },
    })
    const links = await Effect.runPromise(
      adapter.listLinks(
        { kind: "customer_segment", id: "inst_1" },
        "owned_by",
        "g_smart"
      )
    )
    expect(links).toHaveLength(1)
    expect(links[0]?.linkName).toBe("owned_by")
    expect(links[0]?.target).toEqual({ kind: "team", id: "team_ops" })
  })

  it("fails on unsupported write operations", async () => {
    const adapter = makePostgresDynamicAdapter({
      db: {} as any,
      tables: { instance: {} as any, link: {} as any },
    })
    const result = await Effect.runPromise(
      Effect.either(adapter.create("segment", {}, "g_smart"))
    )
    expect(result._tag).toBe("Left")
  })
})
