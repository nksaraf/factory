import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { parseHostname, RouteCache, createGatewayServer, renderStatusPage } from "./gateway-proxy";

describe("parseHostname", () => {
  it("parses tunnel hostname", () => {
    expect(parseHostname("happy-fox-42.tunnel.dx.dev")).toEqual({
      family: "tunnel",
      slug: "happy-fox-42",
      fullSubdomain: "happy-fox-42",
    });
  });

  it("parses preview hostname with endpoint suffix", () => {
    expect(parseHostname("pr-42--fix-auth--myapp.preview.dx.dev")).toEqual({
      family: "preview",
      slug: "pr-42--fix-auth",
      endpointName: "myapp",
      fullSubdomain: "pr-42--fix-auth--myapp",
    });
  });

  it("parses preview hostname (bare)", () => {
    expect(parseHostname("pr-42-fix-auth.preview.dx.dev")).toEqual({
      family: "preview",
      slug: "pr-42-fix-auth",
      fullSubdomain: "pr-42-fix-auth",
    });
  });

  it("parses workspace hostname", () => {
    expect(parseHostname("dev-nikhil-abc.workspace.dx.dev")).toEqual({
      family: "workspace",
      slug: "dev-nikhil-abc",
      fullSubdomain: "dev-nikhil-abc",
    });
  });

  it("parses sandbox hostname (legacy)", () => {
    expect(parseHostname("dev-nikhil-abc.sandbox.dx.dev")).toEqual({
      family: "sandbox",
      slug: "dev-nikhil-abc",
      fullSubdomain: "dev-nikhil-abc",
    });
  });

  it("returns null for non-gateway hostnames", () => {
    expect(parseHostname("api.prod.dx.dev")).toBeNull();
    expect(parseHostname("app.example.com")).toBeNull();
    expect(parseHostname("dx.dev")).toBeNull();
  });

  it("returns null for empty or missing host", () => {
    expect(parseHostname("")).toBeNull();
    expect(parseHostname(undefined as any)).toBeNull();
  });
});

describe("RouteCache", () => {
  let cache: RouteCache;
  const mockLookup = vi.fn();

  beforeEach(() => {
    mockLookup.mockReset();
    cache = new RouteCache({ lookup: mockLookup, maxSize: 100, ttlMs: 60_000 });
  });

  it("calls lookup on cache miss", async () => {
    const fakeRoute = { routeId: "rte_1", kind: "tunnel", domain: "a.tunnel.dx.dev", targetService: "tunnel-broker" };
    mockLookup.mockResolvedValueOnce(fakeRoute);

    const result = await cache.get("a.tunnel.dx.dev");
    expect(result).toEqual(fakeRoute);
    expect(mockLookup).toHaveBeenCalledWith("a.tunnel.dx.dev");
  });

  it("returns cached value on subsequent calls", async () => {
    const fakeRoute = { routeId: "rte_1", kind: "tunnel", domain: "a.tunnel.dx.dev", targetService: "tunnel-broker" };
    mockLookup.mockResolvedValueOnce(fakeRoute);

    await cache.get("a.tunnel.dx.dev");
    const result = await cache.get("a.tunnel.dx.dev");
    expect(result).toEqual(fakeRoute);
    expect(mockLookup).toHaveBeenCalledTimes(1);
  });

  it("invalidate removes entry from cache", async () => {
    const fakeRoute = { routeId: "rte_1", kind: "tunnel", domain: "a.tunnel.dx.dev", targetService: "tunnel-broker" };
    mockLookup.mockResolvedValue(fakeRoute);

    await cache.get("a.tunnel.dx.dev");
    cache.invalidate("a.tunnel.dx.dev");
    await cache.get("a.tunnel.dx.dev");
    expect(mockLookup).toHaveBeenCalledTimes(2);
  });

  it("does not cache null results so new routes are discovered immediately", async () => {
    mockLookup.mockResolvedValueOnce(null);
    mockLookup.mockResolvedValueOnce({ domain: "missing.tunnel.dx.dev", targetService: "svc", status: "active" });

    const r1 = await cache.get("missing.tunnel.dx.dev");
    expect(r1).toBeNull();
    // Second call should hit the DB again (miss not cached) and find the newly created route
    const r2 = await cache.get("missing.tunnel.dx.dev");
    expect(r2).not.toBeNull();
    expect(r2.targetService).toBe("svc");
    expect(mockLookup).toHaveBeenCalledTimes(2);
  });
});

