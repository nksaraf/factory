import { describe, expect, it } from "bun:test"
import { z } from "zod"
import { defineProperty, compileSharedProperty, property } from "./property"

describe("defineProperty", () => {
  it("produces a shared property definition", () => {
    const EmailProp = defineProperty("email", {
      schema: z.string(),
      annotations: { searchable: true },
    })
    expect(EmailProp.__kind).toBe("sharedProperty")
    expect(EmailProp.name).toBe("email")
  })

  it("compiles to SharedPropertyIR", () => {
    const EmailProp = defineProperty("email", { schema: z.string() })
    const ir = compileSharedProperty(EmailProp)
    expect(ir.name).toBe("email")
    expect(ir.schema).toEqual({ type: "string" })
  })
})

describe("property.* helpers", () => {
  it("creates typed markers for special property kinds", () => {
    const a = property.attachment({ mimeTypes: ["image/png"] })
    expect(a.__propKind).toBe("attachment")
    expect(a.mimeTypes).toEqual(["image/png"])

    const ts = property.timeseries({ pointType: "number" })
    expect(ts.__propKind).toBe("timeseries")
    expect(ts.pointType).toBe("number")

    const geo = property.geo({ shape: "point" })
    expect(geo.__propKind).toBe("geo")
    expect(geo.shape).toBe("point")

    const enc = property.encrypted({ base: "string" })
    expect(enc.__propKind).toBe("encrypted")
    expect(enc.base).toBe("string")
  })
})
