import { describe, test, expect, mock } from "bun:test"

describe("docker-defaults cache detection", () => {
  test("includes registry-mirrors when cache is reachable", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("{}", { status: 200 }))
    ) as unknown as typeof fetch

    // Force fresh import to pick up mocked fetch
    delete require.cache[require.resolve("../docker-defaults.js")]
    const { dockerDefaultsProvider } = await import("../docker-defaults.js")
    const changes = await dockerDefaultsProvider.detect()
    const mirrorChange = changes.find((c) => c.id === "docker:registry-mirrors")

    expect(mirrorChange).toBeDefined()
    expect(mirrorChange!.proposedValue).toContain("docker-cache.internal")

    globalThis.fetch = originalFetch
  })

  test("skips registry-mirrors when cache is unreachable", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = mock(() =>
      Promise.reject(new Error("unreachable"))
    ) as unknown as typeof fetch

    delete require.cache[require.resolve("../docker-defaults.js")]
    const { dockerDefaultsProvider } = await import("../docker-defaults.js")
    const changes = await dockerDefaultsProvider.detect()
    const mirrorChange = changes.find((c) => c.id === "docker:registry-mirrors")

    expect(mirrorChange).toBeUndefined()

    globalThis.fetch = originalFetch
  })
})
