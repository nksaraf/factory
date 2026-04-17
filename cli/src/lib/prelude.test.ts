import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { DxContextWithProject } from "./dx-context.js"
import { composeHealthy, runPrelude, type Runners } from "./prelude.js"

let rootDir: string

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), "prelude-test-"))
})

afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true })
})

/** Minimal context stub — only the fields runPrelude reads. */
function makeCtx(
  overrides: { composeFiles?: string[] } = {}
): DxContextWithProject {
  return {
    project: {
      rootDir,
      composeFiles: overrides.composeFiles ?? [],
      catalog: undefined,
    },
  } as unknown as DxContextWithProject
}

/** Capture calls so tests can assert runner invocations. */
interface Calls {
  mise: number
  jsInstall: Array<{ lockfile: string }>
  pyInstall: Array<{ lockfile: string }>
  mvnResolve: number
}

function makeRunners(result: boolean): { runners: Runners; calls: Calls } {
  const calls: Calls = { mise: 0, jsInstall: [], pyInstall: [], mvnResolve: 0 }
  const runners: Runners = {
    mise: () => {
      calls.mise++
      return result
    },
    jsInstall: (_dir, lockfile) => {
      calls.jsInstall.push({ lockfile })
      return result
    },
    pyInstall: (_dir, lockfile) => {
      calls.pyInstall.push({ lockfile })
      return result
    },
    mvnResolve: () => {
      calls.mvnResolve++
      return result
    },
  }
  return { runners, calls }
}

const SAFE_OPTS = {
  skipTools: true,
  skipHooks: true,
  skipEnv: true,
  skipLinks: true,
  skipInfra: true,
  quiet: true,
} as const

describe("runPrelude — pass-through cases", () => {
  test("noPrelude: true → returns empty result, runs nothing", async () => {
    writeFileSync(join(rootDir, ".tool-versions"), "node 20")
    writeFileSync(join(rootDir, "pnpm-lock.yaml"), "lockfile: 9.0")

    const { runners, calls } = makeRunners(true)
    const r = await runPrelude(makeCtx(), {
      noPrelude: true,
      quiet: true,
      runners,
    })

    expect(r.ran).toEqual([])
    expect(r.skipped).toEqual([])
    expect(r.warnings).toEqual([])
    expect(calls.mise).toBe(0)
    expect(calls.jsInstall).toEqual([])
    expect(existsSync(join(rootDir, ".dx", ".state"))).toBe(false)
  })

  test("all skips set → empty result, runners untouched", async () => {
    writeFileSync(join(rootDir, ".tool-versions"), "node 20")
    writeFileSync(join(rootDir, "pnpm-lock.yaml"), "lockfile: 9.0")
    writeFileSync(join(rootDir, ".env.example"), "X=1")

    const { runners, calls } = makeRunners(true)
    const r = await runPrelude(makeCtx(), {
      ...SAFE_OPTS,
      skipDeps: true,
      runners,
    })

    expect(r.ran).toEqual([])
    expect(calls.mise).toBe(0)
    expect(calls.jsInstall).toEqual([])
  })
})

describe("runPrelude — install dispatch", () => {
  test("only js runner called when only pnpm-lock exists", async () => {
    writeFileSync(join(rootDir, "pnpm-lock.yaml"), "lockfile: 9.0\n")

    const { runners, calls } = makeRunners(true)
    await runPrelude(makeCtx(), { ...SAFE_OPTS, runners })

    expect(calls.jsInstall).toEqual([{ lockfile: "pnpm-lock.yaml" }])
    expect(calls.pyInstall).toEqual([])
    expect(calls.mvnResolve).toBe(0)
  })

  test("py + mvn runners dispatched alongside js when all three exist", async () => {
    writeFileSync(join(rootDir, "pnpm-lock.yaml"), "lockfile: 9.0\n")
    writeFileSync(join(rootDir, "uv.lock"), "version = 1\n")
    writeFileSync(join(rootDir, "pom.xml"), "<project/>\n")

    const { runners, calls } = makeRunners(true)
    await runPrelude(makeCtx(), { ...SAFE_OPTS, runners })

    expect(calls.jsInstall).toHaveLength(1)
    expect(calls.pyInstall).toEqual([{ lockfile: "uv.lock" }])
    expect(calls.mvnResolve).toBe(1)
  })
})

