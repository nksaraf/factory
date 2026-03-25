import { describe, expect, it } from "vitest"
import { NoopObservabilityAdapter } from "../adapters/observability-adapter-noop"
import { ClickStackObservabilityAdapter } from "../adapters/observability-adapter-clickstack"
import { SigNozObservabilityAdapter } from "../adapters/observability-adapter-signoz"
import { getObservabilityAdapter } from "../adapters/adapter-registry"
import type { ObservabilityAdapter } from "../adapters/observability-adapter"

describe("NoopObservabilityAdapter", () => {
  const adapter: ObservabilityAdapter = new NoopObservabilityAdapter()

  it("has type 'noop'", () => {
    expect(adapter.type).toBe("noop")
  })

  it("queryLogs returns empty result", async () => {
    const result = await adapter.queryLogs({})
    expect(result).toEqual({ entries: [], hasMore: false })
  })

  it("streamLogs resolves immediately", async () => {
    const ac = new AbortController()
    const entries: unknown[] = []
    await adapter.streamLogs({}, (e) => entries.push(e), ac.signal)
    expect(entries).toEqual([])
  })

  it("listTraces returns empty array", async () => {
    expect(await adapter.listTraces({})).toEqual([])
  })

  it("getTrace returns empty array", async () => {
    expect(await adapter.getTrace("t1")).toEqual([])
  })

  it("findTrace returns empty array", async () => {
    expect(await adapter.findTrace({})).toEqual([])
  })

  it("getSummary returns empty array", async () => {
    expect(await adapter.getSummary({})).toEqual([])
  })

  it("getComponentMetrics returns empty object", async () => {
    expect(await adapter.getComponentMetrics("mod", "comp", {})).toEqual({})
  })

  it("getSeries returns empty array", async () => {
    expect(await adapter.getSeries({})).toEqual([])
  })

  it("getInfraMetrics returns empty array", async () => {
    expect(await adapter.getInfraMetrics({})).toEqual([])
  })

  it("runQuery returns empty array", async () => {
    expect(await adapter.runQuery("up", {})).toEqual([])
  })

  it("listAlerts returns empty array", async () => {
    expect(await adapter.listAlerts({})).toEqual([])
  })

  it("getAlert throws not found", async () => {
    await expect(adapter.getAlert("a1")).rejects.toThrow("Alert not found: a1")
  })

  it("ackAlert resolves", async () => {
    await expect(adapter.ackAlert("a1", "ok")).resolves.toBeUndefined()
  })

  it("resolveAlert resolves", async () => {
    await expect(adapter.resolveAlert("a1", "fixed")).resolves.toBeUndefined()
  })

  it("silenceAlerts returns silenceId", async () => {
    const result = await adapter.silenceAlerts({
      duration: "1h",
      reason: "maintenance",
    })
    expect(result.silenceId).toMatch(/^silence_noop_/)
  })

  it("listAlertRules returns empty array", async () => {
    expect(await adapter.listAlertRules()).toEqual([])
  })

  it("getAlertRule throws not found", async () => {
    await expect(adapter.getAlertRule("r1")).rejects.toThrow(
      "Alert rule not found: r1"
    )
  })

  it("setAlertRuleEnabled resolves", async () => {
    await expect(
      adapter.setAlertRuleEnabled("r1", false)
    ).resolves.toBeUndefined()
  })

  it("createAlertRule returns rule with id", async () => {
    const rule = await adapter.createAlertRule({
      name: "test",
      metric: "up",
      threshold: "> 0",
      severity: "warning",
      enabled: true,
    })
    expect(rule.id).toMatch(/^rule_noop_/)
    expect(rule.name).toBe("test")
    expect(rule.severity).toBe("warning")
  })
})

describe("ClickStackObservabilityAdapter", () => {
  it("has type 'clickstack' and throws NYI on all methods", () => {
    const adapter = new ClickStackObservabilityAdapter()
    expect(adapter.type).toBe("clickstack")
    expect(() => adapter.queryLogs({})).toThrow("not yet implemented")
    expect(() => adapter.listTraces({})).toThrow("not yet implemented")
    expect(() => adapter.listAlerts({})).toThrow("not yet implemented")
  })
})

describe("SigNozObservabilityAdapter", () => {
  it("has type 'signoz' and throws NYI on all methods", () => {
    const adapter = new SigNozObservabilityAdapter()
    expect(adapter.type).toBe("signoz")
    expect(() => adapter.queryLogs({})).toThrow("not yet implemented")
    expect(() => adapter.listTraces({})).toThrow("not yet implemented")
    expect(() => adapter.listAlerts({})).toThrow("not yet implemented")
  })
})

describe("getObservabilityAdapter", () => {
  it("returns noop adapter by default", () => {
    const adapter = getObservabilityAdapter()
    expect(adapter.type).toBe("noop")
  })

  it("returns noop adapter explicitly", () => {
    const adapter = getObservabilityAdapter("noop")
    expect(adapter.type).toBe("noop")
  })

  it("throws for unknown type", () => {
    expect(() => getObservabilityAdapter("unknown" as any)).toThrow(
      "No observability adapter for type: unknown"
    )
  })
})
