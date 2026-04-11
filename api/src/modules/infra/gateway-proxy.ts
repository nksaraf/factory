import { LRUCache } from "lru-cache"

import type { Database } from "../../db/connection"
import { logger as rootLogger } from "../../logger"
import { lookupRouteByDomain, setRouteChangeListener } from "./gateway.service"
import type { StreamManager } from "./tunnel-streams"

const logger = rootLogger.child({ module: "gateway-proxy" })

export type RouteFamily = "tunnel" | "preview" | "sandbox" | "workbench"

export interface ParsedHost {
  family: RouteFamily
  slug: string // base sandbox/preview slug (e.g. "my-env")
  port?: number // from -p{port} suffix (e.g. 3000)
  endpointName?: string // from --{name} suffix (e.g. "terminal")
  fullSubdomain: string // full subdomain for route lookup (e.g. "my-env-p3000" or "my-env--terminal")
}

function getGatewayDomain(): string {
  return process.env.DX_GATEWAY_DOMAIN ?? "dx.dev"
}

function getFamilySuffixes(): { suffix: string; family: RouteFamily }[] {
  const domain = getGatewayDomain()
  return [
    { suffix: `.tunnel.${domain}`, family: "tunnel" },
    { suffix: `.preview.${domain}`, family: "preview" },
    // Legacy public hostname; routes are stored as *.workbench.{domain}
    { suffix: `.workspace.${domain}`, family: "workbench" },
    { suffix: `.workbench.${domain}`, family: "workbench" },
    { suffix: `.sandbox.${domain}`, family: "sandbox" },
  ]
}

// Patterns for port-based (-p3000) and named endpoint (--terminal) suffixes
const PORT_SUFFIX_RE = /^(.+)-p(\d+)$/
const NAME_SUFFIX_RE = /^(.+)--([a-z][a-z0-9-]*)$/

export function parseHostname(host: string | undefined): ParsedHost | null {
  if (!host) return null

  // Strip port if present
  const hostname = host.split(":")[0]

  for (const { suffix, family } of getFamilySuffixes()) {
    if (hostname.endsWith(suffix)) {
      const fullSubdomain = hostname.slice(0, -suffix.length)
      if (fullSubdomain.length === 0) continue

      // Try to parse port suffix: {slug}-p{port}
      const portMatch = PORT_SUFFIX_RE.exec(fullSubdomain)
      if (portMatch) {
        return {
          family,
          slug: portMatch[1]!,
          port: parseInt(portMatch[2]!, 10),
          fullSubdomain,
        }
      }

      // Try to parse named endpoint suffix: {slug}--{name}
      const nameMatch = NAME_SUFFIX_RE.exec(fullSubdomain)
      if (nameMatch) {
        return {
          family,
          slug: nameMatch[1]!,
          endpointName: nameMatch[2]!,
          fullSubdomain,
        }
      }

      // Bare subdomain (no port or name suffix)
      return { family, slug: fullSubdomain, fullSubdomain }
    }
  }

  return null
}

export interface RouteCacheOptions {
  lookup: (domain: string) => Promise<any | null>
  maxSize?: number
  ttlMs?: number
}

const SENTINEL_NULL = Symbol("null")

export class RouteCache {
  private cache: LRUCache<string, any>
  private lookup: (domain: string) => Promise<any | null>

  constructor(opts: RouteCacheOptions) {
    this.lookup = opts.lookup
    this.cache = new LRUCache<string, any>({
      max: opts.maxSize ?? 10_000,
      ttl: opts.ttlMs ?? 300_000, // 5 min default
    })
  }

  async get(domain: string): Promise<any | null> {
    const cached = this.cache.get(domain)
    if (cached !== undefined) {
      return cached === SENTINEL_NULL ? null : cached
    }

    const result = await this.lookup(domain)
    // Only cache positive hits. Misses are not cached so that newly
    // created routes are discoverable immediately — the DB lookup is
    // fast enough for the miss path, and once the route exists the
    // positive hit will be cached normally.
    if (result) {
      this.cache.set(domain, result)
    }
    return result
  }

  invalidate(domain: string): void {
    this.cache.delete(domain)
  }

  clear(): void {
    this.cache.clear()
  }
}

export interface AuthCheckResult {
  allowed: boolean
  principalId?: string
  redirectUrl?: string
}

export type AuthCheckFn = (
  req: Request,
  resource: { kind: string; slug: string; authMode: string }
) => Promise<AuthCheckResult>

