import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  parseRecipient,
  resolveRecipients,
  getNotificationChannels,
} from "./recipient-resolver"

describe("parseRecipient", () => {
  it("parses principal ID", () => {
    expect(parseRecipient("prin_alice")).toEqual({
      kind: "principal",
      id: "prin_alice",
    })
  })

  it("parses team slug", () => {
    expect(parseRecipient("team:platform")).toEqual({
      kind: "team",
      id: "platform",
    })
  })

  it("parses on-call role", () => {
    expect(parseRecipient("on-call:platform")).toEqual({
      kind: "on-call",
      id: "platform",
    })
  })

  it("defaults to principal for plain IDs", () => {
    expect(parseRecipient("some_id")).toEqual({
      kind: "principal",
      id: "some_id",
    })
  })
})

describe("getNotificationChannels", () => {
  it("returns preferences from principal spec", () => {
    const spec = {
      notificationPreferences: {
        defaultChannels: ["slack", "email"],
      },
    }
    expect(getNotificationChannels(spec)).toEqual(["slack", "email"])
  })

  it("returns defaults when no preferences", () => {
    expect(getNotificationChannels({})).toEqual(["slack", "web"])
    expect(getNotificationChannels(null)).toEqual(["slack", "web"])
  })

  it("respects muted flag", () => {
    const spec = {
      notificationPreferences: {
        defaultChannels: ["slack"],
        muted: true,
      },
    }
    expect(getNotificationChannels(spec)).toEqual([])
  })
})

describe("resolveRecipients", () => {
  const mockDb = {
    select: vi.fn(),
  } as any

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("resolves principal recipient directly", async () => {
    const mockChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        {
          id: "prin_alice",
          spec: { notificationPreferences: { defaultChannels: ["slack"] } },
        },
      ]),
    }
    mockDb.select.mockReturnValue(mockChain)

    const result = await resolveRecipients(mockDb, "prin_alice")
    expect(result).toHaveLength(1)
    expect(result[0].principalId).toBe("prin_alice")
    expect(result[0].channels).toEqual(["slack"])
  })

  it("resolves team to member principals", async () => {
    // First call: team lookup
    const teamChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: "team_123" }]),
    }
    // Second call: membership lookup
    const memberChain = {
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([
        {
          principalId: "prin_alice",
          principalSpec: {
            notificationPreferences: { defaultChannels: ["slack"] },
          },
        },
        {
          principalId: "prin_bob",
          principalSpec: {},
        },
      ]),
    }

    mockDb.select
      .mockReturnValueOnce(teamChain)
      .mockReturnValueOnce(memberChain)

    const result = await resolveRecipients(mockDb, "team:platform")
    expect(result).toHaveLength(2)
    expect(result[0].principalId).toBe("prin_alice")
    expect(result[0].channels).toEqual(["slack"])
    expect(result[1].principalId).toBe("prin_bob")
    expect(result[1].channels).toEqual(["slack", "web"])
  })
})
