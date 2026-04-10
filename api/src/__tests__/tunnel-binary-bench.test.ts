/**
 * Tunnel end-to-end benchmark — measures real throughput and concurrency.
 *
 * Two modes:
 *   Local (default): in-process StreamManager ↔ handleBinaryFrame ↔ local Bun.serve
 *     cd api && bun test src/__tests__/tunnel-binary-bench.test.ts
 *
 *   Production: real tunnel over the internet via FACTORY_URL
 *     cd api && FACTORY_URL=https://factory.lepton.software bun test src/__tests__/tunnel-binary-bench.test.ts
 *
 * Production mode connects a real tunnel WebSocket to the factory API,
 * registers a subdomain, and fires HTTP requests through the public tunnel URL.
 * This measures the full path: client → internet → cloud broker → WS → client
 * → local server → back through the same path.
 */
import { FrameType, decodeFrame } from "@smp/factory-shared/tunnel-protocol"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  type PendingBodies,
  handleBinaryFrame,
} from "../../../cli/src/lib/tunnel-client"
import { StreamManager } from "../modules/infra/tunnel-streams"

// ---------------------------------------------------------------------------
// Mode detection
// ---------------------------------------------------------------------------

const FACTORY_URL = process.env.FACTORY_URL
const IS_PROD = !!FACTORY_URL
const GATEWAY_DOMAIN = IS_PROD
  ? "lepton.software"
  : (process.env.DX_GATEWAY_DOMAIN ?? "dx.dev")

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`
}

function formatRate(bytesPerSec: number): string {
  return `${formatSize(bytesPerSec)}/s`
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)]
}

function generatePayload(sizeBytes: number): Uint8Array {
  const buf = new Uint8Array(sizeBytes)
  for (let i = 0; i < sizeBytes; i++) buf[i] = i % 256
  return buf
}

/** Generate realistic JSON API response (highly compressible) */
function generateJsonPayload(targetBytes: number): string {
  const items: object[] = []
  const template = {
    id: 0,
    name: "John Doe",
    email: "john.doe@example.com",
    role: "developer",
    department: "engineering",
    status: "active",
    createdAt: "2026-01-15T10:30:00Z",
    updatedAt: "2026-04-10T08:00:00Z",
    metadata: {
      lastLogin: "2026-04-09T22:00:00Z",
      preferences: { theme: "dark", language: "en", notifications: true },
    },
  }
  while (JSON.stringify(items).length < targetBytes) {
    items.push({ ...template, id: items.length, name: `User ${items.length}` })
  }
  return JSON.stringify({ data: items, total: items.length, page: 1 })
}

/** Generate realistic HTML page (highly compressible) */
function generateHtmlPayload(targetBytes: number): string {
  let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Dashboard</title>
<style>body{font-family:system-ui,sans-serif;margin:0;padding:20px;background:#f5f5f5}
.card{background:white;border-radius:8px;padding:16px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,0.1)}
.header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}
table{width:100%;border-collapse:collapse}th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #eee}
th{font-weight:600;color:#666;font-size:0.875rem}</style></head><body><div class="header"><h1>Dashboard</h1></div>`
  let i = 0
  while (html.length < targetBytes) {
    html += `<div class="card"><h3>Item ${i}</h3><p>Description for item ${i}. This is a typical content block in a web application dashboard.</p>
<table><tr><th>Property</th><th>Value</th></tr><tr><td>Status</td><td>Active</td></tr>
<tr><td>Created</td><td>2026-01-15</td></tr><tr><td>Owner</td><td>user-${i}</td></tr></table></div>`
    i++
  }
  html += "</body></html>"
  return html
}

