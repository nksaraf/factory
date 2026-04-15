import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"

import {
  RouteCache,
  createGatewayServer,
  parseHostname,
  renderStatusPage,
} from "./gateway-proxy"

describe("parseHostname", () => {
  it("parses tunnel hostname", () => {
    expect(parseHostname("happy-fox-42.tunnel.lepton.software")).toEqual({
      family: "tunnel",
      slug: "happy-fox-42",
      fullSubdomain: "happy-fox-42",
    })
  })

  it("parses preview hostname with endpoint suffix", () => {
    expect(
      parseHostname("pr-42--fix-auth--myapp.preview.lepton.software")
    ).toEqual({
      family: "preview",
      slug: "pr-42--fix-auth",
      endpointName: "myapp",
      fullSubdomain: "pr-42--fix-auth--myapp",
    })
  })

  it("parses preview hostname (bare)", () => {
    expect(parseHostname("pr-42-fix-auth.preview.lepton.software")).toEqual({
      family: "preview",
      slug: "pr-42-fix-auth",
      fullSubdomain: "pr-42-fix-auth",
    })
  })

  it("parses workbench hostname", () => {
    expect(parseHostname("dev-nikhil-abc.dev.lepton.software")).toEqual({
      family: "dev",
      slug: "dev-nikhil-abc",
      fullSubdomain: "dev-nikhil-abc",
    })
  })

  it("parses sandbox hostname as dev", () => {
    expect(parseHostname("dev-nikhil-abc.sandbox.lepton.software")).toEqual({
      family: "dev",
      slug: "dev-nikhil-abc",
      fullSubdomain: "dev-nikhil-abc",
    })
  })

  it("returns null for non-gateway hostnames", () => {
    expect(parseHostname("api.prod.lepton.software")).toBeNull()
    expect(parseHostname("app.example.com")).toBeNull()
    expect(parseHostname("lepton.software")).toBeNull()
  })

  it("returns null for empty or missing host", () => {
    expect(parseHostname("")).toBeNull()
    expect(parseHostname(undefined as any)).toBeNull()
  })
})

describe("RouteCache", () => {
  let cache: RouteCache
  const mockLookup = mock()

  beforeEach(() => {
    mockLookup.mockReset()
    cache = new RouteCache({ lookup: mockLookup, maxSize: 100, ttlMs: 60_000 })
  })

  it("calls lookup on cache miss", async () => {
    const fakeRoute = {
      routeId: "rte_1",
      kind: "tunnel",
      domain: "a.tunnel.lepton.software",
      targetService: "tunnel-broker",
    }
    mockLookup.mockResolvedValueOnce(fakeRoute)

    const result = await cache.get("a.tunnel.lepton.software")
    expect(result).toEqual(fakeRoute)
    expect(mockLookup).toHaveBeenCalledWith("a.tunnel.lepton.software")
  })

  it("returns cached value on subsequent calls", async () => {
    const fakeRoute = {
      routeId: "rte_1",
      kind: "tunnel",
      domain: "a.tunnel.lepton.software",
      targetService: "tunnel-broker",
    }
    mockLookup.mockResolvedValueOnce(fakeRoute)

    await cache.get("a.tunnel.lepton.software")
    const result = await cache.get("a.tunnel.lepton.software")
    expect(result).toEqual(fakeRoute)
    expect(mockLookup).toHaveBeenCalledTimes(1)
  })

  it("invalidate removes entry from cache", async () => {
    const fakeRoute = {
      routeId: "rte_1",
      kind: "tunnel",
      domain: "a.tunnel.lepton.software",
      targetService: "tunnel-broker",
    }
    mockLookup.mockResolvedValue(fakeRoute)

    await cache.get("a.tunnel.lepton.software")
    cache.invalidate("a.tunnel.lepton.software")
    await cache.get("a.tunnel.lepton.software")
    expect(mockLookup).toHaveBeenCalledTimes(2)
  })

  it("does not cache null results so new routes are discovered immediately", async () => {
    mockLookup.mockResolvedValueOnce(null)
    mockLookup.mockResolvedValueOnce({
      domain: "missing.tunnel.lepton.software",
      targetService: "svc",
      status: "active",
    })

    const r1 = await cache.get("missing.tunnel.lepton.software")
    expect(r1).toBeNull()
    // Second call should hit the DB again (miss not cached) and find the newly created route
    const r2 = await cache.get("missing.tunnel.lepton.software")
    expect(r2).not.toBeNull()
    expect(r2.targetService).toBe("svc")
    expect(mockLookup).toHaveBeenCalledTimes(2)
  })
})

