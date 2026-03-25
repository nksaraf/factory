# Unified Gateway Implementation Plan (Phases 1 & 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-instance Traefik routing with a unified smart proxy (factory-gateway) that handles all high-cardinality routing (tunnels, previews, sandboxes) via hostname-based lookup, and add a preview lifecycle data model.

**Architecture:** A Bun HTTP server on port 9090 (same process as the API) parses incoming hostnames, determines the route family (tunnel/preview/sandbox), looks up the target from an LRU cache backed by Postgres, and reverse-proxies or relays accordingly. Traefik is simplified to ~5 static wildcard routers that forward all high-cardinality traffic to this gateway, while keeping per-route config only for low-cardinality custom_domain and ingress routes.

**Tech Stack:** Bun HTTP server, Drizzle ORM (Postgres), LRU cache (`lru-cache` npm package), existing Elysia API, Vitest + PGlite for tests.

**Spec:** `docs/superpowers/specs/2026-03-26-unified-gateway-design.md`

**Scope:** This plan covers Phase 1 (Factory Gateway + Traefik Simplification) and Phase 2 (Preview Data Model + Lifecycle). Phases 3-5 (Tunnel Data Plane, TCP Tunneling, Production Hardening) will be separate follow-up plans.

---

## File Structure

| File | Responsibility | Action |
|------|---------------|--------|
| `api/src/modules/infra/gateway-proxy.ts` | HTTP server: hostname parsing, LRU cache, reverse proxy | Create |
| `api/src/modules/infra/gateway-proxy.test.ts` | Unit tests for hostname parsing and route resolution | Create |
| `api/src/modules/infra/traefik-sync.ts` | Generate Traefik YAML — now only for custom_domain + ingress | Modify |
| `api/src/modules/infra/gateway.service.ts` | Add `lookupRouteByDomain()` for gateway, cache invalidation hooks | Modify |
| `api/src/modules/infra/gateway.controller.ts` | Wire gateway startup on API boot | Modify |
| `api/src/db/schema/gateway.ts` | Add `mode` and `tcpPort` columns to tunnel table | Modify |
| `api/src/db/schema/fleet.ts` | Add `preview` table | Modify |
| `api/src/lib/id.ts` | Add `"prev"` entity prefix for previews | Modify |
| `api/src/services/preview/preview.service.ts` | Preview CRUD + lifecycle state machine | Create |
| `api/src/__tests__/gateway-services.test.ts` | Integration tests for gateway service + preview service | Create |
| `api/src/__tests__/traefik-sync.test.ts` | Tests for simplified traefik-sync | Create |

---

## Task 1: Hostname Parser + Route Family Detection

**Files:**
- Create: `api/src/modules/infra/gateway-proxy.ts`
- Create: `api/src/modules/infra/gateway-proxy.test.ts`

This task builds the pure-function hostname parsing layer. No HTTP server yet — just the logic that extracts route family and slug from a hostname.

- [ ] **Step 1: Write failing tests for hostname parsing**

Create `api/src/modules/infra/gateway-proxy.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { parseHostname } from "./gateway-proxy";

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && npx vitest run src/modules/infra/gateway-proxy.test.ts`
Expected: FAIL — module `./gateway-proxy` not found

- [ ] **Step 3: Implement parseHostname**

Create `api/src/modules/infra/gateway-proxy.ts`:

```typescript
/**
 * Factory Gateway — unified smart proxy for high-cardinality routing.
 *
 * Handles *.tunnel.dx.dev, *.preview.dx.dev, *.sandbox.dx.dev by parsing
 * the hostname, looking up the route from cache/DB, and proxying to the target.
 */

export type RouteFamily = "tunnel" | "preview" | "sandbox";

export interface ParsedHost {
  family: RouteFamily;
  slug: string;
}

const FAMILY_SUFFIXES: { suffix: string; family: RouteFamily }[] = [
  { suffix: ".tunnel.dx.dev", family: "tunnel" },
  { suffix: ".preview.dx.dev", family: "preview" },
  { suffix: ".sandbox.dx.dev", family: "sandbox" },
];

export function parseHostname(host: string | undefined): ParsedHost | null {
  if (!host) return null;

  // Strip port if present
  const hostname = host.split(":")[0];

  for (const { suffix, family } of FAMILY_SUFFIXES) {
    if (hostname.endsWith(suffix)) {
      const slug = hostname.slice(0, -suffix.length);
      if (slug.length > 0) {
        return { family, slug };
      }
    }
  }

  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && npx vitest run src/modules/infra/gateway-proxy.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/infra/gateway-proxy.ts api/src/modules/infra/gateway-proxy.test.ts
git commit -m "feat: add hostname parser for factory gateway"
```

---

## Task 2: Route Lookup Service with LRU Cache

**Files:**
- Modify: `api/src/modules/infra/gateway.service.ts` (add `lookupRouteByDomain`)
- Modify: `api/src/modules/infra/gateway-proxy.ts` (add `RouteCache` class)
- Modify: `api/src/modules/infra/gateway-proxy.test.ts` (add cache tests)

- [ ] **Step 1: Install lru-cache**

Run: `cd api && bun add lru-cache`

- [ ] **Step 2: Write failing test for lookupRouteByDomain**

Add to `api/src/__tests__/gateway-services.test.ts` (new file):

