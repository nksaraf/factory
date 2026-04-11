import { afterEach, describe, expect, it } from "bun:test"

describe("nats module", () => {
  const origUrl = process.env.NATS_URL

  afterEach(() => {
    if (origUrl) {
      process.env.NATS_URL = origUrl
    } else {
      delete process.env.NATS_URL
    }
  })

  it("returns null when NATS_URL is not set", async () => {
    delete process.env.NATS_URL
    const { getNatsConnection } = await import("./nats")
    const result = await getNatsConnection()
    expect(result).toBeNull()
  })

  it("publishToNats returns { ok: false } with error when NATS is not connected", async () => {
    delete process.env.NATS_URL
    const { publishToNats, resetNatsForTesting } = await import("./nats")
    resetNatsForTesting()
    const result = await publishToNats("test.topic", '{"foo":"bar"}')
    expect(result.ok).toBe(false)
    expect(result.error).toContain("NATS not connected")
  })
})
