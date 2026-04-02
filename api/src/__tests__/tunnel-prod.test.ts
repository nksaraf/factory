/**
 * Tunnel production integration test — connects to the real factory API,
 * registers a tunnel using the REAL tunnel client code, starts a local
 * test server, and verifies end-to-end round-trip through production.
 *
 * Run: cd api && FACTORY_URL=https://factory.lepton.software bun test src/__tests__/tunnel-prod.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import {
  handleBinaryFrame,
  type PendingBodies,
} from "../../../cli/src/lib/tunnel-client"

const FACTORY_URL = process.env.FACTORY_URL ?? "https://factory.lepton.software"
const GATEWAY_DOMAIN = "lepton.software"
const LOCAL_PORT = 28000 + Math.floor(Math.random() * 1000)
const SUBDOMAIN = `prod-test-${Date.now()}`

describe("Tunnel Production Integration", () => {
  let localServer: ReturnType<typeof Bun.serve> | null = null
  let tunnelWs: WebSocket | null = null
  let tunnelUrl: string | null = null
  let registered = false

  // State maps passed to the real handleBinaryFrame
  const activeLocalWs = new Map<number, WebSocket>()
  const pendingBodies: PendingBodies = new Map()

  beforeAll(async () => {
    // Start local test server
    localServer = Bun.serve({
      port: LOCAL_PORT,
      async fetch(req, server) {
        const url = new URL(req.url)

        if (url.pathname === "/ws-echo" && req.headers.get("upgrade")?.toLowerCase() === "websocket") {
          const upgraded = server.upgrade(req)
          if (upgraded) return undefined as any
          return new Response("WebSocket upgrade failed", { status: 500 })
        }

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
              },
            },
          )
        }

        if (url.pathname === "/large") {
          const body = "x".repeat(100 * 1024)
          return new Response(body, { headers: { "content-type": "text/plain" } })
        }

        return new Response(JSON.stringify({ path: url.pathname }), {
          headers: { "content-type": "application/json" },
        })
      },
      websocket: {
        message(ws, message) {
          const text = typeof message === "string" ? message : new TextDecoder().decode(message)
          ws.send(`echo:${text}`)
        },
      },
    })

    // Connect tunnel to production
    const wsUrl = FACTORY_URL.replace(/^http/, "ws") + "/api/v1/factory/infra/gateway/tunnels/ws"
    console.log(`Connecting tunnel to ${wsUrl} with subdomain ${SUBDOMAIN}...`)

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl)
      ws.binaryType = "arraybuffer"
      tunnelWs = ws

      const timeout = setTimeout(() => {
        reject(new Error("Tunnel registration timed out after 10s"))
      }, 10_000)

      ws.addEventListener("open", () => {
        ws.send(JSON.stringify({
          type: "register",
          localAddr: `localhost:${LOCAL_PORT}`,
          subdomain: SUBDOMAIN,
          principalId: "prod-test",
        }))
      })

      ws.addEventListener("message", (event) => {
        if (registered && event.data instanceof ArrayBuffer) {
          handleBinaryFrame(new Uint8Array(event.data), ws, LOCAL_PORT, activeLocalWs, pendingBodies)
          return
        }

        try {
          const msg = JSON.parse(typeof event.data === "string" ? event.data : "")
          if (msg.type === "registered") {
            registered = true
            tunnelUrl = msg.url
            clearTimeout(timeout)
            console.log(`Tunnel registered: ${tunnelUrl}`)
            resolve()
          } else if (msg.type === "error") {
            clearTimeout(timeout)
            reject(new Error(`Registration error: ${msg.message}`))
          }
        } catch {}
      })

      ws.addEventListener("error", () => {
        clearTimeout(timeout)
        reject(new Error("WebSocket connection error"))
      })
    })
  }, 15_000)

  afterAll(() => {
    tunnelWs?.close()
    localServer?.stop()
    for (const [, ws] of activeLocalWs) {
      try { ws.close() } catch {}
    }
  })

  it("1. tunnel registered successfully", () => {
    expect(registered).toBe(true)
    expect(tunnelUrl).toContain(SUBDOMAIN)
    expect(tunnelUrl).toContain(`tunnel.${GATEWAY_DOMAIN}`)
  })

  it("2. GET request round-trips through production tunnel", async () => {
    const res = await fetch(`https://${SUBDOMAIN}.tunnel.${GATEWAY_DOMAIN}/echo`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { method: string; path: string }
    expect(body.method).toBe("GET")
    expect(body.path).toBe("/echo")
  }, 15_000)

  it("3. response headers are preserved", async () => {
    const res = await fetch(`https://${SUBDOMAIN}.tunnel.${GATEWAY_DOMAIN}/echo`)
    expect(res.headers.get("x-custom-header")).toBe("tunnel-works")
    expect(res.headers.get("content-type")).toContain("application/json")
  }, 15_000)

  it("4. query strings are preserved", async () => {
    const res = await fetch(`https://${SUBDOMAIN}.tunnel.${GATEWAY_DOMAIN}/echo?foo=bar&baz=123`)
    const body = (await res.json()) as { query: string }
    expect(body.query).toBe("?foo=bar&baz=123")
  }, 15_000)

  it("5. POST body is forwarded correctly", async () => {
    const payload = JSON.stringify({ message: "hello from tunnel", count: 42 })
    const res = await fetch(`https://${SUBDOMAIN}.tunnel.${GATEWAY_DOMAIN}/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { method: string; body: string }
    expect(body.method).toBe("POST")
    expect(body.body).toBe(payload)
  }, 15_000)

  it("6. large POST body (200KB) survives chunked transfer", async () => {
    const largeBody = "B".repeat(200 * 1024)
    const res = await fetch(`https://${SUBDOMAIN}.tunnel.${GATEWAY_DOMAIN}/echo`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: largeBody,
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { method: string; body: string }
    expect(body.method).toBe("POST")
    expect(body.body?.length).toBe(200 * 1024)
  }, 30_000)

  it("7. large response (100KB) streams back correctly", async () => {
    const res = await fetch(`https://${SUBDOMAIN}.tunnel.${GATEWAY_DOMAIN}/large`)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text.length).toBe(100 * 1024)
    expect(text).toBe("x".repeat(100 * 1024))
  }, 30_000)

  it("8. WebSocket upgrade through tunnel round-trips messages", async () => {
    const ws = new WebSocket(
      `wss://${SUBDOMAIN}.tunnel.${GATEWAY_DOMAIN}/ws-echo`,
    )

    const messages: string[] = []
    const opened = new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve())
      ws.addEventListener("error", () => reject(new Error("WS connection failed")))
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
    await new Promise((r) => setTimeout(r, 2000))
    ws.close()
    await closed

    expect(messages).toContain("echo:ping-1")
    expect(messages).toContain("echo:ping-2")
  }, 15_000)

  it("9. unknown subdomain returns 404 or 502", async () => {
    const res = await fetch(`https://nonexistent-${Date.now()}.tunnel.${GATEWAY_DOMAIN}/`)
    expect([404, 502]).toContain(res.status)
  }, 15_000)
})
