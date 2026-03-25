/**
 * dx pkg diff — show changes in a linked package.
 */

import { existsSync } from "node:fs";
import { PackageState } from "./state.js";
import { gitRepoDir } from "./detect.js";
import { runInherit } from "../../lib/subprocess.js";

export interface DiffOptions {
  package: string;
  stat?: boolean;
  verbose?: boolean;
}

export async function pkgDiff(root: string, opts: DiffOptions): Promise<void> {
  const pm = new PackageState(root);
  const entry = pm.get(opts.package);
  if (!entry) {
    throw new Error(
      `Package '${opts.package}' is not checked out\nRun 'dx pkg list' to see checked-out packages`
    );
  }

  const pkgDir = root + "/" + entry.local_path;
  if (!existsSync(pkgDir)) {
    throw new Error(
      `Package directory missing: ${entry.local_path}\nRun 'dx pkg unlink --force ${opts.package}' to clean up state`
    );
  }

  const repoDir = gitRepoDir(entry, root);
  const diffArgs = ["diff"];
  if (opts.stat) diffArgs.push("--stat");
  if (entry.source_path) {
    diffArgs.push("--", entry.source_path);
  }

  const exitCode = runInherit("git", diffArgs, { cwd: repoDir });
  if (exitCode !== 0) process.exit(exitCode);
}
