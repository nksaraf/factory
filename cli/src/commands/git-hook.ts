import { validateCommitMessage } from "@smp/factory-shared/conventions"
import { defaultConventionsConfig } from "@smp/factory-shared/conventions-schema"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"

import type { DxBase } from "../dx-root.js"
import { resolveDxContext } from "../lib/dx-context.js"

/**
 * dx git-hook — called by git hooks in .dx/hooks/, not by users directly.
 * Each subcommand implements one git hook's logic.
 */
export function gitHookCommand(app: DxBase) {
  return app
    .sub("git-hook")
    .meta({
      description:
        "Git hook implementations (called by .dx/hooks/, not directly)",
    })
    .command("commit-msg", (c) =>
      c
        .meta({ description: "Validate commit message conventions" })
        .args([
          {
            name: "file",
            type: "string" as const,
            required: true,
            description: "Path to the commit message file",
          },
        ])
        .run(async ({ args }) => {
          const message = readFileSync(args.file, "utf-8").trim()

          // Skip merge commits, fixup commits, and empty messages
          if (
            message.startsWith("Merge ") ||
            message.startsWith("fixup! ") ||
            message.startsWith("squash! ")
          ) {
            process.exit(0)
          }

          const ctx = await resolveDxContext({ need: "host" })
          const conventions =
            ctx.project?.conventions ?? defaultConventionsConfig()

          // Check if dx config says commits: "none" — skip validation
          if (ctx.project?.dxConfig.conventions.commits === "none") {
            process.exit(0)
          }

          const result = validateCommitMessage(message, conventions)
          if (!result.valid) {
            console.error("")
            console.error("  Commit message does not follow conventions:")
            for (const v of result.violations) {
              console.error(`    ✗ ${v}`)
            }
            if (result.suggestions.length > 0) {
              console.error("")
              console.error("  Expected format:")
              for (const s of result.suggestions) {
                console.error(`    ${s}`)
              }
            }
            console.error("")
            console.error("  Types: feat fix chore refactor test docs perf ci")
            console.error("  Example: feat: add user search endpoint")
            console.error("")
            process.exit(1)
          }
        })
    )
    .command("pre-commit", (c) =>
      c.meta({ description: "Run lint-staged on staged files" }).run(() => {
        // Run lint-staged via bunx — reads config from package.json lint-staged key
        const result = spawnSync("bunx", ["lint-staged"], {
          cwd: process.cwd(),
          stdio: "inherit",
          env: { ...process.env },
        })
        process.exit(result.status ?? 1)
      })
    )
    .command("pre-push", (c) =>
      c.meta({ description: "Run quality checks before push" }).run(() => {
        const TIMEOUT_MS = 30_000
        const checks: Array<{
          name: string
          args: string[]
          advisory?: boolean
        }> = [
          { name: "lint", args: ["run", "lint"] },
          { name: "typecheck", args: ["run", "typecheck"], advisory: true },
          { name: "format", args: ["run", "format:check"] },
        ]

        for (const check of checks) {
          const result = spawnSync("pnpm", check.args, {
            cwd: process.cwd(),
            stdio: "inherit",
            timeout: TIMEOUT_MS,
          })

          if (result.signal === "SIGTERM") {
            console.error("")
            console.error(
              `  Pre-push ${check.name} timed out (30s). Skipping — full checks run in CI.`
            )
            console.error("")
            if (!check.advisory) process.exit(0)
            continue
          }

          if (result.status !== 0) {
            if (check.advisory) {
              console.error(
                `  ⚠ Pre-push ${check.name} failed (advisory, not blocking push).`
              )
              continue
            }
            console.error("")
            console.error(
              `  Pre-push ${check.name} failed. Fix the issues above and try again.`
            )
            console.error("  To bypass: git push --no-verify")
            console.error("")
            process.exit(result.status ?? 1)
          }
        }
      })
    )
    .command("post-merge", (c) =>
      c.meta({ description: "Sync local state after merge" }).run(() => {
        // Delegate to dx sync --quiet
        spawnSync("dx", ["sync", "--quiet"], {
          cwd: process.cwd(),
          stdio: "inherit",
        })
      })
    )
    .command("post-checkout", (c) =>
      c
        .meta({ description: "Sync local state after branch checkout" })
        .run(() => {
          // Delegate to dx sync --quiet
          spawnSync("dx", ["sync", "--quiet"], {
            cwd: process.cwd(),
            stdio: "inherit",
          })
        })
    )
}
