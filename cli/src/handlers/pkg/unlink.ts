/**
 * dx pkg unlink — remove a locally checked-out package.
 */

import { existsSync, lstatSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { PackageState } from "./state.js";
import { gitStatusSummary } from "./detect.js";
import { removeGitignoreEntry } from "./gitignore.js";
import { unintegrateNpm, unintegrateJava } from "./integrate.js";
import { removeWorktree } from "./shared-repo.js";
import { capture } from "../../lib/subprocess.js";

export interface UnlinkOptions {
  package: string;
  force?: boolean;
  verbose?: boolean;
}

export async function pkgUnlink(
  root: string,
  opts: UnlinkOptions
): Promise<void> {
  const pm = new PackageState(root);
  const entry = pm.get(opts.package);
  if (!entry) {
    throw new Error(`Package '${opts.package}' is not checked out`);
  }

  const pkgDir = join(root, entry.local_path);

  // Check for uncommitted changes (scoped to source_path)
  if (!opts.force) {
    const { status, count } = await gitStatusSummary(entry, root);
    if (status === "modified") {
      throw new Error(
        `Package '${opts.package}' has ${count} uncommitted change(s)\n` +
          "Use 'dx pkg push' first, or 'dx pkg unlink --force' to discard"
      );
    }
  }

  // For contributed packages, keep local files (they're real source)
  // and clean up the staging repo if the PR has been merged.
  if (entry.mode === "contribute") {
    console.log(
      `Keeping local files at ${entry.local_path} (contributed package)\n` +
        `  To delete local files: dx pkg remove ${opts.package}`
    );

    // Clean up the staging repo clone
    const repoDir = entry.repo_path ? join(root, entry.repo_path) : undefined;
    if (repoDir && existsSync(repoDir)) {
      // Check if the contribute PR has been merged
      let prMerged = false;
      const ghCheck = await capture(["which", "gh"]);
      if (ghCheck.exitCode === 0) {
        const prState = await capture(
          [
            "gh", "pr", "view", entry.checkout_branch,
            "--json", "state", "-q", ".state",
          ],
          { cwd: repoDir }
        );
        if (prState.exitCode === 0) {
          prMerged = prState.stdout.trim() === "MERGED";
        }
      }

      if (prMerged) {
        rmSync(repoDir, { recursive: true });
        console.log(`Removed staging repo ${entry.repo_path} (PR merged)`);
      } else if (opts.force) {
        rmSync(repoDir, { recursive: true });
        console.warn(
          `Removed staging repo ${entry.repo_path} (PR not merged, forced)`
        );
      } else {
        throw new Error(
          `PR for '${opts.package}' has not been merged yet.\n` +
            "Use 'dx pkg unlink --force' to remove anyway"
        );
      }
    }
  } else if (entry.is_worktree && entry.shared_repo) {
    // Worktree-based: remove symlink (if monorepo) then remove worktree
    let isSymlink = false;
    try {
      isSymlink = lstatSync(pkgDir).isSymbolicLink();
    } catch {}

    if (isSymlink) {
      unlinkSync(pkgDir);
      console.log(`Removed symlink ${entry.local_path}`);
    }

    // The worktree is at repo_path (monorepo) or local_path (single-repo)
    const worktreePath = entry.repo_path
      ? join(root, entry.repo_path)
      : pkgDir;

    if (existsSync(worktreePath)) {
      await removeWorktree(entry.shared_repo, worktreePath);
      console.log(`Removed worktree ${entry.repo_path ?? entry.local_path}`);
    }
  } else {
    // Legacy: direct rmSync
    let isSymlink = false;
    let exists = false;
    try {
      const stat = lstatSync(pkgDir);
      exists = true;
      isSymlink = stat.isSymbolicLink();
    } catch {}

    if (exists) {
      if (isSymlink) {
        unlinkSync(pkgDir);
      } else {
        rmSync(pkgDir, { recursive: true });
      }
      console.log(`Removed ${entry.local_path}`);
    } else {
      console.warn(
        `Directory ${entry.local_path} already removed, cleaning up state`
      );
    }

    // Remove full clone for subpath packages (legacy)
    if (entry.repo_path) {
      const fullRepo = join(root, entry.repo_path);
      if (existsSync(fullRepo)) {
        rmSync(fullRepo, { recursive: true });
        console.log(`Removed repo clone ${entry.repo_path}`);
      }
    }
  }

  // Unintegrate
  if (entry.type === "npm") await unintegrateNpm(root);
  else if (entry.type === "java") unintegrateJava(root, opts.package);

  // Remove .gitignore entry
  removeGitignoreEntry(root, entry.local_path + "/");

  // Remove from state
  pm.remove(opts.package);
  console.log(`Package '${opts.package}' removed from workspace`);
}
