import type { DxBase } from "../dx-root.js";

import { exitWithError } from "../lib/cli-exit.js";
import { toDxFlags } from "./dx-flags.js";
import { setExamples } from "../plugins/examples-plugin.js";

setExamples("script", [
  "$ dx script deploy.ts                 Run a TypeScript script",
  "$ dx script .dx/scripts/review.ts     Run a script from .dx/scripts",
  "$ dx script setup.ts -- --env prod    Pass extra args to script",
]);

export function scriptCommand(app: DxBase) {
  return app
    .sub("script")
    .meta({ description: "Run a TypeScript script with the embedded Bun runtime" })
    .args([
      {
        name: "file",
        type: "string",
        required: true,
        description: "TypeScript or JavaScript file to run",
      },
    ])
    .flags({
      watch: {
        type: "boolean",
        alias: "w",
        description: "Re-run script on file changes",
      },
    })
    .run(async ({ args, flags }) => {
      const f = toDxFlags(flags);
      try {
        const { runScript } = await import("../handlers/script.js");
        // Everything after "--" in process.argv goes to the script
        const allArgs = process.argv;
        const ddIdx = allArgs.indexOf("--");
        const passthrough = ddIdx >= 0 ? allArgs.slice(ddIdx + 1) : [];
        await runScript({
          file: args.file as string,
          watch: flags.watch as boolean | undefined,
          passthrough,
        });
      } catch (err) {
        exitWithError(f, err instanceof Error ? err.message : String(err));
      }
    });
}
