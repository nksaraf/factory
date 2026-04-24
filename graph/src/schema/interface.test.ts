import { describe, expect, it } from "bun:test"
import { z } from "zod"
import { defineInterface, compileInterface } from "./interface"

describe("defineInterface", () => {
  it("produces an interface definition", () => {
    const HasLifecycle = defineInterface("hasLifecycle", {
      description: "Anything with a lifecycle state",
      properties: z.object({
        lifecycle: z.enum(["active", "retired"]),
      }),
    })
    expect(HasLifecycle.__kind).toBe("interface")
    expect(HasLifecycle.name).toBe("hasLifecycle")
  })

  it("compiles to InterfaceIR", () => {
    const HasLifecycle = defineInterface("hasLifecycle", {
      properties: z.object({ lifecycle: z.enum(["active", "retired"]) }),
    })
    const ir = compileInterface(HasLifecycle)
    expect(ir.name).toBe("hasLifecycle")
    expect(ir.properties).toEqual({
      type: "object",
      properties: {
        lifecycle: { type: "string", enum: ["active", "retired"] },
      },
      required: ["lifecycle"],
    })
  })
})
