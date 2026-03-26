import { dirname } from "node:path";

import { findDxYaml } from "@smp/factory-shared/config-loader";
import { defaultConventionsConfig } from "@smp/factory-shared/conventions-schema";
import { loadConventions, validateBranchName } from "@smp/factory-shared/conventions";
import { ExitCodes } from "@smp/factory-shared/exit-codes";

import type { DxBase } from "../dx-root.js";
import { exitWithError } from "../lib/cli-exit.js";
import { createBranch, listBranches } from "../lib/git.js";
import { toDxFlags } from "./dx-flags.js";
import { setExamples } from "../plugins/examples-plugin.js";

setExamples("branch", [
  "$ dx branch create feature/auth    Create a new branch",
  "$ dx branch list                   List branches",
]);

export function branchCommand(app: DxBase) {
  return app
    .sub("branch")
    .meta({ description: "Branch management" })
    .command("create", (c) =>
      c
        .meta({ description: "Create and check out a branch" })
        .args([
          {
            name: "name",
            type: "string",
            required: true,
            description: "Branch name",
          },
        ])
        .flags({
          force: {
            type: "boolean",
            description: "Skip convention validation",
          },
        })
        .run(({ args, flags }) => {
          const f = toDxFlags(flags);
          try {
            const dx = findDxYaml(process.cwd());
            const conventions = dx
              ? loadConventions(dirname(dx))
              : defaultConventionsConfig();
            const result = validateBranchName(args.name, conventions);
            if (!result.valid && !flags.force) {
              if (f.json) {
                console.log(
                  JSON.stringify({
                    success: false,
                    error: {
                      code: "CONVENTION_VIOLATION",
                      violations: result.violations,
                      suggestions: result.suggestions,
                    },
                    exitCode: ExitCodes.CONVENTION_VIOLATION,
                  })
                );
                process.exit(ExitCodes.CONVENTION_VIOLATION);
              }
              console.error(
                `Convention violation:\n${result.violations.join("\n")}\n\nSuggestions:\n${result.suggestions.join("\n")}\n\nUse --force to skip validation.`
              );
              process.exit(ExitCodes.CONVENTION_VIOLATION);
            }
            createBranch(process.cwd(), args.name);
            if (f.json) {
              console.log(
                JSON.stringify({ success: true, branch: args.name, exitCode: 0 })
              );
            } else {
              console.log(`Switched to new branch ${args.name}`);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            exitWithError(f, msg);
          }
        })
    )
    .command("list", (c) =>
      c.meta({ description: "List local branches" }).run(({ flags }) => {
        const f = toDxFlags(flags);
        try {
          const out = listBranches(process.cwd());
          if (f.json) {
            console.log(JSON.stringify({ success: true, branches: out.split("\n") }));
          } else {
            console.log(out);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          exitWithError(f, msg);
        }
      })
    );
}
