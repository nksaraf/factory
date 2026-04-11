import { describe, expect, it } from "vitest"
import { matchTopic, matchTopicAny } from "./topic-matcher"

describe("matchTopic", () => {
  it("matches exact topics", () => {
    expect(matchTopic("ops.workspace.created", "ops.workspace.created")).toBe(
      true
    )
    expect(matchTopic("ops.workspace.created", "ops.workspace.deleted")).toBe(
      false
    )
  })

  it("matches single-level wildcard (*)", () => {
    expect(matchTopic("ops.workspace.*", "ops.workspace.created")).toBe(true)
    expect(matchTopic("ops.*.created", "ops.workspace.created")).toBe(true)
    expect(matchTopic("ops.workspace.*", "ops.workspace.health.changed")).toBe(
      false
    )
  })

  it("matches multi-level wildcard (>)", () => {
    expect(matchTopic("ops.>", "ops.workspace.created")).toBe(true)
    expect(matchTopic("ops.>", "ops.workspace.health.changed")).toBe(true)
    expect(matchTopic("ops.>", "infra.host.discovered")).toBe(false)
    expect(matchTopic(">", "anything.at.all")).toBe(true)
  })

  it("rejects partial matches", () => {
    expect(matchTopic("ops.workspace", "ops.workspace.created")).toBe(false)
  })

  it("handles edge cases", () => {
    expect(matchTopic("*", "ops")).toBe(true)
    expect(matchTopic("*", "ops.workspace")).toBe(false)
    expect(matchTopic("*.*", "ops.workspace")).toBe(true)
  })
})

describe("matchTopicAny", () => {
  it("matches against multiple filters", () => {
    expect(
      matchTopicAny(["ops.>", "infra.host.*"], "ops.workspace.created")
    ).toBe(true)
    expect(
      matchTopicAny(["ops.>", "infra.host.*"], "build.pipeline.failed")
    ).toBe(false)
  })
})
