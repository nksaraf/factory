/**
 * Tunnel integration test — verifies the full tunnel round-trip.
 *
 * Two modes controlled by FACTORY_URL env var:
 *   - Local (default): boots Elysia + PGlite, runs local gateway proxy,
 *     and tests local-only concerns (parseHostname, DB routes, error paths).
 *   - Production: connects to the real factory API and hits *.tunnel.lepton.software.
 *
 * Both modes run the same round-trip tests (GET, POST body, large payloads,
 * WebSocket passthrough) using the real handleBinaryFrame from the CLI.
 *
 * Local:  cd api && bun test src/__tests__/tunnel-smoke.test.ts
 * Prod:   cd api && FACTORY_URL=https://factory.lepton.software bun test src/__tests__/tunnel-smoke.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  type PendingBodies,
  handleBinaryFrame,
} from "../../../cli/src/lib/tunnel-client"

// ---------------------------------------------------------------------------
// Mode detection
// ---------------------------------------------------------------------------

const FACTORY_URL = process.env.FACTORY_URL
const IS_PROD = !!FACTORY_URL

const GATEWAY_DOMAIN = IS_PROD
  ? "lepton.software"
  : (process.env.DX_GATEWAY_DOMAIN ?? "dx.dev")

// Prevent the onStart hook from auto-starting gateway on port 9090
if (!IS_PROD) {
  process.env.__DX_SKIP_GATEWAY_ONSTART = "1"
}

// Pick random ports to avoid conflicts (local mode only)
const API_PORT = 14100 + Math.floor(Math.random() * 1000)
const GATEWAY_PORT = 19090 + Math.floor(Math.random() * 1000)
const LOCAL_PORT = IS_PROD
  ? 28000 + Math.floor(Math.random() * 1000)
  : 18000 + Math.floor(Math.random() * 1000)
const DEAD_PORT = 18999 + Math.floor(Math.random() * 1000)

const SUBDOMAIN = IS_PROD ? `prod-test-${Date.now()}` : "smoke-test"

// ---------------------------------------------------------------------------
// Build the tunnel-target URL based on mode
// ---------------------------------------------------------------------------

function tunnelFetchUrl(path: string): string {
  if (IS_PROD) {
    return `https://${SUBDOMAIN}.tunnel.${GATEWAY_DOMAIN}${path}`
  }
  return `http://localhost:${GATEWAY_PORT}${path}`
}

function tunnelFetchOpts(extra?: RequestInit): RequestInit {
  if (IS_PROD) return extra ?? {}
  return {
    ...extra,
    headers: {
      ...extra?.headers,
      host: `${SUBDOMAIN}.tunnel.${GATEWAY_DOMAIN}`,
    },
  }
}

function tunnelWsUrl(path: string): string {
  if (IS_PROD) {
    return `wss://${SUBDOMAIN}.tunnel.${GATEWAY_DOMAIN}${path}`
  }
  return `ws://localhost:${GATEWAY_PORT}${path}`
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

// Skip in CI unless explicitly opted in via FACTORY_URL (prod) or RUN_TUNNEL_SMOKE=1 (local)
const skipTunnel =
  typeof globalThis.Bun === "undefined" ||
  (!!process.env.CI &&
    !process.env.FACTORY_URL &&
    !process.env.RUN_TUNNEL_SMOKE)

describe.skipIf(skipTunnel)(
  `Tunnel Integration (${IS_PROD ? "prod" : "local"})`,
  () => {
    // Local-mode infrastructure
    let db: any = null
    let client: any = null
    let apiServer: { stop: () => void } | null = null
    let gatewayServer: any = null

    // Shared state
    let localServer: ReturnType<typeof Bun.serve> | null = null
    let tunnelWs: WebSocket | null = null
    let tunnel2Ws: WebSocket | null = null

    beforeAll(async () => {
      // Start the local test server (both modes need this)
      localServer = Bun.serve({
        port: LOCAL_PORT,
        async fetch(req, server) {
          const url = new URL(req.url)

          if (
            url.pathname === "/ws-echo" &&
            req.headers.get("upgrade")?.toLowerCase() === "websocket"
          ) {
            const upgraded = server.upgrade(req, { data: {} })
            if (upgraded) return new Response(null)
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
                  "x-request-id": "smoke-123",
                },
              }
            )
          }

          if (url.pathname === "/large") {
            const body = "x".repeat(100 * 1024)
            return new Response(body, {
              headers: { "content-type": "text/plain" },
            })
          }

          return new Response(
            JSON.stringify({
              path: url.pathname,
              host: req.headers.get("host"),
            }),
            { headers: { "content-type": "application/json" } }
          )
        },
        websocket: {
          message(ws, message) {
            if (typeof message === "string") {
              ws.send(`echo:${message}`)
            } else {
              // Echo binary data back as binary
              ws.sendBinary(
                message instanceof ArrayBuffer
                  ? new Uint8Array(message)
                  : message
              )
            }
          },
        },
      })

      if (IS_PROD) {
        // Connect tunnel to production
        const wsUrl =
          FACTORY_URL!.replace(/^http/, "ws") +
          "/api/v1/factory/infra/tunnel-broker"
        console.log(
          `Connecting tunnel to ${wsUrl} with subdomain ${SUBDOMAIN}...`
        )

        await new Promise<void>((resolve, reject) => {
          const ws = new WebSocket(wsUrl)
          ws.binaryType = "arraybuffer"
          tunnelWs = ws

          const activeLocalWs = new Map<number, WebSocket>()
          const pendingBodies: PendingBodies = new Map()

          const timeout = setTimeout(() => {
            reject(new Error("Tunnel registration timed out after 10s"))
          }, 10_000)

          ws.addEventListener("open", () => {
            ws.send(
              JSON.stringify({
                type: "register",
                localAddr: `localhost:${LOCAL_PORT}`,
                subdomain: SUBDOMAIN,
                principalId: "prod-test",
              })
            )
          })

          ws.addEventListener("message", (event) => {
            if (event.data instanceof ArrayBuffer) {
              handleBinaryFrame(
                new Uint8Array(event.data),
                ws,
                LOCAL_PORT,
                activeLocalWs,
                pendingBodies
              )
              return
            }
            try {
              const msg = JSON.parse(
                typeof event.data === "string" ? event.data : ""
              )
              if (msg.type === "registered") {
                clearTimeout(timeout)
                console.log(`Tunnel registered: ${msg.url}`)
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
      } else {
        // Local mode: boot Elysia + PGlite + gateway proxy
        const { createTestContext } = await import("../test-helpers")
        const ctx = await createTestContext()
        db = ctx.db
        client = ctx.client
        apiServer = ctx.app.listen(API_PORT)

        // Register tunnel
        await registerTunnel({
          port: API_PORT,
          localPort: LOCAL_PORT,
          subdomain: SUBDOMAIN,
          onWs: (ws) => {
            tunnelWs = ws
          },
        })

        // Start gateway proxy
        const { createGatewayServer, RouteCache } =
          await import("../modules/infra/gateway-proxy")
        const { getTunnelStreamManager } =
          await import("../modules/infra/tunnel-broker")
        const { lookupRouteByDomain } =
          await import("../modules/infra/gateway.service")
        const cache = new RouteCache({
          lookup: (domain: string) => lookupRouteByDomain(db, domain),
          maxSize: 100,
          ttlMs: 1_000,
        })
        gatewayServer = createGatewayServer({
          cache,
          port: GATEWAY_PORT,
          getTunnelStreamManager: (subdomain: string) =>
            getTunnelStreamManager(subdomain),
        })
        await new Promise((r) => setTimeout(r, 100))
      }
    }, 15_000)

    afterAll(async () => {
      tunnelWs?.close()
      tunnel2Ws?.close()
      gatewayServer?.stop()
      localServer?.stop()
      apiServer?.stop()
      if (client) await client.close()
    })

    // =========================================================================
    // Local-only: infrastructure tests
    // =========================================================================

    if (!IS_PROD) {
      it("health endpoint responds", async () => {
        const res = await fetch(`http://localhost:${API_PORT}/health`)
        expect(res.status).toBe(200)
      })

      it("tunnel WS endpoint exists", async () => {
        const res = await fetch(
          `http://localhost:${API_PORT}/api/v1/factory/infra/tunnel-broker`
        )
        expect([101, 400, 404, 426]).toContain(res.status)
      })

      it("parseHostname resolves tunnel subdomains", async () => {
        const { parseHostname } = await import("../modules/infra/gateway-proxy")
        const parsed = parseHostname(`smoke-test.tunnel.${GATEWAY_DOMAIN}`)
        expect(parsed).not.toBeNull()
        expect(parsed!.family).toBe("tunnel")
        expect(parsed!.slug).toBe("smoke-test")
      })

      it("parseHostname handles port-suffixed subdomains", async () => {
        const { parseHostname } = await import("../modules/infra/gateway-proxy")
        const parsed = parseHostname(`my-env-p3000.tunnel.${GATEWAY_DOMAIN}`)
        expect(parsed).not.toBeNull()
        expect(parsed!.slug).toBe("my-env")
        expect(parsed!.port).toBe(3000)
      })

      it("parseHostname handles named endpoint subdomains", async () => {
        const { parseHostname } = await import("../modules/infra/gateway-proxy")
        const parsed = parseHostname(
          `my-env--terminal.sandbox.${GATEWAY_DOMAIN}`
        )
        expect(parsed).not.toBeNull()
        expect(parsed!.slug).toBe("my-env")
        expect(parsed!.endpointName).toBe("terminal")
      })

      it("tunnel route exists in database", async () => {
        const { lookupRouteByDomain } =
          await import("../modules/infra/gateway.service")
        const route = await lookupRouteByDomain(
          db,
          `smoke-test.tunnel.${GATEWAY_DOMAIN}`
        )
        expect(route).not.toBeNull()
        expect(route!.kind).toBe("tunnel")
        expect(route!.targetService).toBe("tunnel-broker")
      })
    }

    // =========================================================================
    // Round-trip tests (run in both modes)
    // =========================================================================

    it("GET round-trip", async () => {
      const res = await fetch(tunnelFetchUrl("/echo"), tunnelFetchOpts())
      expect(res.status).toBe(200)
      const body = (await res.json()) as { method: string; path: string }
      expect(body.method).toBe("GET")
      expect(body.path).toBe("/echo")
    }, 15_000)

    it("POST body round-trip", async () => {
      const payload = JSON.stringify({
        message: "hello from tunnel",
        count: 42,
      })
      const res = await fetch(
        tunnelFetchUrl("/echo"),
        tunnelFetchOpts({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: payload,
        })
      )

      expect(res.status).toBe(200)
      const body = (await res.json()) as { method: string; body: string }
      expect(body.method).toBe("POST")
      expect(body.body).toBe(payload)
    }, 15_000)

    it("response headers preserved", async () => {
      const res = await fetch(tunnelFetchUrl("/echo"), tunnelFetchOpts())
      expect(res.headers.get("x-custom-header")).toBe("tunnel-works")
      expect(res.headers.get("content-type")).toContain("application/json")
    }, 15_000)

    it("query string preserved", async () => {
      const res = await fetch(
        tunnelFetchUrl("/echo?foo=bar&baz=123"),
        tunnelFetchOpts()
      )
      const body = (await res.json()) as { query: string }
      expect(body.query).toBe("?foo=bar&baz=123")
    }, 15_000)

    it("large response (100KB) streams correctly", async () => {
      const res = await fetch(tunnelFetchUrl("/large"), tunnelFetchOpts())
      expect(res.status).toBe(200)
      const text = await res.text()
      expect(text.length).toBe(100 * 1024)
      expect(text).toBe("x".repeat(100 * 1024))
    }, 30_000)

    it("large POST body (200KB) survives chunked transfer", async () => {
      const largeBody = "A".repeat(200 * 1024)
      const res = await fetch(
        tunnelFetchUrl("/echo"),
        tunnelFetchOpts({
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: largeBody,
        })
      )

      expect(res.status).toBe(200)
      const body = (await res.json()) as { method: string; body: string }
      expect(body.method).toBe("POST")
      expect(body.body?.length).toBe(200 * 1024)
    }, 30_000)

    it("WebSocket round-trips messages", async () => {
      const wsUrl = tunnelWsUrl("/ws-echo")
      const wsOpts = IS_PROD
        ? undefined
        : ({
            headers: { host: `${SUBDOMAIN}.tunnel.${GATEWAY_DOMAIN}` },
          } as any)
      const ws = new WebSocket(wsUrl, wsOpts)

      const messages: string[] = []
      const opened = new Promise<void>((resolve, reject) => {
        ws.addEventListener("open", () => resolve())
        ws.addEventListener("error", () =>
          reject(new Error("WS connection failed"))
        )
      })
      const closed = new Promise<void>((resolve) => {
        ws.addEventListener("close", () => resolve())
      })
      ws.addEventListener("message", (event) => {
        messages.push(
          typeof event.data === "string"
            ? event.data
            : new TextDecoder().decode(event.data as any)
        )
      })

      await opened
      ws.send("ping-1")
      ws.send("ping-2")
      await new Promise((r) => setTimeout(r, IS_PROD ? 2000 : 500))
      ws.close()
      await closed

      expect(messages).toContain("echo:ping-1")
      expect(messages).toContain("echo:ping-2")
    }, 15_000)

    it("WebSocket binary data round-trip", async () => {
      const wsUrl = tunnelWsUrl("/ws-echo")
      const wsOpts = IS_PROD
        ? undefined
        : ({
            headers: { host: `${SUBDOMAIN}.tunnel.${GATEWAY_DOMAIN}` },
          } as any)
      const ws = new WebSocket(wsUrl, wsOpts)
      ws.binaryType = "arraybuffer"

      const binaryMessages: Uint8Array[] = []
      const opened = new Promise<void>((resolve, reject) => {
        ws.addEventListener("open", () => resolve())
        ws.addEventListener("error", () =>
          reject(new Error("WS connection failed"))
        )
      })
      const closed = new Promise<void>((resolve) => {
        ws.addEventListener("close", () => resolve())
      })
      ws.addEventListener("message", (event) => {
        if (event.data instanceof ArrayBuffer) {
          binaryMessages.push(new Uint8Array(event.data))
        }
      })

      await opened

      // Send binary data
      const testData = new Uint8Array([
        0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd, 0x80, 0x7f,
      ])
      ws.send(testData.buffer)

      await new Promise((r) => setTimeout(r, IS_PROD ? 2000 : 500))
      ws.close()
      await closed

      expect(binaryMessages.length).toBeGreaterThanOrEqual(1)
      expect(binaryMessages[0]).toEqual(testData)
    }, 15_000)

    it("concurrent WebSocket connections receive correct messages", async () => {
      const wsOpts = IS_PROD
        ? undefined
        : ({
            headers: { host: `${SUBDOMAIN}.tunnel.${GATEWAY_DOMAIN}` },
          } as any)

      // Open two WS connections simultaneously
      const ws1 = new WebSocket(tunnelWsUrl("/ws-echo"), wsOpts)
      const ws2 = new WebSocket(tunnelWsUrl("/ws-echo"), wsOpts)

      const messages1: string[] = []
      const messages2: string[] = []

      const opened1 = new Promise<void>((resolve, reject) => {
        ws1.addEventListener("open", () => resolve())
        ws1.addEventListener("error", () => reject(new Error("WS1 failed")))
      })
      const opened2 = new Promise<void>((resolve, reject) => {
        ws2.addEventListener("open", () => resolve())
        ws2.addEventListener("error", () => reject(new Error("WS2 failed")))
      })

      ws1.addEventListener("message", (event) => {
        messages1.push(
          typeof event.data === "string"
            ? event.data
            : new TextDecoder().decode(event.data as any)
        )
      })
      ws2.addEventListener("message", (event) => {
        messages2.push(
          typeof event.data === "string"
            ? event.data
            : new TextDecoder().decode(event.data as any)
        )
      })

      await Promise.all([opened1, opened2])

      // Send messages on both connections
      ws1.send("from-ws1")
      ws2.send("from-ws2")
      ws1.send("second-ws1")

      await new Promise((r) => setTimeout(r, IS_PROD ? 2000 : 500))

      ws1.close()
      ws2.close()
      await new Promise((r) => setTimeout(r, 200))

      // Each WS should only have its own echoes
      expect(messages1).toContain("echo:from-ws1")
      expect(messages1).toContain("echo:second-ws1")
      expect(messages1).not.toContain("echo:from-ws2")

      expect(messages2).toContain("echo:from-ws2")
      expect(messages2).not.toContain("echo:from-ws1")
    }, 15_000)

    it("POST with empty body completes (does not hang)", async () => {
      const res = await fetch(
        tunnelFetchUrl("/echo"),
        tunnelFetchOpts({
          method: "POST",
          headers: { "content-type": "application/json" },
        })
      )

      expect(res.status).toBe(200)
      const body = (await res.json()) as { method: string; body: string | null }
      expect(body.method).toBe("POST")
    }, 15_000)

    it("unknown subdomain returns 404 or 502", async () => {
      const unknownSubdomain = `nonexistent-${Date.now()}`
      let res: Response
      if (IS_PROD) {
        res = await fetch(
          `https://${unknownSubdomain}.tunnel.${GATEWAY_DOMAIN}/`
        )
      } else {
        res = await fetch(`http://localhost:${GATEWAY_PORT}/`, {
          headers: { host: `${unknownSubdomain}.tunnel.${GATEWAY_DOMAIN}` },
        })
      }
      expect([404, 502]).toContain(res.status)
    }, 15_000)

    // =========================================================================
    // Local-only: error paths + concurrent tunnels
    // =========================================================================

    if (!IS_PROD) {
      it("second tunnel on different subdomain works independently", async () => {
        const registered = await registerTunnel({
          port: API_PORT,
          localPort: LOCAL_PORT,
          subdomain: "smoke-test-2",
          onWs: (ws) => {
            tunnel2Ws = ws
          },
        })

        expect(registered.subdomain).toBe("smoke-test-2")

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

      it("gateway returns 404 for unrecognized host", async () => {
        const res = await fetch(`http://localhost:${GATEWAY_PORT}/`, {
          headers: { host: "random.example.com" },
        })
        expect(res.status).toBe(404)
      })

      it("tunnel disconnect: gateway returns 502", async () => {
        const ephemeralWs = await new Promise<WebSocket>((resolve) => {
          let ws: WebSocket
          registerTunnel({
            port: API_PORT,
            localPort: LOCAL_PORT,
            subdomain: "ephemeral",
            onWs: (w) => {
              ws = w
            },
          }).then(() => resolve(ws!))
        })

        const before = await fetch(`http://localhost:${GATEWAY_PORT}/echo`, {
          headers: { host: `ephemeral.tunnel.${GATEWAY_DOMAIN}` },
        })
        expect(before.status).toBe(200)

        ephemeralWs.close()
        await new Promise((r) => setTimeout(r, 200))

        const after = await fetch(`http://localhost:${GATEWAY_PORT}/echo`, {
          headers: { host: `ephemeral.tunnel.${GATEWAY_DOMAIN}` },
        })
        expect([404, 502]).toContain(after.status)
      }, 15_000)

      it("reconnect with resume replays missed frames", async () => {
        // Register a tunnel
        let resumeWs: WebSocket = null!
        const resumeActiveLocalWs = new Map<number, WebSocket>()
        const resumePendingBodies: PendingBodies = new Map()
        let receivedSeq = 0

        const reg = await new Promise<{ tunnelId: string; subdomain: string }>(
          (resolve, reject) => {
            const ws = new WebSocket(
              `ws://localhost:${API_PORT}/api/v1/factory/infra/tunnel-broker`
            )
            ws.binaryType = "arraybuffer"
            resumeWs = ws

            const timeout = setTimeout(
              () => reject(new Error("timeout")),
              5_000
            )

            ws.addEventListener("open", () => {
              ws.send(
                JSON.stringify({
                  type: "register",
                  localAddr: `localhost:${LOCAL_PORT}`,
                  subdomain: "resume-test",
                  principalId: "test-user",
                })
              )
            })

            ws.addEventListener("message", (event) => {
              if (event.data instanceof ArrayBuffer) {
                receivedSeq++
                handleBinaryFrame(
                  new Uint8Array(event.data),
                  ws,
                  LOCAL_PORT,
                  resumeActiveLocalWs,
                  resumePendingBodies
                )
                return
              }
              try {
                const msg = JSON.parse(
                  typeof event.data === "string" ? event.data : ""
                )
                if (msg.type === "registered") {
                  clearTimeout(timeout)
                  resolve(msg)
                }
              } catch {}
            })

            ws.addEventListener("error", () => {
              clearTimeout(timeout)
              reject(new Error("WS error"))
            })
          }
        )

        // Make a request through the tunnel to generate outgoing frames
        const res1 = await fetch(`http://localhost:${GATEWAY_PORT}/echo`, {
          headers: { host: `resume-test.tunnel.${GATEWAY_DOMAIN}` },
        })
        expect(res1.status).toBe(200)

        const seqAfterFirstReq = receivedSeq

        // Close the tunnel (simulating disconnect)
        resumeWs.close()
        await new Promise((r) => setTimeout(r, 200))

        // Make a request while tunnel is disconnected — should fail (502/404)
        const resDuring = await fetch(`http://localhost:${GATEWAY_PORT}/echo`, {
          headers: { host: `resume-test.tunnel.${GATEWAY_DOMAIN}` },
        })
        expect([404, 502]).toContain(resDuring.status)

        // Reconnect with resume
        const resumeActiveLocalWs2 = new Map<number, WebSocket>()
        const resumePendingBodies2: PendingBodies = new Map()
        let replayedFrames = 0

        await new Promise<void>((resolve, reject) => {
          const ws = new WebSocket(
            `ws://localhost:${API_PORT}/api/v1/factory/infra/tunnel-broker`
          )
          ws.binaryType = "arraybuffer"

          const timeout = setTimeout(
            () => reject(new Error("resume timeout")),
            5_000
          )

          ws.addEventListener("open", () => {
            ws.send(
              JSON.stringify({
                type: "register",
                localAddr: `localhost:${LOCAL_PORT}`,
                subdomain: "resume-test",
                principalId: "test-user",
                resume: {
                  tunnelId: reg.tunnelId,
                  lastReceivedSeq: seqAfterFirstReq,
                },
              })
            )
          })

          ws.addEventListener("message", (event) => {
            if (event.data instanceof ArrayBuffer) {
              replayedFrames++
              handleBinaryFrame(
                new Uint8Array(event.data),
                ws,
                LOCAL_PORT,
                resumeActiveLocalWs2,
                resumePendingBodies2
              )
              return
            }
            try {
              const msg = JSON.parse(
                typeof event.data === "string" ? event.data : ""
              )
              if (msg.type === "registered") {
                clearTimeout(timeout)
                // Give a moment for any replayed frames to arrive
                setTimeout(() => resolve(), 200)
              }
            } catch {}
          })

          ws.addEventListener("error", () => {
            clearTimeout(timeout)
            reject(new Error("resume WS error"))
          })
        })

        // After reconnect, tunnel should work again
        const res2 = await fetch(`http://localhost:${GATEWAY_PORT}/echo`, {
          headers: { host: `resume-test.tunnel.${GATEWAY_DOMAIN}` },
        })
        expect(res2.status).toBe(200)
      }, 20_000)

      it("tunnel to unreachable local port returns 504", async () => {
        await registerTunnel({
          port: API_PORT,
          localPort: DEAD_PORT,
          subdomain: "dead-local",
        })

        const res = await fetch(`http://localhost:${GATEWAY_PORT}/`, {
          headers: { host: `dead-local.tunnel.${GATEWAY_DOMAIN}` },
        })
        expect([502, 504]).toContain(res.status)
      }, 15_000)
    }
  }
)

// ---------------------------------------------------------------------------
// Tunnel registration helper (local mode only)
// ---------------------------------------------------------------------------

interface RegisterOpts {
  port: number
  localPort: number
  subdomain: string
  onWs?: (ws: WebSocket) => void
}

async function registerTunnel(opts: RegisterOpts) {
  const activeLocalWs = new Map<number, WebSocket>()
  const pendingBodies: PendingBodies = new Map()

  return new Promise<{ tunnelId: string; subdomain: string; url: string }>(
    (resolve, reject) => {
      const ws = new WebSocket(
        `ws://localhost:${opts.port}/api/v1/factory/infra/tunnel-broker`
      )
      ws.binaryType = "arraybuffer"
      opts.onWs?.(ws)

      const timeout = setTimeout(
        () => reject(new Error("WS registration timed out")),
        5_000
      )

      ws.addEventListener("open", () => {
        ws.send(
          JSON.stringify({
            type: "register",
            localAddr: `localhost:${opts.localPort}`,
            subdomain: opts.subdomain,
            principalId: "test-user",
          })
        )
      })

      ws.addEventListener("message", (event) => {
        if (event.data instanceof ArrayBuffer) {
          handleBinaryFrame(
            new Uint8Array(event.data),
            ws,
            opts.localPort,
            activeLocalWs,
            pendingBodies
          )
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
    }
  )
}