/** Generate realistic JavaScript bundle (highly compressible) */
function generateJsPayload(targetBytes: number): string {
  let js = `"use strict";
const __modules = {};
function __require(id) { if (__modules[id]) return __modules[id].exports; const module = __modules[id] = { exports: {} }; return module.exports; }
`
  let i = 0
  while (js.length < targetBytes) {
    js += `
__modules["module_${i}"] = { exports: {} };
(function(module, exports) {
  class Component${i} {
    constructor(props) {
      this.props = props;
      this.state = { loading: false, data: null, error: null };
    }
    async fetchData(endpoint) {
      this.state.loading = true;
      try {
        const response = await fetch(endpoint);
        this.state.data = await response.json();
      } catch (error) {
        this.state.error = error.message;
      } finally {
        this.state.loading = false;
      }
    }
    render() {
      if (this.state.loading) return '<div class="spinner">Loading...</div>';
      if (this.state.error) return '<div class="error">' + this.state.error + '</div>';
      return '<div class="component-${i}">' + JSON.stringify(this.state.data) + '</div>';
    }
  }
  module.exports = { Component${i} };
})(__modules["module_${i}"], __modules["module_${i}"].exports);
`
    i++
  }
  return js
}

// ---------------------------------------------------------------------------
// In-process tunnel stack (local mode)
// ---------------------------------------------------------------------------

function createTunnelStack(localPort: number) {
  const activeLocalWs = new Map<number, WebSocket>()
  const pendingBodies: PendingBodies = new Map()
  let sm: StreamManager

  const fakeClientWs = {
    send(data: Uint8Array | ArrayBuffer) {
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data
      handleBinaryFrame(
        bytes,
        fakeServerWs as any,
        localPort,
        activeLocalWs,
        pendingBodies
      )
    },
    close() {},
  }

  const fakeServerWs = {
    send(data: Uint8Array | ArrayBuffer) {
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data
      try {
        const frame = decodeFrame(bytes)
        sm.handleFrame(frame)
      } catch {}
    },
    close() {},
  }

  sm = new StreamManager((frameData) => {
    fakeClientWs.send(frameData)
  })

  return {
    sm,
    cleanup() {
      sm.cleanup()
    },
  }
}

// ---------------------------------------------------------------------------
// Prod mode: request sender via public tunnel URL
// ---------------------------------------------------------------------------

interface ProdFetcher {
  get(path: string, headers?: Record<string, string>): Promise<Response>
  post(path: string, body: Uint8Array): Promise<Response>
}

function createProdFetcher(baseUrl: string): ProdFetcher {
  return {
    get(path: string, headers?: Record<string, string>) {
      return fetch(`${baseUrl}${path}`, { headers })
    },
    post(path: string, body: Uint8Array) {
      return fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: body as unknown as BodyInit,
      })
    },
  }
}

// Unified request helper — works in both modes
async function benchGet(
  sm: StreamManager | null,
  prod: ProdFetcher | null,
  path: string,
  timeoutMs = 30_000,
  headers?: Record<string, string>
): Promise<{ status: number; body: Uint8Array; bodyLength: number }> {
  if (prod) {
    const res = await prod.get(path, headers)
    const buf = new Uint8Array(await res.arrayBuffer())
    return { status: res.status, body: buf, bodyLength: buf.byteLength }
  }
  const res = await sm!.sendHttpRequest(
    { method: "GET", url: path, headers: headers ?? {} },
    { timeoutMs }
  )
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let len = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    chunks.push(value)
    len += value.byteLength
  }
  const body = new Uint8Array(len)
  let off = 0
  for (const c of chunks) {
    body.set(c, off)
    off += c.byteLength
  }
  return { status: res.status, body, bodyLength: len }
}

