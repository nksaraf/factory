import { spawnSync } from "node:child_process";

import type { DxBase } from "../dx-root.js";
import { resolveDxContext } from "../lib/dx-context.js";
import { exitWithError } from "../lib/cli-exit.js";
import { toDxFlags } from "./dx-flags.js";
import { setExamples } from "../plugins/examples-plugin.js";

setExamples("generate", [
  "$ dx generate          Run all detected code generators",
]);

export function generateCommand(app: DxBase) {
  return app
    .sub("generate")
    .meta({ description: "Run detected code generators (prisma, drizzle, graphql, openapi, sqlc)" })
    .run(async ({ flags }) => {
      const f = toDxFlags(flags);
      const ctx = await resolveDxContext({ need: "host" });
      if (!ctx.package) return exitWithError(f, "No project found.");

      const { toolchain, dir: rootDir } = ctx.package;
      const generators = toolchain.codegen;

      if (generators.length === 0) {
        if (!f.quiet) console.log("  No code generators detected.");
        return;
      }

      const results: { tool: string; cmd: string; passed: boolean }[] = [];

      for (const gen of generators) {
        if (!f.quiet) {
          const sourceLabel = gen.source === "package.json" ? `Using: package.json → "generate"` : `Detected: ${gen.tool} (from ${gen.configFile})`;
          console.log(`  ${sourceLabel}`);
          console.log(`  Running: ${gen.runCmd}`);
        }

        const [bin, ...args] = gen.runCmd.split(" ");
        const result = spawnSync(bin!, args, { cwd: rootDir, stdio: "inherit", shell: true });
        const passed = result.status === 0;
        results.push({ tool: gen.tool, cmd: gen.runCmd, passed });

        if (!passed) {
          console.error(`  ✗ ${gen.tool} failed`);
          if (!f.json) process.exit(1);
        } else if (!f.quiet) {
          console.log(`  ✓ ${gen.tool} done`);
        }
      }

      if (f.json) {
        console.log(JSON.stringify({
          command: "generate",
          generators: results,
          result: results.every((r) => r.passed) ? "pass" : "fail",
        }));
      }

      if (results.some((r) => !r.passed)) process.exit(1);
    });
}