describe.skipIf(typeof globalThis.Bun === "undefined")("createGatewayServer", () => {
  let targetServer: ReturnType<typeof Bun.serve> | null = null;
  let gateway: { server: ReturnType<typeof Bun.serve>; stop: () => void } | null = null;

  afterEach(() => {
    gateway?.stop();
    targetServer?.stop();
    gateway = null;
    targetServer = null;
  });

  it("proxies request to target service based on hostname", async () => {
    targetServer = Bun.serve({
      port: 0,
      fetch() {
        return new Response("hello from target", { status: 200 });
      },
    });

    const cache = new RouteCache({
      lookup: async (domain) => {
        if (domain === "test-slug.workspace.dx.dev") {
          return {
            routeId: "rte_1",
            kind: "workspace",
            domain: "test-slug.workspace.dx.dev",
            targetService: "localhost",
            targetPort: targetServer!.port,
            status: "active",
          };
        }
        return null;
      },
    });

    gateway = createGatewayServer({ cache, port: 0 });

    const res = await fetch(`http://localhost:${gateway.server.port}/`, {
      headers: { Host: "test-slug.workspace.dx.dev" },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello from target");
  });

  it("returns 404 for unknown hostname", async () => {
    const cache = new RouteCache({ lookup: async () => null });
    gateway = createGatewayServer({ cache, port: 0 });

    const res = await fetch(`http://localhost:${gateway.server.port}/`, {
      headers: { Host: "nope.workspace.dx.dev" },
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 for non-gateway hostname", async () => {
    const cache = new RouteCache({ lookup: async () => null });
    gateway = createGatewayServer({ cache, port: 0 });

    const res = await fetch(`http://localhost:${gateway.server.port}/`, {
      headers: { Host: "api.prod.dx.dev" },
    });
    expect(res.status).toBe(404);
  });

  it("returns 502 when target is unreachable", async () => {
    const cache = new RouteCache({
      lookup: async () => ({
        routeId: "rte_1",
        kind: "workspace",
        domain: "dead.workspace.dx.dev",
        targetService: "localhost",
        targetPort: 1,
        status: "active",
      }),
    });
    gateway = createGatewayServer({ cache, port: 0 });

    const res = await fetch(`http://localhost:${gateway.server.port}/`, {
      headers: { Host: "dead.workspace.dx.dev" },
    });
    expect(res.status).toBe(502);
  });
});

describe("renderStatusPage", () => {
  it("returns building page for building previews", () => {
    const html = renderStatusPage("building", "PR #42 - fix-auth-bug", "Building container image...");
    expect(html).toContain("Building");
    expect(html).toContain("PR #42 - fix-auth-bug");
    expect(html).toContain("auto-refresh");
  });

  it("returns starting page for cold previews", () => {
    const html = renderStatusPage("cold", "PR #42 - fix-auth-bug");
    expect(html).toContain("Starting");
    expect(html).toContain("auto-refresh");
  });

  it("returns expired page", () => {
    const html = renderStatusPage("expired", "PR #42 - fix-auth-bug");
    expect(html).toContain("expired");
  });

  it("returns failed page", () => {
    const html = renderStatusPage("failed", "PR #42 - fix-auth-bug", "Build failed: OOM");
    expect(html).toContain("failed");
    expect(html).toContain("Build failed: OOM");
  });
});
