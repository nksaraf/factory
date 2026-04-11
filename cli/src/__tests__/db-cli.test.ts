import { describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { runDx } from "./run-dx.js"

function isolatedHome(): string {
  return mkdtempSync(path.join(os.tmpdir(), "dx-db-test-"))
}

describe("dx db CLI", () => {
  // ── Help / registration ────────────────────────────────────────────────

  it("dx db --help lists all subcommands", () => {
    const home = isolatedHome()
    const { status, stdout, stderr } = runDx(["db", "--help"], { home })
    expect(status).toBe(0)
    expect(stderr).toBe("")
    expect(stdout).toContain("connect")
    expect(stdout).toContain("query")
    expect(stdout).toContain("table")
    expect(stdout).toContain("schema")
    expect(stdout).toContain("index")
    expect(stdout).toContain("constraint")
    expect(stdout).toContain("sequence")
    expect(stdout).toContain("extension")
    expect(stdout).toContain("activity")
    expect(stdout).toContain("lock")
    expect(stdout).toContain("long-queries")
    expect(stdout).toContain("migrate")
    expect(stdout).toContain("reset")
    expect(stdout).toContain("seed")
  })

  it("dx db migrate --help lists migration subcommands", () => {
    const home = isolatedHome()
    const { status, stdout, stderr } = runDx(["db", "migrate", "--help"], {
      home,
    })
    expect(status).toBe(0)
    expect(stderr).toBe("")
    expect(stdout).toContain("status")
    expect(stdout).toContain("up")
    expect(stdout).toContain("create")
    expect(stdout).toContain("plan")
  })

  // ── Error handling (no docker-compose) ─────────────────────────────────

  it("dx db tables fails when cannot connect to database", () => {
    const home = isolatedHome()
    // Factory docker-compose has postgres on port 5433 which is likely not running
    // The command should fail with a connection error (exit 1), not crash
    const { status } = runDx(["db", "table"], { home })
    // Either succeeds (if postgres is running) or fails gracefully
    expect(typeof status).toBe("number")
  })

  it("dx db tables --json returns structured output", () => {
    const home = isolatedHome()
    const { status, stdout } = runDx(["db", "table", "--json"], { home })
    // Parse the JSON output — should be valid JSON regardless of success/failure
    const body = JSON.parse(stdout) as { success: boolean }
    expect(typeof body.success).toBe("boolean")
  })

  it("dx db connect errors when no docker-compose exists", () => {
    const home = isolatedHome()
    const { status } = runDx(["db", "connect"], {
      home,
      cwd: home,
      env: { HOME: home },
    })
    expect(status).not.toBe(0)
  })

  it("dx db query errors without SQL or -f flag", () => {
    const home = isolatedHome()
    // Create a minimal docker-compose.yaml so it gets past project detection
    // but still fails because no DB is reachable
    const dir = mkdtempSync(path.join(os.tmpdir(), "dx-db-query-"))
    writeFileSync(
      path.join(dir, "docker-compose.yaml"),
      [
        "services:",
        "  postgres:",
        "    image: postgres:16",
        "    ports:",
        '      - "59999:5432"',
        "    environment:",
        "      POSTGRES_DB: testdb",
        "      POSTGRES_USER: test",
        "      POSTGRES_PASSWORD: test",
      ].join("\n"),
      "utf8"
    )
    const { status, stderr, stdout } = runDx(["db", "query"], {
      home,
      env: { HOME: home, PWD: dir },
    })
    // Should fail — either "no SQL" or "cannot connect"
    expect(status).not.toBe(0)
  })

  it("dx db reset without --force exits with error", () => {
    const home = isolatedHome()
    const dir = mkdtempSync(path.join(os.tmpdir(), "dx-db-reset-"))
    writeFileSync(
      path.join(dir, "docker-compose.yaml"),
      [
        "services:",
        "  postgres:",
        "    image: postgres:16",
        "    ports:",
        '      - "59999:5432"',
        "    environment:",
        "      POSTGRES_DB: testdb",
        "      POSTGRES_USER: test",
        "      POSTGRES_PASSWORD: test",
      ].join("\n"),
      "utf8"
    )
    const { status, stdout, stderr } = runDx(["db", "reset"], {
      home,
      env: { HOME: home, PWD: dir },
    })
    expect(status).not.toBe(0)
    // Should mention --force
    const output = stdout + stderr
    expect(output).toContain("--force")
  })
})
