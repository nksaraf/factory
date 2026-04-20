import { describe, expect, test } from "vitest"

function extractStatus(v: unknown): string {
  if (typeof v === "string") return v
  if (typeof v === "object" && v !== null)
    return ((v as Record<string, unknown>).phase as string) ?? "unknown"
  return "unknown"
}

function flattenHost(r: Record<string, unknown>) {
  const spec = (r.spec ?? {}) as Record<string, unknown>
  return {
    id: r.id as string,
    name: (r.name ?? spec.hostname ?? r.slug ?? "") as string,
    slug: (r.slug ?? "") as string,
    ipAddress: (spec.ipAddress ?? r.ipAddress ?? null) as string | null,
    status: (spec.lifecycle as string) ?? extractStatus(r.status),
    osType: (spec.os ?? r.osType ?? "") as string,
    cpuCores: (spec.cpu ?? spec.cpuCores ?? r.cpuCores ?? 0) as number,
    memoryMb: (spec.memoryMb ?? r.memoryMb ?? 0) as number,
    diskGb: (spec.diskGb ?? r.diskGb ?? 0) as number,
  }
}

describe("extractStatus", () => {
  test("returns string status directly", () => {
    expect(extractStatus("active")).toBe("active")
  })

  test("extracts phase from object status", () => {
    expect(extractStatus({ phase: "running" })).toBe("running")
  })

  test("returns unknown for null", () => {
    expect(extractStatus(null)).toBe("unknown")
  })

  test("returns unknown for undefined", () => {
    expect(extractStatus(undefined)).toBe("unknown")
  })

  test("returns unknown for number", () => {
    expect(extractStatus(42)).toBe("unknown")
  })

  test("returns unknown for object without phase", () => {
    expect(extractStatus({ lastScan: {} })).toBe("unknown")
  })
})

describe("flattenHost", () => {
  test("flattens spec fields into host", () => {
    const raw = {
      id: "host_123",
      slug: "my-host",
      name: "My Host",
      type: "vm",
      spec: {
        os: "linux",
        arch: "amd64",
        ipAddress: "192.168.1.1",
        lifecycle: "active",
        cpu: 4,
        memoryMb: 8192,
        diskGb: 100,
      },
      status: { lastScan: { portCount: 5 } },
    }

    const host = flattenHost(raw)
    expect(host.id).toBe("host_123")
    expect(host.name).toBe("My Host")
    expect(host.ipAddress).toBe("192.168.1.1")
    expect(host.status).toBe("active")
    expect(host.osType).toBe("linux")
    expect(host.cpuCores).toBe(4)
    expect(host.memoryMb).toBe(8192)
    expect(host.diskGb).toBe(100)
  })

  test("uses spec.lifecycle for status over status object", () => {
    const raw = {
      id: "host_456",
      slug: "offline-host",
      name: "Offline",
      spec: { lifecycle: "offline" },
      status: { phase: "error" },
    }

    expect(flattenHost(raw).status).toBe("offline")
  })

  test("falls back to status.phase when no spec.lifecycle", () => {
    const raw = {
      id: "host_789",
      slug: "no-lifecycle",
      name: "No Lifecycle",
      spec: {},
      status: { phase: "provisioning" },
    }

    expect(flattenHost(raw).status).toBe("provisioning")
  })

  test("handles missing spec gracefully", () => {
    const raw = { id: "host_000", slug: "bare", name: "Bare" }
    const host = flattenHost(raw)
    expect(host.ipAddress).toBeNull()
    expect(host.cpuCores).toBe(0)
    expect(host.memoryMb).toBe(0)
    expect(host.diskGb).toBe(0)
  })

  test("prefers spec.cpu over spec.cpuCores", () => {
    const raw = {
      id: "h1",
      slug: "h1",
      name: "h1",
      spec: { cpu: 52, cpuCores: 8 },
    }
    expect(flattenHost(raw).cpuCores).toBe(52)
  })
})
