import { describe, expect, it } from "vitest"
import { NoopGitHostAdapter } from "../adapters/git-host-adapter-noop"
import type { GitHostAdapter } from "../adapters/git-host-adapter"
import { getGitHostAdapter } from "../adapters/adapter-registry"

describe("NoopGitHostAdapter", () => {
  const adapter: GitHostAdapter = new NoopGitHostAdapter()

  it("has type 'noop'", () => {
    expect(adapter.type).toBe("noop")
  })

  it("listRepos returns empty array", async () => {
    expect(await adapter.listRepos()).toEqual([])
  })

  it("getRepo returns null", async () => {
    expect(await adapter.getRepo("123")).toBeNull()
  })

  it("listOrgMembers returns empty array", async () => {
    expect(await adapter.listOrgMembers()).toEqual([])
  })

  it("verifyWebhook returns valid with extracted data", async () => {
    const result = await adapter.verifyWebhook(
      { "x-github-event": "push", "x-github-delivery": "abc" },
      JSON.stringify({ action: "created" })
    )
    expect(result.valid).toBe(true)
    expect(result.eventType).toBe("push")
    expect(result.deliveryId).toBe("abc")
  })

  it("postCommitStatus resolves", async () => {
    await expect(
      adapter.postCommitStatus("org/repo", "sha123", {
        state: "success",
        targetUrl: "http://test",
        description: "ok",
        context: "factory/build",
      })
    ).resolves.toBeUndefined()
  })
})

describe("getGitHostAdapter", () => {
  it("creates noop adapter", () => {
    const adapter = getGitHostAdapter("noop")
    expect(adapter.type).toBe("noop")
  })

  it("throws for unknown type", () => {
    expect(() => getGitHostAdapter("unknown" as any)).toThrow(
      "No git host adapter for type: unknown"
    )
  })
})
