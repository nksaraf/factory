import { describe, expect, it } from "vitest"
import { Elysia } from "elysia"
import { NoopObservabilityAdapter } from "../adapters/observability-adapter-noop"
import { observabilityController } from "../modules/observability/index"

function createTestApp() {
  const adapter = new NoopObservabilityAdapter()
  return new Elysia().use(observabilityController(adapter))
}

describe("observabilityController", () => {
  const app = createTestApp()

  // -- Logs --
  it("GET /api/v1/observability/logs returns empty result", async () => {
    const res = await app.handle(new Request("http://localhost/api/v1/observability/logs"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ entries: [], hasMore: false })
  })

  it("GET /api/v1/observability/logs with query params", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/v1/observability/logs?module=core&level=error&limit=10")
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.entries).toEqual([])
  })

  // -- Traces --
  it("GET /api/v1/observability/traces returns empty array", async () => {
    const res = await app.handle(new Request("http://localhost/api/v1/observability/traces"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it("GET /api/v1/observability/traces/find returns empty array", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/v1/observability/traces/find?requestId=req-123")
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it("GET /api/v1/observability/traces/:traceId returns empty array", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/v1/observability/traces/abc123")
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  // -- Metrics --
  it("GET /api/v1/observability/metrics/summary returns empty array", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/v1/observability/metrics/summary")
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it("GET /api/v1/observability/metrics/:module/:component returns empty object", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/v1/observability/metrics/core/api")
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({})
  })

  it("GET /api/v1/observability/metrics/series returns empty array", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/v1/observability/metrics/series")
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it("GET /api/v1/observability/metrics/infra returns empty array", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/v1/observability/metrics/infra")
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it("POST /api/v1/observability/metrics/query returns empty array", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/v1/observability/metrics/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promql: "up" }),
      })
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  // -- Alerts --
  it("GET /api/v1/observability/alerts returns empty array", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/v1/observability/alerts")
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it("GET /api/v1/observability/alerts/rules returns empty array", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/v1/observability/alerts/rules")
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it("POST /api/v1/observability/alerts/:id/ack resolves", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/v1/observability/alerts/a1/ack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "investigating" }),
      })
    )
    expect(res.status).toBe(200)
  })

  it("POST /api/v1/observability/alerts/silence returns silenceId", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/v1/observability/alerts/silence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duration: "1h", reason: "maintenance" }),
      })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.silenceId).toMatch(/^silence_noop_/)
  })

  it("POST /api/v1/observability/alerts/rules creates rule", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/v1/observability/alerts/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "test",
          metric: "up",
          threshold: "> 0",
          severity: "warning",
          enabled: true,
        }),
      })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toMatch(/^rule_noop_/)
    expect(body.name).toBe("test")
  })
})
