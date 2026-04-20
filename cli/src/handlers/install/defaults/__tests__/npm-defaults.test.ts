import { describe, test, expect, mock } from "bun:test"

describe("npm-defaults cache detection", () => {
  test("includes cache registry when Verdaccio is reachable", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("{}", { status: 200 }))
    ) as unknown as typeof fetch

    const { npmDefaultsProvider } = await import("../npm-defaults.js")
    const changes = await npmDefaultsProvider.detect()
    const registryChange = changes.find((c) => c.id === "npm:registry")

    expect(registryChange).toBeDefined()
    expect(registryChange!.proposedValue).toContain("npm-cache.internal")

    globalThis.fetch = originalFetch
  })

  test("skips cache registry when Verdaccio is unreachable", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = mock(() =>
      Promise.reject(new Error("unreachable"))
    ) as unknown as typeof fetch

    const { npmDefaultsProvider } = await import("../npm-defaults.js")
    const changes = await npmDefaultsProvider.detect()
    const registryChange = changes.find((c) => c.id === "npm:registry")

    expect(registryChange).toBeUndefined()

    globalThis.fetch = originalFetch
  })
})
