/**
 * Tunnel smoke test — boots a real Elysia server with PGlite,
 * connects a WebSocket tunnel client, starts the gateway proxy,
 * and verifies full round-trip: HTTP → gateway proxy → tunnel → local server → response.
 *
 * This test catches:
 *  - WebSocket upgrade failures (runtime adapter issues)
 *  - Tunnel registration DB errors (schema mismatches, silent catch blocks)
 *  - Gateway proxy hostname parsing (DX_GATEWAY_DOMAIN misconfig)
 *  - Route lookup failures (domain not found in DB)
 *  - Binary framing protocol round-trip (GET, POST with body, large responses)
 *  - Tunnel disconnect cleanup
 *  - Response header preservation
 *
 * Requires Bun runtime (uses Bun.serve, WebSocket, app.listen).
 * Run: cd api && bun test src/__tests__/tunnel-smoke.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { createTestContext } from "../test-helpers"
import type { Database } from "../db/connection"
import type { PGlite } from "@electric-sql/pglite"
import {
  createGatewayServer,
  parseHostname,
  RouteCache,
} from "../modules/infra/gateway-proxy"
import { getTunnelStreamManager } from "../modules/infra/tunnel-broker"
import { lookupRouteByDomain } from "../modules/infra/gateway.service"
import {
  handleBinaryFrame,
  type PendingBodies,
} from "../../../cli/src/lib/tunnel-client"

// Prevent the onStart hook from auto-starting gateway on port 9090
process.env.__DX_SKIP_GATEWAY_ONSTART = "1"

const GATEWAY_DOMAIN = process.env.DX_GATEWAY_DOMAIN ?? "dx.dev"

// Pick random ports to avoid conflicts
const API_PORT = 14100 + Math.floor(Math.random() * 1000)
const GATEWAY_PORT = 19090 + Math.floor(Math.random() * 1000)
const LOCAL_PORT = 18000 + Math.floor(Math.random() * 1000)

// Port for a second local server that we intentionally don't start (unreachable)
const DEAD_PORT = 18999 + Math.floor(Math.random() * 1000)

describe("Tunnel Smoke Test", () => {
  let db: Database
  let client: PGlite
  let apiServer: { stop: () => void } | null = null
  let gatewayServer: ReturnType<typeof createGatewayServer> | null = null
  let localServer: ReturnType<typeof Bun.serve> | null = null
  let tunnelWs: WebSocket | null = null
  let tunnel2Ws: WebSocket | null = null

  beforeAll(async () => {
    const ctx = await createTestContext()
    db = ctx.db as unknown as Database
    client = ctx.client

    // Start the Elysia API server on a random port
    apiServer = ctx.app.listen(API_PORT)

    // Start a mock local dev server (simulates user's localhost)
    localServer = Bun.serve({
      port: LOCAL_PORT,
      async fetch(req, server) {
        const url = new URL(req.url)

        // WebSocket upgrade for echo endpoint
        if (url.pathname === "/ws-echo" && req.headers.get("upgrade")?.toLowerCase() === "websocket") {
          const upgraded = server.upgrade(req)
          if (upgraded) return undefined as any
          return new Response("WebSocket upgrade failed", { status: 500 })
        }

        // Echo endpoint: returns method, path, query, headers, body
        if (url.pathname === "/echo") {
          const body = req.body ? await req.text() : null
          return new Response(
            JSON.stringify({
              method: req.method,
              path: url.pathname,
              query: url.search,
              body,
            }),
            {
              headers: {
                "content-type": "application/json",
                "x-custom-header": "tunnel-works",
                "x-request-id": "smoke-123",
              },
            },
          )
        }

        // Large response endpoint: returns ~100KB of data
        if (url.pathname === "/large") {
          const chunk = "x".repeat(1024) // 1KB
          const body = Array.from({ length: 100 }, () => chunk).join("")
          return new Response(body, {
            headers: { "content-type": "text/plain" },
          })
        }

        // Default: return path + host
        return new Response(
          JSON.stringify({
            path: url.pathname,
            host: req.headers.get("host"),
          }),
          { headers: { "content-type": "application/json" } },
        )
      },
      websocket: {
        message(ws, message) {
          // Echo back with prefix
          const text = typeof message === "string" ? message : new TextDecoder().decode(message)
          ws.send(`echo:${text}`)
        },
      },
    })
  }, 15_000)

  afterAll(async () => {
    tunnelWs?.close()
    tunnel2Ws?.close()
    gatewayServer?.stop()
    localServer?.stop()
    apiServer?.stop()
    await client.close()
  })

  // =========================================================================
  // Core: server boots and routes are registered
  // =========================================================================

  it("1. health endpoint responds", async () => {
    const res = await fetch(`http://localhost:${API_PORT}/health`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe("ok")
  })

  it("2. tunnel WS endpoint exists", async () => {
    const res = await fetch(
      `http://localhost:${API_PORT}/api/v1/factory/infra/gateway/tunnels/ws`,
    )
    expect([101, 400, 404, 426]).toContain(res.status)
  })

  // =========================================================================
  // Tunnel registration
  // =========================================================================

  it("3. WebSocket tunnel registers and handles binary frames", async () => {
    const registered = await registerTunnel({
      port: API_PORT,
      localPort: LOCAL_PORT,
      subdomain: "smoke-test",
      onWs: (ws) => { tunnelWs = ws },
    })

    expect(registered.tunnelId).toBeTruthy()
    expect(registered.subdomain).toBe("smoke-test")
    expect(registered.url).toBe(`https://smoke-test.tunnel.${GATEWAY_DOMAIN}`)
  }, 10_000)

  it("4. parseHostname resolves tunnel subdomains for configured domain", () => {
    const parsed = parseHostname(`smoke-test.tunnel.${GATEWAY_DOMAIN}`)
    expect(parsed).not.toBeNull()
    expect(parsed!.family).toBe("tunnel")
    expect(parsed!.slug).toBe("smoke-test")
  })

  it("5. parseHostname handles port-suffixed subdomains", () => {
    const parsed = parseHostname(`my-env-p3000.tunnel.${GATEWAY_DOMAIN}`)
    expect(parsed).not.toBeNull()
    expect(parsed!.family).toBe("tunnel")
    expect(parsed!.slug).toBe("my-env")
    expect(parsed!.port).toBe(3000)
  })

  it("6. parseHostname handles named endpoint subdomains", () => {
    const parsed = parseHostname(`my-env--terminal.sandbox.${GATEWAY_DOMAIN}`)
    expect(parsed).not.toBeNull()
    expect(parsed!.family).toBe("sandbox")
    expect(parsed!.slug).toBe("my-env")
    expect(parsed!.endpointName).toBe("terminal")
  })

  it("7. tunnel route exists in database", async () => {
    const route = await lookupRouteByDomain(
      db,
      `smoke-test.tunnel.${GATEWAY_DOMAIN}`,
    )
    expect(route).not.toBeNull()
    expect(route!.kind).toBe("tunnel")
    expect(route!.targetService).toBe("tunnel-broker")
    expect(route!.status).toBe("active")
  })

  // =========================================================================
  // Gateway proxy: round-trip
  // =========================================================================

  it("8. gateway proxy forwards GET through tunnel", async () => {
    startGateway()
    await new Promise((r) => setTimeout(r, 100))

    const res = await fetch(`http://localhost:${GATEWAY_PORT}/hello?foo=bar`, {
      headers: { host: `smoke-test.tunnel.${GATEWAY_DOMAIN}` },
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { path: string }
    expect(body.path).toBe("/hello")
  }, 15_000)

  it("9. gateway proxy forwards POST with body (body round-trip)", async () => {
    const payload = JSON.stringify({ message: "hello from tunnel", count: 42 })
    const res = await fetch(`http://localhost:${GATEWAY_PORT}/echo`, {
      method: "POST",
      headers: {
        host: `smoke-test.tunnel.${GATEWAY_DOMAIN}`,
        "content-type": "application/json",
      },
      body: payload,
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { method: string; body: string }
    expect(body.method).toBe("POST")
    expect(body.body).toBe(payload)
  }, 15_000)

  it("10. response headers are preserved through tunnel", async () => {
    const res = await fetch(`http://localhost:${GATEWAY_PORT}/echo`, {
      headers: { host: `smoke-test.tunnel.${GATEWAY_DOMAIN}` },
    })

    expect(res.status).toBe(200)
    expect(res.headers.get("x-custom-header")).toBe("tunnel-works")
    expect(res.headers.get("x-request-id")).toBe("smoke-123")
  }, 15_000)

  it("11. query string is preserved through tunnel", async () => {
    const res = await fetch(
      `http://localhost:${GATEWAY_PORT}/echo?key=value&arr=1&arr=2`,
      { headers: { host: `smoke-test.tunnel.${GATEWAY_DOMAIN}` } },
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as { query: string }
    expect(body.query).toBe("?key=value&arr=1&arr=2")
  }, 15_000)

  it("12. large response body (~100KB) survives chunked transfer", async () => {
    const res = await fetch(`http://localhost:${GATEWAY_PORT}/large`, {
      headers: { host: `smoke-test.tunnel.${GATEWAY_DOMAIN}` },
    })

    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body.length).toBe(100 * 1024) // 100KB
    expect(body).toBe("x".repeat(100 * 1024))
  }, 15_000)

  it("13. large POST body (~200KB) survives chunked transfer", async () => {
    const largeBody = "A".repeat(200 * 1024) // 200KB — exceeds MAX_PAYLOAD_SIZE (64KB)
    const res = await fetch(`http://localhost:${GATEWAY_PORT}/echo`, {
      method: "POST",
      headers: {
        host: `smoke-test.tunnel.${GATEWAY_DOMAIN}`,
        "content-type": "text/plain",
      },
      body: largeBody,
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { method: string; body: string }
    expect(body.method).toBe("POST")
    expect(body.body?.length).toBe(200 * 1024)
    expect(body.body).toBe(largeBody)
  }, 30_000)

  // =========================================================================
  // WebSocket passthrough
  // =========================================================================

  it("14. WebSocket upgrade through tunnel round-trips messages", async () => {
    // The gateway proxy should upgrade browser WS → tunnel WS_DATA frames
    // → local WS server, and bridge messages in both directions.
    const ws = new WebSocket(
      `ws://localhost:${GATEWAY_PORT}/ws-echo`,
      { headers: { host: `smoke-test.tunnel.${GATEWAY_DOMAIN}` } } as any,
    )

    const messages: string[] = []
    const opened = new Promise<void>((resolve) => {
      ws.addEventListener("open", () => resolve())
    })
    const closed = new Promise<void>((resolve) => {
      ws.addEventListener("close", () => resolve())
    })
    ws.addEventListener("message", (event) => {
      messages.push(typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data as any))
    })

    await opened
    ws.send("ping-1")
    ws.send("ping-2")
    // Give time for round-trip
    await new Promise((r) => setTimeout(r, 500))
    ws.close()
    await closed

    expect(messages).toContain("echo:ping-1")
    expect(messages).toContain("echo:ping-2")
  }, 15_000)

  // =========================================================================
  // Multiple concurrent tunnels
  // =========================================================================

  it("15. second tunnel on different subdomain works independently", async () => {
    const registered = await registerTunnel({
      port: API_PORT,
      localPort: LOCAL_PORT,
      subdomain: "smoke-test-2",
      onWs: (ws) => { tunnel2Ws = ws },
    })

    expect(registered.subdomain).toBe("smoke-test-2")

    // Both tunnels should respond
    const [res1, res2] = await Promise.all([
      fetch(`http://localhost:${GATEWAY_PORT}/echo`, {
        headers: { host: `smoke-test.tunnel.${GATEWAY_DOMAIN}` },
      }),
      fetch(`http://localhost:${GATEWAY_PORT}/echo`, {
        headers: { host: `smoke-test-2.tunnel.${GATEWAY_DOMAIN}` },
      }),
    ])

    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)
  }, 15_000)

  // =========================================================================
  // Error paths
  // =========================================================================

  it("16. gateway returns 404 for unknown tunnel subdomain", async () => {
    const res = await fetch(`http://localhost:${GATEWAY_PORT}/`, {
      headers: { host: `nonexistent.tunnel.${GATEWAY_DOMAIN}` },
    })
    expect(res.status).toBe(404)
  })

  it("17. gateway returns 404 for unrecognized host", async () => {
    const res = await fetch(`http://localhost:${GATEWAY_PORT}/`, {
      headers: { host: "random.example.com" },
    })
    expect(res.status).toBe(404)
  })

  it("18. tunnel disconnect: gateway returns 502 after WS closes", async () => {
    // Register a tunnel that we'll close
    const ephemeralWs = await new Promise<WebSocket>((resolve) => {
      let ws: WebSocket
      registerTunnel({
        port: API_PORT,
        localPort: LOCAL_PORT,
        subdomain: "ephemeral",
        onWs: (w) => { ws = w },
      }).then(() => resolve(ws!))
    })

    // Verify it works first
    const before = await fetch(`http://localhost:${GATEWAY_PORT}/echo`, {
      headers: { host: `ephemeral.tunnel.${GATEWAY_DOMAIN}` },
    })
    expect(before.status).toBe(200)

    // Close the tunnel
    ephemeralWs.close()
    await new Promise((r) => setTimeout(r, 200))

    // Now the gateway should return 502 (tunnel not connected)
    const after = await fetch(`http://localhost:${GATEWAY_PORT}/echo`, {
      headers: { host: `ephemeral.tunnel.${GATEWAY_DOMAIN}` },
    })
    // 502 if route exists but tunnel disconnected, or 404 if route was cleaned up
    expect([404, 502]).toContain(after.status)
  }, 15_000)

  it("19. tunnel to unreachable local port returns 504", async () => {
    // Register tunnel pointing to a port nobody is listening on
    await registerTunnel({
      port: API_PORT,
      localPort: DEAD_PORT, // nothing listens here
      subdomain: "dead-local",
    })

    const res = await fetch(`http://localhost:${GATEWAY_PORT}/`, {
      headers: { host: `dead-local.tunnel.${GATEWAY_DOMAIN}` },
    })

    // The tunnel client tries to fetch from DEAD_PORT, gets ECONNREFUSED,
    // sends RST_STREAM → gateway returns 504 Gateway Timeout
    expect([502, 504]).toContain(res.status)
  }, 15_000)

  // =========================================================================
  // Helpers
  // =========================================================================

  function startGateway() {
    if (gatewayServer) return
    const cache = new RouteCache({
      lookup: (domain) => lookupRouteByDomain(db, domain),
      maxSize: 100,
      ttlMs: 1_000,
    })
    gatewayServer = createGatewayServer({
      cache,
      port: GATEWAY_PORT,
      getTunnelStreamManager: (subdomain) => getTunnelStreamManager(subdomain),
    })
  }
})

// ---------------------------------------------------------------------------
// Tunnel registration helper
// ---------------------------------------------------------------------------

interface RegisterOpts {
  port: number
  localPort: number
  subdomain: string
  onWs?: (ws: WebSocket) => void
}

async function registerTunnel(opts: RegisterOpts) {
  // State maps for the real handleBinaryFrame
  const activeLocalWs = new Map<number, WebSocket>()
  const pendingBodies: PendingBodies = new Map()

  return new Promise<{ tunnelId: string; subdomain: string; url: string }>(
    (resolve, reject) => {
      const ws = new WebSocket(
        `ws://localhost:${opts.port}/api/v1/factory/infra/gateway/tunnels/ws`,
      )
      ws.binaryType = "arraybuffer"
      opts.onWs?.(ws)

      const timeout = setTimeout(
        () => reject(new Error("WS registration timed out")),
        5_000,
      )

      ws.addEventListener("open", () => {
        ws.send(
          JSON.stringify({
            type: "register",
            localAddr: `localhost:${opts.localPort}`,
            subdomain: opts.subdomain,
            principalId: "test-user",
          }),
        )
      })

      ws.addEventListener("message", (event) => {
        if (event.data instanceof ArrayBuffer) {
          handleBinaryFrame(new Uint8Array(event.data), ws, opts.localPort, activeLocalWs, pendingBodies)
          return
        }
        if (typeof event.data !== "string") return
        let msg: any
        try {
          msg = JSON.parse(event.data)
        } catch {
          return
        }
        if (msg.type === "registered") {
          clearTimeout(timeout)
          resolve(msg)
        } else if (msg.type === "error") {
          clearTimeout(timeout)
          reject(new Error(`Tunnel error: ${msg.message}`))
        }
      })

      ws.addEventListener("error", () => {
        clearTimeout(timeout)
        reject(new Error("WebSocket connection error"))
      })
    },
  )
}

