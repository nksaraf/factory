import type { DxBase } from "../dx-root.js"

import { exitWithError } from "../lib/cli-exit.js"
import { toDxFlags } from "./dx-flags.js"
import { findPkgRoot } from "../handlers/pkg/detect.js"
import { setExamples } from "../plugins/examples-plugin.js"

setExamples("source", [
  "$ dx source link                                       Interactive source linking",
  "$ dx source link org/repo --path sub --target dir      Link source for local dev",
  "$ dx source link org/repo --target dir --require       Link as required source",
  "$ dx source link infra-auth --target packages/auth     Link from catalog labels",
  "$ dx source list                                       List source links",
  "$ dx source unlink my-service                          Remove source link",
  "$ dx source diff my-service                            Show source changes",
  "$ dx source push my-service                            Push source upstream",
])

const root = (): string => findPkgRoot(process.cwd())

async function ensurePkgEnv(): Promise<void> {
  const { loadGlobalAuthEnv } =
    await import("../handlers/pkg/registry-auth-store.js")
  await loadGlobalAuthEnv()
}

export function sourceCommand(app: DxBase) {
  return (
    app
      .sub("source")
      .meta({
        description: "Source linking — check out external repos for local dev",
      })

      // ── link ──
      .command("link", (c) =>
        c
          .meta({
            description: "Check out an external source for local development",
          })
          .args([
            {
              name: "source",
              type: "string",
              description:
                "Git URL, GitHub shorthand (org/repo), or catalog service name",
            },
          ])
          .flags({
            path: {
              type: "string",
              description: "Subdirectory within a monorepo",
            },
            target: {
              type: "string",
              description: "Target directory in the workspace",
            },
            as: {
              type: "string",
              description: "Override source name",
            },
            ref: {
              type: "string",
              description: "Branch or tag to check out",
            },
            branch: {
              type: "string",
              description: "Working branch name (default: dx/<name>-dev)",
            },
            require: {
              type: "boolean",
              description:
                "Required source — committed to package.json, restored by dx sync",
            },
          })
          .run(async ({ args, flags }) => {
            const f = toDxFlags(flags)
            try {
              await ensurePkgEnv()

              // Interactive mode when no source argument provided
              if (!args.source) {
                const { promptSourceLink } =
                  await import("../handlers/source/link-prompts.js")
                const opts = await promptSourceLink(root())
                const { sourceLink } =
                  await import("../handlers/source/link.js")
                await sourceLink(root(), {
                  ...opts,
                  ref: flags.ref as string | undefined,
                  branch: flags.branch as string | undefined,
                  verbose: f.verbose,
                })
                return
              }

              const { sourceLink } = await import("../handlers/source/link.js")
              await sourceLink(root(), {
                source: args.source as string,
                path: flags.path as string | undefined,
                target: flags.target as string | undefined,
                as: flags.as as string | undefined,
                ref: flags.ref as string | undefined,
                branch: flags.branch as string | undefined,
                require: flags.require as boolean | undefined,
                verbose: f.verbose,
              })
            } catch (err) {
              exitWithError(f, err instanceof Error ? err.message : String(err))
            }
          })
      )

      // ── unlink ──
      .command("unlink", (c) =>
        c
          .meta({ description: "Remove a source link" })
          .args([
            {
              name: "package",
              type: "string",
              required: true,
              description: "Source to unlink",
            },
          ])
          .flags({
            force: {
              type: "boolean",
              description: "Force removal even with uncommitted changes",
            },
            localOnly: {
              type: "boolean",
              description: "Remove local checkout only, keep committed config",
            },
          })
          .run(async ({ args, flags }) => {
            const f = toDxFlags(flags)
            try {
              await ensurePkgEnv()
              const { sourceUnlink } =
                await import("../handlers/source/unlink.js")
              await sourceUnlink(root(), {
                package: args.package as string,
                force: flags.force as boolean | undefined,
                localOnly: flags.localOnly as boolean | undefined,
                verbose: f.verbose,
              })
            } catch (err) {
              exitWithError(f, err instanceof Error ? err.message : String(err))
            }
          })
      )

      // ── list ──
      .command("list", (c) =>
        c
          .meta({ description: "Show source links (required and optional)" })
          .run(async ({ flags }) => {
            const f = toDxFlags(flags)
            try {
              await ensurePkgEnv()
              const { sourceList } = await import("../handlers/source/list.js")
              await sourceList(root(), f.json)
            } catch (err) {
              exitWithError(f, err instanceof Error ? err.message : String(err))
            }
          })
      )

      // ── diff ──
      .command("diff", (c) =>
        c
          .meta({ description: "Show changes in a source link" })
          .args([
            {
              name: "package",
              type: "string",
              required: true,
              description: "Source to diff",
            },
          ])
          .flags({
            stat: {
              type: "boolean",
              description: "Show diffstat summary only",
            },
          })
          .run(async ({ args, flags }) => {
            const f = toDxFlags(flags)
            try {
              await ensurePkgEnv()
              const { pkgDiff } = await import("../handlers/pkg/diff.js")
              await pkgDiff(root(), {
                package: args.package as string,
                stat: flags.stat as boolean | undefined,
                verbose: f.verbose,
              })
            } catch (err) {
              exitWithError(f, err instanceof Error ? err.message : String(err))
            }
          })
      )

      // ── push ──
      .command("push", (c) =>
        c
          .meta({
            description: "Commit, push, and create PR for source changes",
          })
          .args([
            {
              name: "package",
              type: "string",
              required: true,
              description: "Source to push",
            },
          ])
          .flags({
            branch: {
              type: "string",
              description: "Override working branch",
            },
            message: {
              type: "string",
              short: "m",
              description: "Custom commit message",
            },
          })
          .run(async ({ args, flags }) => {
            const f = toDxFlags(flags)
            try {
              await ensurePkgEnv()
              const { pkgPush } = await import("../handlers/pkg/push.js")
              await pkgPush(root(), {
                package: args.package as string,
                branch: flags.branch as string | undefined,
                message: flags.message as string | undefined,
                verbose: f.verbose,
              })
            } catch (err) {
              exitWithError(f, err instanceof Error ? err.message : String(err))
            }
          })
      )

      // ── pull ──
      .command("pull", (c) =>
        c
          .meta({
            description: "Pull upstream changes for a source link",
          })
          .args([
            {
              name: "package",
              type: "string",
              required: true,
              description: "Source to pull updates for",
            },
          ])
          .flags({
            branch: {
              type: "string",
              description: "Override working branch",
            },
            dryRun: {
              type: "boolean",
              description: "Preview changes without applying",
            },
          })
          .run(async ({ args, flags }) => {
            const f = toDxFlags(flags)
            try {
              await ensurePkgEnv()
              const { pkgPull } = await import("../handlers/pkg/pull.js")
              await pkgPull(root(), {
                package: args.package as string,
                branch: flags.branch as string | undefined,
                dryRun: flags.dryRun as boolean | undefined,
                verbose: f.verbose,
              })
            } catch (err) {
              exitWithError(f, err instanceof Error ? err.message : String(err))
            }
          })
      )
  )
}
