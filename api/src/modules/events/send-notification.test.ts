import { describe, expect, it } from "bun:test"
import { buildNotificationEvent } from "./send-notification"

describe("buildNotificationEvent", () => {
  it("builds a notification event with topic prefix", () => {
    const result = buildNotificationEvent({
      to: "prin_alice",
      title: "Approval needed",
      body: "api-prod v2.3 needs approval",
      severity: "warning",
      source: "workflow",
      data: { deploymentId: "cdp_123" },
    })

    expect(result.topic).toBe("notification.alert")
    expect(result.source).toBe("workflow")
    expect(result.severity).toBe("warning")
    expect(result.data).toMatchObject({
      title: "Approval needed",
      body: "api-prod v2.3 needs approval",
      recipient: "prin_alice",
      deploymentId: "cdp_123",
    })
  })

  it("uses custom topic when provided", () => {
    const result = buildNotificationEvent({
      to: "prin_alice",
      title: "Test",
      topic: "ops.approval.needed",
      source: "api",
    })

    expect(result.topic).toBe("notification.ops.approval.needed")
  })

  it("defaults severity to info", () => {
    const result = buildNotificationEvent({
      to: "prin_alice",
      title: "FYI",
      source: "api",
    })

    expect(result.severity).toBe("info")
  })
})
