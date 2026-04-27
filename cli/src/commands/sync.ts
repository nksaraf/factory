import { existsSync, statSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

const GITIGNORE_ENTRIES = ["**/.dx/generated/", "**/.dx/workbench.json", ".env"]

function ensureGitignore(rootDir: string): { added: string[] } {
  const path = join(rootDir, ".gitignore")
  const existing = existsSync(path) ? readFileSync(path, "utf-8") : ""
  const lines = new Set(existing.split("\n").map((l) => l.trim()))
  const added: string[] = []
  for (const entry of GITIGNORE_ENTRIES) {
    if (!lines.has(entry)) added.push(entry)
  }
  if (added.length === 0) return { added: [] }
  const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : ""
  const block = `${prefix}# dx\n${added.join("\n")}\n`
  writeFileSync(path, existing + block, "utf-8")
  return { added }
}

import type { DxBase } from "../dx-root.js"
import { resolveDxContext } from "../lib/dx-context.js"
import { installHooks, verifyHooks } from "../lib/hooks.js"
import {
  extractComposeImages,
  checkImageStatus,
  pullAndCacheImages,
  seedCacheFromLocal,
} from "../lib/docker-image-cache.js"
import { exitWithError } from "../lib/cli-exit.js"
import { toDxFlags } from "./dx-flags.js"
import { setExamples } from "../plugins/examples-plugin.js"

setExamples("sync", [
  "$ dx sync              Heal local state (hooks, deps, env, db)",
  "$ dx sync --pull       Also pull latest Docker images",
  "$ dx sync --quiet      Only report problems",
])

export function syncCommand(app: DxBase) {
  return app
    .sub("sync")
    .meta({
      description: "Sync local state: hooks, dependencies, env, migrations",
    })
    .flags({
      pull: { type: "boolean", description: "Pull latest Docker images" },
    })
    .run(async ({ flags }) => {
      const f = toDxFlags(flags)
      const quiet = Boolean(f.quiet)

      let ctx
      try {
        ctx = await resolveDxContext({ need: "host" })
      } catch {
        if (!quiet) console.log("  No dx project found — nothing to sync.")
        return
      }

      if (!ctx.project) {
        if (!quiet) console.log("  No dx project found — nothing to sync.")
        return
      }

      const project = ctx.project
      const toolchain = ctx.package?.toolchain
      const rootDir = project.rootDir
      const results: {
        step: string
        status: "ok" | "updated" | "warning" | "error"
        detail?: string
      }[] = []

      // 1. Git hooks
      const hookVerification = verifyHooks(rootDir)
      const needsHookUpdate =
        !hookVerification.hooksPathSet ||
        Object.values(hookVerification.hooks).some((s) => s !== "ok")

      if (needsHookUpdate) {
        const hookResult = installHooks(rootDir)
        const changed = [...hookResult.installed, ...hookResult.updated]
        if (changed.length > 0) {
          results.push({
            step: "Hooks",
            status: "updated",
            detail: `${changed.length} hooks ${hookResult.installed.length > 0 ? "installed" : "updated"}`,
          })
        }
      } else {
        results.push({
          step: "Hooks",
          status: "ok",
          detail: "core.hooksPath set to .dx/hooks",
        })
      }

      // 2. Gitignore — ensure dx-managed paths are excluded
      const giResult = ensureGitignore(rootDir)
      if (giResult.added.length > 0) {
        results.push({
          step: "Gitignore",
          status: "updated",
          detail: `added: ${giResult.added.join(", ")}`,
        })
      } else {
        results.push({ step: "Gitignore", status: "ok" })
      }

      // 3. Environment (.env from .env.example)
      const examplePath = join(rootDir, ".env.example")
      if (existsSync(examplePath)) {
        try {
          const { syncEnv } = await import("../handlers/sync-env.js")
          const envResult = await syncEnv(rootDir)
          const hasChanges =
            envResult.resolved.length > 0 || envResult.unresolved.length > 0
          if (!hasChanges) {
            results.push({ step: "Environment", status: "ok" })
          } else {
            const parts: string[] = []
            if (envResult.created) parts.push(".env created")
            if (envResult.resolved.length > 0)
              parts.push(`${envResult.resolved.length} resolved`)
            if (envResult.unresolved.length > 0)
              parts.push(`unresolved: ${envResult.unresolved.join(", ")}`)
            results.push({
              step: "Environment",
              status: envResult.unresolved.length > 0 ? "warning" : "updated",
              detail: parts.join(", "),
            })
          }
        } catch {
          results.push({
            step: "Environment",
            status: "error",
            detail: "failed to sync .env",
          })
        }
      }

      // 3a. Heal stale dx-managed symlinks (workspace clones leave absolute
      //     targets pointing at the original workspace).
      try {
        const { healManagedSymlinks } =
          await import("../handlers/pkg/heal-symlinks.js")
        const heal = healManagedSymlinks(rootDir)
        if (heal.repointed.length > 0) {
          results.push({
            step: "Symlinks",
            status: "updated",
            detail: `repointed: ${heal.repointed.join(", ")}`,
          })
        } else if (heal.unhealed.length > 0) {
          results.push({
            step: "Symlinks",
            status: "warning",
            detail: `stale (worktree missing): ${heal.unhealed.join(", ")}`,
          })
        }
      } catch {
        // Best-effort — don't block sync.
      }

      // 3. Required source links
      try {
        const { syncSources } =
          await import("../handlers/source/sync-sources.js")
        const sourceResult = await syncSources(rootDir, {
          verbose: f.verbose,
        })

        if (sourceResult.total === 0) {
          // No sources declared — skip silently
        } else if (
          sourceResult.failed.length === 0 &&
          sourceResult.restored.length === 0
        ) {
          const names = sourceResult.alreadyLinked.join(", ")
          results.push({
            step: "Sources",
            status: "ok",
            detail: `${sourceResult.total} linked (${names})`,
          })
        } else if (sourceResult.failed.length === 0) {
          const names = sourceResult.restored.join(", ")
          results.push({
            step: "Sources",
            status: "updated",
            detail: `${names} linked (fresh checkout)`,
          })
        } else {
          const failedNames = sourceResult.failed.map((f) => f.name).join(", ")
          results.push({
            step: "Sources",
            status: "error",
            detail: `failed to link: ${failedNames}`,
          })
        }
      } catch {
        // Source sync is best-effort — don't block rest of sync
      }

      // 4. Dependencies
      const lockFiles: Record<string, string> = {
        "pnpm-lock.yaml": "pnpm install",
        "bun.lockb": "bun install",
        "bun.lock": "bun install",
        "yarn.lock": "yarn install",
        "package-lock.json": "npm install",
      }

      for (const [lockFile, installCmd] of Object.entries(lockFiles)) {
        const lockPath = join(rootDir, lockFile)
        const nmPath = join(rootDir, "node_modules")

        if (existsSync(lockPath)) {
          const needsInstall =
            !existsSync(nmPath) ||
            statSync(lockPath).mtimeMs > statSync(nmPath).mtimeMs

          if (needsInstall) {
            const [bin, ...args] = installCmd.split(" ")
            const result = spawnSync(bin!, args, {
              cwd: rootDir,
              stdio: quiet ? "ignore" : "inherit",
            })
            if (result.status === 0) {
              results.push({
                step: "Dependencies",
                status: "updated",
                detail: `${installCmd} (lockfile changed)`,
              })
            } else {
              results.push({
                step: "Dependencies",
                status: "error",
                detail: `${installCmd} failed`,
              })
            }
          } else {
            results.push({ step: "Dependencies", status: "ok" })
          }
          break
        }
      }

      // 5. Docker images — cache-aware pull
      if (project.composeFiles.length > 0) {
        const images = extractComposeImages(rootDir, project.composeFiles)
        if (images.length > 0) {
          if (f.pull) {
            // --pull: hit the registry, update cache
            const pullResult = pullAndCacheImages(
              rootDir,
              project.composeFiles,
              images,
              { quiet }
            )
            if (pullResult.updated.length > 0) {
              results.push({
                step: "Docker images",
                status: "updated",
                detail: `${pullResult.updated.length} updated, ${pullResult.upToDate} up to date`,
              })
            } else if (pullResult.failed.length > 0) {
              results.push({
                step: "Docker images",
                status: "warning",
                detail: `${pullResult.failed.length} failed to pull`,
              })
            } else {
              results.push({
                step: "Docker images",
                status: "ok",
                detail: `${pullResult.total} up to date`,
              })
            }
          } else {
            // Default: check cache locally (no network)
            const status = checkImageStatus(images)
            if (status.missing.length > 0) {
              // Try seeding from locally-present images first
              const seeded = seedCacheFromLocal(status.missing)
              if (seeded > 0) {
                // Re-check after seeding
                const recheck = checkImageStatus(images)
                if (recheck.missing.length > 0) {
                  results.push({
                    step: "Docker images",
                    status: "warning",
                    detail: `${recheck.missing.length} not pulled (run dx sync --pull)`,
                  })
                } else {
                  results.push({
                    step: "Docker images",
                    status: "ok",
                    detail: `${images.length} cached`,
                  })
                }
              } else {
                results.push({
                  step: "Docker images",
                  status: "warning",
                  detail: `${status.missing.length} not pulled (run dx sync --pull)`,
                })
              }
            } else {
              results.push({
                step: "Docker images",
                status: "ok",
                detail: `${images.length} cached`,
              })
            }
          }
        }
      }

      // 6. Codegen — check if generators have stale outputs
      if (toolchain?.codegen && toolchain.codegen.length > 0) {
        results.push({
          step: "Codegen",
          status: "ok",
          detail: `${toolchain.codegen.length} generator(s) available`,
        })
      }

      // 7. Database — check for pending migrations
      if (toolchain?.migrationTool) {
        results.push({
          step: "Database",
          status: "ok",
          detail: `${toolchain.migrationTool.tool} detected (migrations run on next dx dev)`,
        })
      }

      // 8. Cache — probe local Docker and npm cache endpoints
      try {
        const cacheChecks = await Promise.allSettled([
          fetch("http://docker-cache.internal:5001/v2/", {
            signal: AbortSignal.timeout(2000),
          }),
          fetch("http://npm-cache.internal:4873/-/ping", {
            signal: AbortSignal.timeout(2000),
          }),
        ])
        const dockerOk =
          cacheChecks[0].status === "fulfilled" && cacheChecks[0].value.ok
        const npmOk =
          cacheChecks[1].status === "fulfilled" && cacheChecks[1].value.ok

        if (dockerOk && npmOk) {
          results.push({
            step: "Cache",
            status: "ok",
            detail: "docker + npm cache reachable",
          })
        } else if (dockerOk || npmOk) {
          const up = dockerOk ? "docker" : "npm"
          const down = dockerOk ? "npm" : "docker"
          results.push({
            step: "Cache",
            status: "warning",
            detail: `${up} cache ok, ${down} cache unreachable`,
          })
        } else {
          results.push({
            step: "Cache",
            status: "warning",
            detail: "cache unreachable (pulls use upstream directly)",
          })
        }
      } catch {
        results.push({
          step: "Cache",
          status: "warning",
          detail: "cache check skipped",
        })
      }

      // Print results
      if (!quiet) {
        console.log("")
        for (const r of results) {
          const icon =
            r.status === "ok"
              ? "✓"
              : r.status === "updated"
                ? "✓"
                : r.status === "warning"
                  ? "⚠"
                  : "✗"
          const detail = r.detail ? `: ${r.detail}` : ""
          console.log(`  ${icon} ${r.step}${detail}`)
        }
        console.log("")
      }

      if (f.json) {
        console.log(JSON.stringify({ command: "sync", results }))
      }
    })
}