export interface GatewayServerOptions {
  cache: RouteCache
  port?: number
  getTunnelStreamManager?: (subdomain: string) => StreamManager | undefined
  checkAuth?: AuthCheckFn
}

/**
 * Per-WebSocket state for browser↔tunnel bridging.
 * Stored in Bun's `ws.data` via `server.upgrade(req, { data })`.
 */
interface TunnelWsData {
  kind: "tunnel"
  streamId: number
  sm: StreamManager
}

/**
 * Per-WebSocket state for browser↔backend bridging (workbench/preview).
 * The gateway opens a raw WebSocket to the backend NodePort service and
 * relays frames in both directions.
 */
interface ProxyWsData {
  kind: "proxy"
  backend: WebSocket
}

type WsUpgradeData = TunnelWsData | ProxyWsData

export function createGatewayServer(opts: GatewayServerOptions) {
  const { cache, port = 9090 } = opts

  /**
   * Shared request handler for both HTTP and WebSocket upgrade paths.
   * Returns { parsed, route, tunnelSubdomain, sm } or a Response (error).
   */
  async function resolveRoute(req: Request): Promise<
    | Response
    | {
        parsed: ParsedHost
        route: any
        tunnelSubdomain: string
        sm: StreamManager | null
      }
  > {
    const host = req.headers.get("host") ?? ""
    const url = new URL(req.url)
    const parsed = parseHostname(host)

    logger.info(
      {
        method: req.method,
        host,
        path: url.pathname,
        family: parsed?.family,
        slug: parsed?.slug,
      },
      "gateway request"
    )

    if (!parsed) {
      logger.warn({ host }, "gateway no route match")
      return new Response("Not Found", { status: 404 })
    }

    const gwd = getGatewayDomain()
    const suffixMap: Record<RouteFamily, string> = {
      tunnel: `.tunnel.${gwd}`,
      preview: `.preview.${gwd}`,
      workbench: `.workbench.${gwd}`,
      sandbox: `.sandbox.${gwd}`,
    }
    const domain = parsed.fullSubdomain + suffixMap[parsed.family]

    const route = await cache.get(domain)
    if (!route) {
      logger.warn({ domain }, "gateway route not found in db")
      return new Response("Not Found", { status: 404 })
    }
    logger.debug(
      { domain, kind: route.kind, targetService: route.targetService },
      "gateway route matched"
    )

    // Auth enforcement for sandbox/preview routes
    if (
      opts.checkAuth &&
      (route.kind === "sandbox" ||
        route.kind === "workbench" ||
        route.kind === "preview")
    ) {
      const authMode = route.metadata?.authMode ?? "private"
      if (authMode !== "public") {
        const authResult = await opts.checkAuth(req, {
          kind: route.kind,
          slug: parsed.slug,
          authMode,
        })
        if (!authResult.allowed) {
          if (authResult.redirectUrl) {
            return Response.redirect(authResult.redirectUrl, 302)
          }
          return new Response("Unauthorized", { status: 401 })
        }
      }
    }

    const isTunnelBacked = route.targetService === "tunnel-broker"
    if (!(parsed.family === "tunnel" || isTunnelBacked)) {
      // Not a tunnel route — return null sm so caller can handle reverse proxy
      return { parsed, route, tunnelSubdomain: "", sm: null }
    }

    const tunnelSubdomain = isTunnelBacked ? parsed.fullSubdomain : parsed.slug
    const sm = opts.getTunnelStreamManager?.(tunnelSubdomain)
    if (!sm) {
      logger.warn({ tunnelSubdomain, domain }, "tunnel not connected")
      return new Response("Tunnel Not Connected", { status: 502 })
    }

    return { parsed, route, tunnelSubdomain, sm }
  }

  const server = Bun.serve<WsUpgradeData>({
    port,
    async fetch(req, server) {
      const result = await resolveRoute(req)
      if (result instanceof Response) return result

      const { parsed, route, sm } = result
      const isTunnelBacked = route.targetService === "tunnel-broker"

      // WebSocket upgrade: bridge browser WS ↔ tunnel WS_DATA frames
      if (
        (parsed.family === "tunnel" || isTunnelBacked) &&
        sm &&
        req.headers.get("upgrade")?.toLowerCase() === "websocket"
      ) {
        const headerObj: Record<string, string> = {}
        req.headers.forEach((val, key) => {
          headerObj[key] = val
        })
        const reqUrl = new URL(req.url)

        // Initiate WS_UPGRADE through the tunnel to the local server
        const streamId = sm.sendWsUpgrade({
          url: reqUrl.pathname + reqUrl.search,
          headers: headerObj,
        })

        logger.debug(
          { streamId, path: reqUrl.pathname },
          "gateway upgrading ws"
        )

        // Upgrade the browser connection to WebSocket
        const upgraded = server.upgrade(req, {
          data: { kind: "tunnel" as const, streamId, sm },
        })
        if (!upgraded) {
          return new Response("WebSocket upgrade failed", { status: 500 })
        }
        return new Response(null) // Bun ignores return after upgrade
      }

      // HTTP tunnel proxy
      if ((parsed.family === "tunnel" || isTunnelBacked) && sm) {
        try {
          const headerObj: Record<string, string> = {}
          req.headers.forEach((val, key) => {
            headerObj[key] = val
          })

          const reqUrl = new URL(req.url)
          const tunnelRes = await sm.sendHttpRequest(
            {
              method: req.method,
              url: reqUrl.pathname + reqUrl.search,
              headers: headerObj,
            },
            { body: req.body ?? undefined, timeoutMs: 30_000 }
          )

          return new Response(tunnelRes.body, {
            status: tunnelRes.status,
            headers: tunnelRes.headers,
          })
        } catch (err) {
          logger.error({ err }, "tunnel proxy error")
          return new Response("Gateway Timeout", { status: 504 })
        }
      }

      // Reverse proxy for preview/workbench (NodePort-backed routes)
      const targetPort = route.targetPort ?? 80
      const targetUrl = new URL(req.url)
      targetUrl.hostname = route.targetService
      targetUrl.port = String(targetPort)
      targetUrl.protocol = "http:"

      // WebSocket upgrade for workbench/preview routes
      const upgradeHeader = req.headers.get("upgrade")
      if (upgradeHeader?.toLowerCase() === "websocket") {
        const wsTarget = new URL(targetUrl)
        wsTarget.protocol = "ws:"
        logger.debug(
          { target: wsTarget.toString(), targetPort },
          "workbench ws upgrade"
        )

        try {
          // Forward subprotocols (e.g. ttyd requires "tty", VS Code uses its own)
          const subprotocols =
            req.headers
              .get("sec-websocket-protocol")
              ?.split(",")
              .map((s) => s.trim()) ?? []
          const backend =
            subprotocols.length > 0
              ? new WebSocket(wsTarget.toString(), subprotocols)
              : new WebSocket(wsTarget.toString())
          backend.binaryType = "arraybuffer"

          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error("backend ws connect timeout")),
              10_000
            )
            backend.addEventListener(
              "open",
              () => {
                clearTimeout(timer)
                resolve()
              },
              { once: true }
            )
            backend.addEventListener(
              "error",
              (e) => {
                clearTimeout(timer)
                reject(e)
              },
              { once: true }
            )
          })

          const upgraded = server.upgrade(req, {
            data: { kind: "proxy" as const, backend },
          })
          if (!upgraded) {
            backend.close()
            return new Response("WebSocket upgrade failed", { status: 500 })
          }
          return new Response(null) // Bun ignores return after upgrade
        } catch (err) {
          logger.error(
            { err, target: wsTarget.toString() },
            "workbench ws proxy error"
          )
          return new Response("Bad Gateway", { status: 502 })
        }
      }

      try {
        const proxyRes = await fetch(targetUrl.toString(), {
          method: req.method,
          headers: req.headers,
          body: req.body,
          redirect: "manual",
        })
        // fetch() auto-decompresses gzip/br but keeps the Content-Encoding header.
        // Strip encoding headers so the browser doesn't try to decompress again.
        const respHeaders = new Headers(proxyRes.headers)
        respHeaders.delete("content-encoding")
        respHeaders.delete("content-length")
        return new Response(proxyRes.body, {
          status: proxyRes.status,
          statusText: proxyRes.statusText,
          headers: respHeaders,
        })
      } catch (err) {
        logger.error(
          { err, targetService: route.targetService, targetPort },
          "reverse proxy error"
        )
        return new Response("Bad Gateway", { status: 502 })
      }
    },

    // WebSocket handler: bridges browser WS ↔ backend (tunnel or direct proxy)
    websocket: {
      // Disable per-message deflate — ttyd and VS Code send pre-compressed
      // binary frames; compressing again wastes CPU and can corrupt data.
      perMessageDeflate: false,
      open(ws) {
        if (ws.data.kind === "tunnel") {
          const { streamId, sm } = ws.data
          logger.debug({ streamId }, "gateway tunnel ws bridge opened")

          sm.registerWsStream(streamId, {
            onMessage(_sid: number, data: Uint8Array, isBinary: boolean) {
              ws.send(isBinary ? data : new TextDecoder().decode(data))
            },
            onClose(_sid: number) {
              ws.close()
            },
          })
        } else {
          const { backend } = ws.data
          logger.debug("gateway proxy ws bridge opened")

          // Relay backend → browser
          backend.addEventListener("message", (ev: MessageEvent) => {
            try {
              if (typeof ev.data === "string") {
                ws.send(ev.data)
              } else {
                ws.sendBinary(new Uint8Array(ev.data as ArrayBuffer))
              }
            } catch {
              /* client disconnected */
            }
          })
          backend.addEventListener("close", () => {
            try {
              ws.close()
            } catch {
              /* already closed */
            }
          })
          backend.addEventListener("error", () => {
            try {
              ws.close()
            } catch {}
          })
        }
      },

      message(ws, message) {
        if (ws.data.kind === "tunnel") {
          const { streamId, sm } = ws.data
          try {
            if (typeof message === "string") {
              sm.sendWsData(streamId, new TextEncoder().encode(message), false)
            } else {
              const bytes =
                message instanceof ArrayBuffer
                  ? new Uint8Array(message)
                  : new Uint8Array(
                      message.buffer,
                      message.byteOffset,
                      message.byteLength
                    )
              sm.sendWsData(streamId, bytes, true)
            }
          } catch {
            /* tunnel WS closed */
          }
        } else {
          // Relay browser → backend
          const { backend } = ws.data
          try {
            if (typeof message === "string") {
              backend.send(message)
            } else {
              const buf =
                message instanceof ArrayBuffer
                  ? message
                  : message.buffer.slice(
                      message.byteOffset,
                      message.byteOffset + message.byteLength
                    )
              backend.send(buf)
            }
          } catch {
            /* backend disconnected */
          }
        }
      },

      close(ws) {
        if (ws.data.kind === "tunnel") {
          const { streamId, sm } = ws.data
          logger.debug({ streamId }, "gateway tunnel ws bridge closed")
          try {
            sm.sendWsClose(streamId)
          } catch {
            /* tunnel WS already closed */
          }
          sm.unregisterWsStream(streamId)
        } else {
          logger.debug("gateway proxy ws bridge closed")
          try {
            ws.data.backend.close()
          } catch {}
        }
      },
    },
  })

  return {
    server,
    stop() {
      server.stop()
    },
  }
}