describe("runPrelude — stamp invariant", () => {
  test("successful runner writes deps stamp (next run skips)", async () => {
    writeFileSync(join(rootDir, "pnpm-lock.yaml"), "lockfile: 9.0\n")
    mkdirSync(join(rootDir, "node_modules"))

    const { runners: r1 } = makeRunners(true)
    await runPrelude(makeCtx(), { ...SAFE_OPTS, runners: r1 })

    const { runners: r2, calls: c2 } = makeRunners(true)
    const result = await runPrelude(makeCtx(), { ...SAFE_OPTS, runners: r2 })

    expect(result.skipped).toContain("deps")
    expect(c2.jsInstall).toEqual([])
  })

  test("failed runner → no stamp written → next run retries", async () => {
    writeFileSync(join(rootDir, "pnpm-lock.yaml"), "lockfile: 9.0\n")

    const { runners: r1, calls: c1 } = makeRunners(false)
    const result1 = await runPrelude(makeCtx(), { ...SAFE_OPTS, runners: r1 })

    expect(c1.jsInstall).toHaveLength(1)
    expect(result1.ran).not.toContain("deps")
    expect(result1.warnings.some((w) => w.step === "deps")).toBe(true)

    const { runners: r2, calls: c2 } = makeRunners(false)
    await runPrelude(makeCtx(), { ...SAFE_OPTS, runners: r2 })
    expect(c2.jsInstall).toHaveLength(1)
  })

  test("node_modules deleted invalidates deps stamp", async () => {
    writeFileSync(join(rootDir, "pnpm-lock.yaml"), "lockfile: 9.0\n")
    mkdirSync(join(rootDir, "node_modules"))

    const { runners: r1 } = makeRunners(true)
    await runPrelude(makeCtx(), { ...SAFE_OPTS, runners: r1 })

    const { runners: r2, calls: c2 } = makeRunners(true)
    const skipped = await runPrelude(makeCtx(), {
      ...SAFE_OPTS,
      runners: r2,
    })
    expect(skipped.skipped).toContain("deps")
    expect(c2.jsInstall).toEqual([])

    rmSync(join(rootDir, "node_modules"), { recursive: true })
    const { runners: r3, calls: c3 } = makeRunners(true)
    const rerun = await runPrelude(makeCtx(), { ...SAFE_OPTS, runners: r3 })
    expect(rerun.ran).toContain("deps")
    expect(c3.jsInstall).toHaveLength(1)
  })

  test("fresh: true forces runner even with valid stamp", async () => {
    writeFileSync(join(rootDir, "pnpm-lock.yaml"), "lockfile: 9.0\n")
    mkdirSync(join(rootDir, "node_modules"))

    const { runners: r1 } = makeRunners(true)
    await runPrelude(makeCtx(), { ...SAFE_OPTS, runners: r1 })

    const { runners: r2, calls: c2 } = makeRunners(true)
    const r = await runPrelude(makeCtx(), {
      ...SAFE_OPTS,
      fresh: true,
      runners: r2,
    })

    expect(r.skipped).not.toContain("deps")
    expect(c2.jsInstall).toHaveLength(1)
  })

  test("lockfile change invalidates deps stamp", async () => {
    writeFileSync(join(rootDir, "pnpm-lock.yaml"), "lockfile: 9.0\nv1\n")
    mkdirSync(join(rootDir, "node_modules"))

    const { runners: r1 } = makeRunners(true)
    await runPrelude(makeCtx(), { ...SAFE_OPTS, runners: r1 })

    writeFileSync(join(rootDir, "pnpm-lock.yaml"), "lockfile: 9.0\nv2\n")
    const { runners: r2, calls: c2 } = makeRunners(true)
    const r = await runPrelude(makeCtx(), { ...SAFE_OPTS, runners: r2 })
    expect(r.ran).toContain("deps")
    expect(c2.jsInstall).toHaveLength(1)
  })
})

