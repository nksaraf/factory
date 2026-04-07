import { spawnSync } from "node:child_process";

import type { DxBase } from "../dx-root.js";
import { resolveDxContext } from "../lib/dx-context.js";
import { exitWithError } from "../lib/cli-exit.js";
import { toDxFlags } from "./dx-flags.js";
import { setExamples } from "../plugins/examples-plugin.js";

setExamples("typecheck", [
  "$ dx typecheck         Run auto-detected type checker",
]);

export function typecheckCommand(app: DxBase) {
  return app
    .sub("typecheck")
    .meta({ description: "Run type checker (auto-detected or from package.json)" })
    .run(async ({ flags }) => {
      const f = toDxFlags(flags);
      const ctx = await resolveDxContext({ need: "host" });
      if (!ctx.package) return exitWithError(f, "No project found.");

      const { toolchain, dir: rootDir } = ctx.package;
      const tool = toolchain.typeChecker;

      if (!tool) {
        // Go and Rust: compiler handles types — skip silently
        if (toolchain.runtime === "go" || toolchain.runtime === "rust") {
          if (!f.quiet) console.log("  Type checking handled by compiler — skipping.");
          process.exit(0);
        }
        return exitWithError(f, 'No type checker detected. Add tsconfig.json or a "typecheck" script to package.json.');
      }

      if (!f.quiet) {
        const sourceLabel = tool.source === "package.json" ? `Using: package.json → "typecheck"` : `Detected: ${tool.tool} (from ${tool.configFile})`;
        console.log(`  ${sourceLabel}`);
      }

      const [bin, ...args] = tool.runCmd.split(" ");
      const result = spawnSync(bin!, args, { cwd: rootDir, stdio: "inherit", shell: true });

      if (f.json) {
        console.log(JSON.stringify({
          command: "typecheck",
          tool: tool.tool,
          source: tool.source,
          detected_from: tool.configFile,
          executed: tool.runCmd,
          result: result.status === 0 ? "pass" : "fail",
        }));
      }

      process.exit(result.status ?? 1);
    });
}
