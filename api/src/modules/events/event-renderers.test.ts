import { describe, expect, it } from "vitest"
import { renderAggregate, renderEvent } from "./event-renderers"

const sampleEvent = {
  id: "evt_test",
  topic: "ops.component_deployment.drifted",
  source: "reconciler",
  severity: "warning" as const,
  scopeKind: "org",
  scopeId: "default",
  spec: {
    data: {
      componentDeploymentSlug: "api-prod",
      desiredImage: "registry/api:v2.1",
      actualImage: "registry/api:v2.0",
      siteSlug: "production",
    },
  },
  schemaVersion: 1,
  occurredAt: "2026-04-11T12:00:00Z",
  createdAt: "2026-04-11T12:00:00Z",
}

describe("renderEvent", () => {
  it("renders to CLI format", () => {
    const output = renderEvent(sampleEvent, "cli")
    expect(typeof output).toBe("string")
    expect(output as string).toContain("api-prod")
  })

  it("renders to web format", () => {
    const output = renderEvent(sampleEvent, "web") as any
    expect(output).toHaveProperty("title")
    expect(output).toHaveProperty("severity", "warning")
  })

  it("renders to slack format", () => {
    const output = renderEvent(sampleEvent, "slack")
    expect(Array.isArray(output)).toBe(true)
  })

  it("renders to email format", () => {
    const output = renderEvent(sampleEvent, "email") as any
    expect(output).toHaveProperty("subject")
    expect(output).toHaveProperty("html")
  })

  it("uses generic renderer for unknown topics", () => {
    const unknownEvent = { ...sampleEvent, topic: "custom.unknown.event" }
    const output = renderEvent(unknownEvent, "cli")
    expect(typeof output).toBe("string")
    expect(output as string).toContain("custom.unknown.event")
  })
})

describe("renderAggregate", () => {
  it("renders storm aggregate to CLI", () => {
    const output = renderAggregate(
      {
        topicPrefix: "ops.component_deployment",
        eventCount: 42,
        maxSeverity: "warning",
        windowStart: "2026-04-11T12:00:00Z",
        windowEnd: "2026-04-11T12:05:00Z",
      },
      "cli"
    )
    expect(typeof output).toBe("string")
    expect(output as string).toContain("42")
  })

  it("renders storm aggregate to web", () => {
    const output = renderAggregate(
      {
        topicPrefix: "ops.component_deployment",
        eventCount: 42,
        maxSeverity: "warning",
        windowStart: "2026-04-11T12:00:00Z",
        windowEnd: "2026-04-11T12:05:00Z",
      },
      "web"
    ) as any
    expect(output).toHaveProperty("title")
    expect(output.data.eventCount).toBe(42)
  })
})