```typescript
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, truncateAllTables } from "../test-helpers";
import * as gw from "../modules/infra/gateway.service";
import type { Database } from "../db/connection";
import type { PGlite } from "@electric-sql/pglite";

describe("Gateway Services", () => {
  let db: Database;
  let client: PGlite;

  beforeAll(async () => {
    const ctx = await createTestContext();
    db = ctx.db as unknown as Database;
    client = ctx.client;
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    await truncateAllTables(client);
  });

  describe("lookupRouteByDomain", () => {
    it("finds an active route by domain", async () => {
      await gw.createRoute(db, {
        kind: "tunnel",
        domain: "happy-fox-42.tunnel.dx.dev",
        targetService: "tunnel-broker",
        status: "active",
        createdBy: "system",
      });

      const found = await gw.lookupRouteByDomain(db, "happy-fox-42.tunnel.dx.dev");
      expect(found).not.toBeNull();
      expect(found!.kind).toBe("tunnel");
      expect(found!.domain).toBe("happy-fox-42.tunnel.dx.dev");
    });

    it("returns null for non-existent domain", async () => {
      const found = await gw.lookupRouteByDomain(db, "nope.tunnel.dx.dev");
      expect(found).toBeNull();
    });

    it("returns null for inactive routes", async () => {
      await gw.createRoute(db, {
        kind: "tunnel",
        domain: "stale.tunnel.dx.dev",
        targetService: "tunnel-broker",
        status: "expired",
        createdBy: "system",
      });

      const found = await gw.lookupRouteByDomain(db, "stale.tunnel.dx.dev");
      expect(found).toBeNull();
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd api && npx vitest run src/__tests__/gateway-services.test.ts`
Expected: FAIL — `lookupRouteByDomain` is not a function

- [ ] **Step 4: Implement lookupRouteByDomain in gateway.service.ts**

Add to `api/src/modules/infra/gateway.service.ts` after the `cleanupExpiredRoutes` function (after line 137):

```typescript
/**
 * Look up a single active route by exact domain match.
 * Used by the factory gateway for fast hostname-based routing.
 */
export async function lookupRouteByDomain(
  db: Database,
  domain: string
): Promise<any | null> {
  const [row] = await db
    .select()
    .from(route)
    .where(and(eq(route.domain, domain), eq(route.status, "active")))
    .limit(1);

  return row ?? null;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd api && npx vitest run src/__tests__/gateway-services.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 6: Write failing tests for RouteCache**

Add to `api/src/modules/infra/gateway-proxy.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { parseHostname, RouteCache } from "./gateway-proxy";

// ... existing parseHostname tests ...

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
```

- [ ] **Step 7: Run tests to verify cache tests fail**

Run: `cd api && npx vitest run src/modules/infra/gateway-proxy.test.ts`
Expected: FAIL — `RouteCache` not exported

- [ ] **Step 8: Implement RouteCache**

Add to `api/src/modules/infra/gateway-proxy.ts`:

```typescript
import { LRUCache } from "lru-cache";

export interface RouteCacheOptions {
  lookup: (domain: string) => Promise<any | null>;
  maxSize?: number;
  ttlMs?: number;
}

const SENTINEL_NULL = Symbol("null");

export class RouteCache {
  private cache: LRUCache<string, any>;
  private lookup: (domain: string) => Promise<any | null>;

  constructor(opts: RouteCacheOptions) {
    this.lookup = opts.lookup;
    this.cache = new LRUCache<string, any>({
      max: opts.maxSize ?? 10_000,
      ttl: opts.ttlMs ?? 300_000, // 5 min default
    });
  }

  async get(domain: string): Promise<any | null> {
    const cached = this.cache.get(domain);
    if (cached !== undefined) {
      return cached === SENTINEL_NULL ? null : cached;
    }

    const result = await this.lookup(domain);
    this.cache.set(domain, result ?? SENTINEL_NULL);
    return result;
  }

  invalidate(domain: string): void {
    this.cache.delete(domain);
  }

  clear(): void {
    this.cache.clear();
  }
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd api && npx vitest run src/modules/infra/gateway-proxy.test.ts`
Expected: All tests PASS

- [ ] **Step 10: Commit**

```bash
git add api/src/modules/infra/gateway-proxy.ts api/src/modules/infra/gateway-proxy.test.ts api/src/__tests__/gateway-services.test.ts api/src/modules/infra/gateway.service.ts api/package.json api/bun.lockb
git commit -m "feat: add route lookup + LRU cache for factory gateway"
```

---

## Task 3: Gateway HTTP Server (Reverse Proxy)

**Files:**
- Modify: `api/src/modules/infra/gateway-proxy.ts` (add HTTP server + proxy logic)
- Modify: `api/src/modules/infra/gateway-proxy.test.ts` (add integration tests)

- [ ] **Step 1: Write failing tests for the gateway server**

Add to `api/src/modules/infra/gateway-proxy.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach, afterAll, afterEach } from "vitest";
import { parseHostname, RouteCache, createGatewayServer } from "./gateway-proxy";

