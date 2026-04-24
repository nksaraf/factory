import { describe, expect, it, mock } from "bun:test"
import { Effect } from "effect"
import { makePostgresCodeAdapter } from "./index"

describe("postgres-code adapter", () => {
  it("reads via bindings for known kinds", async () => {
    const fakeDb = {
      select: mock().mockReturnValue({
        from: mock().mockReturnThis(),
        where: mock().mockReturnThis(),
        limit: mock().mockResolvedValue([
          {
            id: "host_1",
            slug: "box-01",
            hostname: "box-01",
            spec: {},
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
      }),
    }
    const bindings = {
      host: {
        table: {} as any,
        slug: { name: "slug" } as any,
        id: { name: "id" } as any,
        fks: {},
      },
    }
    const adapter = makePostgresCodeAdapter({
      db: fakeDb as any,
      bindings: bindings as any,
    })
    const row = await Effect.runPromise(adapter.get("host", "box-01", null))
    expect(row?.kind).toBe("host")
    expect(row?.id).toBe("host_1")
    expect(row?.title).toBe("box-01")
  })

  it("returns null for unknown kinds", async () => {
    const adapter = makePostgresCodeAdapter({
      db: {} as any,
      bindings: {} as any,
    })
    const row = await Effect.runPromise(
      adapter.get("customer_segment", "whatever", null)
    )
    expect(row).toBeNull()
  })

  it("returns [] on list for unknown kinds", async () => {
    const adapter = makePostgresCodeAdapter({
      db: {} as any,
      bindings: {} as any,
    })
    const rows = await Effect.runPromise(
      adapter.list("customer_segment", {}, null)
    )
    expect(rows).toEqual([])
  })

  it("fails on unsupported write operations", async () => {
    const adapter = makePostgresCodeAdapter({
      db: {} as any,
      bindings: {} as any,
    })
    const result = await Effect.runPromise(
      Effect.either(adapter.create("host", {}, null))
    )
    expect(result._tag).toBe("Left")
  })
})
