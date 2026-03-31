import type { DxBase } from "../dx-root.js";

import { exitWithError } from "../lib/cli-exit.js";
import { toDxFlags } from "./dx-flags.js";
import { setExamples } from "../plugins/examples-plugin.js";

setExamples("script", [
  "$ dx script deploy.ts                 Run a TypeScript script",
  "$ dx script .dx/scripts/review.ts     Run a script from .dx/scripts",
  "$ dx script setup.ts -- --arg val     Pass extra args to script",
  "$ dx script seed.ts --env production  Run with production secrets",
  "$ dx script seed.ts --no-secrets       Run without secret injection",
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
      env: {
        type: "string",
        description: "Secret environment scope (production, development, preview)",
      },
      secrets: {
        type: "boolean",
        description: "Inject secrets into the script environment (use --no-secrets to disable)",
      },
    })
    .run(async ({ args, flags }) => {
      console.error("\x1b[2m(dx script is now dx run — dx script still works)\x1b[0m");
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
          environment: flags.env as string | undefined,
          noSecrets: flags.secrets === false ? true : undefined,
        });
      } catch (err) {
        exitWithError(f, err instanceof Error ? err.message : String(err));
      }
    });
}
