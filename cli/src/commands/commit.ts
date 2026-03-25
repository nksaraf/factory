import { dirname } from "node:path";

import { findDxYaml } from "@smp/factory-shared/config-loader";
import { defaultConventionsConfig } from "@smp/factory-shared/conventions-schema";
import { loadConventions, validateCommitMessage } from "@smp/factory-shared/conventions";
import { ExitCodes } from "@smp/factory-shared/exit-codes";

import type { DxBase } from "../dx-root.js";
import { exitWithError } from "../lib/cli-exit.js";
import { gitCommit, stageAll } from "../lib/git.js";
import { toDxFlags } from "./dx-flags.js";

export function commitCommand(app: DxBase) {
  return app
    .sub("commit")
    .meta({ description: "Create a commit" })
    .args([
      {
        name: "message",
        type: "string",
        required: true,
        description: "Commit message",
      },
    ])
    .flags({
      all: {
        type: "boolean",
        short: "a",
        description: "Stage all changes before committing",
      },
      force: {
        type: "boolean",
        description: "Allow convention violations",
      },
      reason: {
        type: "string",
        description: "Reason when using --force (logged to stderr)",
      },
    })
    .run(({ args, flags }) => {
      const f = toDxFlags(flags);
      try {
        const dx = findDxYaml(process.cwd());
        const conventions = dx
          ? loadConventions(dirname(dx))
          : defaultConventionsConfig();
        const result = validateCommitMessage(args.message, conventions);
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
            `Convention violation:\n${result.violations.join("\n")}\n\nSuggestions:\n${result.suggestions.join("\n")}\n\nUse --force with --reason to override.`
          );
          process.exit(ExitCodes.CONVENTION_VIOLATION);
        }
        if (!result.valid && flags.force && flags.reason && !f.json) {
          console.error(`Convention override: ${flags.reason}`);
        }
        const cwd = process.cwd();
        if (flags.all) {
          stageAll(cwd);
        }
        const sha = gitCommit(cwd, args.message);
        if (f.json) {
          console.log(
            JSON.stringify({ success: true, sha, short: sha.slice(0, 8) })
          );
        } else {
          console.log(`Created commit ${sha.slice(0, 8)}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        exitWithError(f, msg);
      }
    });
}
