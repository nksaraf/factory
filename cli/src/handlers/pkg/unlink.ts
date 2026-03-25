/**
 * dx pkg unlink — remove a locally checked-out package.
 */

import { existsSync, lstatSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { PackageState } from "./state.js";
import { gitStatusSummary } from "./detect.js";
import { removeGitignoreEntry } from "./gitignore.js";
import { unintegrateNpm, unintegrateJava } from "./integrate.js";

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
    const { status, count } = gitStatusSummary(entry, root);
    if (status === "modified") {
      throw new Error(
        `Package '${opts.package}' has ${count} uncommitted change(s)\n` +
          "Use 'dx pkg push' first, or 'dx pkg unlink --force' to discard"
      );
    }
  }

  // For contributed packages, keep local files (they're real source)
  if (entry.mode === "contribute") {
    console.log(
      `Keeping local files at ${entry.local_path} (contributed package)`
    );
  } else {
    // lstatSync doesn't follow symlinks, so use it to detect broken symlinks too
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
  }

  // Remove full clone for subpath packages
  if (entry.repo_path) {
    const fullRepo = join(root, entry.repo_path);
    if (existsSync(fullRepo)) {
      rmSync(fullRepo, { recursive: true });
      console.log(`Removed repo clone ${entry.repo_path}`);
    }
  }

  // Unintegrate
  if (entry.type === "npm") unintegrateNpm(root);
  else if (entry.type === "java") unintegrateJava(root, opts.package);

  // Remove .gitignore entry
  removeGitignoreEntry(root, entry.local_path + "/");

  // Remove from state
  pm.remove(opts.package);
  console.log(`Package '${opts.package}' removed from workspace`);
}
