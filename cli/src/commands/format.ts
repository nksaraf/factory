import { spawnSync } from "node:child_process"

import type { DxBase } from "../dx-root.js"
import { resolveDxContext } from "../lib/dx-context.js"
import { exitWithError } from "../lib/cli-exit.js"
import { toDxFlags } from "./dx-flags.js"
import { setExamples } from "../plugins/examples-plugin.js"

setExamples("format", [
  "$ dx format            Format all files",
  "$ dx format --check    Check formatting without modifying",
])

export function formatCommand(app: DxBase) {
  return app
    .sub("format")
    .meta({ description: "Run formatter (auto-detected or from package.json)" })
    .flags({
      check: {
        type: "boolean",
        description: "Check formatting without writing changes",
      },
    })
    .run(async ({ flags }) => {
      const f = toDxFlags(flags)
      const ctx = await resolveDxContext({ need: "host" })
      if (!ctx.package) return exitWithError(f, "No project found.")

      const { toolchain, dir: rootDir } = ctx.package
      const tool = toolchain.formatter

      if (!tool) {
        return exitWithError(
          f,
          'No formatter detected. Add .prettierrc/biome.json or a "format" script to package.json.'
        )
      }

      if (!f.quiet) {
        const sourceLabel =
          tool.source === "package.json"
            ? `Using: package.json → "format"`
            : `Detected: ${tool.tool} (from ${tool.configFile})`
        console.log(`  ${sourceLabel}`)
      }

      let cmd = tool.runCmd
      if (flags.check && tool.source === "auto-detect") {
        // Replace --write with --check for check mode
        cmd = cmd
          .replace("--write", "--check")
          .replace("format .", "format --check .")
        if (!cmd.includes("--check")) cmd += " --check"
      }

      const [bin, ...args] = cmd.split(" ")
      const result = spawnSync(bin!, args, {
        cwd: rootDir,
        stdio: "inherit",
        shell: true,
      })

      if (f.json) {
        console.log(
          JSON.stringify({
            command: "format",
            tool: tool.tool,
            source: tool.source,
            detected_from: tool.configFile,
            executed: cmd,
            result: result.status === 0 ? "pass" : "fail",
          })
        )
      }

      process.exit(result.status ?? 1)
    })
}
