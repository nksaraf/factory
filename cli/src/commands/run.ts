// cli/src/commands/run.ts
import type { DxBase } from "../dx-root.js";

import { exitWithError } from "../lib/cli-exit.js";
import { toDxFlags } from "./dx-flags.js";
import {
  styleBold,
  styleMuted,
  styleSuccess,
} from "./list-helpers.js";
import { setExamples } from "../plugins/examples-plugin.js";

setExamples("run", [
  "$ dx run script.ts                          Run a TypeScript script locally",
  "$ dx run setup.sh --on staging-1            Run a shell script on a remote machine",
  "$ dx run @dx/docker --on staging-1          Install Docker via built-in recipe",
  "$ dx run ghost-cms --on prod --set domain=x Run a custom recipe with params",
  "$ dx run list                               List available recipes",
]);

export function runCommand(app: DxBase) {
  return app
    .sub("run")
    .meta({ description: "Run scripts, recipes, and playbooks locally or on remote machines" })
    .args([
      {
        name: "input",
        type: "string",
        description: "Script file, recipe name, or @dx/<built-in>",
      },
    ])
    .flags({
      on: {
        type: "string",
        description: "Target machine(s): slug, comma-separated, tag:<name>, or @inventory:<group>",
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
        description: "Apply even if already applied",
      },
      watch: {
        type: "boolean",
        alias: "w",
        description: "Re-run script on file changes (TS/JS only)",
      },
      env: {
        type: "string",
        description: "Secret environment scope (production, development, preview)",
      },
      secrets: {
        type: "boolean",
        description: "Inject secrets (use --no-secrets to disable)",
      },
    })
    .run(async ({ args, flags }) => {
      const f = toDxFlags(flags);
      const input = args.input as string | undefined;

      if (!input) {
        console.log(styleBold("dx run") + " — Universal execute\n");
        console.log("Usage:");
        console.log("  dx run <script.ts>                    Run TypeScript/JavaScript locally");
        console.log("  dx run <script.sh> --on <machine>     Run shell script on remote machine");
        console.log("  dx run @dx/<tool> --on <machine>      Run built-in recipe");
        console.log("  dx run <recipe> --on <machine>        Run custom recipe");
        console.log("  dx run list                           List available recipes");
        console.log("  dx run show <recipe>                  Show recipe details");
        console.log("");
        console.log("Flags:");
        console.log("  --on <target>     Machine(s): slug, slug1,slug2, tag:<name>, @inventory:<group>");
        console.log("  --set key=value   Set recipe parameter (repeatable)");
        console.log("  --dry-run         Check state without applying");
        console.log("  --force           Re-apply even if already applied");
        console.log("  --watch           Re-run on file changes (scripts only)");
        return;
      }

      try {
        const {
          detectInputType,
          runScriptLocal,
          runShellScriptRemote,
          runRecipe,
        } = await import("../handlers/run.js");
        const { expandTargets } = await import("../lib/machine-target.js");
        const { resolveRecipe, resolveParams } = await import("../lib/recipe.js");

        const inputType = detectInputType(input);
        const onExpr = flags.on as string | undefined;

        // Collect --set flags (may be string or repeated)
        const rawSet = flags.set;
        const setFlags: string[] = !rawSet
          ? []
          : Array.isArray(rawSet)
            ? rawSet as string[]
            : [rawSet as string];

        switch (inputType) {
          case "script-ts": {
            if (onExpr) {
              // Remote TS execution — not yet supported in v1
              exitWithError(
                f,
                "Remote TypeScript execution is not yet supported.\n" +
                "  Use a .sh script for remote execution, or run the recipe system:\n" +
                "  dx run @dx/docker --on <machine>"
              );
            }
            // Local TS/JS execution — delegate to existing script handler
            const allArgs = process.argv;
            const ddIdx = allArgs.indexOf("--");
            const passthrough = ddIdx >= 0 ? allArgs.slice(ddIdx + 1) : [];
            await runScriptLocal(input, {
              watch: flags.watch as boolean | undefined,
              passthrough,
              environment: flags.env as string | undefined,
              noSecrets: flags.secrets === false ? true : undefined,
            });
            break;
          }

          case "script-sh": {
            if (!onExpr) {
              // Local shell script — just run it
              const { execFileSync } = await import("node:child_process");
              try {
                execFileSync("bash", [input], { stdio: "inherit" });
              } catch (err: any) {
                if (err.status != null) process.exit(err.status);
                throw err;
              }
              break;
            }
            // Remote shell script
            const targets = await expandTargets(onExpr);
            for (const target of targets) {
              console.log(styleMuted(`Running on ${styleBold(target.name)}...`));
              await runShellScriptRemote(input, target, {
                DX_MACHINE_NAME: target.name,
                DX_MACHINE_HOST: target.host,
                DX_MACHINE_USER: target.user,
              });
              console.log(styleSuccess(`Done on ${target.name}`));
            }
            break;
          }

          case "recipe": {
            if (!onExpr) {
              exitWithError(
                f,
                `Recipe "${input}" requires a target machine.\n` +
                "  Usage: dx run " + input + " --on <machine>"
              );
            }

            const recipe = resolveRecipe(input);
            const paramEnv = resolveParams(recipe.manifest, setFlags);
            const targets = await expandTargets(onExpr);

            await runRecipe({
              recipeName: input,
              targets,
              paramEnv,
              dryRun: flags["dry-run"] as boolean | undefined,
              force: flags.force as boolean | undefined,
            });
            break;
          }

          default:
            exitWithError(
              f,
              `Cannot determine how to run "${input}".\n` +
              "  Expected: .ts/.js/.sh file, recipe name (@dx/<name>), or recipe directory.\n" +
              "  List recipes: dx run list"
            );
        }
      } catch (err) {
        exitWithError(f, err instanceof Error ? err.message : String(err));
      }
    })

    // ── dx run list ──
    .command("list", (c) =>
      c
        .meta({ description: "List available recipes" })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags);
          const { listRecipes } = await import("../lib/recipe.js");
          const { printTable } = await import("../output.js");

          const recipes = listRecipes();

          if (f.json) {
            console.log(JSON.stringify({ success: true, data: recipes }, null, 2));
            return;
          }

          if (recipes.length === 0) {
            console.log("No recipes found.");
            return;
          }

          const rows = recipes.map((r) => [
            styleBold(r.name),
            r.description,
            styleMuted(r.source),
          ]);
          console.log(printTable(["Name", "Description", "Source"], rows));
        })
    )

    // ── dx run show <recipe> ──
    .command("show", (c) =>
      c
        .meta({ description: "Show recipe details" })
        .args([{ name: "name", type: "string", required: true, description: "Recipe name" }])
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags);
          const { resolveRecipe } = await import("../lib/recipe.js");

          try {
            const recipe = resolveRecipe(args.name as string);
            const m = recipe.manifest;

            if (f.json) {
              console.log(JSON.stringify({ success: true, data: m }, null, 2));
              return;
            }

            console.log(styleBold(m.name) + styleMuted(` (${recipe.source})`));
            console.log(m.description);
            console.log("");

            if (m.requires?.length) {
              console.log("Requires: " + m.requires.join(", "));
            }
            if (m.os?.length) {
              console.log("OS: " + m.os.join(", "));
            }

            const params = m.params ?? {};
            if (Object.keys(params).length > 0) {
              console.log("\nParameters:");
              for (const [key, spec] of Object.entries(params)) {
                const req = spec.required ? " (required)" : "";
                const def = spec.default !== undefined ? ` [default: ${spec.default}]` : "";
                console.log(`  --set ${key}=<${spec.type}>${req}${def}`);
                if (spec.description) {
                  console.log(styleMuted(`    ${spec.description}`));
                }
              }
            }

            console.log(styleMuted(`\nHas verify.sh: ${recipe.verifyScript ? "yes" : "no"}`));
            console.log(styleMuted(`Has uninstall.sh: ${recipe.uninstallScript ? "yes" : "no"}`));
          } catch (err) {
            exitWithError(f, err instanceof Error ? err.message : String(err));
          }
        })
    );
}
