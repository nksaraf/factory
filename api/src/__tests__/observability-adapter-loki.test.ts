import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { LokiObservabilityAdapter } from "../adapters/observability-adapter-loki"
import { getObservabilityAdapter } from "../adapters/adapter-registry"

function lokiResponse(
  streams: Array<{
    stream: Record<string, string>
    values: Array<[string, string]>
  }>
) {
  return {
    status: "success",
    data: { resultType: "streams", result: streams },
  }
}

const pinoLog = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    level: 30,
    time: "2026-04-07T12:00:00.000Z",
    msg: "test message",
    service: "factory-api",
    ...overrides,
  })

describe("LokiObservabilityAdapter", () => {
  let adapter: LokiObservabilityAdapter
  let fetchSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    adapter = new LokiObservabilityAdapter("http://loki:3100")
    fetchSpy = spyOn(globalThis, "fetch")
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it("has type 'loki'", () => {
    expect(adapter.type).toBe("loki")
  })

  it("strips trailing slash from URL", () => {
    const a = new LokiObservabilityAdapter("http://loki:3100///")
    // Verify by checking the fetch URL
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(lokiResponse([])), { status: 200 })
    )
    a.queryLogs({})
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("http://loki:3100/loki/api/v1/query_range")
    )
  })

  // -- LogQL building --

  it("builds base LogQL with no filters", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(lokiResponse([])), { status: 200 })
    )
    await adapter.queryLogs({})
    const url = fetchSpy.mock.calls[0][0] as string
    expect(url).toContain("query=%7Bservice_name%3D%7E%22.%2B%22%7D") // {service_name=~".+"}
  })

  it("adds level filter to LogQL", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(lokiResponse([])), { status: 200 })
    )
    await adapter.queryLogs({ level: "error" })
    const url = fetchSpy.mock.calls[0][0] as string
    const query = new URL(url).searchParams.get("query")!
    expect(query).toContain("level >= 50")
  })

  it("adds operation filter to LogQL", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(lokiResponse([])), { status: 200 })
    )
    await adapter.queryLogs({ sandbox: "proxmox" })
    const url = fetchSpy.mock.calls[0][0] as string
    const query = new URL(url).searchParams.get("query")!
    expect(query).toContain('op="proxmox"')
  })

  it("sanitizes backticks in grep filter", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(lokiResponse([])), { status: 200 })
    )
    await adapter.queryLogs({ grep: "test`injection" })
    const url = fetchSpy.mock.calls[0][0] as string
    const query = new URL(url).searchParams.get("query")!
    expect(query).toContain("`testinjection`")
    expect(query).not.toContain("``")
  })

  // -- Timestamp conversion --

  it("converts relative time '1h' to nanosecond start param", async () => {
    const before = Date.now()
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(lokiResponse([])), { status: 200 })
    )
    await adapter.queryLogs({ since: "1h" })
    const url = fetchSpy.mock.calls[0][0] as string
    const start = new URL(url).searchParams.get("start")!
    const startMs = Number(start) / 1_000_000
    // Should be roughly 1 hour ago (within 5s tolerance)
    expect(startMs).toBeGreaterThan(before - 3_605_000)
    expect(startMs).toBeLessThan(before - 3_595_000)
  })

  it("converts ISO date to nanosecond start param", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(lokiResponse([])), { status: 200 })
    )
    await adapter.queryLogs({ since: "2026-01-01T00:00:00.000Z" })
    const url = fetchSpy.mock.calls[0][0] as string
    const start = new URL(url).searchParams.get("start")!
    const expectedNs =
      new Date("2026-01-01T00:00:00.000Z").getTime() * 1_000_000
    expect(start).toBe(String(expectedNs))
  })

  it("cursor overrides since", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(lokiResponse([])), { status: 200 })
    )
    await adapter.queryLogs({ since: "1h", cursor: "999999000000000" })
    const url = fetchSpy.mock.calls[0][0] as string
    const start = new URL(url).searchParams.get("start")!
    expect(start).toBe("999999000000000")
  })

  // -- Log line parsing --

  it("parses structured Pino JSON log", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          lokiResponse([
            {
              stream: { service_name: "unknown_service" },
              values: [
                [
                  "1712491200000000000",
                  pinoLog({
                    op: "reconciler",
                    runId: "opr_123",
                    durationMs: 450,
                  }),
                ],
              ],
            },
          ])
        ),
        { status: 200 }
      )
    )
    const result = await adapter.queryLogs({})
    expect(result.entries).toHaveLength(1)
    const entry = result.entries[0]
    expect(entry.level).toBe("info")
    expect(entry.message).toBe("test message")
    expect(entry.source).toBe("factory-api")
    expect(entry.timestamp).toBe("2026-04-07T12:00:00.000Z")
    expect(entry.attributes.op).toBe("reconciler")
    expect(entry.attributes.runId).toBe("opr_123")
    expect(entry.attributes.durationMs).toBe("450")
  })

  it("parses plain text log line", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          lokiResponse([
            {
              stream: { service_name: "postgres", level: "warn" },
              values: [["1712491200000000000", "LOG: checkpoint starting"]],
            },
          ])
        ),
        { status: 200 }
      )
    )
    const result = await adapter.queryLogs({})
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].message).toBe("LOG: checkpoint starting")
    expect(result.entries[0].level).toBe("warn")
    expect(result.entries[0].source).toBe("postgres")
  })

  it("strips Body: Str(...) wrapping from historical data", async () => {
    const wrapped = `Body: Str(Body: Str(${pinoLog()}))`
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          lokiResponse([
            {
              stream: { service_name: "unknown_service" },
              values: [["1712491200000000000", wrapped]],
            },
          ])
        ),
        { status: 200 }
      )
    )
    const result = await adapter.queryLogs({})
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].message).toBe("test message")
    expect(result.entries[0].level).toBe("info")
  })

  it("uses cleaned value as fallback message when msg is missing", async () => {
    const noMsg = JSON.stringify({
      level: 30,
      time: "2026-04-07T12:00:00.000Z",
      service: "factory-api",
    })
    const wrapped = `Body: Str(${noMsg})`
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          lokiResponse([
            {
              stream: {},
              values: [["1712491200000000000", wrapped]],
            },
          ])
        ),
        { status: 200 }
      )
    )
    const result = await adapter.queryLogs({})
    // Should use the cleaned (unwrapped) JSON string as fallback, not the Body: Str(...) wrapped version
    expect(result.entries[0].message).toBe(noMsg)
    expect(result.entries[0].message).not.toContain("Body: Str")
  })

  // -- Pino level mapping --

  it("maps Pino numeric levels correctly", async () => {
    const levels = [
      { input: 10, expected: "debug" as const },
      { input: 20, expected: "debug" as const },
      { input: 30, expected: "info" as const },
      { input: 40, expected: "warn" as const },
      { input: 50, expected: "error" as const },
      { input: 60, expected: "fatal" as const },
    ]
    for (const { input, expected } of levels) {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            lokiResponse([
              {
                stream: {},
                values: [["1712491200000000000", pinoLog({ level: input })]],
              },
            ])
          ),
          { status: 200 }
        )
      )
      const result = await adapter.queryLogs({})
      expect(result.entries[0].level).toBe(expected)
    }
  })

  // -- Response handling --

  it("returns empty on HTTP error", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("bad gateway", { status: 502 }))
    const result = await adapter.queryLogs({})
    expect(result.entries).toEqual([])
    expect(result.hasMore).toBe(false)
  })

  it("returns empty on fetch error", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("connection refused"))
    const result = await adapter.queryLogs({})
    expect(result.entries).toEqual([])
    expect(result.hasMore).toBe(false)
  })

  it("sets hasMore when entries >= limit", async () => {
    const values: Array<[string, string]> = Array.from(
      { length: 3 },
      (_, i) => [
        String(1712491200000000000 + i * 1000000),
        pinoLog({ msg: `msg ${i}` }),
      ]
    )
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(lokiResponse([{ stream: {}, values }])), {
        status: 200,
      })
    )
    const result = await adapter.queryLogs({ limit: 3 })
    expect(result.entries).toHaveLength(3)
    expect(result.hasMore).toBe(true)
  })

  it("sorts entries newest-first", async () => {
    const values: Array<[string, string]> = [
      [
        "1712491200000000000",
        pinoLog({ time: "2026-04-07T12:00:00.000Z", msg: "first" }),
      ],
      [
        "1712491260000000000",
        pinoLog({ time: "2026-04-07T12:01:00.000Z", msg: "second" }),
      ],
      [
        "1712491320000000000",
        pinoLog({ time: "2026-04-07T12:02:00.000Z", msg: "third" }),
      ],
    ]
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(lokiResponse([{ stream: {}, values }])), {
        status: 200,
      })
    )
    const result = await adapter.queryLogs({})
    expect(result.entries[0].message).toBe("third")
    expect(result.entries[2].message).toBe("first")
  })

  // -- Noop delegates --

  it("delegates traces/metrics/alerts to noop returns", async () => {
    expect(await adapter.listTraces({})).toEqual([])
    expect(await adapter.getTrace("t1")).toEqual([])
    expect(await adapter.findTrace({})).toEqual([])
    expect(await adapter.getSummary({})).toEqual([])
    expect(await adapter.getComponentMetrics("m", "c", {})).toEqual({})
    expect(await adapter.getSeries({})).toEqual([])
    expect(await adapter.getInfraMetrics({})).toEqual([])
    expect(await adapter.runQuery("up", {})).toEqual([])
    expect(await adapter.listAlerts({})).toEqual([])
    expect(await adapter.listAlertRules()).toEqual([])
    await expect(adapter.getAlert("a1")).rejects.toThrow("Alert not found: a1")
  })
})

describe("getObservabilityAdapter('loki')", () => {
  it("returns Loki adapter via registry", () => {
    const adapter = getObservabilityAdapter("loki", {
      lokiUrl: "http://test:3100",
    })
    expect(adapter.type).toBe("loki")
  })
})
