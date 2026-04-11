import { describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { runDx } from "./run-dx.js"

/**
 * When FACTORY_API_TEST_URL is set (e.g. http://127.0.0.1:4100), asserts `dx status`
 * against a real factory-api `/health`. Skipped by default so `pnpm test` needs no API.
 */
const FACTORY_API_TEST_URL = process.env.FACTORY_API_TEST_URL?.replace(
  /\/$/,
  ""
)

function isolatedHome(): string {
  return mkdtempSync(path.join(os.tmpdir(), "dx-cli-status-env-"))
}

function writeDxConfig(home: string, yaml: string): void {
  const dir = path.join(home, ".config", "dx")
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, "config.yaml"), yaml, "utf8")
}

describe.skipIf(!FACTORY_API_TEST_URL)(
  "dx CLI status (FACTORY_API_TEST_URL)",
  () => {
    it("prints healthy line when API /health is ok", () => {
      const home = isolatedHome()
      writeDxConfig(home, `apiUrl: ${FACTORY_API_TEST_URL}\n`)

      const { status, stdout, stderr } = runDx(["status"], { home })
      expect(status).toBe(0)
      expect(stderr).toBe("")
      expect(stdout).toContain("Factory API: ok")
      expect(stdout).toContain("factory-api")
    })

    it("status --json returns success payload", () => {
      const home = isolatedHome()
      writeDxConfig(home, `apiUrl: ${FACTORY_API_TEST_URL}\n`)

      const { status, stdout, stderr } = runDx(["status", "--json"], { home })
      expect(status).toBe(0)
      expect(stderr).toBe("")
      const body = JSON.parse(stdout) as {
        success: boolean
        data?: { status?: string; service?: string }
      }
      expect(body.success).toBe(true)
      expect(body.data?.status).toBe("ok")
      expect(body.data?.service).toBe("factory-api")
    })
  }
)
