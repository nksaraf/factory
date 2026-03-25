import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { parseHostname, RouteCache, createGatewayServer } from "./gateway-proxy";

describe("parseHostname", () => {
  it("parses tunnel hostname", () => {
    expect(parseHostname("happy-fox-42.tunnel.dx.dev")).toEqual({
      family: "tunnel",
      slug: "happy-fox-42",
    });
  });

  it("parses preview hostname", () => {
    expect(parseHostname("pr-42--fix-auth--myapp.preview.dx.dev")).toEqual({
      family: "preview",
      slug: "pr-42--fix-auth--myapp",
    });
  });

  it("parses sandbox hostname", () => {
    expect(parseHostname("dev-nikhil-abc.sandbox.dx.dev")).toEqual({
      family: "sandbox",
      slug: "dev-nikhil-abc",
    });
  });

  it("parses sandbox with port suffix", () => {
    expect(parseHostname("dev-nikhil-abc-8080.sandbox.dx.dev")).toEqual({
      family: "sandbox",
      slug: "dev-nikhil-abc-8080",
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

  it("caches null results (negative cache)", async () => {
    mockLookup.mockResolvedValueOnce(null);

    const r1 = await cache.get("missing.tunnel.dx.dev");
    const r2 = await cache.get("missing.tunnel.dx.dev");
    expect(r1).toBeNull();
    expect(r2).toBeNull();
    expect(mockLookup).toHaveBeenCalledTimes(1);
  });
});

describe("createGatewayServer", () => {
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
        if (domain === "test-slug.sandbox.dx.dev") {
          return {
            routeId: "rte_1",
            kind: "sandbox",
            domain: "test-slug.sandbox.dx.dev",
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
      headers: { Host: "test-slug.sandbox.dx.dev" },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello from target");
  });

  it("returns 404 for unknown hostname", async () => {
    const cache = new RouteCache({ lookup: async () => null });
    gateway = createGatewayServer({ cache, port: 0 });

    const res = await fetch(`http://localhost:${gateway.server.port}/`, {
      headers: { Host: "nope.sandbox.dx.dev" },
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
        kind: "sandbox",
        domain: "dead.sandbox.dx.dev",
        targetService: "localhost",
        targetPort: 1,
        status: "active",
      }),
    });
    gateway = createGatewayServer({ cache, port: 0 });

    const res = await fetch(`http://localhost:${gateway.server.port}/`, {
      headers: { Host: "dead.sandbox.dx.dev" },
    });
    expect(res.status).toBe(502);
  });
});
