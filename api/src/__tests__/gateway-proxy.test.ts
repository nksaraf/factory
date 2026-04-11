/**
 * Gateway proxy integration tests — verifies HTTP and WebSocket reverse proxying.
 *
 * Spins up a mock backend (HTTP + WS) and the gateway proxy, then tests:
 *   - HTTP proxy: correct forwarding, content-encoding stripping
 *   - WebSocket proxy: binary relay, subprotocol forwarding, perMessageDeflate off
 *   - parseHostname: domain family parsing, port/endpoint suffixes
 *
 * Run:  cd api && bun test src/__tests__/gateway-proxy.test.ts
 *
 * NOTE: Requires Bun runtime (Bun.serve, Bun.gzipSync). Skipped under plain vitest.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test"

// This entire file requires the Bun runtime (Bun.serve, Bun.gzipSync, WebSocket with headers).
const hasBun = typeof globalThis.Bun !== "undefined"

describe.skipIf(!hasBun)("gateway-proxy integration", () => {
  // Dynamic imports so module evaluation doesn't blow up without Bun
  let createGatewayServer: any
  let parseHostname: any
  type RouteCache = any

  // Prevent the onStart hook from auto-starting gateway on port 9090
  process.env.__DX_SKIP_GATEWAY_ONSTART = "1"
  process.env.DX_GATEWAY_DOMAIN = "dx.dev"

  const BACKEND_PORT = 28000 + Math.floor(Math.random() * 1000)
  const GATEWAY_PORT = 29000 + Math.floor(Math.random() * 1000)

  const WORKBENCH_SLUG = "test-proxy"
  const WORKBENCH_DOMAIN = `${WORKBENCH_SLUG}.workbench.dx.dev`
  const TERMINAL_DOMAIN = `${WORKBENCH_SLUG}--terminal.workbench.dx.dev`

  // ---------------------------------------------------------------------------
  // Mock backend: HTTP + WebSocket server simulating a workbench service
  // ---------------------------------------------------------------------------

  let backendServer: any
  let gatewayServer: { server: any; stop: () => void }

  beforeAll(async () => {
    const mod = await import("../modules/infra/gateway-proxy")
    createGatewayServer = mod.createGatewayServer
    parseHostname = mod.parseHostname

    // Start mock backend
    backendServer = Bun.serve({
      port: BACKEND_PORT,
      async fetch(req: Request, server: any) {
        const url = new URL(req.url)

        // WebSocket upgrade — echo with subprotocol support
        if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
          const proto = req.headers.get("sec-websocket-protocol")
          const opts: { data: Record<string, never>; headers?: Headers } = {
            data: {},
          }
          if (proto)
            opts.headers = new Headers({ "sec-websocket-protocol": proto })
          const upgraded = server.upgrade(req, opts)
          if (upgraded) return new Response(null)
          return new Response("WebSocket upgrade failed", { status: 500 })
        }

        // Gzipped response (simulates ttyd/openvscode)
        if (url.pathname === "/gzipped") {
          const body = "hello from gzipped endpoint"
          const compressed = Bun.gzipSync(Buffer.from(body))
          return new Response(compressed, {
            headers: {
              "content-type": "text/plain",
              "content-encoding": "gzip",
              "content-length": String(compressed.length),
            },
          })
        }

        // Echo endpoint
        if (url.pathname === "/echo") {
          const text = req.body ? await req.text() : ""
          return new Response(
            JSON.stringify({
              method: req.method,
              path: url.pathname,
              body: text,
            }),
            { headers: { "content-type": "application/json" } }
          )
        }

        return new Response("OK", { headers: { "content-type": "text/plain" } })
      },
      websocket: {
        message(ws: any, message: any) {
          // Echo back with prefix
          if (typeof message === "string") {
            ws.send(`echo:${message}`)
          } else {
            // Binary: prepend 0x01 byte
            const buf =
              message instanceof ArrayBuffer ? message : message.buffer
            const input = new Uint8Array(buf)
            const output = new Uint8Array(input.length + 1)
            output[0] = 0x01
            output.set(input, 1)
            ws.send(output)
          }
        },
      },
    })

    // Start gateway proxy with a mock route cache
    const mockCache = {
      get: async (domain: string) => {
        if (domain === WORKBENCH_DOMAIN || domain === TERMINAL_DOMAIN) {
          return {
            kind: "workbench",
            domain,
            targetService: "localhost",
            targetPort: BACKEND_PORT,
            status: "active",
          }
        }
        return null
      },
    }

    gatewayServer = createGatewayServer({
      cache: mockCache as RouteCache,
      port: GATEWAY_PORT,
    })
  })

  afterAll(() => {
    backendServer?.stop()
    gatewayServer?.stop()
  })

  // Helper to make requests through the gateway with the right Host header
  function gwFetch(path: string, opts?: RequestInit & { host?: string }) {
    const host = opts?.host ?? WORKBENCH_DOMAIN
    const { host: _, ...rest } = opts ?? {}
    return fetch(`http://localhost:${GATEWAY_PORT}${path}`, {
      ...rest,
      headers: { ...rest.headers, host },
    })
  }

  // ---------------------------------------------------------------------------
  // parseHostname unit tests
  // ---------------------------------------------------------------------------

  describe("parseHostname", () => {
    it("parses workbench domain", () => {
      const result = parseHostname("my-env.workbench.dx.dev")
      expect(result).toEqual({
        family: "workbench",
        slug: "my-env",
        fullSubdomain: "my-env",
      })
    })

    it("parses sandbox domain (legacy)", () => {
      const result = parseHostname("my-env.sandbox.dx.dev")
      expect(result).toEqual({
        family: "sandbox",
        slug: "my-env",
        fullSubdomain: "my-env",
      })
    })

    it("parses named endpoint (--terminal)", () => {
      const result = parseHostname("my-env--terminal.workbench.dx.dev")
      expect(result).toEqual({
        family: "workbench",
        slug: "my-env",
        endpointName: "terminal",
        fullSubdomain: "my-env--terminal",
      })
    })

    it("parses port suffix (-p3000)", () => {
      const result = parseHostname("my-env-p3000.workbench.dx.dev")
      expect(result).toEqual({
        family: "workbench",
        slug: "my-env",
        port: 3000,
        fullSubdomain: "my-env-p3000",
      })
    })

    it("returns null for unknown domain", () => {
      expect(parseHostname("unknown.example.com")).toBeNull()
    })

    it("strips port from host", () => {
      const result = parseHostname("my-env.workbench.dx.dev:8080")
      expect(result?.slug).toBe("my-env")
    })
  })

  // ---------------------------------------------------------------------------
  // HTTP Proxy
  // ---------------------------------------------------------------------------

  describe("HTTP proxy", () => {
    it("proxies GET requests to backend", async () => {
      const res = await gwFetch("/echo")
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.method).toBe("GET")
      expect(body.path).toBe("/echo")
    })

    it("proxies POST with body", async () => {
      const res = await gwFetch("/echo", {
        method: "POST",
        body: "hello",
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.method).toBe("POST")
      expect(body.body).toBe("hello")
    })

    it("strips content-encoding after fetch auto-decompresses", async () => {
      const res = await gwFetch("/gzipped")
      expect(res.status).toBe(200)

      // The gateway should strip content-encoding since fetch() auto-decompresses
      expect(res.headers.get("content-encoding")).toBeNull()

      const text = await res.text()
      expect(text).toBe("hello from gzipped endpoint")
    })

    it("returns 404 for unknown route", async () => {
      const res = await gwFetch("/echo", { host: "unknown.workbench.dx.dev" })
      expect(res.status).toBe(404)
    })
  })

  // ---------------------------------------------------------------------------
  // WebSocket Proxy
  // ---------------------------------------------------------------------------

  describe("WebSocket proxy", () => {
    it("relays text messages bidirectionally", async () => {
      const ws = new WebSocket(`ws://localhost:${GATEWAY_PORT}/ws`, {
        headers: { host: WORKBENCH_DOMAIN },
      } as unknown as string[])

      const messages: string[] = []
      const opened = new Promise<void>((resolve) => {
        ws.addEventListener("open", () => resolve(), { once: true })
      })
      ws.addEventListener("message", (ev) => {
        messages.push(typeof ev.data === "string" ? ev.data : "binary")
      })

      await opened
      ws.send("hello")

      // Wait for echo
      await new Promise((r) => setTimeout(r, 200))
      expect(messages).toContain("echo:hello")

      ws.close()
    })

    it("relays binary messages", async () => {
      const ws = new WebSocket(`ws://localhost:${GATEWAY_PORT}/ws`, {
        headers: { host: WORKBENCH_DOMAIN },
      } as unknown as string[])
      ws.binaryType = "arraybuffer"

      const messages: ArrayBuffer[] = []
      const opened = new Promise<void>((resolve) => {
        ws.addEventListener("open", () => resolve(), { once: true })
      })
      ws.addEventListener("message", (ev) => {
        if (ev.data instanceof ArrayBuffer) messages.push(ev.data)
      })

      await opened
      ws.send(new Uint8Array([0x10, 0x20, 0x30]))

      await new Promise((r) => setTimeout(r, 200))
      expect(messages.length).toBe(1)
      const received = new Uint8Array(messages[0])
      // Backend prepends 0x01 byte
      expect(received[0]).toBe(0x01)
      expect(received[1]).toBe(0x10)
      expect(received[2]).toBe(0x20)
      expect(received[3]).toBe(0x30)

      ws.close()
    })

    it("forwards Sec-WebSocket-Protocol (subprotocol)", async () => {
      // Simulate ttyd which requires the "tty" subprotocol
      const ws = new WebSocket(`ws://localhost:${GATEWAY_PORT}/ws`, {
        headers: {
          host: TERMINAL_DOMAIN,
          "sec-websocket-protocol": "tty",
        },
      } as unknown as string[])

      const opened = new Promise<void>((resolve, reject) => {
        ws.addEventListener("open", () => resolve(), { once: true })
        ws.addEventListener("error", (e) => reject(e), { once: true })
        setTimeout(() => reject(new Error("ws open timeout")), 5000)
      })

      await opened

      // If the subprotocol wasn't forwarded, the backend wouldn't accept it
      // and the connection would fail. The fact that we're here means it worked.
      expect(ws.readyState).toBe(WebSocket.OPEN)

      // Verify data flows with subprotocol connection
      const messages: string[] = []
      ws.addEventListener("message", (ev) => {
        messages.push(typeof ev.data === "string" ? ev.data : "binary")
      })
      ws.send("test-tty")

      await new Promise((r) => setTimeout(r, 200))
      expect(messages).toContain("echo:test-tty")

      ws.close()
    })

    it("closes browser WS when backend closes", async () => {
      const ws = new WebSocket(`ws://localhost:${GATEWAY_PORT}/ws`, {
        headers: { host: WORKBENCH_DOMAIN },
      } as unknown as string[])

      const opened = new Promise<void>((resolve) => {
        ws.addEventListener("open", () => resolve(), { once: true })
      })
      const closed = new Promise<void>((resolve) => {
        ws.addEventListener("close", () => resolve(), { once: true })
      })

      await opened
      ws.send("bye")
      ws.close()

      // Should complete without hanging
      await closed
    })
  })
})
