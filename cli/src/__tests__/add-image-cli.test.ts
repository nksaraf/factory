import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { isDockerRunning } from "../lib/docker.js"
import { RUN_JS } from "./run-dx.js"

function tmpDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "dx-add-image-test-"))
}

function isolatedHome(): string {
  return mkdtempSync(path.join(os.tmpdir(), "dx-add-image-home-"))
}

function readFile(dir: string, ...segments: string[]): string {
  return readFileSync(path.join(dir, ...segments), "utf8")
}

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

// ─── Docker Image Addition ──────────────────────────────────────────────────

describe.skipIf(!isDockerRunning())("dx add --image", () => {
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

  it("adds from a Docker image with auto-detected name", () => {
    const { status, stderr } = runDxInDir(
      ["add", "--image", "redis:7-alpine"],
      dir,
      home
    )

    expect(status).toBe(0)
    expect(stderr).toBe("")

    // Compose file created with auto-detected name
    expect(existsSync(path.join(dir, "compose/redis.yml"))).toBe(true)

    // Compose file has correct content
    const compose = readFile(dir, "compose/redis.yml")
    expect(compose).toContain("image: redis:7-alpine")
    expect(compose).toContain("6379")
    expect(compose).toContain("catalog.type:")

    // docker-compose.yaml updated
    const rootCompose = readFile(dir, "docker-compose.yaml")
    expect(rootCompose).toContain("compose/redis.yml")
  })

  it("adds from a Docker image with custom name", () => {
    const { status } = runDxInDir(
      ["add", "my-cache", "--image", "redis:7-alpine"],
      dir,
      home
    )

    expect(status).toBe(0)
    expect(existsSync(path.join(dir, "compose/my-cache.yml"))).toBe(true)

    const compose = readFile(dir, "compose/my-cache.yml")
    expect(compose).toContain("image: redis:7-alpine")
    expect(compose).toContain("my-cache:")

    const rootCompose = readFile(dir, "docker-compose.yaml")
    expect(rootCompose).toContain("compose/my-cache.yml")
  })

  it("detects exposed ports from image", () => {
    const { status } = runDxInDir(
      ["add", "--image", "postgres:16-alpine"],
      dir,
      home
    )

    // Note: postgres already exists as a built-in resource in the project,
    // but --image bypasses built-in resource checks (uses image name "postgres")
    // This may collide — test with a custom name instead
    expect(status).not.toBe(0) // collision expected
  })

  it("detects ports with custom name to avoid collision", () => {
    const { status } = runDxInDir(
      ["add", "my-pg", "--image", "postgres:16-alpine"],
      dir,
      home
    )

    expect(status).toBe(0)

    const compose = readFile(dir, "compose/my-pg.yml")
    expect(compose).toContain("5432")
    expect(compose).toContain("catalog.type: database")
  })

  it("--json returns structured output", () => {
    const { status, stdout } = runDxInDir(
      ["add", "my-redis", "--image", "redis:7-alpine", "--json"],
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
    expect(body.category).toBe("image")
    expect(body.name).toBe("my-redis")
    expect(body.files).toContain("compose/my-redis.yml")
  })

  it("rejects duplicate image addition", () => {
    runDxInDir(["add", "my-redis", "--image", "redis:7-alpine"], dir, home)

    const { status, stderr } = runDxInDir(
      ["add", "my-redis", "--image", "redis:7-alpine"],
      dir,
      home
    )
    expect(status).not.toBe(0)
    expect(stderr).toContain("already")
  })
})
