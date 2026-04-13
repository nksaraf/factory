import type { CatalogSystem } from "@smp/factory-shared/catalog"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"

import { checkBuildStatus, recordBuild } from "./build-cache.js"

let rootDir: string

function git(...args: string[]) {
  const r = spawnSync("git", args, {
    cwd: rootDir,
    encoding: "utf8",
    timeout: 5_000,
  })
  if (r.status !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`)
  return r.stdout.trim()
}

function makeCatalog(): CatalogSystem {
  return {
    kind: "System",
    metadata: { name: "test", namespace: "default" },
    spec: { owner: "test-team", domain: "test", lifecycle: "development" },
    components: {
      api: {
        kind: "Component",
        metadata: { name: "api", namespace: "default" },
        spec: {
          type: "service",
          lifecycle: "development",
          owner: "test-team",
          runtime: "node",
          build: { context: "./api", dockerfile: "./api/Dockerfile" },
          ports: [{ port: 14100, name: "http" }],
        },
      },
      worker: {
        kind: "Component",
        metadata: { name: "worker", namespace: "default" },
        spec: {
          type: "service",
          lifecycle: "development",
          owner: "test-team",
          runtime: "python",
          build: { context: "./worker", dockerfile: "./worker/Dockerfile" },
        },
      },
    },
    resources: {
      postgres: {
        kind: "Resource",
        metadata: { name: "postgres", namespace: "default" },
        spec: {
          type: "database",
          owner: "test-team",
          lifecycle: "development",
          image: "postgres:16-alpine",
        },
      },
    },
    apis: {},
    connections: [],
  } as unknown as CatalogSystem
}

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), "dx-build-cache-"))
  mkdirSync(join(rootDir, ".dx"), { recursive: true })

  git("init")
  git("config", "user.email", "test@test.com")
  git("config", "user.name", "Test")

  mkdirSync(join(rootDir, "api"), { recursive: true })
  writeFileSync(join(rootDir, "api", "index.ts"), "console.log('api')")
  mkdirSync(join(rootDir, "worker"), { recursive: true })
  writeFileSync(join(rootDir, "worker", "main.py"), "print('worker')")

  git("add", "-A")
  git("commit", "-m", "initial")
})

afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true })
})

describe("checkBuildStatus", () => {
  test("reports 'new' when no cache exists", () => {
    const catalog = makeCatalog()
    const result = checkBuildStatus(rootDir, catalog, ["api", "worker"])

    expect(result.needsBuild).toContain("api")
    expect(result.needsBuild).toContain("worker")
    expect(result.cached).toEqual([])
    expect(result.details.api.reason).toBe("new")
    expect(result.details.worker.reason).toBe("new")
  })

  test("reports 'cached' after recordBuild with no changes", () => {
    const catalog = makeCatalog()
    recordBuild(rootDir, catalog, ["api", "worker"])

    const result = checkBuildStatus(rootDir, catalog, ["api", "worker"])

    expect(result.cached).toContain("api")
    expect(result.cached).toContain("worker")
    expect(result.needsBuild).toEqual([])
    expect(result.details.api.reason).toBe("cached")
  })

  test("reports 'changed' after committed source change", () => {
    const catalog = makeCatalog()
    recordBuild(rootDir, catalog, ["api"])

    writeFileSync(join(rootDir, "api", "index.ts"), "console.log('v2')")
    git("add", "-A")
    git("commit", "-m", "update api")

    const result = checkBuildStatus(rootDir, catalog, ["api"])

    expect(result.needsBuild).toContain("api")
    expect(result.details.api.reason).toBe("changed")
  })

  test("reports 'dirty' for uncommitted changes", () => {
    const catalog = makeCatalog()
    recordBuild(rootDir, catalog, ["api"])

    writeFileSync(join(rootDir, "api", "index.ts"), "console.log('dirty')")

    const result = checkBuildStatus(rootDir, catalog, ["api"])

    expect(result.needsBuild).toContain("api")
    expect(result.details.api.reason).toBe("dirty")
  })

  test("reports 'dirty' for untracked files in context", () => {
    const catalog = makeCatalog()
    recordBuild(rootDir, catalog, ["api"])

    writeFileSync(join(rootDir, "api", "new-file.ts"), "export {}")

    const result = checkBuildStatus(rootDir, catalog, ["api"])

    expect(result.needsBuild).toContain("api")
    expect(result.details.api.reason).toBe("dirty")
  })

  test("skips services without build directives (resources)", () => {
    const catalog = makeCatalog()
    const result = checkBuildStatus(rootDir, catalog, ["postgres"])

    expect(result.needsBuild).toEqual([])
    expect(result.cached).toEqual([])
    expect(result.details.postgres).toBeUndefined()
  })

  test("only rebuilds changed service, not all", () => {
    const catalog = makeCatalog()
    recordBuild(rootDir, catalog, ["api", "worker"])

    writeFileSync(join(rootDir, "api", "index.ts"), "console.log('v2')")
    git("add", "-A")
    git("commit", "-m", "update api only")

    const result = checkBuildStatus(rootDir, catalog, ["api", "worker"])

    expect(result.needsBuild).toEqual(["api"])
    expect(result.cached).toEqual(["worker"])
  })
})

describe("recordBuild", () => {
  test("writes hashes to .dx/build-hashes.json", () => {
    const catalog = makeCatalog()
    recordBuild(rootDir, catalog, ["api"])

    const cachePath = join(rootDir, ".dx", "build-hashes.json")
    expect(existsSync(cachePath)).toBe(true)

    const data = JSON.parse(readFileSync(cachePath, "utf8"))
    expect(data.api).toBeDefined()
    expect(data.api.treeHash).toBeTypeOf("string")
    expect(data.api.treeHash.length).toBe(40)
    expect(data.api.builtAt).toBeTypeOf("string")
  })

  test("preserves existing entries when recording new ones", () => {
    const catalog = makeCatalog()
    recordBuild(rootDir, catalog, ["api"])
    recordBuild(rootDir, catalog, ["worker"])

    const cachePath = join(rootDir, ".dx", "build-hashes.json")
    const data = JSON.parse(readFileSync(cachePath, "utf8"))
    expect(data.api).toBeDefined()
    expect(data.worker).toBeDefined()
  })

  test("skips services without build context", () => {
    const catalog = makeCatalog()
    recordBuild(rootDir, catalog, ["postgres"])

    const cachePath = join(rootDir, ".dx", "build-hashes.json")
    const data = JSON.parse(readFileSync(cachePath, "utf8"))
    expect(data.postgres).toBeUndefined()
  })
})
