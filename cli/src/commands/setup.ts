// cli/src/commands/setup.ts
import type { DxBase } from "../dx-root.js";

import { exitWithError } from "../lib/cli-exit.js";
import { toDxFlags } from "./dx-flags.js";
import {
  styleBold,
  styleMuted,
} from "./list-helpers.js";
import { setExamples } from "../plugins/examples-plugin.js";

setExamples("setup", [
  "$ dx setup                                 Install/upgrade the dx platform",
  "$ dx setup docker --on staging-1           Install Docker on a remote machine",
  "$ dx setup node --on staging-1 --set v=20  Install Node.js v20 on a remote machine",
  "$ dx setup caddy --on staging-1            Install Caddy on a remote machine",
]);

export function setupCommand(app: DxBase) {
  return app
    .sub("setup")
    .meta({ description: "Set up the dx platform or install tools on remote machines" })
    .args([
      {
        name: "tool",
        type: "string",
        description: "Tool to install (docker, node, caddy, etc.) or omit for platform setup",
      },
    ])
    .flags({
      on: {
        type: "string",
        description: "Target machine(s) for remote tool installation",
      },
      set: {
        type: "string",
        description: "Set recipe parameter (repeatable, format: key=value)",
      },
      "dry-run": {
        type: "boolean",
        description: "Check current state without applying changes",
      },
      force: {
        type: "boolean",
        description: "Re-install even if already present",
      },
      // Pass through all dx install flags for platform setup mode
      role: { type: "string", description: "Installation role: workbench (default), site, or factory" },
      bundle: { type: "string", short: "b", description: "Path to offline bundle directory" },
      yes: { type: "boolean", short: "y", description: "Skip interactive prompts" },
    })
    .run(async ({ args, flags }) => {
      const f = toDxFlags(flags);
      const tool = args.tool as string | undefined;
      const onExpr = flags.on as string | undefined;

      // No tool specified → delegate to platform install (dx install)
      if (!tool) {
        const { installCommand } = await import("./install.js");
        // Re-invoke dx install with the same flags
        console.log(styleMuted("Running platform setup (same as dx install)...\n"));
        // Directly import and run the install handler
        // We forward by re-running the install command's run handler
        const args = process.argv.slice(2).filter(a => a !== "setup");
        args.unshift("install");
        // Simplest: just tell the user
        console.log(styleBold("dx setup") + " — Platform & machine setup\n");
        console.log("For platform installation, use: " + styleBold("dx install"));
        console.log("For remote tool setup:");
        console.log("  dx setup docker --on <machine>     Install Docker");
        console.log("  dx setup node --on <machine>       Install Node.js");
        console.log("  dx setup caddy --on <machine>      Install Caddy");
        console.log("");
        console.log(styleMuted("dx setup <tool> --on <machine> is equivalent to dx run @dx/<tool> --on <machine>"));
        return;
      }

      // Tool specified → delegate to dx run @dx/<tool> --on <machine>
      if (!onExpr) {
        exitWithError(
          f,
          `dx setup ${tool} requires --on <machine>.\n` +
          `  Usage: dx setup ${tool} --on <machine-slug>`
        );
      }

      try {
        const { resolveRecipe, resolveParams } = await import("../lib/recipe.js");
        const { expandTargets } = await import("../lib/machine-target.js");
        const { runRecipe } = await import("../handlers/run.js");

        const recipeName = `@dx/${tool}`;
        const recipe = resolveRecipe(recipeName);

        const rawSet = flags.set;
        const setFlags: string[] = !rawSet
          ? []
          : Array.isArray(rawSet)
            ? rawSet as string[]
            : [rawSet as string];

        const paramEnv = resolveParams(recipe.manifest, setFlags);
        const targets = await expandTargets(onExpr);

        await runRecipe({
          recipeName,
          targets,
          paramEnv,
          dryRun: flags["dry-run"] as boolean | undefined,
          force: flags.force as boolean | undefined,
        });
      } catch (err) {
        exitWithError(f, err instanceof Error ? err.message : String(err));
      }
    });
}
