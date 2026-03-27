/**
 * dx pkg pull — pull upstream changes for a linked or contributed package.
 */

import { exec, capture } from "../../lib/subprocess.js";
import { PackageState } from "./state.js";
import { gitRepoDir, gitStatusSummary } from "./detect.js";

export interface PullOptions {
  package: string;
  branch?: string;
  dryRun?: boolean;
  verbose?: boolean;
}

export async function pkgPull(root: string, opts: PullOptions): Promise<void> {
  const pm = new PackageState(root);
  let entry = pm.get(opts.package);
  if (!entry) {
    throw new Error(`Package '${opts.package}' is not tracked`);
  }

  // Switch branch if override provided
  if (opts.branch) {
    const repoDir = gitRepoDir(entry, root);
    const { status, count } = await gitStatusSummary(entry, root);
    if (status === "modified") {
      throw new Error(
        `Package '${opts.package}' has ${count} uncommitted change(s)\nCommit or stash changes before switching branches`
      );
    }
    await exec(["git", "checkout", opts.branch], { cwd: repoDir });
    entry.checkout_branch = opts.branch;
    pm.add(opts.package, entry);
    entry = pm.get(opts.package)!;
  }

  if (entry.mode === "contribute") {
    const { syncFromStaging } = await import("./contribute.js");
    await syncFromStaging(root, entry, opts.dryRun);
  } else {
    // Link mode: git pull in the linked repo
    const repoDir = gitRepoDir(entry, root);

    if (opts.dryRun) {
      console.log("Fetching to check for upstream changes...");
      await exec(["git", "fetch", "origin"], { cwd: repoDir });
      const logResult = await capture(
        [
          "git",
          "log",
          `HEAD..origin/${entry.branch ?? "main"}`,
          "--oneline",
        ],
        { cwd: repoDir }
      );
      if (logResult.stdout.trim()) {
        console.log(`Upstream commits available:\n${logResult.stdout.trim()}`);
      } else {
        console.log("Already up to date");
      }
      return;
    }

    console.log("Pulling upstream changes...");
    await exec(["git", "pull"], { cwd: repoDir });
    console.log("Updated");
  }
}
