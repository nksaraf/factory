import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { PortManager, allocatePort, isPortFree } from "./port-manager.js"

let testDir: string

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "port-mgr-"))
  mkdirSync(join(testDir, ".dx"), { recursive: true })
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

function stateDir() {
  return join(testDir, ".dx")
}

describe("isPortFree", () => {
  test("returns true for an unused port", async () => {
    // Allocate a port then close it — it should be free
    const port = await allocatePort(new Set())
    expect(await isPortFree(port)).toBe(true)
  })

  test("returns false for an occupied port", async () => {
    const server = createServer()
    const port = await new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address()
        resolve(typeof addr === "object" && addr ? addr.port : 0)
      })
    })
    try {
      expect(await isPortFree(port)).toBe(false)
    } finally {
      server.close()
    }
  })
})

describe("allocatePort", () => {
  test("returns a port not in the reserved set", async () => {
    const reserved = new Set([1234, 5678])
    const port = await allocatePort(reserved)
    expect(reserved.has(port)).toBe(false)
    expect(port).toBeGreaterThan(0)
  })
})

describe("PortManager", () => {
  test("resolve assigns preferred ports when free", async () => {
    const pm = new PortManager(stateDir())
    const result = await pm.resolve([
      { name: "api", preferred: 14100 },
      { name: "ui", preferred: 13100 },
    ])
    expect(result.api).toBe(14100)
    expect(result.ui).toBe(13100)
  })

  test("resolve falls back to dynamic when preferred is occupied", async () => {
    // Occupy a port
    const server = createServer()
    const occupiedPort = await new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address()
        resolve(typeof addr === "object" && addr ? addr.port : 0)
      })
    })
    try {
      const pm = new PortManager(stateDir())
      const result = await pm.resolve([
        { name: "api", preferred: occupiedPort },
      ])
      expect(result.api).not.toBe(occupiedPort)
      expect(result.api).toBeGreaterThan(0)
    } finally {
      server.close()
    }
  })

  test("resolve reuses persisted ports across instances", async () => {
    const pm1 = new PortManager(stateDir())
    const result1 = await pm1.resolve([{ name: "api" }])

    // New instance reads from the same state file
    const pm2 = new PortManager(stateDir())
    const result2 = await pm2.resolve([{ name: "api" }])

    expect(result2.api).toBe(result1.api)
  })

  test("resolve does not assign duplicate ports", async () => {
    const pm = new PortManager(stateDir())
    const result = await pm.resolve([
      { name: "svc-a" },
      { name: "svc-b" },
      { name: "svc-c" },
    ])
    const ports = Object.values(result)
    expect(new Set(ports).size).toBe(ports.length)
  })

  test("pin persists and is honored by resolve", async () => {
    const pm = new PortManager(stateDir())
    pm.pin("api", 9999)

    const result = await pm.resolve([{ name: "api" }])
    expect(result.api).toBe(9999)
  })

  test("pin throws if port conflicts with another service", () => {
    const pm = new PortManager(stateDir())
    pm.pin("api", 9999)
    expect(() => pm.pin("ui", 9999)).toThrow("already reserved by api")
  })

  test("clear removes a single service", async () => {
    const pm = new PortManager(stateDir())
    await pm.resolve([{ name: "api" }, { name: "ui" }])
    pm.clear("api")

    const status = pm.status()
    expect(status.find((s) => s.name === "api/default")).toBeUndefined()
    expect(status.find((s) => s.name === "ui/default")).toBeDefined()
  })

  test("clear with no arg removes all", async () => {
    const pm = new PortManager(stateDir())
    await pm.resolve([{ name: "api" }, { name: "ui" }])
    pm.clear()

    expect(pm.status()).toEqual([])
  })

  test("status returns current reservations sorted", async () => {
    const pm = new PortManager(stateDir())
    await pm.resolve([
      { name: "ui", preferred: 13100 },
      { name: "api", preferred: 14100 },
    ])
    const status = pm.status()
    expect(status).toHaveLength(2)
    expect(status[0].name).toBe("api/default")
    expect(status[0].port).toBe(14100)
    expect(status[1].name).toBe("ui/default")
    expect(status[1].port).toBe(13100)
  })

  test("writeEnvFile generates correct format", async () => {
    const pm = new PortManager(stateDir())
    const envPath = join(testDir, ".dx", ".env")
    // writeEnvFile takes pre-built env var map (from portEnvVars())
    pm.writeEnvFile(
      { INFRA_POSTGRES_PORT: "5433", SERVICE_DATA_PORT: "8084" },
      envPath
    )
    const content = readFileSync(envPath, "utf-8")
    expect(content).toContain("INFRA_POSTGRES_PORT=5433")
    expect(content).toContain("SERVICE_DATA_PORT=8084")
  })

  test("writeEnvFile preserves env-var-style keys", async () => {
    const pm = new PortManager(stateDir())
    const envPath = join(testDir, ".dx", ".env")
    pm.writeEnvFile({ CUSTOM_VAR: "9090" }, envPath)
    const content = readFileSync(envPath, "utf-8")
    expect(content).toContain("CUSTOM_VAR=9090")
  })

  test("persists to ports.json", async () => {
    const pm = new PortManager(stateDir())
    await pm.resolve([{ name: "api", preferred: 14100 }])
    expect(existsSync(join(stateDir(), "ports.json"))).toBe(true)

    const raw = JSON.parse(
      readFileSync(join(stateDir(), "ports.json"), "utf-8")
    )
    // Stored with compound key "api/default"
    expect(raw["api/default"].port).toBe(14100)
    expect(raw["api/default"].pinned).toBe(false)
  })
})
