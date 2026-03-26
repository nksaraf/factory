/**
 * dx pkg link — check out an external package for local development.
 *
 * Uses a shared bare clone at ~/.dx/shared-repos/ with git worktrees
 * so multiple workspaces can link the same repo without redundant clones.
 */

import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { join, relative } from "node:path";
import { generateBranchSlug } from "@smp/factory-shared/slug";
import { capture } from "../../lib/subprocess.js";
import { PackageState, type PackageEntry } from "./state.js";
import {
  resolveSource,
  deriveName,
  targetDir,
  shortSource,
} from "./detect.js";
import { addGitignoreEntry } from "./gitignore.js";
import { integrateNpm, integrateJava } from "./integrate.js";
import {
  ensureSharedClone,
  addWorktree,
  detectPkgTypeFromBare,
} from "./shared-repo.js";

export interface LinkOptions {
  source: string;
  path?: string;
  as?: string;
  ref?: string;
  branch?: string;
  verbose?: boolean;
}

export async function pkgLink(root: string, opts: LinkOptions): Promise<void> {
  const gitUrl = resolveSource(opts.source);
  const name = deriveName(opts.source, opts.path, opts.as);

  console.log(`Checking out ${name} from ${shortSource(gitUrl)}...`);

  // 1. Ensure shared bare clone exists and is up-to-date
  const sharedRepo = await ensureSharedClone(gitUrl, {
    verbose: opts.verbose,
  });

  // 2. Detect the default branch from the bare clone
  const defaultBranch = await resolveDefaultBranch(sharedRepo, opts.ref);

  // 3. Detect package type from bare repo (no worktree needed)
  const startPoint = opts.ref ?? defaultBranch;
  const pkgType = await detectPkgTypeFromBare(sharedRepo, startPoint, opts.path);
  if (!pkgType) {
    throw new Error(
      "Could not detect package type (no package.json, pom.xml, or pyproject.toml found)",
    );
  }

  // 4. Check target doesn't already exist
  const target = targetDir(root, pkgType, name);
  if (existsSync(target)) {
    throw new Error(
      `Package directory already exists: ${relative(root, target)}`,
    );
  }

  // 5. Generate unique branch name
  const checkoutBranch = opts.branch ?? `dx/${name}-dev-${generateBranchSlug()}`;

  mkdirSync(join(target, ".."), { recursive: true });

  let repoPath: string | undefined;

  if (opts.path) {
    // Monorepo source: worktree in .dx/pkg-repos/<name>/, symlink subpath
    const reposDir = join(root, ".dx", "pkg-repos");
    mkdirSync(reposDir, { recursive: true });
    const worktreeDest = join(reposDir, name);

    await addWorktree(sharedRepo, worktreeDest, checkoutBranch, startPoint);

    // Verify the subpath exists in the worktree
    const pkgSource = join(worktreeDest, opts.path);
    if (!existsSync(pkgSource)) {
      throw new Error(`Path ${opts.path} does not exist in the cloned repo`);
    }

    // Symlink the subpath into packages/<type>/<name>/
    symlinkSync(pkgSource, target);
    repoPath = relative(root, worktreeDest);
  } else {
    // Single-repo source: worktree IS the package directory
    await addWorktree(sharedRepo, target, checkoutBranch, startPoint);
  }

  console.log(`Checked out into ${relative(root, target)}`);

  // Save state
  const pm = new PackageState(root);
  const entry: PackageEntry = {
    source: gitUrl,
    source_path: opts.path,
    type: pkgType,
    local_path: relative(root, target),
    branch: defaultBranch,
    checkout_branch: checkoutBranch,
    checked_out_at: new Date().toISOString(),
    mode: "link",
    shared_repo: sharedRepo,
    is_worktree: true,
  };
  if (repoPath) entry.repo_path = repoPath;
  pm.add(name, entry);

  // Integrate with build system
  if (pkgType === "npm") await integrateNpm(root);
  else if (pkgType === "java") await integrateJava(root, name);

  // Add to .gitignore
  addGitignoreEntry(root, relative(root, target) + "/");

  console.log(`Package ${name} is ready for development`);
  console.log(`  Branch: ${checkoutBranch}`);
  console.log(`  Edit files in ${relative(root, target)}/`);
  console.log(`  Run 'dx pkg diff ${name}' to see changes`);
  console.log(`  Run 'dx pkg push ${name}' when ready to submit`);
}

/**
 * Resolve the default branch name from the bare clone.
 * If a ref override is provided, returns that instead.
 */
async function resolveDefaultBranch(
  sharedRepo: string,
  refOverride?: string,
): Promise<string> {
  if (refOverride) return refOverride;

  // In a bare clone, HEAD points to the default branch
  const result = await capture(
    ["git", "symbolic-ref", "--short", "HEAD"],
    { cwd: sharedRepo },
  );
  return result.exitCode === 0 ? result.stdout.trim() : "main";
}
