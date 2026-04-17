/**
 * Cached prelude for `dx dev`.
 *
 * Runs idempotent bootstrap steps (tools, deps, hooks, env, links, compose)
 * and skips each one whose inputs haven't changed since last success. Turbo
 * handles task-level caching; this module handles environment-level caching.
 *
 * Errors in individual steps become warnings (not throws) so dev startup
 * proceeds — the dev server surfaces real errors in context. Warnings carry
 * an actionable hint so the developer knows which manual command to run to
 * see the underlying failure.
 */
import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { basename, dirname, join } from "node:path"

import type { DxContextWithProject } from "./dx-context.js"
import {
  Compose,
  isDockerRunning,
  type ComposeServiceStatus,
} from "./docker.js"
import { hooksHealthy, installHooks } from "./hooks.js"
import { isStale, markFresh } from "./state-cache.js"
import { ensureToolchainDefaults } from "./toolchain-defaults.js"

export interface PreludeOptions {
  /** Skip everything — go straight to dev. */
  noPrelude?: boolean
  /** Force re-run regardless of stamps. */
  fresh?: boolean
  /** Fine-grained skips. */
  skipTools?: boolean
  skipToolchain?: boolean
  skipDeps?: boolean
  skipHooks?: boolean
  skipEnv?: boolean
  skipLinks?: boolean
  skipInfra?: boolean
  /** Pipe child stdio instead of inheriting (used by tests). */
  quiet?: boolean
  /** Injectable command runners — tests substitute fakes. */
  runners?: Runners
}

export interface PreludeWarning {
  step: string
  message: string
  /** One-line command the dev can run to reproduce / diagnose. */
  hint?: string
}

export interface PreludeResult {
  ran: string[]
  skipped: string[]
  warnings: PreludeWarning[]
  /** Milliseconds per step — suitable for telemetry / summary print. */
  timings: Record<string, number>
}

/**
 * Injectable runners — real implementations shell out; tests replace with fakes.
 * Each returns `true` on success, `false` on failure. Never throws.
 */
export interface Runners {
  mise(rootDir: string, quiet: boolean): boolean
  /**
   * Install JS deps. `allowLockfileChange: true` skips `--frozen-lockfile`,
   * which is needed when package.json was just modified (e.g. the toolchain
   * step added a devDep). Default (false) uses frozen-lockfile for safety.
   */
  jsInstall(
    rootDir: string,
    lockfile: string,
    quiet: boolean,
    allowLockfileChange?: boolean
  ): boolean
  pyInstall(rootDir: string, lockfile: string, quiet: boolean): boolean
  mvnResolve(rootDir: string, quiet: boolean): boolean
}

