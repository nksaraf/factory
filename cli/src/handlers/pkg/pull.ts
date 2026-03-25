/**
 * dx pkg pull — pull upstream changes for a linked or contributed package.
 */

import { run } from "../../lib/subprocess.js";
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
    const { status, count } = gitStatusSummary(entry, root);
    if (status === "modified") {
      throw new Error(
        `Package '${opts.package}' has ${count} uncommitted change(s)\nCommit or stash changes before switching branches`
      );
    }
    const result = run("git", ["checkout", opts.branch], { cwd: repoDir });
    if (result.status !== 0) {
      throw new Error(`Failed to switch to branch '${opts.branch}'`);
    }
    entry.checkout_branch = opts.branch;
    pm.add(opts.package, entry);
    entry = pm.get(opts.package)!;
  }

  if (entry.mode === "contribute") {
    const { syncFromStaging } = await import("./contribute.js");
    syncFromStaging(root, entry, opts.dryRun);
  } else {
    // Link mode: git pull in the linked repo
    const repoDir = gitRepoDir(entry, root);

    if (opts.dryRun) {
      console.log("Fetching to check for upstream changes...");
      run("git", ["fetch", "origin"], { cwd: repoDir, verbose: opts.verbose });
      const logResult = run(
        "git",
        [
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
    const pullResult = run("git", ["pull"], {
      cwd: repoDir,
      verbose: opts.verbose,
    });
    if (pullResult.status !== 0) {
      throw new Error(
        `Pull failed:\n${pullResult.stderr || pullResult.stdout}`
      );
    }
    console.log("Updated");
  }
}
