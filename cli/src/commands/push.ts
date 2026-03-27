import { spawnSync } from "node:child_process";

import type { DxBase } from "../dx-root.js";
import { exitWithError } from "../lib/cli-exit.js";
import { gitPushAuto } from "../lib/git-push.js";

import { toDxFlags } from "./dx-flags.js";
import { setExamples } from "../plugins/examples-plugin.js";

setExamples("push", [
  "$ dx push                  Push artifacts",
  "$ dx push --pr             Push and open PR",
]);

export function pushCommand(app: DxBase) {
  return app
    .sub("push")
    .meta({ description: "Push artifacts" })
    .flags({
      pr: {
        type: "boolean",
        description: "Run gh pr create after a successful push (requires GitHub CLI)",
      },
    })
    .run(({ flags }) => {
      const f = toDxFlags(flags);
      try {
        const cwd = process.cwd();
        gitPushAuto(cwd);
        if (flags.pr) {
          const gh = spawnSync("gh", ["pr", "create"], {
            cwd,
            stdio: "inherit",
          });
          if (gh.status !== 0) {
            throw new Error("gh pr create failed (install gh CLI and authenticate)");
          }
        }
        if (f.json) {
          console.log(JSON.stringify({ success: true, exitCode: 0 }));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        exitWithError(f, msg);
      }
    });
}
