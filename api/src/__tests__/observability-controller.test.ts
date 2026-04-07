import { describe, expect, it } from "vitest"
import { Elysia } from "elysia"
import { NoopObservabilityAdapter } from "../adapters/observability-adapter-noop"
import { observabilityController } from "../modules/observability/index"

function createTestApp() {
  const adapter = new NoopObservabilityAdapter()
  return new Elysia({ prefix: "/api/v1/factory" }).use(observabilityController(adapter))
}

describe("observabilityController", () => {
  const app = createTestApp()

  // -- Logs --
  it("GET /api/v1/factory/observability/logs returns empty result", async () => {
    const res = await app.handle(new Request("http://localhost/api/v1/factory/observability/logs"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ entries: [], hasMore: false })
  })

  it("GET /api/v1/factory/observability/logs with query params", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/v1/factory/observability/logs?system=core&level=error&limit=10")
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.entries).toEqual([])
  })

  // -- Traces --
  it("GET /api/v1/factory/observability/traces returns empty array", async () => {
    const res = await app.handle(new Request("http://localhost/api/v1/factory/observability/traces"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it("GET /api/v1/factory/observability/traces/find returns empty array", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/v1/factory/observability/traces/find?requestId=req-123")
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it("GET /api/v1/factory/observability/traces/:traceId returns empty array", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/v1/factory/observability/traces/abc123")
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  // -- Metrics --
  it("GET /api/v1/factory/observability/metrics/summary returns empty array", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/v1/factory/observability/metrics/summary")
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it("GET /api/v1/factory/observability/metrics/:module/:component returns empty object", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/v1/factory/observability/metrics/core/api")
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({})
  })

  it("GET /api/v1/factory/observability/metrics/series returns empty array", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/v1/factory/observability/metrics/series")
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it("GET /api/v1/factory/observability/metrics/infra returns empty array", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/v1/factory/observability/metrics/infra")
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it("POST /api/v1/factory/observability/metrics/query returns empty array", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/v1/factory/observability/metrics/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promql: "up" }),
      })
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  // -- Alerts --
  it("GET /api/v1/factory/observability/alerts returns empty array", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/v1/factory/observability/alerts")
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it("GET /api/v1/factory/observability/alerts/rules returns empty array", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/v1/factory/observability/alerts/rules")
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it("POST /api/v1/factory/observability/alerts/:id/ack resolves", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/v1/factory/observability/alerts/a1/ack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "investigating" }),
      })
    )
    expect(res.status).toBe(200)
  })

  it("POST /api/v1/factory/observability/alerts/silence returns silenceId", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/v1/factory/observability/alerts/silence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duration: "1h", reason: "maintenance" }),
      })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.silenceId).toMatch(/^silence_noop_/)
  })

  it("POST /api/v1/factory/observability/alerts/rules creates rule", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/v1/factory/observability/alerts/rules", {
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
