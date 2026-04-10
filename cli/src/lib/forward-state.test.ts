import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"

// Create a stable temp dir BEFORE the mock is evaluated, so module-level
// constants in forward-state.ts resolve to our test directory.
const TEST_HOME = mkdtempSync(join(tmpdir(), "fwd-state-"))
const STATE_DIR = join(TEST_HOME, ".config", "dx")
const STATE_FILE = join(STATE_DIR, "forwards.json")

vi.mock("node:os", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:os")>()
  return { ...original, homedir: () => TEST_HOME }
})

// Import after mock setup so module-level constants use our TEST_HOME
const { ForwardState, findFreePort } = await import("./forward-state.js")

afterAll(() => {
  rmSync(TEST_HOME, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function writeState(entries: unknown[]) {
  mkdirSync(STATE_DIR, { recursive: true })
  writeFileSync(STATE_FILE, JSON.stringify(entries))
}

function readState(): unknown[] {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8"))
  } catch {
    return []
  }
}

function clearState() {
  try {
    rmSync(STATE_FILE)
  } catch {
    // doesn't exist
  }
}

describe("ForwardState", () => {
  beforeAll(() => clearState())

  test("list returns empty when no state file exists", () => {
    clearState()
    const state = new ForwardState()
    expect(state.list()).toEqual([])
  })

  test("add creates an entry with a generated id", () => {
    clearState()
    const state = new ForwardState()
    const id = state.add({
      pid: process.pid,
      localPort: 5432,
      remotePort: 5432,
      remoteHost: "192.168.1.1",
      displayName: "staging",
      startedAt: "2026-01-01T00:00:00Z",
    })

    expect(id).toMatch(/^[0-9a-f]{6}$/)
    const entries = state.list()
    expect(entries).toHaveLength(1)
    expect(entries[0].id).toBe(id)
    expect(entries[0].localPort).toBe(5432)
    expect(entries[0].displayName).toBe("staging")
  })

  test("add generates unique ids across multiple entries", () => {
    clearState()
    const state = new ForwardState()
    const ids = new Set<string>()
    for (let i = 0; i < 20; i++) {
      const id = state.add({
        pid: process.pid,
        localPort: 5000 + i,
        remotePort: 5000 + i,
        remoteHost: "host",
        displayName: "test",
        startedAt: new Date().toISOString(),
      })
      ids.add(id)
    }
    expect(ids.size).toBe(20)
  })

  test("list prunes entries with dead PIDs", () => {
    // PID 999999 is almost certainly dead
    writeState([
      {
        id: "aaaaaa",
        pid: 999999,
        localPort: 5432,
        remotePort: 5432,
        remoteHost: "host",
        displayName: "dead",
        startedAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "bbbbbb",
        pid: process.pid,
        localPort: 3000,
        remotePort: 3000,
        remoteHost: "host",
        displayName: "alive",
        startedAt: "2026-01-01T00:00:00Z",
      },
    ])

    const state = new ForwardState()
    const entries = state.list()
    expect(entries).toHaveLength(1)
    expect(entries[0].id).toBe("bbbbbb")

    // State file should be updated with pruned entries
    const persisted = readState() as Array<{ id: string }>
    expect(persisted).toHaveLength(1)
  })

  test("remove deletes entry by id and prunes dead PIDs", () => {
    writeState([
      {
        id: "aaaaaa",
        pid: process.pid,
        localPort: 5432,
        remotePort: 5432,
        remoteHost: "host",
        displayName: "test",
        startedAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "bbbbbb",
        pid: 999999,
        localPort: 3000,
        remotePort: 3000,
        remoteHost: "host",
        displayName: "dead",
        startedAt: "2026-01-01T00:00:00Z",
      },
    ])

    const state = new ForwardState()
    const removed = state.remove("aaaaaa")
    expect(removed).toBe(true)

    // Both should be gone: aaaaaa removed, bbbbbb pruned
    const persisted = readState() as Array<{ id: string }>
    expect(persisted).toHaveLength(0)
  })

  test("remove returns false for unknown id", () => {
    clearState()
    const state = new ForwardState()
    expect(state.remove("nonexistent")).toBe(false)
  })

  test("clear removes all entries", () => {
    clearState()
    const state = new ForwardState()
    state.add({
      pid: process.pid,
      localPort: 5432,
      remotePort: 5432,
      remoteHost: "host",
      displayName: "test",
      startedAt: new Date().toISOString(),
    })
    expect(state.list()).toHaveLength(1)

    state.clear()
    expect(state.list()).toHaveLength(0)
  })

  test("reservedPorts returns set of alive local ports", () => {
    writeState([
      {
        id: "aaaaaa",
        pid: process.pid,
        localPort: 5432,
        remotePort: 5432,
        remoteHost: "host",
        displayName: "test",
        startedAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "bbbbbb",
        pid: process.pid,
        localPort: 3000,
        remotePort: 3000,
        remoteHost: "host",
        displayName: "test2",
        startedAt: "2026-01-01T00:00:00Z",
      },
    ])

    const state = new ForwardState()
    const ports = state.reservedPorts()
    expect(ports).toEqual(new Set([5432, 3000]))
  })

  test("handles corrupted state file gracefully", () => {
    mkdirSync(STATE_DIR, { recursive: true })
    writeFileSync(STATE_FILE, "not valid json!!!")

    const state = new ForwardState()
    expect(state.list()).toEqual([])
  })
})

describe("findFreePort", () => {
  test("returns preferred port when available", async () => {
    clearState()
    const port = await findFreePort(59123, false)
    expect(port).toBeGreaterThanOrEqual(59123)
  })

  test("throws when explicit port is taken", async () => {
    const { createServer } = await import("node:net")
    const server = createServer()
    const port = await new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address()
        resolve(typeof addr === "object" && addr ? addr.port : 0)
      })
    })

    try {
      await expect(findFreePort(port, true)).rejects.toThrow(
        `Port ${port} is already in use`
      )
    } finally {
      server.close()
    }
  })

  test("auto-increments when preferred port is taken", async () => {
    const { createServer } = await import("node:net")
    const server = createServer()
    const port = await new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address()
        resolve(typeof addr === "object" && addr ? addr.port : 0)
      })
    })

    try {
      clearState()
      const found = await findFreePort(port, false)
      expect(found).toBeGreaterThan(port)
    } finally {
      server.close()
    }
  })

  test("skips ports reserved by global forwards", async () => {
    clearState()
    // Add a forward entry claiming port 59200
    const state = new ForwardState()
    state.add({
      pid: process.pid,
      localPort: 59200,
      remotePort: 5432,
      remoteHost: "host",
      displayName: "test",
      startedAt: new Date().toISOString(),
    })

    const port = await findFreePort(59200, false)
    expect(port).toBeGreaterThan(59200)
  })
})
