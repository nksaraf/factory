import { spawnSync } from "node:child_process";

import type { DxBase } from "../dx-root.js";
import { resolveDxContext } from "../lib/dx-context.js";
import { exitWithError } from "../lib/cli-exit.js";
import { toDxFlags } from "./dx-flags.js";
import { setExamples } from "../plugins/examples-plugin.js";

setExamples("lint", [
  "$ dx lint              Run auto-detected linter",
  "$ dx lint --fix        Auto-fix linting issues",
]);

export function lintCommand(app: DxBase) {
  return app
    .sub("lint")
    .meta({ description: "Run linter (auto-detected or from package.json)" })
    .flags({
      fix: {
        type: "boolean",
        description: "Auto-fix issues",
      },
    })
    .run(async ({ flags }) => {
      const f = toDxFlags(flags);
      const ctx = await resolveDxContext({ need: "host" });
      if (!ctx.package) return exitWithError(f, "No project found (no package.json in parent directories).");

      const { toolchain, dir: rootDir } = ctx.package;
      const tool = toolchain.linter;

      if (!tool) {
        return exitWithError(f, 'No linter detected. Add a "lint" script to package.json or install eslint/biome.');
      }

      if (!f.quiet) {
        const sourceLabel = tool.source === "package.json" ? `Using: package.json → "lint"` : `Detected: ${tool.tool} (from ${tool.configFile})`;
        console.log(`  ${sourceLabel}`);
      }

      let cmd = tool.runCmd;
      if (flags.fix && tool.source === "auto-detect" && !cmd.includes("--fix")) {
        cmd += " --fix";
      }

      const [bin, ...args] = cmd.split(" ");
      const result = spawnSync(bin!, args, { cwd: rootDir, stdio: "inherit", shell: true });

      if (f.json) {
        console.log(JSON.stringify({
          command: "lint",
          tool: tool.tool,
          source: tool.source,
          detected_from: tool.configFile,
          executed: cmd,
          result: result.status === 0 ? "pass" : "fail",
        }));
      }

      process.exit(result.status ?? 1);
    });
}
