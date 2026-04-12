import { beforeEach, describe, expect, it, vi } from "vitest"
import { parseChannelAddress, resolveDeliveryTarget } from "./identity-resolver"

describe("parseChannelAddress", () => {
  it("parses provider:target format", () => {
    const result = parseChannelAddress("slack:C12345")
    expect(result).toEqual({ provider: "slack", target: "C12345" })
  })

  it("parses provider:@owner special target", () => {
    const result = parseChannelAddress("slack:@owner")
    expect(result).toEqual({ provider: "slack", target: "@owner" })
  })

  it("parses email:@owner", () => {
    const result = parseChannelAddress("email:@owner")
    expect(result).toEqual({ provider: "email", target: "@owner" })
  })

  it("parses web:@owner", () => {
    const result = parseChannelAddress("web:@owner")
    expect(result).toEqual({ provider: "web", target: "@owner" })
  })

  it("handles target with colons", () => {
    const result = parseChannelAddress("slack:DM:U12345")
    expect(result).toEqual({ provider: "slack", target: "DM:U12345" })
  })

  it("returns null for invalid format", () => {
    expect(parseChannelAddress("nocolon")).toBeNull()
  })
})

describe("resolveDeliveryTarget", () => {
  const mockDb = { select: vi.fn() } as any

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("returns target directly for explicit channel IDs", async () => {
    const result = await resolveDeliveryTarget(
      mockDb,
      { provider: "slack", target: "C12345" },
      "prin_alice"
    )
    expect(result).toEqual({ provider: "slack", target: "C12345" })
    expect(mockDb.select).not.toHaveBeenCalled()
  })

  it("resolves @owner to provider identity via identity_link", async () => {
    const mockChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ externalId: "U_SLACK_123" }]),
    }
    mockDb.select.mockReturnValue(mockChain)

    const result = await resolveDeliveryTarget(
      mockDb,
      { provider: "slack", target: "@owner" },
      "prin_alice"
    )
    expect(result).toEqual({ provider: "slack", target: "U_SLACK_123" })
  })

  it("resolves @owner for email via principal.spec.email", async () => {
    const mockChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi
        .fn()
        .mockResolvedValue([{ spec: { email: "alice@example.com" } }]),
    }
    mockDb.select.mockReturnValue(mockChain)

    const result = await resolveDeliveryTarget(
      mockDb,
      { provider: "email", target: "@owner" },
      "prin_alice"
    )
    expect(result).toEqual({ provider: "email", target: "alice@example.com" })
  })

  it("resolves @owner for web to principalId", async () => {
    const result = await resolveDeliveryTarget(
      mockDb,
      { provider: "web", target: "@owner" },
      "prin_alice"
    )
    expect(result).toEqual({ provider: "web", target: "prin_alice" })
  })

  it("returns null when identity not found", async () => {
    const mockChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    }
    mockDb.select.mockReturnValue(mockChain)

    const result = await resolveDeliveryTarget(
      mockDb,
      { provider: "slack", target: "@owner" },
      "prin_alice"
    )
    expect(result).toBeNull()
  })
})
