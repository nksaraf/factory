/**
 * dx pkg push — commit, push, and create PR for package changes.
 */

import { existsSync } from "node:fs";
import { run } from "../../lib/subprocess.js";
import { PackageState } from "./state.js";
import { gitRepoDir, gitStatusSummary, shortSource } from "./detect.js";

export interface PushOptions {
  package: string;
  branch?: string;
  message?: string;
  verbose?: boolean;
}

export async function pkgPush(root: string, opts: PushOptions): Promise<void> {
  const pm = new PackageState(root);
  let entry = pm.get(opts.package);
  if (!entry) {
    throw new Error(
      `Package '${opts.package}' is not tracked (checked out or contributed)`
    );
  }

  // Switch branch if override provided
  if (opts.branch) {
    const repoDir = gitRepoDir(entry, root);
    const result = run("git", ["checkout", opts.branch], { cwd: repoDir });
    if (result.status !== 0) {
      throw new Error(`Failed to switch to branch '${opts.branch}'`);
    }
    entry.checkout_branch = opts.branch;
    pm.add(opts.package, entry);
    entry = pm.get(opts.package)!;
  }

  const pkgDir = root + "/" + entry.local_path;
  if (!existsSync(pkgDir)) {
    throw new Error(`Package directory missing: ${entry.local_path}`);
  }

  const repoDir = gitRepoDir(entry, root);

  // For contributed packages, sync local files to staging clone first
  if (entry.mode === "contribute") {
    const { syncToStaging } = await import("./contribute.js");
    if (!syncToStaging(root, entry)) {
      throw new Error(
        "Sync to staging failed. Run 'dx pkg pull' to reconcile."
      );
    }
  }

  // Check for changes
  const { status, count } = gitStatusSummary(entry, root);
  if (status === "clean") {
    // Check for committed but unpushed changes
    const compareBranch = entry.checkout_branch ?? entry.branch;
    const unpushedResult = run(
      "git",
      ["log", "--oneline", `origin/${compareBranch}..HEAD`],
      { cwd: repoDir }
    );
    if (
      unpushedResult.status === 0 &&
      !unpushedResult.stdout.trim()
    ) {
      console.log(`No changes to push for ${opts.package}`);
      return;
    }
  }

  const message = opts.message ?? `dx: update ${opts.package}`;

  // Stage and commit (only if there are unstaged changes)
  if (status !== "clean") {
    console.log("Staging and committing changes...");
    if (entry.source_path) {
      run("git", ["add", entry.source_path], { cwd: repoDir });
    } else {
      run("git", ["add", "-A"], { cwd: repoDir });
    }
    const commitResult = run("git", ["commit", "-m", message], {
      cwd: repoDir,
    });
    if (commitResult.status !== 0) {
      throw new Error(
        `Commit failed:\n${commitResult.stderr || commitResult.stdout}`
      );
    }
    console.log("Changes committed");
  }

  // Push
  const branch = entry.checkout_branch ?? `dx/${opts.package}-dev`;
  console.log(`Pushing branch ${branch}...`);
  const pushResult = run("git", ["push", "-u", "origin", branch], {
    cwd: repoDir,
    verbose: opts.verbose,
  });
  if (pushResult.status !== 0) {
    throw new Error(
      `Push failed:\n${pushResult.stderr || pushResult.stdout}`
    );
  }
  console.log("Pushed to remote");

  // Create PR via gh CLI
  const ghCheck = run("which", ["gh"]);
  if (ghCheck.status === 0) {
    console.log("Creating pull request...");
    const targetBranch = entry.branch ?? "main";
    const prResult = run(
      "gh",
      [
        "pr",
        "create",
        "--title",
        `Update ${opts.package}`,
        "--body",
        `Changes to \`${opts.package}\` made via \`dx pkg\` from the project workspace.`,
        "--base",
        targetBranch,
        "--head",
        branch,
      ],
      { cwd: repoDir }
    );
    if (prResult.status === 0) {
      console.log(`Pull request created: ${prResult.stdout.trim()}`);
    } else if (
      prResult.stdout.toLowerCase().includes("already exists") ||
      prResult.stderr.toLowerCase().includes("already exists")
    ) {
      console.log("A pull request already exists for this branch");
      const urlResult = run(
        "gh",
        ["pr", "view", "--json", "url", "-q", ".url"],
        { cwd: repoDir }
      );
      if (urlResult.status === 0 && urlResult.stdout.trim()) {
        console.log(`  ${urlResult.stdout.trim()}`);
      }
    } else {
      console.warn(
        `Could not create PR: ${prResult.stderr || prResult.stdout}`
      );
      console.log(`Create one manually for branch '${branch}'`);
    }
  } else {
    console.log("gh CLI not found — create a PR manually:");
    console.log(`  Branch: ${branch}`);
    console.log(`  Repo:   ${shortSource(entry.source)}`);
  }
}
