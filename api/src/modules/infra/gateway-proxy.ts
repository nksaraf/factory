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
