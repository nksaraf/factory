import { spawnSync } from "node:child_process";

import { getCurrentBranch } from "./git.js";

/** Push branch; if there is no upstream, push with -u origin <branch>. */
export function gitPushAuto(cwd: string): void {
  const first = spawnSync("git", ["push"], {
    cwd,
    encoding: "utf8",
  });
  if (first.status === 0) return;
  const err = `${first.stderr || ""}${first.stdout || ""}`;
  if (/no upstream|Set the upstream/i.test(err)) {
    const branch = getCurrentBranch(cwd);
    const second = spawnSync(
      "git",
      ["push", "-u", "origin", branch],
      {
        cwd,
        stdio: "inherit",
      }
    );
    if (second.status !== 0) {
      throw new Error("git push -u origin failed");
    }
    return;
  }
  console.error(err.trim());
  throw new Error("git push failed");
}