async function benchPost(
  sm: StreamManager | null,
  prod: ProdFetcher | null,
  path: string,
  payload: Uint8Array,
  timeoutMs = 30_000
): Promise<{ status: number; responseText: string }> {
  if (prod) {
    const res = await prod.post(path, payload)
    return { status: res.status, responseText: await res.text() }
  }
  const res = await sm!.sendHttpRequest(
    {
      method: "POST",
      url: path,
      headers: { "content-type": "application/octet-stream" },
    },
    { body: payload, timeoutMs }
  )
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const merged = new Uint8Array(chunks.reduce((s, c) => s + c.byteLength, 0))
  let off = 0
  for (const c of chunks) {
    merged.set(c, off)
    off += c.byteLength
  }
  return { status: res.status, responseText: new TextDecoder().decode(merged) }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

const skipBench =
  typeof globalThis.Bun === "undefined" ||
  (!!process.env.CI && !process.env.RUN_TUNNEL_BENCH && !FACTORY_URL)

describe.skipIf(skipBench)(
  `Tunnel Benchmark (${IS_PROD ? "prod" : "local"})`,
  () => {
    const LOCAL_PORT = 17500 + Math.floor(Math.random() * 1000)
    const SUBDOMAIN = IS_PROD ? `bench-${Date.now()}` : "bench-local"
    let localServer: ReturnType<typeof Bun.serve> | null = null
    let tunnelWs: WebSocket | null = null

    // Local mode: in-process StreamManager per test
    // Prod mode: shared tunnel connection + ProdFetcher
    let prodFetcher: ProdFetcher | null = null

    // Factory for getting sm — local creates per-test, prod is null
    function getStack() {
      if (IS_PROD) {
        return {
          sm: null as StreamManager | null,
          prod: prodFetcher!,
          cleanup() {},
        }
      }
      const stack = createTunnelStack(LOCAL_PORT)
      return {
        sm: stack.sm,
        prod: null as ProdFetcher | null,
        cleanup: stack.cleanup,
      }
    }

    beforeAll(async () => {
      // Start local origin server (both modes)
      localServer = Bun.serve({
        port: LOCAL_PORT,
        fetch(req) {
          const url = new URL(req.url)

          if (url.pathname === "/binary") {
            const size = parseInt(url.searchParams.get("size") ?? "1024", 10)
            return new Response(generatePayload(size) as unknown as BodyInit, {
              headers: {
                "content-type": "application/octet-stream",
                "content-length": String(size),
              },
            })
          }

          if (url.pathname === "/upload" && req.method === "POST") {
            return req.arrayBuffer().then(
              (buf) =>
                new Response(JSON.stringify({ received: buf.byteLength }), {
                  headers: { "content-type": "application/json" },
                })
            )
          }

          if (url.pathname === "/echo") {
            return new Response("ok")
          }

          // Compressible content endpoints — realistic dev traffic
          // Supports gzip when Accept-Encoding includes it (like real dev servers)
          if (
            url.pathname === "/json" ||
            url.pathname === "/html" ||
            url.pathname === "/js"
          ) {
            const size = parseInt(url.searchParams.get("size") ?? "1024", 10)
            const contentMap: Record<
              string,
              { gen: (n: number) => string; ct: string }
            > = {
              "/json": { gen: generateJsonPayload, ct: "application/json" },
              "/html": { gen: generateHtmlPayload, ct: "text/html" },
              "/js": { gen: generateJsPayload, ct: "application/javascript" },
            }
            const { gen, ct } = contentMap[url.pathname]!
            const body = gen(size)
            const acceptEncoding = req.headers.get("accept-encoding") ?? ""
            if (acceptEncoding.includes("gzip") && typeof Bun !== "undefined") {
              const compressed = Bun.gzipSync(new TextEncoder().encode(body))
              return new Response(compressed as unknown as BodyInit, {
                headers: {
                  "content-type": ct,
                  "content-encoding": "gzip",
                  "content-length": String(compressed.byteLength),
                },
              })
            }
            return new Response(body, { headers: { "content-type": ct } })
          }

          return new Response("not found", { status: 404 })
        },
      })

      if (IS_PROD) {
        // Connect real tunnel to production
        const wsUrl =
          FACTORY_URL!.replace(/^http/, "ws") +
          "/api/v1/factory/infra/tunnel-broker"
        console.log(`\n  Connecting tunnel to ${wsUrl}`)
        console.log(`  Subdomain: ${SUBDOMAIN}`)
        console.log(`  Local origin: http://localhost:${LOCAL_PORT}\n`)

        const activeLocalWs = new Map<number, WebSocket>()
        const pendingBodies: PendingBodies = new Map()

        await new Promise<void>((resolve, reject) => {
          const ws = new WebSocket(wsUrl)
          ws.binaryType = "arraybuffer"
          tunnelWs = ws

          const timeout = setTimeout(
            () => reject(new Error("Tunnel registration timed out (10s)")),
            10_000
          )

          ws.addEventListener("open", () => {
            ws.send(
              JSON.stringify({
                type: "register",
                localAddr: `localhost:${LOCAL_PORT}`,
                subdomain: SUBDOMAIN,
                principalId: "bench-test",
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
                console.log(`  Tunnel registered: ${msg.url}\n`)
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

        prodFetcher = createProdFetcher(
          `https://${SUBDOMAIN}.tunnel.${GATEWAY_DOMAIN}`
        )

        // Warm up — first request is always slow (DNS, TLS, route cache)
        console.log("  Warming up...")
        await prodFetcher.get("/echo")
        await prodFetcher.get("/echo")
        console.log("  Warm-up complete\n")
      }
    }, 30_000)

    afterAll(() => {
      tunnelWs?.close()
      localServer?.stop()
    })

    // =========================================================================
    // 1. Single-request download throughput
    // =========================================================================

    it("GET download throughput", async () => {
      // Prod mode: smaller sizes (network-bound), Local: up to 10MB
      const sizes = IS_PROD
        ? [
            { label: "1KB", bytes: 1024 },
            { label: "64KB", bytes: 64 * 1024 },
            { label: "256KB", bytes: 256 * 1024 },
            { label: "1MB", bytes: 1024 * 1024 },
            { label: "5MB", bytes: 5 * 1024 * 1024 },
          ]
        : [
            { label: "1KB", bytes: 1024 },
            { label: "64KB", bytes: 64 * 1024 },
            { label: "256KB", bytes: 256 * 1024 },
            { label: "1MB", bytes: 1024 * 1024 },
            { label: "5MB", bytes: 5 * 1024 * 1024 },
            { label: "10MB", bytes: 10 * 1024 * 1024 },
          ]

      const results: {
        label: string
        bytes: number
        ms: number
        rate: string
        ok: boolean
      }[] = []

      for (const { label, bytes } of sizes) {
        const { sm, prod, cleanup } = getStack()

        const start = performance.now()
        const res = await benchGet(sm, prod, `/binary?size=${bytes}`)
        const elapsed = performance.now() - start

        const ok = res.status === 200 && res.bodyLength === bytes
        results.push({
          label,
          bytes,
          ms: elapsed,
          rate: formatRate((bytes / elapsed) * 1000),
          ok,
        })
        cleanup()
      }

      console.log("\n┌─────────────┬──────────┬──────────────┬────┐")
      console.log("│ Payload     │ Time(ms) │ Throughput   │ OK │")
      console.log("├─────────────┼──────────┼──────────────┼────┤")
      for (const r of results) {
        console.log(
          `│ ${r.label.padEnd(11)} │ ${r.ms.toFixed(1).padStart(8)} │ ${r.rate.padStart(12)} │ ${r.ok ? " ✓" : " ✗"} │`
        )
      }
      console.log("└─────────────┴──────────┴──────────────┴────┘\n")

      for (const r of results) {
        expect(r.ok).toBe(true)
      }
    }, 120_000)

    // =========================================================================
    // 2. POST upload throughput
    // =========================================================================

    it("POST upload throughput", async () => {
      const sizes = IS_PROD
        ? [
            { label: "1KB", bytes: 1024 },
            { label: "64KB", bytes: 64 * 1024 },
            { label: "256KB", bytes: 256 * 1024 },
            { label: "1MB", bytes: 1024 * 1024 },
          ]
        : [
            { label: "1KB", bytes: 1024 },
            { label: "64KB", bytes: 64 * 1024 },
            { label: "256KB", bytes: 256 * 1024 },
            { label: "1MB", bytes: 1024 * 1024 },
            { label: "5MB", bytes: 5 * 1024 * 1024 },
          ]

      const results: {
        label: string
        bytes: number
        ms: number
        rate: string
        ok: boolean
      }[] = []

      for (const { label, bytes } of sizes) {
        const { sm, prod, cleanup } = getStack()
        const payload = generatePayload(bytes)

        const start = performance.now()
        const res = await benchPost(sm, prod, "/upload", payload)
        const elapsed = performance.now() - start

        const json = JSON.parse(res.responseText)
        const ok = res.status === 200 && json.received === bytes
        results.push({
          label,
          bytes,
          ms: elapsed,
          rate: formatRate((bytes / elapsed) * 1000),
          ok,
        })
        cleanup()
      }

      console.log("\n┌─────────────┬──────────┬──────────────┬────┐")
      console.log("│ Upload Size │ Time(ms) │ Throughput   │ OK │")
      console.log("├─────────────┼──────────┼──────────────┼────┤")
      for (const r of results) {
        console.log(
          `│ ${r.label.padEnd(11)} │ ${r.ms.toFixed(1).padStart(8)} │ ${r.rate.padStart(12)} │ ${r.ok ? " ✓" : " ✗"} │`
        )
      }
      console.log("└─────────────┴──────────┴──────────────┴────┘\n")

      for (const r of results) {
        expect(r.ok).toBe(true)
      }
    }, 120_000)

    // =========================================================================
    // 3. Latency — minimal payload, measure round-trip time
    // =========================================================================

    it("round-trip latency (minimal payload)", async () => {
      const iterations = IS_PROD ? 20 : 50
      const { sm, prod, cleanup } = getStack()
      const latencies: number[] = []

      for (let i = 0; i < iterations; i++) {
        const start = performance.now()
        await benchGet(sm, prod, "/echo", 10_000)
        latencies.push(performance.now() - start)
      }

      latencies.sort((a, b) => a - b)
      const avg = latencies.reduce((a, b) => a + b) / latencies.length

      console.log(`\n  Latency (${iterations} requests):`)
      console.log(`    min:  ${latencies[0].toFixed(2)}ms`)
      console.log(`    p50:  ${percentile(latencies, 50).toFixed(2)}ms`)
      console.log(`    p95:  ${percentile(latencies, 95).toFixed(2)}ms`)
      console.log(`    p99:  ${percentile(latencies, 99).toFixed(2)}ms`)
      console.log(`    max:  ${latencies[latencies.length - 1].toFixed(2)}ms`)
      console.log(`    avg:  ${avg.toFixed(2)}ms\n`)

      expect(latencies.length).toBe(iterations)
      cleanup()
    }, 120_000)

    // =========================================================================
    // 4. Concurrent request load — throughput under concurrency
    // =========================================================================

    it("concurrent requests — latency distribution", async () => {
      const concurrencyLevels = IS_PROD ? [1, 5, 10, 20] : [1, 10, 50, 100]
      const payloadSize = 4096

      const results: {
        concurrency: number
        total: number
        totalMs: number
        rps: number
        p50: number
        p95: number
        p99: number
        errors: number
      }[] = []

      for (const concurrency of concurrencyLevels) {
        const { sm, prod, cleanup } = getStack()
        const rounds = IS_PROD ? 3 : 5
        const totalRequests = concurrency * rounds
        const latencies: number[] = []
        let errors = 0

        const start = performance.now()

        for (let batch = 0; batch < rounds; batch++) {
          const promises = Array.from({ length: concurrency }, async () => {
            const reqStart = performance.now()
            try {
              await benchGet(sm, prod, `/binary?size=${payloadSize}`, 15_000)
              latencies.push(performance.now() - reqStart)
            } catch {
              errors++
              latencies.push(performance.now() - reqStart)
            }
          })
          await Promise.all(promises)
        }

        const totalMs = performance.now() - start
        latencies.sort((a, b) => a - b)

        results.push({
          concurrency,
          total: totalRequests,
          totalMs,
          rps: (totalRequests / totalMs) * 1000,
          p50: percentile(latencies, 50),
          p95: percentile(latencies, 95),
          p99: percentile(latencies, 99),
          errors,
        })
        cleanup()
      }

      console.log(
        "\n┌─────────────┬──────┬──────────┬──────────┬──────────┬──────────┬────────┐"
      )
      console.log(
        "│ Concurrency │ Reqs │ RPS      │ p50(ms)  │ p95(ms)  │ p99(ms)  │ Errors │"
      )
      console.log(
        "├─────────────┼──────┼──────────┼──────────┼──────────┼──────────┼────────┤"
      )
      for (const r of results) {
        console.log(
          `│ ${String(r.concurrency).padStart(11)} │ ${String(r.total).padStart(4)} │ ${r.rps.toFixed(0).padStart(8)} │ ${r.p50.toFixed(1).padStart(8)} │ ${r.p95.toFixed(1).padStart(8)} │ ${r.p99.toFixed(1).padStart(8)} │ ${String(r.errors).padStart(6)} │`
        )
      }
      console.log(
        "└─────────────┴──────┴──────────┴──────────┴──────────┴──────────┴────────┘\n"
      )

      for (const r of results) {
        expect(r.errors).toBe(0)
      }
    }, 300_000)

    // =========================================================================
    // 5. Concurrent large downloads — aggregate throughput
    // =========================================================================

    it("concurrent 1MB downloads — aggregate throughput", async () => {
      const concurrencyLevels = IS_PROD ? [1, 3, 5, 10] : [1, 5, 10, 20]
      const payloadSize = 1024 * 1024

      const results: {
        concurrency: number
        totalBytes: number
        totalMs: number
        throughput: string
        errors: number
      }[] = []

      for (const concurrency of concurrencyLevels) {
        const { sm, prod, cleanup } = getStack()
        let totalBytes = 0
        let errors = 0

        const start = performance.now()

        const promises = Array.from({ length: concurrency }, async () => {
          try {
            const res = await benchGet(sm, prod, `/binary?size=${payloadSize}`)
            totalBytes += res.bodyLength
          } catch {
            errors++
          }
        })
        await Promise.all(promises)

        const totalMs = performance.now() - start
        results.push({
          concurrency,
          totalBytes,
          totalMs,
          throughput: formatRate((totalBytes / totalMs) * 1000),
          errors,
        })
        cleanup()
      }

      console.log(
        "\n┌─────────────┬────────────┬──────────┬──────────────┬────────┐"
      )
      console.log(
        "│ Concurrency │ Total Data │ Time(ms) │ Throughput   │ Errors │"
      )
      console.log(
        "├─────────────┼────────────┼──────────┼──────────────┼────────┤"
      )
      for (const r of results) {
        console.log(
          `│ ${String(r.concurrency).padStart(11)} │ ${formatSize(r.totalBytes).padStart(10)} │ ${r.totalMs.toFixed(0).padStart(8)} │ ${r.throughput.padStart(12)} │ ${String(r.errors).padStart(6)} │`
        )
      }
      console.log(
        "└─────────────┴────────────┴──────────┴──────────────┴────────┘\n"
      )

      for (const r of results) {
        expect(r.errors).toBe(0)
        expect(r.totalBytes).toBe(r.concurrency * payloadSize)
      }
    }, 300_000)

    // =========================================================================
    // 6. Mixed workload
    // =========================================================================

    it("mixed workload — small and large requests simultaneously", async () => {
      const { sm, prod, cleanup } = getStack()
      const smallCount = IS_PROD ? 10 : 20
      const largeCount = IS_PROD ? 3 : 5
      const largeSize = IS_PROD ? 512 * 1024 : 2 * 1024 * 1024

      const start = performance.now()
      let smallOk = 0
      let largeOk = 0
      let errors = 0

      const promises = [
        ...Array.from({ length: smallCount }, async () => {
          try {
            const res = await benchGet(sm, prod, "/binary?size=4096", 15_000)
            if (res.status === 200 && res.bodyLength === 4096) smallOk++
            else errors++
          } catch {
            errors++
          }
        }),
        ...Array.from({ length: largeCount }, async () => {
          try {
            const res = await benchGet(
              sm,
              prod,
              `/binary?size=${largeSize}`,
              30_000
            )
            if (res.status === 200 && res.bodyLength === largeSize) largeOk++
            else errors++
          } catch {
            errors++
          }
        }),
      ]

      await Promise.all(promises)
      const elapsed = performance.now() - start

      console.log(
        `\n  Mixed workload: ${smallOk}/${smallCount} small OK, ${largeOk}/${largeCount} large OK, ${errors} errors, ${elapsed.toFixed(0)}ms total\n`
      )

      expect(smallOk).toBe(smallCount)
      expect(largeOk).toBe(largeCount)
      expect(errors).toBe(0)
      cleanup()
    }, 120_000)

    // =========================================================================
    // 7. Compressible content — realistic dev traffic (JSON, HTML, JS)
    //    This is the test that shows the impact of WS compression.
    // =========================================================================

    it("compressible content: gzip vs raw (real-world dev traffic)", async () => {
      const endpoints = [
        { path: "/json", type: "JSON" },
        { path: "/html", type: "HTML" },
        { path: "/js", type: "JS" },
      ]
      const sizes = IS_PROD
        ? [
            { label: "256KB", bytes: 256 * 1024 },
            { label: "1MB", bytes: 1024 * 1024 },
          ]
        : [
            { label: "256KB", bytes: 256 * 1024 },
            { label: "1MB", bytes: 1024 * 1024 },
          ]

      const results: {
        type: string
        label: string
        origBytes: number
        mode: string
        ms: number
        wireBytes: number
        ratio: string
        rate: string
        ok: boolean
      }[] = []

      for (const ep of endpoints) {
        for (const { label, bytes } of sizes) {
          // Raw (no compression)
          {
            const { sm, prod, cleanup } = getStack()
            const start = performance.now()
            const res = await benchGet(
              sm,
              prod,
              `${ep.path}?size=${bytes}`,
              60_000
            )
            const elapsed = performance.now() - start
            results.push({
              type: ep.type,
              label,
              origBytes: bytes,
              mode: "raw",
              ms: elapsed,
              wireBytes: res.bodyLength,
              ratio: "1.0x",
              rate: formatRate((res.bodyLength / elapsed) * 1000),
              ok: res.status === 200 && res.bodyLength >= bytes * 0.9,
            })
            cleanup()
          }
          // Gzip (Accept-Encoding: gzip — server compresses, compressed bytes flow through tunnel)
          {
            const { sm, prod, cleanup } = getStack()
            const start = performance.now()
            const res = await benchGet(
              sm,
              prod,
              `${ep.path}?size=${bytes}`,
              60_000,
              { "accept-encoding": "gzip" }
            )
            const elapsed = performance.now() - start
            const compressionRatio =
              res.bodyLength > 0 ? (bytes / res.bodyLength).toFixed(1) : "?"
            results.push({
              type: ep.type,
              label,
              origBytes: bytes,
              mode: "gzip",
              ms: elapsed,
              wireBytes: res.bodyLength,
              ratio: `${compressionRatio}x`,
              rate: formatRate((bytes / elapsed) * 1000), // rate in terms of original content size
              ok: res.status === 200 && res.bodyLength > 0,
            })
            cleanup()
          }
        }
      }

      console.log(
        "\n┌────────┬─────────┬──────┬──────────┬────────────┬───────┬──────────────┬────┐"
      )
      console.log(
        "│ Type   │ Size    │ Mode │ Time(ms) │ Wire bytes │ Ratio │ Throughput   │ OK │"
      )
      console.log(
        "├────────┼─────────┼──────┼──────────┼────────────┼───────┼──────────────┼────┤"
      )
      for (const r of results) {
        console.log(
          `│ ${r.type.padEnd(6)} │ ${r.label.padEnd(7)} │ ${r.mode.padEnd(4)} │ ${r.ms.toFixed(0).padStart(8)} │ ${formatSize(r.wireBytes).padStart(10)} │ ${r.ratio.padStart(5)} │ ${r.rate.padStart(12)} │ ${r.ok ? " ✓" : " ✗"} │`
        )
      }
      console.log(
        "└────────┴─────────┴──────┴──────────┴────────────┴───────┴──────────────┴────┘\n"
      )

      for (const r of results) {
        expect(r.ok).toBe(true)
      }
    }, 300_000)
  }
)