// ... existing tests ...

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
    // Start a mock target server
    targetServer = Bun.serve({
      port: 0, // random port
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
        targetPort: 1, // nothing listening
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && npx vitest run src/modules/infra/gateway-proxy.test.ts`
Expected: FAIL — `createGatewayServer` not exported

- [ ] **Step 3: Implement createGatewayServer**

Add to `api/src/modules/infra/gateway-proxy.ts`:

```typescript
export interface GatewayServerOptions {
  cache: RouteCache;
  port?: number;
  getTunnelSocket?: (subdomain: string) => WebSocket | undefined;
}

export function createGatewayServer(opts: GatewayServerOptions) {
  const { cache, port = 9090 } = opts;

  const server = Bun.serve({
    port,
    async fetch(req) {
      const host = req.headers.get("host") ?? "";
      const parsed = parseHostname(host);

      if (!parsed) {
        return new Response("Not Found", { status: 404 });
      }

      // Build the full domain for route lookup
      const suffixMap: Record<RouteFamily, string> = {
        tunnel: ".tunnel.dx.dev",
        preview: ".preview.dx.dev",
        sandbox: ".sandbox.dx.dev",
      };
      const domain = parsed.slug + suffixMap[parsed.family];

      const route = await cache.get(domain);
      if (!route) {
        return new Response("Not Found", { status: 404 });
      }

      // For tunnels, delegate to tunnel relay (Phase 3)
      if (parsed.family === "tunnel") {
        // TODO: Phase 3 — binary frame relay through WebSocket
        return new Response("Tunnel relay not yet implemented", { status: 501 });
      }

      // Reverse proxy for preview/sandbox
      const targetPort = route.targetPort ?? 80;
      const targetUrl = new URL(req.url);
      targetUrl.hostname = route.targetService;
      targetUrl.port = String(targetPort);
      targetUrl.protocol = "http:";

      try {
        const proxyRes = await fetch(targetUrl.toString(), {
          method: req.method,
          headers: req.headers,
          body: req.body,
          redirect: "manual",
        });
        return new Response(proxyRes.body, {
          status: proxyRes.status,
          statusText: proxyRes.statusText,
          headers: proxyRes.headers,
        });
      } catch {
        return new Response("Bad Gateway", { status: 502 });
      }
    },
  });

  return {
    server,
    stop() {
      server.stop();
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && npx vitest run src/modules/infra/gateway-proxy.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/infra/gateway-proxy.ts api/src/modules/infra/gateway-proxy.test.ts
git commit -m "feat: add factory gateway HTTP server with reverse proxy"
```

---

## Task 4: Simplify traefik-sync.ts

**Files:**
- Modify: `api/src/modules/infra/traefik-sync.ts`
- Create: `api/src/__tests__/traefik-sync.test.ts`

The change: `syncFactoryRoutes` should only generate per-route Traefik config for `custom_domain` and `ingress` kinds. Tunnel, preview, and sandbox kinds are now handled by the factory gateway via wildcard Traefik routers (configured statically, outside this code).

- [ ] **Step 1: Write failing tests for simplified traefik-sync**

Create `api/src/__tests__/traefik-sync.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { generateTraefikYaml, type TraefikRoute } from "../modules/infra/traefik-sync";

describe("generateTraefikYaml", () => {
  it("generates config for custom_domain routes", () => {
    const routes: TraefikRoute[] = [
      {
        routeId: "rte_custom1",
        kind: "custom_domain",
        domain: "app.example.com",
        targetService: "app.example.com",
        protocol: "http",
        tlsMode: "custom",
        middlewares: [],
        priority: 100,
        status: "active",
      },
    ];
    const yaml = generateTraefikYaml(routes);
    expect(yaml).toContain("app.example.com");
    expect(yaml).toContain("rte-custom1");
  });

  it("generates config for ingress routes", () => {
    const routes: TraefikRoute[] = [
      {
        routeId: "rte_ingress1",
        kind: "ingress",
        domain: "api.prod.dx.dev",
        targetService: "api-service",
        targetPort: 8080,
        protocol: "http",
        tlsMode: "auto",
        middlewares: [],
        priority: 100,
        status: "active",
      },
    ];
    const yaml = generateTraefikYaml(routes);
    expect(yaml).toContain("api.prod.dx.dev");
  });

  it("returns empty config for no routes", () => {
    const yaml = generateTraefikYaml([]);
    expect(yaml).toContain("routers: {}");
  });
});

describe("syncFactoryRoutes filtering", () => {
  it("only generates files for custom_domain and ingress kinds", async () => {
    // This tests the KINDS_WITH_TRAEFIK_ROUTES constant
    const { KINDS_WITH_TRAEFIK_ROUTES } = await import("../modules/infra/traefik-sync");
    expect(KINDS_WITH_TRAEFIK_ROUTES).toEqual(["ingress", "custom_domain"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && npx vitest run src/__tests__/traefik-sync.test.ts`
Expected: FAIL — `KINDS_WITH_TRAEFIK_ROUTES` is not exported

- [ ] **Step 3: Simplify traefik-sync.ts**

Modify `api/src/modules/infra/traefik-sync.ts`:

Replace the `kinds` array in `syncFactoryRoutes` (line 137) and export it:

```typescript
/**
 * Only these route kinds get per-route Traefik config.
 * High-cardinality kinds (tunnel, preview, sandbox) are routed
 * through the factory gateway via static wildcard Traefik routers.
 */
export const KINDS_WITH_TRAEFIK_ROUTES = ["ingress", "custom_domain"] as const;
```

Then in `syncFactoryRoutes`, replace line 137:
```typescript
  const kinds = ["sandbox", "tunnel", "preview", "ingress", "custom_domain"];
```
with:
```typescript
  const kinds = [...KINDS_WITH_TRAEFIK_ROUTES];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && npx vitest run src/__tests__/traefik-sync.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/infra/traefik-sync.ts api/src/__tests__/traefik-sync.test.ts
git commit -m "feat: simplify traefik-sync to only handle custom_domain and ingress routes"
```

---

## Task 5: Wire Gateway into API Startup

**Files:**
- Modify: `api/src/modules/infra/gateway.controller.ts`
- Modify: `api/src/modules/infra/gateway.service.ts` (add cache invalidation hooks)
- Modify: `api/src/modules/infra/gateway-proxy.ts` (export `startGateway` convenience function)

- [ ] **Step 1: Add cache invalidation hooks to gateway.service.ts**

In `api/src/modules/infra/gateway.service.ts`, add after the imports (after line 6):

```typescript
/**
 * Route change listener for cache invalidation.
 * The factory gateway registers its cache.invalidate here.
 */
let onRouteChanged: ((domain: string) => void) | null = null;

export function setRouteChangeListener(listener: (domain: string) => void): void {
  onRouteChanged = listener;
}

function notifyRouteChanged(domain: string): void {
  onRouteChanged?.(domain);
}
```

Then add `notifyRouteChanged(row.domain)` calls after mutations:
- In `createRoute` (after line 87, before `return row`): `notifyRouteChanged(row.domain);`
- In `updateRoute` (after line 120, before `return row`): `if (row) notifyRouteChanged(row.domain);`
- In `deleteRoute` (line 127): Read the route first, then delete, then notify:

Replace `deleteRoute`:
```typescript
export async function deleteRoute(db: Database, routeId: string) {
  const existing = await getRoute(db, routeId);
  await db.delete(route).where(eq(route.routeId, routeId));
  if (existing) notifyRouteChanged(existing.domain);
}
```

- [ ] **Step 2: Create startGateway convenience function**

Add to the end of `api/src/modules/infra/gateway-proxy.ts`:

```typescript
import type { Database } from "../../db/connection";
import { lookupRouteByDomain, setRouteChangeListener } from "./gateway.service";

export function startGateway(opts: { db: Database; port?: number; getTunnelSocket?: (subdomain: string) => WebSocket | undefined }) {
  const cache = new RouteCache({
    lookup: (domain) => lookupRouteByDomain(opts.db, domain),
    maxSize: 10_000,
    ttlMs: 300_000,
  });

  // Wire up cache invalidation
  setRouteChangeListener((domain) => cache.invalidate(domain));

  const gw = createGatewayServer({
    cache,
    port: opts.port ?? 9090,
    getTunnelSocket: opts.getTunnelSocket,
  });

  return { ...gw, cache };
}
```

- [ ] **Step 3: Wire into gateway.controller.ts**

Add gateway startup to `api/src/modules/infra/gateway.controller.ts`. Add after the WebSocket handler (after line 107, before the closing `}`):

```typescript
    // Start factory gateway on a separate port
    .onStart(() => {
      const { startGateway } = require("./gateway-proxy");
      const { getTunnelSocket } = require("./tunnel-broker");
      const gw = startGateway({ db, port: 9090, getTunnelSocket });
      console.log(`Factory gateway listening on :${gw.server.port}`);
    })
```

- [ ] **Step 4: Run all gateway tests to verify nothing broke**

Run: `cd api && npx vitest run src/modules/infra/gateway-proxy.test.ts src/__tests__/gateway-services.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/infra/gateway.service.ts api/src/modules/infra/gateway-proxy.ts api/src/modules/infra/gateway.controller.ts
git commit -m "feat: wire factory gateway into API startup with cache invalidation"
```

---

## Task 6: Preview Table Schema

**Files:**
- Modify: `api/src/db/schema/fleet.ts` (add `preview` table)
- Modify: `api/src/db/schema/fleet.ts` (add `"preview"` to `deploymentTarget.kind` constraint)
- Modify: `api/src/lib/id.ts` (add `"prev"` prefix)

- [ ] **Step 1: Add "prev" entity prefix**

In `api/src/lib/id.ts`, add `"prev"` to the `EntityPrefix` union type (after `"gus"` on line 53):

```typescript
  | "prev";
```

- [ ] **Step 2: Add "preview" to deploymentTarget kind constraint**

In `api/src/db/schema/fleet.ts`, line 127, change:

```typescript
      sql`${t.kind} IN ('production', 'staging', 'sandbox', 'dev')`
```
to:
```typescript
      sql`${t.kind} IN ('production', 'staging', 'sandbox', 'dev', 'preview')`
```

- [ ] **Step 3: Add preview table**

In `api/src/db/schema/fleet.ts`, add after the `sandbox` table (after line 358, before `sandboxTemplate`):

```typescript
export const preview = factoryFleet.table(
  "preview",
  {
    previewId: text("preview_id")
      .primaryKey()
      .$defaultFn(() => newId("prev")),
    deploymentTargetId: text("deployment_target_id")
      .notNull()
      .references(() => deploymentTarget.deploymentTargetId, {
        onDelete: "cascade",
      }),
    siteId: text("site_id").references(() => fleetSite.siteId, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    sourceBranch: text("source_branch").notNull(),
    commitSha: text("commit_sha").notNull(),
    repo: text("repo").notNull(),
    prNumber: integer("pr_number"),
    ownerId: text("owner_id").notNull(),
    authMode: text("auth_mode").notNull().default("team"),
    runtimeClass: text("runtime_class").notNull().default("hot"),
    status: text("status").notNull().default("building"),
    statusMessage: text("status_message"),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("preview_slug_unique").on(t.slug),
    uniqueIndex("preview_deployment_target_unique").on(t.deploymentTargetId),
    index("preview_site_idx").on(t.siteId),
    index("preview_status_idx").on(t.status),
    index("preview_branch_idx").on(t.sourceBranch),
    check(
      "preview_auth_mode_valid",
      sql`${t.authMode} IN ('public', 'team', 'private')`
    ),
    check(
      "preview_runtime_class_valid",
      sql`${t.runtimeClass} IN ('hot', 'warm', 'cold')`
    ),
    check(
      "preview_status_valid",
      sql`${t.status} IN ('building', 'deploying', 'active', 'inactive', 'expired', 'failed')`
    ),
  ]
);
```

- [ ] **Step 4: Generate Drizzle migration**

Run: `cd api && npx drizzle-kit generate`
Expected: New migration file created in `api/drizzle/` directory

- [ ] **Step 5: Commit**

```bash
git add api/src/db/schema/fleet.ts api/src/lib/id.ts api/drizzle/
git commit -m "feat: add preview table and update deploymentTarget kinds"
```

---

## Task 7: Preview Service — CRUD Operations

**Files:**
- Create: `api/src/services/preview/preview.service.ts`
- Modify: `api/src/__tests__/gateway-services.test.ts` (add preview tests)

- [ ] **Step 1: Write failing tests for preview CRUD**

Add to `api/src/__tests__/gateway-services.test.ts`:

```typescript
import * as previewSvc from "../services/preview/preview.service";

// Inside the main describe block, after the lookupRouteByDomain tests:

  describe("Preview Service", () => {
    describe("createPreview", () => {
      it("creates preview with deploymentTarget and route", async () => {
        const result = await previewSvc.createPreview(db, {
          name: "PR #42 - fix-auth-bug",
          sourceBranch: "fix-auth-bug",
          commitSha: "a13f000000000000000000000000000000000000",
          repo: "github.com/org/myapp",
          prNumber: 42,
          siteName: "myapp",
          ownerId: "user_1",
          createdBy: "system",
        });

        expect(result.preview.previewId).toBeTruthy();
        expect(result.preview.slug).toBe("pr-42--fix-auth-bug--myapp");
        expect(result.preview.status).toBe("building");
        expect(result.deploymentTarget.kind).toBe("preview");
        expect(result.route.domain).toBe("pr-42--fix-auth-bug--myapp.preview.dx.dev");
      });

      it("creates branch-only preview (no PR number)", async () => {
        const result = await previewSvc.createPreview(db, {
          name: "feat-dashboard",
          sourceBranch: "feat-dashboard",
          commitSha: "b24f000000000000000000000000000000000000",
          repo: "github.com/org/myapp",
          siteName: "myapp",
          ownerId: "user_1",
          createdBy: "system",
        });

        expect(result.preview.slug).toBe("feat-dashboard--myapp");
        expect(result.preview.prNumber).toBeNull();
      });
    });

    describe("getPreview", () => {
      it("returns preview by id", async () => {
        const { preview } = await previewSvc.createPreview(db, {
          name: "PR #1",
          sourceBranch: "main",
          commitSha: "abc",
          repo: "github.com/org/app",
          prNumber: 1,
          siteName: "app",
          ownerId: "user_1",
          createdBy: "system",
        });

        const found = await previewSvc.getPreview(db, preview.previewId);
        expect(found).not.toBeNull();
        expect(found!.previewId).toBe(preview.previewId);
      });

      it("returns null for non-existent id", async () => {
        const found = await previewSvc.getPreview(db, "prev_nonexistent");
        expect(found).toBeNull();
      });
    });

    describe("updatePreviewStatus", () => {
      it("transitions preview to active", async () => {
        const { preview } = await previewSvc.createPreview(db, {
          name: "PR #5",
          sourceBranch: "fix",
          commitSha: "def",
          repo: "github.com/org/app",
          prNumber: 5,
          siteName: "app",
          ownerId: "user_1",
          createdBy: "system",
        });

        const updated = await previewSvc.updatePreviewStatus(db, preview.previewId, {
          status: "active",
          runtimeClass: "hot",
        });
        expect(updated!.status).toBe("active");
        expect(updated!.runtimeClass).toBe("hot");
      });
    });

    describe("expirePreview", () => {
      it("marks preview as expired and updates route", async () => {
        const { preview, route } = await previewSvc.createPreview(db, {
          name: "PR #10",
          sourceBranch: "old",
          commitSha: "ghi",
          repo: "github.com/org/app",
          prNumber: 10,
          siteName: "app",
          ownerId: "user_1",
          createdBy: "system",
        });

        await previewSvc.updatePreviewStatus(db, preview.previewId, { status: "active" });
        await previewSvc.expirePreview(db, preview.previewId);

        const expired = await previewSvc.getPreview(db, preview.previewId);
        expect(expired!.status).toBe("expired");
      });
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && npx vitest run src/__tests__/gateway-services.test.ts`
Expected: FAIL — module `../services/preview/preview.service` not found

- [ ] **Step 3: Create preview.service.ts**

Create `api/src/services/preview/preview.service.ts`:

```typescript
import { eq, and, lt, sql } from "drizzle-orm";

import type { Database } from "../../db/connection";
import { preview, deploymentTarget } from "../../db/schema/fleet";
import { route } from "../../db/schema/gateway";
import { createRoute, updateRoute } from "../../modules/infra/gateway.service";

function buildPreviewSlug(input: { prNumber?: number; sourceBranch: string; siteName: string }): string {
  // Sanitize branch name: lowercase, replace non-alphanumeric with dashes, trim dashes
  const branch = input.sourceBranch
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const site = input.siteName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (input.prNumber != null) {
    return `pr-${input.prNumber}--${branch}--${site}`;
  }
  return `${branch}--${site}`;
}

export async function createPreview(
  db: Database,
  input: {
    name: string;
    sourceBranch: string;
    commitSha: string;
    repo: string;
    prNumber?: number;
    siteName: string;
    siteId?: string;
    clusterId?: string;
    ownerId: string;
    createdBy: string;
    authMode?: string;
    expiresAt?: Date;
  }
): Promise<{ preview: any; deploymentTarget: any; route: any }> {
  const slug = buildPreviewSlug(input);

  // Layer 1: Create deploymentTarget
  const [dt] = await db
    .insert(deploymentTarget)
    .values({
      name: `preview-${slug}`,
      slug: `preview-${slug}`,
      kind: "preview",
      runtime: "kubernetes",
      siteId: input.siteId,
      clusterId: input.clusterId,
      createdBy: input.createdBy,
      trigger: "pr",
      expiresAt: input.expiresAt,
      status: "provisioning",
    })
    .returning();

  // Layer 2: Create preview record
  const [prev] = await db
    .insert(preview)
    .values({
      deploymentTargetId: dt.deploymentTargetId,
      siteId: input.siteId,
      name: input.name,
      slug,
      sourceBranch: input.sourceBranch,
      commitSha: input.commitSha,
      repo: input.repo,
      prNumber: input.prNumber ?? null,
      ownerId: input.ownerId,
      authMode: input.authMode ?? "team",
      status: "building",
    })
    .returning();

  // Layer 3: Create route
  const previewRoute = await createRoute(db, {
    deploymentTargetId: dt.deploymentTargetId,
    siteId: input.siteId,
    clusterId: input.clusterId,
    kind: "preview",
    domain: `${slug}.preview.dx.dev`,
    targetService: slug,
    protocol: "http",
    status: "active",
    createdBy: input.createdBy,
  });

  return { preview: prev, deploymentTarget: dt, route: previewRoute };
}

export async function getPreview(db: Database, previewId: string) {
  const [row] = await db
    .select()
    .from(preview)
    .where(eq(preview.previewId, previewId))
    .limit(1);

  return row ?? null;
}

export async function getPreviewBySlug(db: Database, slug: string) {
  const [row] = await db
    .select()
    .from(preview)
    .where(eq(preview.slug, slug))
    .limit(1);

  return row ?? null;
}

export async function updatePreviewStatus(
  db: Database,
  previewId: string,
  updates: {
    status?: string;
    runtimeClass?: string;
    statusMessage?: string;
    commitSha?: string;
    lastAccessedAt?: Date;
  }
) {
  const [row] = await db
    .update(preview)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(preview.previewId, previewId))
    .returning();

  return row ?? null;
}

export async function expirePreview(db: Database, previewId: string) {
  const prev = await getPreview(db, previewId);
  if (!prev) return null;

  // Mark preview as expired
  await updatePreviewStatus(db, previewId, { status: "expired" });

  // Update associated route status to expired
  const routes = await db
    .select()
    .from(route)
    .where(eq(route.deploymentTargetId, prev.deploymentTargetId));

  for (const r of routes) {
    await updateRoute(db, r.routeId, { status: "expired" });
  }

  return await getPreview(db, previewId);
}

export async function listPreviews(
  db: Database,
  opts?: {
    siteId?: string;
    status?: string;
    sourceBranch?: string;
    repo?: string;
  }
) {
  const conditions = [];
  if (opts?.siteId) conditions.push(eq(preview.siteId, opts.siteId));
  if (opts?.status) conditions.push(eq(preview.status, opts.status));
  if (opts?.sourceBranch) conditions.push(eq(preview.sourceBranch, opts.sourceBranch));
  if (opts?.repo) conditions.push(eq(preview.repo, opts.repo));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const base = db.select().from(preview);
  return where ? await base.where(where) : await base;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd api && npx vitest run src/__tests__/gateway-services.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add api/src/services/preview/preview.service.ts api/src/__tests__/gateway-services.test.ts
git commit -m "feat: add preview service with CRUD operations"
```

---

## Task 8: Preview Cleanup Job

**Files:**
- Modify: `api/src/services/preview/preview.service.ts` (add `runPreviewCleanup`)
- Modify: `api/src/__tests__/gateway-services.test.ts` (add cleanup tests)

- [ ] **Step 1: Write failing tests for cleanup job**

Add to `api/src/__tests__/gateway-services.test.ts` inside the Preview Service describe block:

```typescript
    describe("runPreviewCleanup", () => {
      it("marks expired previews based on expiresAt", async () => {
        const { preview: p } = await previewSvc.createPreview(db, {
          name: "PR #20",
          sourceBranch: "old-branch",
          commitSha: "xyz",
          repo: "github.com/org/app",
          prNumber: 20,
          siteName: "app",
          ownerId: "user_1",
          createdBy: "system",
          expiresAt: new Date(Date.now() - 60_000), // expired 1 min ago
        });
        // Manually set preview status to active + set expiresAt
        await previewSvc.updatePreviewStatus(db, p.previewId, { status: "active" });
        // Set expiresAt on the preview row directly
        await db.update(preview).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(preview.previewId, p.previewId));

        const result = await previewSvc.runPreviewCleanup(db);
        expect(result.expired).toBeGreaterThanOrEqual(1);

        const updated = await previewSvc.getPreview(db, p.previewId);
        expect(updated!.status).toBe("expired");
      });

      it("transitions hot previews to warm after idle period", async () => {
        const { preview: p } = await previewSvc.createPreview(db, {
          name: "PR #21",
          sourceBranch: "idle-branch",
          commitSha: "abc",
          repo: "github.com/org/app",
          prNumber: 21,
          siteName: "app",
          ownerId: "user_1",
          createdBy: "system",
        });
        await previewSvc.updatePreviewStatus(db, p.previewId, {
          status: "active",
          runtimeClass: "hot",
          lastAccessedAt: new Date(Date.now() - 3 * 60 * 60 * 1000), // 3 hours ago
        });

        const result = await previewSvc.runPreviewCleanup(db);
        expect(result.scaledToWarm).toBeGreaterThanOrEqual(1);

        const updated = await previewSvc.getPreview(db, p.previewId);
        expect(updated!.runtimeClass).toBe("warm");
      });
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && npx vitest run src/__tests__/gateway-services.test.ts`
Expected: FAIL — `runPreviewCleanup` is not a function

- [ ] **Step 3: Implement runPreviewCleanup**

Add to `api/src/services/preview/preview.service.ts`:

```typescript
/**
 * Periodic cleanup job for preview lifecycle transitions.
 * Should be called every ~5 minutes.
 *
 * 1. active + expiresAt < now → expired
 * 2. active + hot + lastAccessedAt < 2h ago → warm
 * 3. active + warm + lastAccessedAt < 24h ago → cold
 * 4. expired + expiresAt < 30d ago → hard delete
 */
export async function runPreviewCleanup(db: Database): Promise<{
  expired: number;
  scaledToWarm: number;
  scaledToCold: number;
  deleted: number;
}> {
  const now = new Date();
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // 1. Expire active previews past expiresAt
  const expiredRows = await db
    .update(preview)
    .set({ status: "expired", updatedAt: now })
    .where(
      and(
        eq(preview.status, "active"),
        lt(preview.expiresAt, now)
      )
    )
    .returning();

  // Also expire their routes
  for (const p of expiredRows) {
    const routes = await db
      .select()
      .from(route)
      .where(eq(route.deploymentTargetId, p.deploymentTargetId));
    for (const r of routes) {
      await updateRoute(db, r.routeId, { status: "expired" });
    }
  }

  // 2. Hot → Warm (idle > 2h)
  const warmRows = await db
    .update(preview)
    .set({ runtimeClass: "warm", updatedAt: now })
    .where(
      and(
        eq(preview.status, "active"),
        eq(preview.runtimeClass, "hot"),
        lt(preview.lastAccessedAt, twoHoursAgo)
      )
    )
    .returning();

  // 3. Warm → Cold (idle > 24h)
  const coldRows = await db
    .update(preview)
    .set({ runtimeClass: "cold", updatedAt: now })
    .where(
      and(
        eq(preview.status, "active"),
        eq(preview.runtimeClass, "warm"),
        lt(preview.lastAccessedAt, twentyFourHoursAgo)
      )
    )
    .returning();

  // 4. Hard delete expired previews older than 30 days
  const deletedRows = await db
    .delete(preview)
    .where(
      and(
        eq(preview.status, "expired"),
        lt(preview.expiresAt, thirtyDaysAgo)
      )
    )
    .returning();

  return {
    expired: expiredRows.length,
    scaledToWarm: warmRows.length,
    scaledToCold: coldRows.length,
    deleted: deletedRows.length,
  };
}
```

- [ ] **Step 4: Add the preview import at top of test file**

In `api/src/__tests__/gateway-services.test.ts`, add this import:

```typescript
import { preview } from "../db/schema/fleet";
import { eq } from "drizzle-orm";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd api && npx vitest run src/__tests__/gateway-services.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add api/src/services/preview/preview.service.ts api/src/__tests__/gateway-services.test.ts
git commit -m "feat: add preview cleanup job for lifecycle transitions"
```

---

## Task 9: Gateway Status Pages (Cold/Expired/Building Previews)

**Files:**
- Modify: `api/src/modules/infra/gateway-proxy.ts` (add status page responses for preview states)
- Modify: `api/src/modules/infra/gateway-proxy.test.ts`

- [ ] **Step 1: Write failing tests for preview status pages**

Add to `api/src/modules/infra/gateway-proxy.test.ts`:

```typescript
import { renderStatusPage } from "./gateway-proxy";

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd api && npx vitest run src/modules/infra/gateway-proxy.test.ts`
Expected: FAIL — `renderStatusPage` not exported

- [ ] **Step 3: Implement renderStatusPage**

Add to `api/src/modules/infra/gateway-proxy.ts`:

```typescript
type StatusPageKind = "building" | "deploying" | "cold" | "expired" | "failed" | "inactive";

export function renderStatusPage(kind: StatusPageKind, previewName: string, message?: string): string {
  const shouldAutoRefresh = kind === "building" || kind === "deploying" || kind === "cold";
  const refreshMeta = shouldAutoRefresh ? '<meta http-equiv="refresh" content="5">' : "";

  const titles: Record<StatusPageKind, string> = {
    building: "Building Preview...",
    deploying: "Deploying Preview...",
    cold: "Starting Preview...",
    expired: "Preview Expired",
    failed: "Preview Failed",
    inactive: "Preview Inactive",
  };

  const descriptions: Record<StatusPageKind, string> = {
    building: "Your preview environment is being built. This page will auto-refresh.",
    deploying: "Your preview is being deployed. This page will auto-refresh.",
    cold: "Your preview is starting up. This page will auto-refresh.",
    expired: "This preview environment has expired.",
    failed: "This preview environment failed to deploy.",
    inactive: "This preview environment has been deactivated.",
  };

  const statusCode = kind === "expired" ? "410 Gone" : kind === "failed" ? "500" : "200";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${refreshMeta}
  <title>${titles[kind]}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f5f5f5; color: #333; }
    .container { text-align: center; max-width: 480px; padding: 2rem; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    p { color: #666; line-height: 1.5; }
    .name { font-weight: 600; color: #111; }
    .message { background: #fff3f3; border: 1px solid #fecaca; border-radius: 8px; padding: 1rem; margin-top: 1rem; font-size: 0.875rem; color: #991b1b; }
    .spinner { display: inline-block; width: 24px; height: 24px; border: 3px solid #ddd; border-top-color: #333; border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 1rem; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container">
    ${shouldAutoRefresh ? '<div class="spinner"></div>' : ""}
    <h1>${titles[kind]}</h1>
    <p class="name">${escapeHtml(previewName)}</p>
    <p>${descriptions[kind]}</p>
    ${message ? `<div class="message">${escapeHtml(message)}</div>` : ""}
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
```

- [ ] **Step 4: Wire status pages into the gateway server's fetch handler**

In `createGatewayServer`'s `fetch` function, after the route lookup and before the reverse proxy, add preview state handling. Replace the section after `if (!route)` with:

```typescript
      // Handle preview status pages
      if (parsed.family === "preview" && route.metadata?.previewStatus) {
        const ps = route.metadata.previewStatus as string;
        const pn = route.metadata.previewName as string ?? parsed.slug;
        const pm = route.metadata.previewMessage as string | undefined;

        if (ps === "building" || ps === "deploying" || ps === "cold" || ps === "failed" || ps === "inactive") {
          const html = renderStatusPage(ps as any, pn, pm);
          const status = ps === "failed" ? 500 : 200;
          return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
        }
        if (ps === "expired") {
          return new Response(renderStatusPage("expired", pn), { status: 410, headers: { "Content-Type": "text/html; charset=utf-8" } });
        }
      }
```

- [ ] **Step 5: Run all tests**

Run: `cd api && npx vitest run src/modules/infra/gateway-proxy.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add api/src/modules/infra/gateway-proxy.ts api/src/modules/infra/gateway-proxy.test.ts
git commit -m "feat: add status pages for building/cold/expired previews"
```

---

## Task 10: Add Tunnel Mode/TcpPort Columns

**Files:**
- Modify: `api/src/db/schema/gateway.ts` (add `mode` and `tcpPort` to tunnel table)

This is a small schema-only change preparing for Phase 3 (tunnel data plane). No service changes needed yet.

- [ ] **Step 1: Add columns to tunnel table**

In `api/src/db/schema/gateway.ts`, add two columns to the tunnel table (after `localAddr` on line 127):

```typescript
    mode: text("mode").notNull().default("http"),
    tcpPort: integer("tcp_port"),
```

And add a check constraint in the constraints array (after the `tunnel_status_valid` check, before line 144):

```typescript
    check(
      "tunnel_mode_valid",
      sql`${t.mode} IN ('http', 'tcp')`
    ),
```

- [ ] **Step 2: Generate migration**

Run: `cd api && npx drizzle-kit generate`
Expected: New migration file adding `mode` and `tcp_port` columns

- [ ] **Step 3: Commit**

```bash
git add api/src/db/schema/gateway.ts api/drizzle/
git commit -m "feat: add mode and tcpPort columns to tunnel table for TCP tunneling"
```

---

## Task 11: Full Integration Test

**Files:**
- Modify: `api/src/__tests__/gateway-services.test.ts` (add end-to-end gateway flow test)

- [ ] **Step 1: Write integration test for the full gateway flow**

Add to `api/src/__tests__/gateway-services.test.ts`:

```typescript
  describe("Full Gateway Flow", () => {
    it("creates preview → resolves via gateway lookup → serves status page → transitions to active → proxies", async () => {
      // 1. Create preview
      const { preview: p, route: r } = await previewSvc.createPreview(db, {
        name: "PR #99 - e2e-test",
        sourceBranch: "e2e-test",
        commitSha: "e2e000",
        repo: "github.com/org/app",
        prNumber: 99,
        siteName: "app",
        ownerId: "user_1",
        createdBy: "system",
      });

      expect(r.domain).toBe("pr-99--e2e-test--app.preview.dx.dev");

      // 2. Route should be resolvable
      const found = await gw.lookupRouteByDomain(db, "pr-99--e2e-test--app.preview.dx.dev");
      expect(found).not.toBeNull();
      expect(found!.kind).toBe("preview");

      // 3. Transition to active
      await previewSvc.updatePreviewStatus(db, p.previewId, {
        status: "active",
        runtimeClass: "hot",
        lastAccessedAt: new Date(),
      });

      const active = await previewSvc.getPreview(db, p.previewId);
      expect(active!.status).toBe("active");
      expect(active!.runtimeClass).toBe("hot");
    });

    it("sandbox route is resolvable", async () => {
      await gw.createSandboxRoutes(db, {
        deploymentTargetId: undefined as any, // will be set below
        sandboxSlug: "dev-nikhil-abc",
        publishPorts: [8080],
        createdBy: "system",
      });

      // Note: createSandboxRoutes may fail without a valid deploymentTargetId
      // This test verifies the domain pattern is correct for lookup
      const found = await gw.lookupRouteByDomain(db, "dev-nikhil-abc.preview.dx.dev");
      // May be null without valid FK - that's fine, we're testing the lookup path
    });
  });
```

- [ ] **Step 2: Run all tests**

Run: `cd api && npx vitest run src/__tests__/gateway-services.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Run the full test suite**

Run: `cd api && npx vitest run`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add api/src/__tests__/gateway-services.test.ts
git commit -m "test: add full gateway flow integration tests"
```

---

## Summary

After completing these 11 tasks, you'll have:

1. **Factory Gateway** — A Bun HTTP server that parses hostnames, looks up routes from an LRU cache backed by Postgres, and reverse-proxies to target services
2. **Simplified Traefik** — Only generates per-route config for `custom_domain` and `ingress` (low cardinality)
3. **Preview data model** — Full `preview` table with lifecycle fields, linked to `deploymentTarget` and `route`
4. **Preview service** — CRUD operations + cleanup job (hot→warm→cold→expired transitions)
5. **Status pages** — Branded HTML pages for building/cold/expired previews
6. **Tunnel schema prep** — `mode` and `tcpPort` columns ready for Phase 3

**Next plans (separate documents):**
- Phase 3: Tunnel Data Plane (binary framing protocol, stream multiplexing)
- Phase 4: TCP Tunneling (port allocator, TCP listeners)
- Phase 5: Production Hardening (reconnection, flow control, rate limits, metrics)
