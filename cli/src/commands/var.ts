import type { DxBase } from "../dx-root.js";

import { exitWithError } from "../lib/cli-exit.js";
import { toDxFlags } from "./dx-flags.js";
import { setExamples } from "../plugins/examples-plugin.js";

setExamples("var", [
  "$ dx var set APP_NAME myapp              Set a variable (org scope)",
  "$ dx var set REGION us-east --local      Set a local-only variable",
  "$ dx var get APP_NAME                    Get a variable value",
  "$ dx var list                            List variables",
  "$ dx var list --local                    List local variables",
  "$ dx var rm APP_NAME                     Remove a variable",
  "$ dx var set KEY val --scope team --team platform   Set team-scoped variable",
  "$ dx var set KEY val --env production    Set production-only variable",
]);

const SCOPE_FLAGS = {
  local: {
    type: "boolean" as const,
    alias: "l",
    description: "Use local variable store (~/.config/dx/vars.json)",
  },
  scope: {
    type: "string" as const,
    description: "Variable scope: org, team, project (default: org)",
  },
  team: {
    type: "string" as const,
    description: "Team slug (for team scope)",
  },
  project: {
    type: "string" as const,
    description: "Project slug (for project scope)",
  },
  env: {
    type: "string" as const,
    description: "Environment: production, development, preview",
  },
};

export function varCommand(app: DxBase) {
  return app
    .sub("var")
    .meta({ description: "Manage config variables (local and remote)" })
    .command("set", (c) =>
      c
        .meta({ description: "Set a variable" })
        .args([
          { name: "key", type: "string", required: true, description: "Variable key (env var name)" },
          { name: "value", type: "string", required: true, description: "Variable value" },
        ])
        .flags(SCOPE_FLAGS)
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags);
          try {
            const { varSet } = await import("../handlers/var.js");
            await varSet(args.key as string, args.value as string, {
              local: flags.local as boolean | undefined,
              scope: flags.scope as string | undefined,
              team: flags.team as string | undefined,
              project: flags.project as string | undefined,
              env: flags.env as string | undefined,
              json: f.json,
            });
          } catch (err) {
            exitWithError(f, err instanceof Error ? err.message : String(err));
          }
        }),
    )
    .command("get", (c) =>
      c
        .meta({ description: "Get a variable value" })
        .args([
          { name: "key", type: "string", required: true, description: "Variable key" },
        ])
        .flags(SCOPE_FLAGS)
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags);
          try {
            const { varGet } = await import("../handlers/var.js");
            await varGet(args.key as string, {
              local: flags.local as boolean | undefined,
              scope: flags.scope as string | undefined,
              team: flags.team as string | undefined,
              project: flags.project as string | undefined,
              env: flags.env as string | undefined,
              json: f.json,
            });
          } catch (err) {
            exitWithError(f, err instanceof Error ? err.message : String(err));
          }
        }),
    )
    .command("list", (c) =>
      c
        .meta({ description: "List variables" })
        .flags(SCOPE_FLAGS)
        .run(async ({ flags }) => {
          const f = toDxFlags(flags);
          try {
            const { varList } = await import("../handlers/var.js");
            await varList({
              local: flags.local as boolean | undefined,
              scope: flags.scope as string | undefined,
              team: flags.team as string | undefined,
              project: flags.project as string | undefined,
              env: flags.env as string | undefined,
              json: f.json,
            });
          } catch (err) {
            exitWithError(f, err instanceof Error ? err.message : String(err));
          }
        }),
    )
    .command("rm", (c) =>
      c
        .meta({ description: "Remove a variable" })
        .args([
          { name: "key", type: "string", required: true, description: "Variable key" },
        ])
        .flags(SCOPE_FLAGS)
        .run(async ({ args, flags }) => {
          const f = toDxFlags(flags);
          try {
            const { varRemove } = await import("../handlers/var.js");
            await varRemove(args.key as string, {
              local: flags.local as boolean | undefined,
              scope: flags.scope as string | undefined,
              team: flags.team as string | undefined,
              project: flags.project as string | undefined,
              env: flags.env as string | undefined,
              json: f.json,
            });
          } catch (err) {
            exitWithError(f, err instanceof Error ? err.message : String(err));
          }
        }),
    );
}
