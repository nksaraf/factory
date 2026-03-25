import { LRUCache } from "lru-cache";
import type { Database } from "../../db/connection";
import { lookupRouteByDomain, setRouteChangeListener } from "./gateway.service";

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
