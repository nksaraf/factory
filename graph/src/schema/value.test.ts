import { describe, expect, it } from "bun:test"
import { defineValueType, compileValueType } from "./value"

describe("defineValueType", () => {
  it("produces a value type definition", () => {
    const Email = defineValueType("EmailAddress", {
      base: "string",
      description: "RFC 5322 email",
      validation: { pattern: "^\\S+@\\S+$" },
    })
    expect(Email.__kind).toBe("valueType")
    expect(Email.base).toBe("string")
    expect(Email.validation).toEqual({ pattern: "^\\S+@\\S+$" })
  })

  it("compiles to ValueTypeIR", () => {
    const USD = defineValueType("USD", {
      base: "number",
      display: { locale: "en-US", currency: "USD" },
    })
    const ir = compileValueType(USD)
    expect(ir.name).toBe("USD")
    expect(ir.base).toBe("number")
    expect(ir.display).toEqual({ locale: "en-US", currency: "USD" })
  })
})
