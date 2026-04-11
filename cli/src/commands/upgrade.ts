import type { DxBase } from "../dx-root.js"
import { resolveDxContext } from "../lib/dx-context.js"
import { verifyHooks, installHooks } from "../lib/hooks.js"
import { exitWithError } from "../lib/cli-exit.js"
import { toDxFlags } from "./dx-flags.js"
import { setExamples } from "../plugins/examples-plugin.js"

setExamples("upgrade", [
  "$ dx upgrade           Adopt latest dx template conventions",
  "$ dx upgrade --check   Report available upgrades (for CI)",
])

export function upgradeCommand(app: DxBase) {
  return app
    .sub("upgrade")
    .meta({ description: "Upgrade project to latest dx template conventions" })
    .flags({
      check: {
        type: "boolean",
        description: "Report available upgrades without modifying (for CI)",
      },
    })
    .run(async ({ flags }) => {
      const f = toDxFlags(flags)

      let ctx
      try {
        ctx = await resolveDxContext({ need: "project" })
      } catch {
        return exitWithError(f, "No dx project found.")
      }

      const { rootDir, dxConfig } = ctx.project
      const checkOnly = Boolean(flags.check)
      const upgrades: { file: string; action: "update" | "add" | "custom" }[] =
        []

      // 1. Check hooks
      const hookStatus = verifyHooks(rootDir)
      const staleHooks = Object.entries(hookStatus.hooks).filter(
        ([, s]) => s !== "ok"
      )
      if (staleHooks.length > 0) {
        for (const [name, status] of staleHooks) {
          upgrades.push({
            file: `.dx/hooks/${name}`,
            action: status === "missing" ? "add" : "update",
          })
        }
      }
      if (!hookStatus.hooksPathSet) {
        upgrades.push({ file: "git config core.hooksPath", action: "update" })
      }

      // Report or apply
      if (upgrades.length === 0) {
        if (!f.quiet)
          console.log(
            "  ✓ Project is up to date (dx template v" + dxConfig.version + ")"
          )
        if (checkOnly) process.exit(0)
        return
      }

      if (checkOnly) {
        console.log(`  ${upgrades.length} upgrade(s) available:`)
        for (const u of upgrades) {
          console.log(`    ${u.action === "add" ? "+" : "~"} ${u.file}`)
        }
        if (f.json) {
          console.log(
            JSON.stringify({ command: "upgrade", upToDate: false, upgrades })
          )
        }
        process.exit(1)
      }

      // Apply upgrades
      if (!f.quiet) console.log(`  Applying ${upgrades.length} upgrade(s)...`)

      // Install/update hooks
      if (staleHooks.length > 0 || !hookStatus.hooksPathSet) {
        const result = installHooks(rootDir)
        if (!f.quiet) {
          for (const name of result.installed)
            console.log(`    + .dx/hooks/${name}`)
          for (const name of result.updated)
            console.log(`    ~ .dx/hooks/${name}`)
        }
      }

      if (!f.quiet) console.log("  ✓ Upgrade complete")
      if (f.json) {
        console.log(JSON.stringify({ command: "upgrade", applied: upgrades }))
      }
    })
}
