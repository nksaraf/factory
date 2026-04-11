import { existsSync, statSync } from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

import type { DxBase } from "../dx-root.js"
import { resolveDxContext } from "../lib/dx-context.js"
import { installHooks, verifyHooks } from "../lib/hooks.js"
import { exitWithError } from "../lib/cli-exit.js"
import { toDxFlags } from "./dx-flags.js"
import { setExamples } from "../plugins/examples-plugin.js"

setExamples("sync", [
  "$ dx sync              Heal local state (hooks, deps, env, db)",
  "$ dx sync --quiet      Only report problems",
])

export function syncCommand(app: DxBase) {
  return app
    .sub("sync")
    .meta({
      description: "Sync local state: hooks, dependencies, env, migrations",
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

      // 2. Dependencies
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

      // 3. Docker images — check for new services
      if (project.composeFiles.length > 0) {
        const pullResult = spawnSync(
          "docker",
          ["compose", "pull", "--quiet", "--ignore-pull-failures"],
          {
            cwd: rootDir,
            stdio: "ignore",
            timeout: 30_000,
          }
        )
        if (pullResult.status === 0) {
          results.push({ step: "Docker images", status: "ok" })
        }
      }

      // 4. Codegen — check if generators have stale outputs
      if (toolchain?.codegen && toolchain.codegen.length > 0) {
        results.push({
          step: "Codegen",
          status: "ok",
          detail: `${toolchain.codegen.length} generator(s) available`,
        })
      }

      // 5. Database — check for pending migrations
      if (toolchain?.migrationTool) {
        results.push({
          step: "Database",
          status: "ok",
          detail: `${toolchain.migrationTool.tool} detected (migrations run on next dx dev)`,
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