type StatusPageKind =
  | "building"
  | "deploying"
  | "cold"
  | "expired"
  | "failed"
  | "inactive"

export function renderStatusPage(
  kind: StatusPageKind,
  previewName: string,
  message?: string
): string {
  const shouldAutoRefresh =
    kind === "building" || kind === "deploying" || kind === "cold"
  const refreshMeta = shouldAutoRefresh
    ? '<meta http-equiv="refresh" content="5">'
    : ""

  const titles: Record<StatusPageKind, string> = {
    building: "Building Preview...",
    deploying: "Deploying Preview...",
    cold: "Starting Preview...",
    expired: "Preview Expired",
    failed: "Preview Failed",
    inactive: "Preview Inactive",
  }

  const descriptions: Record<StatusPageKind, string> = {
    building:
      "Your preview environment is being built. This page will auto-refresh.",
    deploying: "Your preview is being deployed. This page will auto-refresh.",
    cold: "Your preview is starting up. This page will auto-refresh.",
    expired: "This preview environment has expired.",
    failed: "This preview environment failed to deploy.",
    inactive: "This preview environment has been deactivated.",
  }

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
</html>`
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export function startGateway(opts: {
  db: Database
  port?: number
  getTunnelStreamManager?: (subdomain: string) => StreamManager | undefined
  checkAuth?: AuthCheckFn
}) {
  const cache = new RouteCache({
    lookup: (domain) => lookupRouteByDomain(opts.db, domain),
    maxSize: 10_000,
    ttlMs: 300_000,
  })

  // Wire up cache invalidation
  setRouteChangeListener((domain) => cache.invalidate(domain))

  const gwPort = opts.port ?? 9090
  const gw = createGatewayServer({
    cache,
    port: gwPort,
    getTunnelStreamManager: opts.getTunnelStreamManager,
    checkAuth: opts.checkAuth,
  })

  logger.info(
    { port: gwPort, domain: getGatewayDomain() },
    "gateway proxy started"
  )
  return { ...gw, cache }
}
