import { basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";

import { findDxYaml } from "@smp/factory-shared/config-loader";
import { defaultConventionsConfig } from "@smp/factory-shared/conventions-schema";
import { loadConventions, validateBranchName } from "@smp/factory-shared/conventions";
import { ExitCodes } from "@smp/factory-shared/exit-codes";

import type { DxBase } from "../dx-root.js";
import { exitWithError } from "../lib/cli-exit.js";
import { hasUncommittedChanges } from "../lib/git.js";
import { printTable } from "../output.js";
import { toDxFlags } from "./dx-flags.js";
import { setExamples } from "../plugins/examples-plugin.js";

setExamples("worktree", [
  "$ dx worktree create feature/x    Create isolated worktree",
  "$ dx worktree list                List worktrees",
  "$ dx worktree remove feature/x    Clean up worktree",
]);

interface WorktreeEntry {
  path: string;
  head: string;
  branch: string;
}

function parseWorktreeList(output: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  const blocks = output.trim().split("\n\n");
  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.trim().split("\n");
    let path = "";
    let head = "";
    let branch = "";
    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        path = line.slice("worktree ".length);
      } else if (line.startsWith("HEAD ")) {
        head = line.slice("HEAD ".length);
      } else if (line.startsWith("branch ")) {
        branch = line.slice("branch refs/heads/".length);
      }
    }
    if (path) {
      entries.push({ path, head, branch });
    }
  }
  return entries;
}

export function worktreeCommand(app: DxBase) {
  return app
    .sub("worktree")
    .meta({ description: "Git worktree management" })

    .command("create", (c) =>
      c
        .meta({ description: "Create a worktree with a new branch" })
        .args([
          {
            name: "branch",
            type: "string",
            required: true,
            description: "Branch name for the new worktree",
          },
        ])
        .flags({
          path: {
            type: "string",
            description:
              "Directory for the worktree (default: ../<project>-<branch>)",
          },
          force: {
            type: "boolean",
            description: "Skip convention validation",
          },
        })
        .run(({ args, flags }) => {
          const f = toDxFlags(flags);
          try {
            if (!flags.force) {
              const dx = findDxYaml(process.cwd());
              const conventions = dx
                ? loadConventions(dirname(dx))
                : defaultConventionsConfig();
              const result = validateBranchName(args.branch, conventions);
              if (!result.valid) {
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
            }

            const worktreePath =
              (flags.path as string) ??
              resolve("..", `${basename(process.cwd())}-${args.branch}`);

            const proc = spawnSync(
              "git",
              ["worktree", "add", worktreePath, "-b", args.branch],
              { cwd: process.cwd(), stdio: "inherit" }
            );
            if (proc.status !== 0) {
              throw new Error(
                `git worktree add failed (exit code ${proc.status})`
              );
            }

            if (f.json) {
              console.log(
                JSON.stringify({
                  success: true,
                  branch: args.branch,
                  path: worktreePath,
                })
              );
            } else {
              console.log(
                `Created worktree at ${worktreePath} on branch ${args.branch}`
              );
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            exitWithError(f, msg);
          }
        })
    )

    .command("list", (c) =>
      c
        .meta({ description: "List worktrees" })
        .run(({ flags }) => {
          const f = toDxFlags(flags);
          try {
            const proc = spawnSync(
              "git",
              ["worktree", "list", "--porcelain"],
              { cwd: process.cwd(), encoding: "utf8" }
            );
            if (proc.status !== 0) {
              throw new Error(
                (proc.stderr || "").trim() || "git worktree list failed"
              );
            }

            const entries = parseWorktreeList(proc.stdout || "");

            if (f.json) {
              console.log(
                JSON.stringify({ success: true, data: entries }, null, 2)
              );
              return;
            }

            if (entries.length === 0) {
              console.log("No worktrees found.");
              return;
            }

            console.log(
              printTable(
                ["Path", "Branch", "Commit"],
                entries.map((e) => [
                  e.path,
                  e.branch || "(detached)",
                  e.head.slice(0, 8),
                ])
              )
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            exitWithError(f, msg);
          }
        })
    )

    .command("remove", (c) =>
      c
        .meta({ description: "Remove a worktree" })
        .args([
          {
            name: "target",
            type: "string",
            required: true,
            description: "Worktree path or branch name",
          },
        ])
        .flags({
          force: {
            type: "boolean",
            description: "Force removal even with uncommitted changes",
          },
        })
        .run(({ args, flags }) => {
          const f = toDxFlags(flags);
          try {
            let worktreePath = args.target as string;

            // If target looks like a branch name (no leading /), resolve it
            if (!worktreePath.startsWith("/")) {
              const proc = spawnSync(
                "git",
                ["worktree", "list", "--porcelain"],
                { cwd: process.cwd(), encoding: "utf8" }
              );
              if (proc.status !== 0) {
                throw new Error(
                  (proc.stderr || "").trim() || "git worktree list failed"
                );
              }
              const entries = parseWorktreeList(proc.stdout || "");
              const match = entries.find((e) => e.branch === worktreePath);
              if (match) {
                worktreePath = match.path;
              }
              // If no match, pass through as-is and let git handle the error
            }

            if (!flags.force && hasUncommittedChanges(worktreePath)) {
              const msg =
                "Worktree has uncommitted changes. Use --force to remove anyway.";
              if (f.json) {
                console.log(
                  JSON.stringify({ success: false, error: msg })
                );
                process.exit(1);
              }
              console.error(msg);
              process.exit(1);
            }

            const gitArgs = ["worktree", "remove", worktreePath];
            if (flags.force) {
              gitArgs.push("--force");
            }

            const proc = spawnSync("git", gitArgs, {
              cwd: process.cwd(),
              stdio: "inherit",
            });
            if (proc.status !== 0) {
              throw new Error(
                `git worktree remove failed (exit code ${proc.status})`
              );
            }

            if (f.json) {
              console.log(
                JSON.stringify({ success: true, path: worktreePath })
              );
            } else {
              console.log(`Removed worktree at ${worktreePath}`);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            exitWithError(f, msg);
          }
        })
    );
}
