import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { RUN_JS } from "./run-dx.js"

function tmpDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "dx-add-test-"))
}

function isolatedHome(): string {
  return mkdtempSync(path.join(os.tmpdir(), "dx-add-home-"))
}

function readFile(dir: string, ...segments: string[]): string {
  return readFileSync(path.join(dir, ...segments), "utf8")
}

/** Run dx from a specific cwd (needed for `dx add` to find project root). */
function runDxInDir(
  args: string[],
  cwd: string,
  home: string
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("bun", [RUN_JS, ...args], {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, HOME: home },
    stdio: ["ignore", "pipe", "pipe"],
  })
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  }
}

/** Create a project scaffold to add things to. */
function createProject(dir: string, home: string): void {
  const result = spawnSync(
    "bun",
    [RUN_JS, "init", "--name", "test-proj", "--owner", "team", "--dir", dir],
    {
      cwd: dir,
      encoding: "utf-8",
      env: { ...process.env, HOME: home },
      stdio: ["ignore", "pipe", "pipe"],
    }
  )
  if (result.status !== 0) {
    throw new Error(`Failed to create project: ${result.stderr}`)
  }
}

// ─── Resource Addition ──────────────────────────────────────────────────────

describe("dx add — resources", () => {
  let dir: string
  let home: string

  beforeEach(() => {
    dir = tmpDir()
    home = isolatedHome()
    createProject(dir, home)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  })

  it("adds redis resource", () => {
    const { status, stderr } = runDxInDir(["add", "redis"], dir, home)

    expect(status).toBe(0)
    expect(stderr).toBe("")

    // Compose file created
    expect(existsSync(path.join(dir, "compose/redis.yml"))).toBe(true)

    // Compose file has correct content
    const redis = readFile(dir, "compose/redis.yml")
    expect(redis).toContain("redis:7-alpine")
    expect(redis).toContain("catalog.type: cache")
    expect(redis).toContain("catalog.owner: team")

    // docker-compose.yaml updated
    const compose = readFile(dir, "docker-compose.yaml")
    expect(compose).toContain("compose/redis.yml")
  })

  it("adds kafka resource", () => {
    const { status } = runDxInDir(["add", "kafka"], dir, home)
    expect(status).toBe(0)

    expect(existsSync(path.join(dir, "compose/kafka.yml"))).toBe(true)

    const kafka = readFile(dir, "compose/kafka.yml")
    expect(kafka).toContain("apache/kafka")
    expect(kafka).toContain("catalog.type: queue")

    const compose = readFile(dir, "docker-compose.yaml")
    expect(compose).toContain("compose/kafka.yml")
  })

  it("rejects duplicate resource", () => {
    // postgres is already in the project from dx init
    const { status, stderr } = runDxInDir(["add", "postgres"], dir, home)
    expect(status).not.toBe(0)
    expect(stderr).toContain("already")
  })

  it("adds multiple resources sequentially", () => {
    runDxInDir(["add", "redis"], dir, home)
    runDxInDir(["add", "minio"], dir, home)

    const compose = readFile(dir, "docker-compose.yaml")
    expect(compose).toContain("compose/redis.yml")
    expect(compose).toContain("compose/minio.yml")

    expect(existsSync(path.join(dir, "compose/redis.yml"))).toBe(true)
    expect(existsSync(path.join(dir, "compose/minio.yml"))).toBe(true)
  })

  it("--json returns structured output for resource", () => {
    const { status, stdout } = runDxInDir(["add", "redis", "--json"], dir, home)
    expect(status).toBe(0)

    const body = JSON.parse(stdout) as {
      success: boolean
      category: string
      name: string
      files: string[]
    }
    expect(body.success).toBe(true)
    expect(body.category).toBe("resource")
    expect(body.name).toBe("redis")
    expect(body.files).toContain("compose/redis.yml")
  })
})

// ─── Component Addition ─────────────────────────────────────────────────────