describe.skipIf(typeof globalThis.Bun === "undefined")(
  "createGatewayServer",
  () => {
    let targetServer: ReturnType<typeof Bun.serve> | null = null
    let gateway: {
      server: ReturnType<typeof Bun.serve>
      stop: () => void
    } | null = null

    afterEach(() => {
      gateway?.stop()
      targetServer?.stop()
      gateway = null
      targetServer = null
    })

    it("proxies request to target service based on hostname", async () => {
      targetServer = Bun.serve({
        port: 0,
        fetch() {
          return new Response("hello from target", { status: 200 })
        },
      })

      const cache = new RouteCache({
        lookup: async (domain) => {
          if (domain === "test-slug.dev.lepton.software") {
            return {
              routeId: "rte_1",
              kind: "dev",
              domain: "test-slug.dev.lepton.software",
              targetService: "localhost",
              targetPort: targetServer!.port,
              status: "active",
            }
          }
          return null
        },
      })

      gateway = createGatewayServer({ cache, port: 0 })

      const res = await fetch(`http://localhost:${gateway.server.port}/`, {
        headers: { Host: "test-slug.dev.lepton.software" },
      })
      expect(res.status).toBe(200)
      expect(await res.text()).toBe("hello from target")
    })

    it("returns 404 for unknown hostname", async () => {
      const cache = new RouteCache({ lookup: async () => null })
      gateway = createGatewayServer({ cache, port: 0 })

      const res = await fetch(`http://localhost:${gateway.server.port}/`, {
        headers: { Host: "nope.dev.lepton.software" },
      })
      expect(res.status).toBe(404)
    })

    it("returns 404 for non-gateway hostname", async () => {
      const cache = new RouteCache({ lookup: async () => null })
      gateway = createGatewayServer({ cache, port: 0 })

      const res = await fetch(`http://localhost:${gateway.server.port}/`, {
        headers: { Host: "api.prod.lepton.software" },
      })
      expect(res.status).toBe(404)
    })

    it("returns 502 when target is unreachable", async () => {
      const cache = new RouteCache({
        lookup: async () => ({
          routeId: "rte_1",
          kind: "dev",
          domain: "dead.dev.lepton.software",
          targetService: "localhost",
          targetPort: 1,
          status: "active",
        }),
      })
      gateway = createGatewayServer({ cache, port: 0 })

      const res = await fetch(`http://localhost:${gateway.server.port}/`, {
        headers: { Host: "dead.dev.lepton.software" },
      })
      expect(res.status).toBe(502)
    })
  }
)

describe("renderStatusPage", () => {
  it("returns building page for building previews", () => {
    const html = renderStatusPage(
      "building",
      "PR #42 - fix-auth-bug",
      "Building container image..."
    )
    expect(html).toContain("Building")
    expect(html).toContain("PR #42 - fix-auth-bug")
    expect(html).toContain("auto-refresh")
  })

  it("returns starting page for cold previews", () => {
    const html = renderStatusPage("cold", "PR #42 - fix-auth-bug")
    expect(html).toContain("Starting")
    expect(html).toContain("auto-refresh")
  })

  it("returns expired page", () => {
    const html = renderStatusPage("expired", "PR #42 - fix-auth-bug")
    expect(html).toContain("expired")
  })

  it("returns failed page", () => {
    const html = renderStatusPage(
      "failed",
      "PR #42 - fix-auth-bug",
      "Build failed: OOM"
    )
    expect(html).toContain("failed")
    expect(html).toContain("Build failed: OOM")
  })
})