const defaultRunners: Runners = {
  mise: (rootDir, quiet) =>
    spawnSync("mise", ["install"], {
      cwd: rootDir,
      stdio: quiet ? "ignore" : "inherit",
    }).status === 0,
  jsInstall: (rootDir, lockfile, quiet, allowLockfileChange) => {
    // frozen install: lockfile is authoritative, fail on drift.
    // loose install: update the lockfile as needed.
    const frozen: Record<string, [string, string[]]> = {
      "pnpm-lock.yaml": ["pnpm", ["install", "--frozen-lockfile"]],
      "bun.lock": ["bun", ["install", "--frozen-lockfile"]],
      "yarn.lock": ["yarn", ["install", "--frozen-lockfile"]],
      "package-lock.json": ["npm", ["ci"]],
    }
    const loose: Record<string, [string, string[]]> = {
      "pnpm-lock.yaml": ["pnpm", ["install"]],
      "bun.lock": ["bun", ["install"]],
      "yarn.lock": ["yarn", ["install"]],
      "package-lock.json": ["npm", ["install"]],
    }
    const run = (cmd: [string, string[]]): boolean =>
      spawnSync(cmd[0], cmd[1], {
        cwd: rootDir,
        stdio: quiet ? "ignore" : "inherit",
      }).status === 0

    if (allowLockfileChange) {
      const entry = loose[lockfile]
      return entry ? run(entry) : true
    }
    // Try frozen first; if it fails because the lockfile is out of sync with
    // package.json (common after a failed prior install or an external edit),
    // fall back to a loose install automatically. Silent drift is worse than
    // a one-time loose install.
    const frozenEntry = frozen[lockfile]
    if (!frozenEntry) return true
    if (run(frozenEntry)) return true
    const looseEntry = loose[lockfile]
    if (!quiet) {
      console.log(
        "  ! frozen install failed (lockfile / package.json out of sync); retrying with loose install"
      )
    }
    return looseEntry ? run(looseEntry) : false
  },
  pyInstall: (rootDir, lockfile, quiet) => {
    if (lockfile !== "uv.lock") return true // other python tools not yet supported
    return (
      spawnSync("uv", ["sync"], {
        cwd: rootDir,
        stdio: quiet ? "ignore" : "inherit",
      }).status === 0
    )
  },
  mvnResolve: (rootDir, quiet) => {
    const tryRun = (bin: string) =>
      spawnSync(bin, ["dependency:go-offline", "-q"], {
        cwd: rootDir,
        stdio: quiet ? "ignore" : "inherit",
      }).status === 0
    if (existsSync(join(rootDir, "mvnw"))) return tryRun("./mvnw")
    return tryRun("mvn")
  },
}

function logStep(label: string, detail: string, stream: "ran" | "skip"): void {
  const prefix = stream === "ran" ? "✓" : "·"
  console.log(`  ${prefix} ${label.padEnd(14)} ${detail}`)
}

const JS_LOCKS = [
  "pnpm-lock.yaml",
  "bun.lock",
  "yarn.lock",
  "package-lock.json",
]
const PY_LOCKS = ["uv.lock", "poetry.lock", "requirements.txt"]

/**
 * Walk up to 4 levels deep for pom.xml files. Cross-platform (pure node),
 * replaces the earlier `find` shell-out so behaviour is identical on
 * macOS / Linux / Windows / CI runners.
 */
function findPoms(rootDir: string): string[] {
  const results: string[] = []
  const skipDirs = new Set([
    "node_modules",
    "target",
    ".git",
    ".dx",
    "dist",
    "build",
  ])

  function walk(dir: string, depth: number): void {
    if (depth > 4) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue
        walk(join(dir, entry.name), depth + 1)
      } else if (entry.name === "pom.xml") {
        const full = join(dir, entry.name)
        results.push(full.slice(rootDir.length + 1))
      }
    }
  }

  walk(rootDir, 0)
  return results
}

function findLockfiles(rootDir: string): {
  js: string | null
  py: string | null
  poms: string[]
} {
  const js = JS_LOCKS.find((f) => existsSync(join(rootDir, f))) ?? null
  const py = PY_LOCKS.find((f) => existsSync(join(rootDir, f))) ?? null
  const poms = findPoms(rootDir)
  return { js, py, poms }
}

/**
 * Check that lockfile-implied output directories actually exist. Closes the
 * `rm -rf node_modules` foot-gun: lockfile hash matches the stamp, but the
 * install output is gone, so we force a re-install.
 *
 * mvn/uv outputs are either per-module or in a user-global cache; we don't
 * probe those. The common foot-gun is `node_modules`, which this covers.
 */
function depsOutputMissing(rootDir: string, js: string | null): boolean {
  return !!js && !existsSync(join(rootDir, "node_modules"))
}

// ---------------------------------------------------------------------------
// Advisory lock — non-blocking
// ---------------------------------------------------------------------------

