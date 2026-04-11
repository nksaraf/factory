import { ExitCodes } from "@smp/factory-shared/exit-codes"
import { describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { runDx } from "./run-dx.js"

function isolatedHome(): string {
  return mkdtempSync(path.join(os.tmpdir(), "dx-cli-test-"))
}

function writeDxConfig(home: string, yaml: string): void {
  const dir = path.join(home, ".config", "dx")
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, "config.yaml"), yaml, "utf8")
}

describe("dx CLI (subprocess)", () => {
  it("prints help", () => {
    const home = isolatedHome()
    const { status, stdout, stderr } = runDx(["--help"], { home })
    expect(status).toBe(0)
    expect(stderr).toBe("")
    expect(stdout).toContain("Software Factory CLI")
    expect(stdout).toContain("dx")
  })

  it("stub command prints NYI message", () => {
    const home = isolatedHome()
    const { status, stdout, stderr } = runDx(["context", "list"], { home })
    expect(status).toBe(0)
    expect(stderr).toBe("")
    expect(stdout).toContain("Not yet implemented")
  })

  it("stub command --json prints NYI payload and exits 1", () => {
    const home = isolatedHome()
    const { status, stdout, stderr } = runDx(["context", "list", "--json"], {
      home,
    })
    expect(status).toBe(ExitCodes.GENERAL_FAILURE)
    expect(stderr).toBe("")
    const body = JSON.parse(stdout) as {
      success: boolean
      error?: { code?: string }
    }
    expect(body.success).toBe(false)
    expect(body.error?.code).toBe("NYI")
  })

  it("factory logout with no session", () => {
    const home = isolatedHome()
    const { status, stdout, stderr } = runDx(["factory", "logout"], { home })
    expect(status).toBe(0)
    expect(stderr).toBe("")
    expect(stdout).toContain("No local session was stored.")
  })

  it("factory logout --json with no session", () => {
    const home = isolatedHome()
    const { status, stdout, stderr } = runDx(["factory", "logout", "--json"], {
      home,
    })
    expect(status).toBe(0)
    expect(stderr).toBe("")
    const body = JSON.parse(stdout) as { success: boolean }
    expect(body.success).toBe(true)
  })

  it("whoami with no session writes to stderr and exits 3", () => {
    const home = isolatedHome()
    const { status, stdout, stderr } = runDx(["whoami"], { home })
    expect(status).toBe(ExitCodes.AUTH_FAILURE)
    expect(stdout).toBe("")
    expect(stderr).toContain("Not signed in")
  })

  it("whoami --json with no session", () => {
    const home = isolatedHome()
    const { status, stdout, stderr } = runDx(["whoami", "--json"], { home })
    expect(status).toBe(ExitCodes.AUTH_FAILURE)
    expect(stderr).toBe("")
    const body = JSON.parse(stdout) as {
      success: boolean
      error?: { code?: string }
    }
    expect(body.success).toBe(false)
    expect(body.error?.code).toBe("AUTH_DENIED")
  })

  it("status succeeds without API (local-only)", () => {
    const home = isolatedHome()
    writeDxConfig(home, "apiUrl: http://127.0.0.1:59999\n")
    const { status } = runDx(["status"], { home })
    expect(status).toBe(0)
  })

  it("status --json succeeds without API (local-only)", () => {
    const home = isolatedHome()
    writeDxConfig(home, "apiUrl: http://127.0.0.1:59999\n")
    const { status, stdout } = runDx(["status", "--json"], { home })
    expect(status).toBe(0)
    const body = JSON.parse(stdout) as { success: boolean }
    expect(body.success).toBe(true)
  })
})
