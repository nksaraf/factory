import { describe, expect, it } from "bun:test"

import { printKeyValue, printTable } from "../output.js"

describe("output helpers", () => {
  it("printKeyValue skips undefined and joins lines", () => {
    expect(printKeyValue({ a: 1, b: "x", c: undefined })).toBe("a: 1\nb: x")
    expect(printKeyValue({})).toBe("")
  })

  it("printTable aligns columns", () => {
    const t = printTable(
      ["h1", "h2"],
      [
        ["a", "bb"],
        ["ccc", "d"],
      ]
    )
    expect(t).toContain("h1  | h2")
    expect(t).toContain("---+---")
    expect(t).toContain("a   | bb")
    expect(t).toContain("ccc | d ")
  })
})
