import type { DxBase } from "../dx-root.js";
import { styleMuted } from "./list-helpers.js";

const DEPRECATION = `dx worktree is deprecated. Use dx workspace instead:

  dx worktree create <branch>  →  dx workspace create <name> --tier worktree --branch <branch>
  dx worktree list             →  dx workspace list --tier worktree
  dx worktree remove <name>    →  dx workspace delete <name>
`;

export function worktreeCommand(app: DxBase) {
  return app
    .sub("worktree")
    .meta({ description: "Git worktree management (deprecated — use dx workspace)" })

    .command("create", (c) =>
      c
        .meta({ description: "(deprecated) Create a worktree" })
        .args([
          {
            name: "branch",
            type: "string",
            required: true,
            description: "Branch name",
          },
        ])
        .flags({
          path: { type: "string", description: "Directory path" },
          force: { type: "boolean", description: "Skip validation" },
        })
        .run(() => {
          console.log(styleMuted(DEPRECATION));
          process.exit(0);
        })
    )

    .command("list", (c) =>
      c
        .meta({ description: "(deprecated) List worktrees" })
        .run(() => {
          console.log(styleMuted(DEPRECATION));
          process.exit(0);
        })
    )

    .command("remove", (c) =>
      c
        .meta({ description: "(deprecated) Remove a worktree" })
        .args([
          {
            name: "target",
            type: "string",
            required: true,
            description: "Worktree path or branch",
          },
        ])
        .flags({
          force: { type: "boolean", description: "Force removal" },
        })
        .run(() => {
          console.log(styleMuted(DEPRECATION));
          process.exit(0);
        })
    );
}
