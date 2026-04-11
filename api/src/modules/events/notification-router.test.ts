import { describe, expect, it } from "vitest"
import {
  isMuted,
  isQuietHours,
  matchStreamSubscription,
} from "./notification-router"

describe("matchStreamSubscription", () => {
  const baseSub = {
    kind: "stream" as const,
    status: "active" as const,
    topicFilter: "ops.>",
    minSeverity: null as string | null,
    scopeKind: null as string | null,
    scopeId: null as string | null,
    matchFields: null as Record<string, unknown> | null,
    spec: null as Record<string, unknown> | null,
    expiresAt: new Date(Date.now() + 600_000),
  }

  const baseEvent = {
    topic: "ops.workbench.created",
    severity: "info",
    scopeKind: "org",
    scopeId: "default",
    data: { workbenchId: "wb-1" },
  }

  it("matches when topic filter matches", () => {
    expect(matchStreamSubscription(baseSub, baseEvent)).toBe(true)
  })

  it("rejects when topic filter does not match", () => {
    const sub = { ...baseSub, topicFilter: "build.>" }
    expect(matchStreamSubscription(sub, baseEvent)).toBe(false)
  })

  it("filters by minimum severity", () => {
    const sub = { ...baseSub, minSeverity: "warning" }
    expect(matchStreamSubscription(sub, baseEvent)).toBe(false)
    expect(
      matchStreamSubscription(sub, { ...baseEvent, severity: "critical" })
    ).toBe(true)
  })

  it("filters by scope", () => {
    const sub = { ...baseSub, scopeKind: "org", scopeId: "other" }
    expect(matchStreamSubscription(sub, baseEvent)).toBe(false)
  })

  it("matches JSONB fields", () => {
    const sub = { ...baseSub, matchFields: { workbenchId: "wb-1" } }
    expect(matchStreamSubscription(sub, baseEvent)).toBe(true)

    const sub2 = { ...baseSub, matchFields: { workbenchId: "wb-other" } }
    expect(matchStreamSubscription(sub2, baseEvent)).toBe(false)
  })

  it("rejects expired subscriptions", () => {
    const sub = { ...baseSub, expiresAt: new Date(Date.now() - 1000) }
    expect(matchStreamSubscription(sub, baseEvent)).toBe(false)
  })
})

describe("isMuted", () => {
  it("returns false when no mute config", () => {
    expect(isMuted(null)).toBe(false)
    expect(isMuted({})).toBe(false)
  })

  it("returns true when muted flag is set", () => {
    expect(isMuted({ muted: true })).toBe(true)
  })

  it("returns true when mutedUntil is in the future", () => {
    expect(
      isMuted({ mutedUntil: new Date(Date.now() + 60_000).toISOString() })
    ).toBe(true)
  })

  it("returns false when mutedUntil is in the past", () => {
    expect(
      isMuted({ mutedUntil: new Date(Date.now() - 60_000).toISOString() })
    ).toBe(false)
  })
})

describe("isQuietHours", () => {
  it("returns false when no quiet hours configured", () => {
    expect(isQuietHours(undefined, undefined, 14)).toBe(false)
  })

  it("detects same-day quiet hours", () => {
    expect(isQuietHours("09:00", "17:00", 12)).toBe(true)
    expect(isQuietHours("09:00", "17:00", 20)).toBe(false)
  })

  it("handles overnight quiet hours", () => {
    expect(isQuietHours("22:00", "06:00", 23)).toBe(true)
    expect(isQuietHours("22:00", "06:00", 3)).toBe(true)
    expect(isQuietHours("22:00", "06:00", 12)).toBe(false)
  })
})
