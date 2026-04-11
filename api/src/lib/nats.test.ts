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

  it("publishToNats returns false when NATS is not connected", async () => {
    delete process.env.NATS_URL
    const { publishToNats } = await import("./nats")
    const result = await publishToNats("test.topic", '{"foo":"bar"}')
    expect(result).toBe(false)
  })
})
