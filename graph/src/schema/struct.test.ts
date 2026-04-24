import { describe, expect, it } from "bun:test"
import { z } from "zod"
import { defineStruct, compileStruct } from "./struct"

describe("defineStruct", () => {
  it("produces a struct definition", () => {
    const Address = defineStruct("address", {
      description: "Postal address",
      fields: z.object({
        line1: z.string(),
        city: z.string(),
        postalCode: z.string(),
      }),
      mainField: "line1",
    })
    expect(Address.__kind).toBe("struct")
    expect(Address.name).toBe("address")
    expect(Address.mainField).toBe("line1")
  })

  it("compiles to StructIR with JSON-schema fields", () => {
    const Address = defineStruct("address", {
      fields: z.object({ line1: z.string(), city: z.string() }),
      mainField: "line1",
    })
    const ir = compileStruct(Address)
    expect(ir.name).toBe("address")
    expect(ir.fields).toEqual({
      type: "object",
      properties: {
        line1: { type: "string" },
        city: { type: "string" },
      },
      required: ["line1", "city"],
    })
    expect(ir.mainField).toBe("line1")
  })
})