describe("dx add — components", () => {
  let dir: string
  let home: string

  beforeEach(() => {
    dir = tmpDir()
    home = isolatedHome()
    createProject(dir, home)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  })

  it("adds a node service", () => {
    const { status, stderr } = runDxInDir(
      ["add", "payment-api", "--type", "service", "--runtime", "node"],
      dir,
      home
    )

    expect(status).toBe(0)
    expect(stderr).toBe("")

    // Service directory created
    expect(
      existsSync(path.join(dir, "services/payment-api/package.json"))
    ).toBe(true)
    expect(
      existsSync(path.join(dir, "services/payment-api/src/server.ts"))
    ).toBe(true)
    expect(existsSync(path.join(dir, "services/payment-api/Dockerfile"))).toBe(
      true
    )

    // Compose file created
    expect(existsSync(path.join(dir, "compose/payment-api.yml"))).toBe(true)
    const compose = readFile(dir, "compose/payment-api.yml")
    expect(compose).toContain('catalog.type: "service"')
    expect(compose).toContain("services/payment-api")

    // docker-compose.yaml updated
    const rootCompose = readFile(dir, "docker-compose.yaml")
    expect(rootCompose).toContain("compose/payment-api.yml")
  })

  it("adds a website", () => {
    const { status } = runDxInDir(
      ["add", "admin-panel", "--type", "website", "--runtime", "node"],
      dir,
      home
    )

    expect(status).toBe(0)

    // App directory created
    expect(existsSync(path.join(dir, "apps/admin-panel/package.json"))).toBe(
      true
    )
    expect(
      existsSync(path.join(dir, "apps/admin-panel/src/entry.client.tsx"))
    ).toBe(true)

    // Compose file
    expect(existsSync(path.join(dir, "compose/admin-panel.yml"))).toBe(true)

    // docker-compose.yaml updated
    const rootCompose = readFile(dir, "docker-compose.yaml")
    expect(rootCompose).toContain("compose/admin-panel.yml")
  })

  it("adds a java service", () => {
    const { status } = runDxInDir(
      ["add", "billing-svc", "--type", "service", "--runtime", "java"],
      dir,
      home
    )

    expect(status).toBe(0)
    expect(existsSync(path.join(dir, "services/billing-svc/pom.xml"))).toBe(
      true
    )
    expect(existsSync(path.join(dir, "compose/billing-svc.yml"))).toBe(true)
  })

  it("adds a python library (no compose file)", () => {
    const { status } = runDxInDir(
      ["add", "ml-utils", "--type", "library", "--runtime", "python"],
      dir,
      home
    )

    expect(status).toBe(0)
    expect(
      existsSync(path.join(dir, "packages/python/ml-utils/pyproject.toml"))
    ).toBe(true)
    // Libraries don't get compose files
    expect(existsSync(path.join(dir, "compose/ml-utils.yml"))).toBe(false)
  })

  it("service compose file wires DATABASE_URL when postgres exists", () => {
    const { status } = runDxInDir(
      ["add", "data-api", "--type", "service", "--runtime", "node"],
      dir,
      home
    )
    expect(status).toBe(0)

    const compose = readFile(dir, "compose/data-api.yml")
    expect(compose).toContain("DATABASE_URL")
    expect(compose).toContain("infra-postgres")
  })

  it("rejects duplicate component", () => {
    runDxInDir(
      ["add", "my-svc", "--type", "service", "--runtime", "node"],
      dir,
      home
    )

    const { status, stderr } = runDxInDir(
      ["add", "my-svc", "--type", "service", "--runtime", "node"],
      dir,
      home
    )
    expect(status).not.toBe(0)
    expect(stderr).toContain("already exists")
  })

  it("--json returns structured output for component", () => {
    const { status, stdout } = runDxInDir(
      ["add", "api-two", "--type", "service", "--runtime", "node", "--json"],
      dir,
      home
    )
    expect(status).toBe(0)

    const body = JSON.parse(stdout) as {
      success: boolean
      category: string
      name: string
      files: string[]
    }
    expect(body.success).toBe(true)
    expect(body.category).toBe("component")
    expect(body.name).toBe("api-two")
    expect(
      body.files.some((f: string) => f.includes("services/api-two/"))
    ).toBe(true)
    expect(body.files).toContain("compose/api-two.yml")
  })
})

// ─── Error Handling ─────────────────────────────────────────────────────────

describe("dx add — error handling", () => {
  it("fails outside a dx project", () => {
    const dir = tmpDir()
    const home = isolatedHome()

    const { status, stderr } = runDxInDir(["add", "redis"], dir, home)
    expect(status).not.toBe(0)
    expect(stderr).toContain("Not inside a dx project")

    rmSync(dir, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  })

  it("--help shows command usage", () => {
    const home = isolatedHome()
    const { status, stdout } = runDxInDir(["add", "--help"], tmpDir(), home)
    expect(status).toBe(0)
    expect(stdout).toContain("Add a resource")
    expect(stdout).toContain("--type")
    expect(stdout).toContain("--runtime")

    rmSync(home, { recursive: true, force: true })
  })
})