describe("runPrelude — timings & warnings", () => {
  test("emits per-step timings", async () => {
    writeFileSync(join(rootDir, "pnpm-lock.yaml"), "lockfile: 9.0\n")
    const { runners } = makeRunners(true)
    const r = await runPrelude(makeCtx(), { ...SAFE_OPTS, runners })
    expect(typeof r.timings.deps).toBe("number")
    expect(r.timings.deps).toBeGreaterThanOrEqual(0)
  })

  test("warnings include actionable hint", async () => {
    writeFileSync(join(rootDir, "pnpm-lock.yaml"), "lockfile: 9.0\n")
    const { runners } = makeRunners(false)
    const r = await runPrelude(makeCtx(), { ...SAFE_OPTS, runners })
    const warning = r.warnings.find((w) => w.step === "deps")
    expect(warning).toBeTruthy()
    expect(warning?.hint).toContain("pnpm install")
  })
})

describe("composeHealthy — docker compose ps gating", () => {
  test("empty list → not healthy (nothing to skip past)", () => {
    expect(composeHealthy([])).toBe(false)
  })

  test("all running with no healthchecks → healthy", () => {
    expect(
      composeHealthy([
        { name: "a", status: "running", health: "", ports: "" },
        { name: "b", status: "running", health: "", ports: "" },
      ])
    ).toBe(true)
  })

  test("all running with Health=healthy → healthy", () => {
    expect(
      composeHealthy([
        { name: "a", status: "running", health: "healthy", ports: "" },
      ])
    ).toBe(true)
  })

  test("mix of Health=healthy and no healthcheck → healthy", () => {
    expect(
      composeHealthy([
        { name: "a", status: "running", health: "healthy", ports: "" },
        { name: "b", status: "running", health: "", ports: "" },
      ])
    ).toBe(true)
  })

  test("running but Health=unhealthy → NOT healthy (the core fix)", () => {
    expect(
      composeHealthy([
        { name: "a", status: "running", health: "healthy", ports: "" },
        { name: "spicedb", status: "running", health: "unhealthy", ports: "" },
      ])
    ).toBe(false)
  })

  test("Health=starting is treated as NOT healthy", () => {
    expect(
      composeHealthy([
        { name: "a", status: "running", health: "starting", ports: "" },
      ])
    ).toBe(false)
  })

  test("exited service → NOT healthy regardless of Health field", () => {
    expect(
      composeHealthy([{ name: "a", status: "exited", health: "", ports: "" }])
    ).toBe(false)
  })
})

describe("runPrelude — resilience", () => {
  test("does not throw when project is missing", async () => {
    const ctx = { project: undefined } as unknown as DxContextWithProject
    const r = await runPrelude(ctx, { quiet: true })
    expect(r).toEqual({ ran: [], skipped: [], warnings: [], timings: {} })
  })
})

describe("runPrelude — concurrency lock", () => {
  test("lock held by live local pid → second call returns empty", async () => {
    writeFileSync(join(rootDir, "pnpm-lock.yaml"), "lockfile: 9.0\n")
    mkdirSync(join(rootDir, ".dx", ".state"), { recursive: true })
    // Simulate a live holder by writing *our own* pid (guaranteed alive).
    writeFileSync(
      join(rootDir, ".dx", ".state", "prelude.lock"),
      `${process.pid}:${Date.now()}`
    )

    const { runners, calls } = makeRunners(true)
    const r = await runPrelude(makeCtx(), { ...SAFE_OPTS, runners })

    expect(r.ran).toEqual([])
    expect(r.skipped).toEqual([])
    expect(calls.jsInstall).toEqual([])
  })

  test("stale lock (dead pid) is stolen, prelude proceeds", async () => {
    writeFileSync(join(rootDir, "pnpm-lock.yaml"), "lockfile: 9.0\n")
    mkdirSync(join(rootDir, ".dx", ".state"), { recursive: true })
    // Use pid 1 only if a unit test is NOT running as pid 1 (which would be
    // rare). Instead, use a clearly-dead pid — pid 0 is never valid.
    // We rely on the staleness window: set timestamp far in the past.
    writeFileSync(
      join(rootDir, ".dx", ".state", "prelude.lock"),
      `999999999:0` // timestamp 0 → ancient → stolen regardless of pid
    )

    const { runners, calls } = makeRunners(true)
    const r = await runPrelude(makeCtx(), { ...SAFE_OPTS, runners })

    expect(calls.jsInstall).toHaveLength(1)
    expect(r.ran).toContain("deps")
  })
})
