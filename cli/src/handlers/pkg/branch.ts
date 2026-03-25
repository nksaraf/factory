/**
 * dx pkg branch — list, switch, or create branches for a linked package.
 */

import { existsSync } from "node:fs";
import { run } from "../../lib/subprocess.js";
import { PackageState } from "./state.js";
import { gitRepoDir, gitStatusSummary } from "./detect.js";

export interface BranchOptions {
  package: string;
  switch?: string;
  create?: string;
  verbose?: boolean;
}

export async function pkgBranch(
  root: string,
  opts: BranchOptions
): Promise<void> {
  const pm = new PackageState(root);
  const entry = pm.get(opts.package);
  if (!entry) {
    throw new Error(`Package '${opts.package}' is not tracked`);
  }

  const repoDir = gitRepoDir(entry, root);

  if (opts.create) {
    createBranch(root, pm, opts.package, entry, repoDir, opts.create);
    return;
  }

  if (opts.switch) {
    switchBranch(root, pm, opts.package, entry, repoDir, opts.switch);
    return;
  }

  // Default: list branches
  listBranches(repoDir, entry);
}

function guardDirtyState(
  entry: ReturnType<PackageState["get"]>,
  root: string,
  name: string
): void {
  if (!entry) return;
  const { status, count } = gitStatusSummary(entry, root);
  if (status === "modified") {
    throw new Error(
      `Package '${name}' has ${count} uncommitted change(s)\n` +
        "Commit or stash changes before switching branches"
    );
  }
}

function switchBranch(
  root: string,
  pm: PackageState,
  name: string,
  entry: NonNullable<ReturnType<PackageState["get"]>>,
  repoDir: string,
  branch: string
): void {
  // Check if already on this branch
  const currentResult = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: repoDir,
  });
  if (currentResult.status === 0 && currentResult.stdout.trim() === branch) {
    return;
  }

  guardDirtyState(entry, root, name);

  const result = run("git", ["checkout", branch], { cwd: repoDir });
  if (result.status !== 0) {
    throw new Error(
      `Failed to switch to branch '${branch}':\n${result.stderr || result.stdout}`
    );
  }

  entry.checkout_branch = branch;
  pm.add(name, entry);
  console.log(`Switched ${name} to branch ${branch}`);
}

function createBranch(
  root: string,
  pm: PackageState,
  name: string,
  entry: NonNullable<ReturnType<PackageState["get"]>>,
  repoDir: string,
  branch: string
): void {
  guardDirtyState(entry, root, name);

  const result = run("git", ["checkout", "-b", branch], { cwd: repoDir });
  if (result.status !== 0) {
    throw new Error(
      `Failed to create branch '${branch}':\n${result.stderr || result.stdout}`
    );
  }

  entry.checkout_branch = branch;
  pm.add(name, entry);
  console.log(`Created and switched ${name} to branch ${branch}`);
}

function listBranches(
  repoDir: string,
  entry: NonNullable<ReturnType<PackageState["get"]>>
): void {
  const currentResult = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: repoDir,
  });
  const currentBranch =
    currentResult.status === 0 ? currentResult.stdout.trim() : "";

  const listResult = run("git", ["branch", "--list"], { cwd: repoDir });
  if (listResult.status !== 0) {
    throw new Error("Failed to list branches");
  }

  const registeredBranch = entry.checkout_branch ?? "";
  const baseBranch = entry.branch ?? "main";

  for (const line of listResult.stdout.split("\n")) {
    const branchName = line.trim().replace(/^\*\s*/, "").trim();
    if (!branchName) continue;

    const markers: string[] = [];
    if (branchName === currentBranch) markers.push("current");
    if (branchName === registeredBranch) markers.push("registered");
    if (branchName === baseBranch) markers.push("base");

    const suffix = markers.length > 0 ? `  (${markers.join(", ")})` : "";
    const prefix = branchName === currentBranch ? "* " : "  ";
    console.log(`${prefix}${branchName}${suffix}`);
  }

  if (currentBranch && currentBranch !== registeredBranch) {
    console.warn(
      `Current branch '${currentBranch}' differs from registered branch '${registeredBranch}'`
    );
  }
}
