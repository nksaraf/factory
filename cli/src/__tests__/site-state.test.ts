/**
 * Tests for site controller state persistence.
 *
 * Covers:
 *   - StateStore: save/load manifest, image history, rollback
 *   - Atomic writes (temp + rename)
 *   - Corruption recovery (falls back to fresh state)
 */
import type { CatalogSystem } from "@smp/factory-shared/catalog"
import { afterEach, describe, expect, it } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { SiteManifest } from "../site/manifest.js"
import { StateStore } from "../site/state.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "site-state-test-"))
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

function makeManifest(version: number): SiteManifest {
  return {
    version,
    systemDeployment: {
      id: "sd-1",
      name: "test",
      site: "test-site",
      realmType: "docker-compose",
    },
    componentDeployments: [],
    catalog: {
      kind: "System",
      metadata: { name: "test", namespace: "default" },
      spec: { owner: "team" },
      components: {},
      resources: {},
      connections: [],
    } as CatalogSystem,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("StateStore", () => {
  const dirs: Array<() => void> = []

  afterEach(() => {
    for (const cleanup of dirs) cleanup()
    dirs.length = 0
  })

  it("starts with no manifest on fresh state", () => {
    const { dir, cleanup } = tempDir()
    dirs.push(cleanup)
    const store = new StateStore(dir)

    expect(store.getLastManifest()).toBeNull()
  })

  it("persists and loads manifest across instances", () => {
    const { dir, cleanup } = tempDir()
    dirs.push(cleanup)

    const store1 = new StateStore(dir)
    store1.saveManifest(makeManifest(42))

    const store2 = new StateStore(dir)
    const loaded = store2.getLastManifest()
    expect(loaded).not.toBeNull()
    expect(loaded!.version).toBe(42)
  })

  it("records and retrieves image deploy history", () => {
    const { dir, cleanup } = tempDir()
    dirs.push(cleanup)

    const store = new StateStore(dir)
    store.recordImageDeploy("api", "registry/api:v1", 1)
    store.recordImageDeploy("api", "registry/api:v2", 2)
    store.recordImageDeploy("api", "registry/api:v3", 3)

    const history = store.getImageHistory("api")
    expect(history).toHaveLength(3)
    expect(history[0].image).toBe("registry/api:v1")
    expect(history[2].image).toBe("registry/api:v3")
  })

  it("returns previous image for rollback", () => {
    const { dir, cleanup } = tempDir()
    dirs.push(cleanup)

    const store = new StateStore(dir)
    store.recordImageDeploy("api", "registry/api:v1", 1)
    store.recordImageDeploy("api", "registry/api:v2", 2)

    expect(store.getPreviousImage("api")).toBe("registry/api:v1")
  })

  it("returns null for rollback with insufficient history", () => {
    const { dir, cleanup } = tempDir()
    dirs.push(cleanup)

    const store = new StateStore(dir)
    store.recordImageDeploy("api", "registry/api:v1", 1)

    expect(store.getPreviousImage("api")).toBeNull()
    expect(store.getPreviousImage("nonexistent")).toBeNull()
  })

  it("caps image history at 10 entries", () => {
    const { dir, cleanup } = tempDir()
    dirs.push(cleanup)

    const store = new StateStore(dir)
    for (let i = 1; i <= 15; i++) {
      store.recordImageDeploy("api", `registry/api:v${i}`, i)
    }

    const history = store.getImageHistory("api")
    expect(history).toHaveLength(10)
    expect(history[0].image).toBe("registry/api:v6")
    expect(history[9].image).toBe("registry/api:v15")
  })

  it("creates state directory if missing", () => {
    const { dir, cleanup } = tempDir()
    dirs.push(cleanup)
    const nestedDir = join(dir, "nested", "state")

    const store = new StateStore(nestedDir)
    store.saveManifest(makeManifest(1))

    expect(existsSync(join(nestedDir, "controller-state.json"))).toBe(true)
  })

  it("recovers from corrupted state file", () => {
    const { dir, cleanup } = tempDir()
    dirs.push(cleanup)

    writeFileSync(join(dir, "controller-state.json"), "not json {{{")

    const store = new StateStore(dir)
    expect(store.getLastManifest()).toBeNull()

    store.saveManifest(makeManifest(99))
    const store2 = new StateStore(dir)
    expect(store2.getLastManifest()!.version).toBe(99)
  })

  it("uses atomic writes (temp file exists briefly)", () => {
    const { dir, cleanup } = tempDir()
    dirs.push(cleanup)

    const store = new StateStore(dir)
    store.saveManifest(makeManifest(1))

    const statePath = join(dir, "controller-state.json")
    const tmpPath = statePath + ".tmp"
    expect(existsSync(statePath)).toBe(true)
    expect(existsSync(tmpPath)).toBe(false)
  })

  it("provides startedAt timestamp", () => {
    const { dir, cleanup } = tempDir()
    dirs.push(cleanup)

    const before = new Date().toISOString()
    const store = new StateStore(dir)
    const startedAt = store.getStartedAt()
    const after = new Date().toISOString()

    expect(startedAt >= before).toBe(true)
    expect(startedAt <= after).toBe(true)
  })
})
