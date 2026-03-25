/**
 * dx pkg link — clone an external package for local development.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { run, runOrThrow } from "../../lib/subprocess.js";
import { PackageState, type PackageEntry } from "./state.js";
import {
  resolveSource,
  deriveName,
  detectPkgType,
  targetDir,
  shortSource,
} from "./detect.js";
import { addGitignoreEntry } from "./gitignore.js";
import { integrateNpm, integrateJava } from "./integrate.js";

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

  const tmpDir = mkdtempSync(join(tmpdir(), "dx-pkg-"));
  try {
    // Clone
    const cloneArgs = ["clone", "--progress"];
    if (opts.ref) cloneArgs.push("--branch", opts.ref);
    cloneArgs.push(gitUrl, join(tmpDir, "repo"));

    runOrThrow("git", cloneArgs, { verbose: opts.verbose });

    const cloned = join(tmpDir, "repo");
    const pkgSource = opts.path ? join(cloned, opts.path) : cloned;

    if (!existsSync(pkgSource)) {
      throw new Error(`Path ${opts.path} does not exist in the cloned repo`);
    }

    // Detect package type
    const pkgType = detectPkgType(pkgSource);
    if (!pkgType) {
      throw new Error(
        "Could not detect package type (no package.json, pom.xml, or pyproject.toml found)"
      );
    }

    const target = targetDir(root, pkgType, name);
    if (existsSync(target)) {
      throw new Error(
        `Package directory already exists: ${relative(root, target)}`
      );
    }

    mkdirSync(join(target, ".."), { recursive: true });

    let repoPath: string | undefined;

    if (opts.path) {
      // Monorepo source: keep full clone in .dx/pkg-repos/<name>/
      const reposDir = join(root, ".dx", "pkg-repos");
      mkdirSync(reposDir, { recursive: true });
      const repoDest = join(reposDir, name);
      if (existsSync(repoDest)) rmSync(repoDest, { recursive: true });
      renameSync(cloned, repoDest);

      // Symlink the subpath
      symlinkSync(join(repoDest, opts.path), target);
      repoPath = relative(root, repoDest);

      // Detect default branch and create dev branch
      const branchResult = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: repoDest,
      });
      const defaultBranch =
        branchResult.status === 0 ? branchResult.stdout.trim() : "main";
      const checkoutBranch = opts.branch ?? `dx/${name}-dev`;
      run("git", ["checkout", "-b", checkoutBranch], { cwd: repoDest });

      saveState(root, name, {
        gitUrl,
        sourcePath: opts.path,
        pkgType,
        target,
        defaultBranch,
        checkoutBranch,
        repoPath,
      });
    } else {
      // Single-repo source: move whole clone into packages/<type>/
      renameSync(cloned, target);

      const branchResult = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: target,
      });
      const defaultBranch =
        branchResult.status === 0 ? branchResult.stdout.trim() : "main";
      const checkoutBranch = opts.branch ?? `dx/${name}-dev`;
      run("git", ["checkout", "-b", checkoutBranch], { cwd: target });

      saveState(root, name, {
        gitUrl,
        pkgType,
        target,
        defaultBranch,
        checkoutBranch,
      });
    }

    console.log(`Cloned into ${relative(root, target)}`);

    // Integrate with build system
    if (pkgType === "npm") integrateNpm(root);
    else if (pkgType === "java") integrateJava(root, name);

    // Add to .gitignore
    addGitignoreEntry(root, relative(root, target) + "/");

    console.log(`Package ${name} is ready for development`);
    console.log(`  Edit files in ${relative(root, target)}/`);
    console.log(`  Run 'dx pkg diff ${name}' to see changes`);
    console.log(`  Run 'dx pkg push ${name}' when ready to submit`);
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

function saveState(
  root: string,
  name: string,
  opts: {
    gitUrl: string;
    sourcePath?: string;
    pkgType: "npm" | "java" | "python";
    target: string;
    defaultBranch: string;
    checkoutBranch: string;
    repoPath?: string;
  }
): void {
  const pm = new PackageState(root);
  const entry: PackageEntry = {
    source: opts.gitUrl,
    source_path: opts.sourcePath,
    type: opts.pkgType,
    local_path: relative(root, opts.target),
    branch: opts.defaultBranch,
    checkout_branch: opts.checkoutBranch,
    checked_out_at: new Date().toISOString(),
    mode: "link",
  };
  if (opts.repoPath) entry.repo_path = opts.repoPath;
  pm.add(name, entry);
}
