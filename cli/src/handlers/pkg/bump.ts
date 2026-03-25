/**
 * dx pkg bump — bump package version.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { PackageState } from "./state.js";
import {
  readVersion,
  writeVersion,
  bumpSemver,
  type BumpKind,
} from "./versioning.js";

export interface BumpOptions {
  package: string;
  level: BumpKind;
  dryRun?: boolean;
  verbose?: boolean;
}

export async function pkgBump(root: string, opts: BumpOptions): Promise<void> {
  const pm = new PackageState(root);
  const entry = pm.get(opts.package);

  let pkgDir: string | undefined;
  let pkgType: string | undefined;

  if (entry) {
    pkgDir = join(root, entry.local_path);
    pkgType = entry.type;
  } else {
    // Try to find by name in packages/
    for (const type of ["npm", "java", "python"]) {
      const candidate = join(root, "packages", type, opts.package);
      if (existsSync(candidate)) {
        pkgDir = candidate;
        pkgType = type;
        break;
      }
    }
  }

  if (!pkgDir || !pkgType) {
    throw new Error(`Package '${opts.package}' not found`);
  }

  const { name, version } = readVersion(pkgDir, pkgType);
  if (!version) {
    throw new Error(`Could not read version for ${opts.package}`);
  }

  const newVersion = bumpSemver(version, opts.level);
  console.log(`${name ?? opts.package}: ${version} → ${newVersion}`);

  if (opts.dryRun) {
    console.log("[dry-run] No changes made");
    return;
  }

  writeVersion(pkgDir, pkgType, newVersion);
  console.log(`Version bumped to ${newVersion}`);
}