const LOCK_FILE = ".dx/.state/prelude.lock"
const LOCK_STALE_MS = 5 * 60 * 1000

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Try to acquire the prelude lock. Returns null if another prelude is running. */
function acquireLock(rootDir: string): { release: () => void } | null {
  const path = join(rootDir, LOCK_FILE)
  if (existsSync(path)) {
    try {
      const raw = readFileSync(path, "utf8").trim()
      const [pidStr, timestampStr] = raw.split(":")
      const pid = Number(pidStr)
      const timestamp = Number(timestampStr)
      const age = Date.now() - timestamp
      if (Number.isFinite(pid) && pidAlive(pid) && age < LOCK_STALE_MS) {
        return null
      }
      unlinkSync(path)
    } catch {
      try {
        unlinkSync(path)
      } catch {}
    }
  }
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${process.pid}:${Date.now()}`, { flag: "wx" })
  } catch {
    // Race: another prelude wrote the lock between our check and write.
    return null
  }
  return {
    release() {
      try {
        const raw = readFileSync(path, "utf8").trim()
        if (raw.startsWith(`${process.pid}:`)) unlinkSync(path)
      } catch {
        // best-effort
      }
    },
  }
}

/**
 * A service is "healthy for dev" when it's both running AND (either has no
 * healthcheck, or its healthcheck is reporting "healthy"). We deliberately
 * reject `unhealthy` and `starting` so that the infra step re-runs for
 * services whose healthchecks are failing — skipping a crashing service
 * would silently break the dev server later with a cryptic error.
 *
 * Single source of truth for "is this service OK to skip past" — both
 * `composeHealthy` and `unhealthySummary` use it so the two can't drift.
 */
export function isServiceHealthy(s: ComposeServiceStatus): boolean {
  const stateOk = s.status === "running" || s.status === "healthy"
  // "" = no healthcheck; "none" = HEALTHCHECK NONE in Dockerfile.
  const healthOk = !s.health || s.health === "healthy" || s.health === "none"
  return stateOk && healthOk
}

export function composeHealthy(statuses: ComposeServiceStatus[]): boolean {
  return statuses.length > 0 && statuses.every(isServiceHealthy)
}

/** Summarize any non-healthy services for the log/warning. */
function unhealthySummary(statuses: ComposeServiceStatus[]): string {
  return statuses
    .filter((s) => !isServiceHealthy(s))
    .map((s) => {
      const suffix =
        s.health && s.health !== "healthy" && s.health !== "none"
          ? ` (${s.health})`
          : s.status !== "running"
            ? ` (${s.status})`
            : ""
      return `${s.name}${suffix}`
    })
    .join(", ")
}

/**
 * Run the cached prelude for `dx dev`.
 *
 * Returns a summary of what ran vs. what was skipped plus per-step timings.
 * Does not throw — errors become warnings so dev startup proceeds (the dev
 * server will surface real errors with more context).
 */
export async function runPrelude(
  ctx: DxContextWithProject,
  opts: PreludeOptions = {}
): Promise<PreludeResult> {
  const result: PreludeResult = {
    ran: [],
    skipped: [],
    warnings: [],
    timings: {},
  }
  if (opts.noPrelude) return result

  const project = ctx.project
  if (!project) return result
  const rootDir = project.rootDir
  const quiet = Boolean(opts.quiet)
  const force = Boolean(opts.fresh)
  const runners = opts.runners ?? defaultRunners

  const lock = acquireLock(rootDir)
  if (!lock) {
    console.log(
      "  · prelude       skipped (another dx dev is running this prelude)"
    )
    return result
  }

  const timed = async <T>(
    label: string,
    fn: () => Promise<T> | T
  ): Promise<T> => {
    const start = performance.now()
    try {
      return await fn()
    } finally {
      result.timings[label] = Math.round(performance.now() - start)
    }
  }

  try {
    // 1. Tool versions (.tool-versions → mise install)
    if (!opts.skipTools && existsSync(join(rootDir, ".tool-versions"))) {
      await timed("tools", () => {
        const check = isStale(rootDir, "tools", [".tool-versions"])
        if (force || check.stale) {
          if (runners.mise(rootDir, quiet)) {
            markFresh(rootDir, "tools", check.hash)
            result.ran.push("tools")
            logStep("tools", "mise install", "ran")
          } else {
            result.warnings.push({
              step: "tools",
              message: "mise install failed",
              hint: "run `mise install` to see why",
            })
          }
        } else {
          result.skipped.push("tools")
          logStep("tools", "up to date", "skip")
        }
      })
    }

    // 1b. Toolchain defaults — ensure baseline devDeps (tsgo, oxlint, oxfmt,
    //     turbo when applicable) are declared so `dx check` etc. work. Runs
    //     BEFORE deps so that a new addition triggers pnpm install naturally.
    let toolchainAdded: string[] = []
    if (!opts.skipToolchain) {
      await timed("toolchain", () => {
        const res = ensureToolchainDefaults(rootDir)
        if (res.changed) {
          toolchainAdded = res.added
          result.ran.push("toolchain")
          logStep(
            "toolchain",
            `added ${res.added.join(", ")} to devDependencies`,
            "ran"
          )
        } else {
          result.skipped.push("toolchain")
          logStep("toolchain", "defaults present", "skip")
        }
      })
    }

    // 2. Dependencies (per-lang lockfile hash + output-dir existence probe).
    //    If toolchain added new devDeps, force an install even if the stamp
    //    still matches — pnpm won't know they're in package.json otherwise.
    if (!opts.skipDeps) {
      await timed("deps", () => {
        const locks = findLockfiles(rootDir)
        const inputs: string[] = []
        if (locks.js) inputs.push(locks.js)
        if (locks.py) inputs.push(locks.py)
        inputs.push(...locks.poms)
        if (inputs.length === 0) return

        const check = isStale(rootDir, "deps", inputs)
        const outputMissing = depsOutputMissing(rootDir, locks.js)
        const toolchainChanged = toolchainAdded.length > 0

        if (force || check.stale || outputMissing || toolchainChanged) {
          let ok = true
          if (locks.js)
            ok =
              runners.jsInstall(rootDir, locks.js, quiet, toolchainChanged) &&
              ok
          if (locks.py) ok = runners.pyInstall(rootDir, locks.py, quiet) && ok
          if (locks.poms.length > 0)
            ok = runners.mvnResolve(rootDir, quiet) && ok
          if (ok) {
            // Re-hash inputs since package.json may have been rewritten by
            // ensureToolchainDefaults. Lockfile itself hasn't changed yet —
            // pnpm install will update it if needed. Stamp against the
            // current state so next run correctly skips.
            const freshHash = isStale(rootDir, "deps", inputs).hash
            markFresh(rootDir, "deps", freshHash)
            result.ran.push("deps")
            const parts: string[] = []
            if (locks.js) parts.push(locks.js)
            if (locks.py) parts.push(locks.py)
            if (locks.poms.length > 0)
              parts.push(`${locks.poms.length} pom.xml`)
            const reason = toolchainChanged
              ? `toolchain added ${toolchainAdded.join(", ")}`
              : outputMissing
                ? "output missing"
                : force
                  ? "forced"
                  : "lockfile changed"
            logStep(
              "deps",
              `installed (${parts.join(", ")}) — ${reason}`,
              "ran"
            )
          } else {
            const jsHint: Record<string, string> = {
              "pnpm-lock.yaml": "pnpm install",
              "bun.lock": "bun install",
              "yarn.lock": "yarn install",
              "package-lock.json": "npm install",
            }
            const hintCmd = locks.js
              ? jsHint[locks.js]
              : locks.py === "uv.lock"
                ? "uv sync"
                : locks.poms.length > 0
                  ? "./mvnw install"
                  : undefined
            result.warnings.push({
              step: "deps",
              message: "dependency install reported errors",
              hint: hintCmd ? `run \`${hintCmd}\` to see why` : undefined,
            })
          }
        } else {
          result.skipped.push("deps")
          logStep("deps", "up to date", "skip")
        }
      })
    }

    // 3. Git hooks (idempotent; skip if healthy)
    if (!opts.skipHooks) {
      await timed("hooks", () => {
        if (hooksHealthy(rootDir)) {
          result.skipped.push("hooks")
          logStep("hooks", "healthy", "skip")
        } else {
          installHooks(rootDir)
          result.ran.push("hooks")
          logStep("hooks", "installed", "ran")
        }
      })
    }

    // 4. .env from .env.example
    if (!opts.skipEnv && existsSync(join(rootDir, ".env.example"))) {
      await timed("env", async () => {
        const check = isStale(rootDir, "env", [".env.example"])
        const envExists = existsSync(join(rootDir, ".env"))
        if (force || check.stale || !envExists) {
          try {
            const { syncEnv } = await import("../handlers/sync-env.js")
            await syncEnv(rootDir)
            markFresh(rootDir, "env", check.hash)
            result.ran.push("env")
            logStep("env", envExists ? "refreshed" : ".env created", "ran")
          } catch (err) {
            result.warnings.push({
              step: "env",
              message: `.env sync failed: ${err instanceof Error ? err.message : String(err)}`,
              hint: "run `dx sync` to see why",
            })
          }
        } else {
          result.skipped.push("env")
          logStep("env", "up to date", "skip")
        }
      })
    }

    // 5. Source links (cheap; always run; underlying sync-sources is idempotent)
    if (!opts.skipLinks) {
      await timed("links", async () => {
        try {
          const { syncSources } =
            await import("../handlers/source/sync-sources.js")
          const r = await syncSources(rootDir, { verbose: false })
          if (r.total === 0) return
          if (r.restored.length > 0) {
            result.ran.push("links")
            logStep("links", `restored ${r.restored.length}`, "ran")
          } else {
            result.skipped.push("links")
            logStep("links", `${r.alreadyLinked.length} linked`, "skip")
          }
        } catch {
          // best-effort
        }
      })
    }

    // 6. Infra (docker compose up -d if anything not healthy)
    if (!opts.skipInfra && project.composeFiles.length > 0) {
      await timed("infra", () => {
        if (!isDockerRunning()) {
          result.warnings.push({
            step: "infra",
            message: "docker is not running — infra skipped",
            hint: "start Docker Desktop or the daemon",
          })
          return
        }
        const envPath = join(rootDir, ".dx", "ports.env")
        const compose = new Compose(
          project.composeFiles,
          basename(rootDir),
          existsSync(envPath) ? envPath : undefined
        )
        let statuses: ComposeServiceStatus[] = []
        try {
          statuses = compose.ps()
        } catch {
          statuses = []
        }
        if (!force && composeHealthy(statuses)) {
          result.skipped.push("infra")
          logStep("infra", `${statuses.length} services healthy`, "skip")
        } else {
          const reason =
            statuses.length === 0
              ? "no services up"
              : force
                ? "forced"
                : `unhealthy: ${unhealthySummary(statuses)}`
          compose.up({ detach: true })
          result.ran.push("infra")
          logStep("infra", `docker compose up -d — ${reason}`, "ran")
        }
      })
    }
  } finally {
    lock.release()
  }

  // Emit a one-line summary — "don't even ask" proof-point at startup.
  const totalMs = Object.values(result.timings).reduce((a, b) => a + b, 0)
  if (result.ran.length + result.skipped.length > 0) {
    const parts = [
      ...result.ran.map((s) => `${s} run`),
      ...result.skipped.map((s) => `${s} skip`),
    ]
    console.log(`  prelude: ${totalMs}ms (${parts.join(", ")})`)
  }
  for (const w of result.warnings) {
    const tail = w.hint ? ` — ${w.hint}` : ""
    console.warn(`  ! ${w.step}: ${w.message}${tail}`)
  }

  return result
}
