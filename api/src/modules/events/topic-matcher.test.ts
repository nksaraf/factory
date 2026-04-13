import { describe, expect, it } from "bun:test"
import { matchTopic, matchTopicAny } from "./topic-matcher"

describe("matchTopic", () => {
  it("matches exact topics", () => {
    expect(matchTopic("ops.workbench.created", "ops.workbench.created")).toBe(
      true
    )
    expect(matchTopic("ops.workbench.created", "ops.workbench.deleted")).toBe(
      false
    )
  })

  it("matches single-level wildcard (*)", () => {
    expect(matchTopic("ops.workbench.*", "ops.workbench.created")).toBe(true)
    expect(matchTopic("ops.*.created", "ops.workbench.created")).toBe(true)
    expect(matchTopic("ops.workbench.*", "ops.workbench.health.changed")).toBe(
      false
    )
  })

  it("matches multi-level wildcard (>)", () => {
    expect(matchTopic("ops.>", "ops.workbench.created")).toBe(true)
    expect(matchTopic("ops.>", "ops.workbench.health.changed")).toBe(true)
    expect(matchTopic("ops.>", "infra.host.discovered")).toBe(false)
    expect(matchTopic(">", "anything.at.all")).toBe(true)
  })

  it("rejects partial matches", () => {
    expect(matchTopic("ops.workbench", "ops.workbench.created")).toBe(false)
  })

  it("handles edge cases", () => {
    expect(matchTopic("*", "ops")).toBe(true)
    expect(matchTopic("*", "ops.workbench")).toBe(false)
    expect(matchTopic("*.*", "ops.workbench")).toBe(true)
  })
})

describe("matchTopicAny", () => {
  it("matches against multiple filters", () => {
    expect(
      matchTopicAny(["ops.>", "infra.host.*"], "ops.workbench.created")
    ).toBe(true)
    expect(
      matchTopicAny(["ops.>", "infra.host.*"], "build.pipeline.failed")
    ).toBe(false)
  })
})
