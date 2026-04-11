/**
 * dx pkg remove — permanently delete a package from the workspace.
 */

import { createInterface } from "node:readline/promises"
import { existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import { PackageState } from "./state.js"
import { removeGitignoreEntry } from "./gitignore.js"
import { unintegrateNpm, unintegrateJava } from "./integrate.js"

export interface RemoveOptions {
  package: string
  yes?: boolean
  verbose?: boolean
}

export async function pkgRemove(
  root: string,
  opts: RemoveOptions
): Promise<void> {
  const pm = new PackageState(root)
  const entry = pm.get(opts.package)

  // If tracked, ensure it's been unlinked first (contribute mode keeps files)
  if (entry && entry.mode !== "contribute") {
    throw new Error(
      `Package '${opts.package}' is still linked.\n` +
        "Run 'dx pkg unlink' first, then 'dx pkg remove' to delete the files"
    )
  }

  // Resolve directory
  const pkgDir = entry ? join(root, entry.local_path) : join(root, opts.package)

  if (!existsSync(pkgDir)) {
    // Clean up stale state if it exists
    if (entry) {
      pm.remove(opts.package)
      console.log(`Cleaned up stale state for '${opts.package}'`)
    } else {
      throw new Error(`Package directory not found: ${opts.package}`)
    }
    return
  }

  // Confirm deletion
  if (!opts.yes) {
    console.log(
      `This will permanently delete: ${entry?.local_path ?? opts.package}`
    )
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    })
    try {
      const answer = await rl.question("Are you sure? (y/N) ")
      if (answer.trim().toLowerCase() !== "y") {
        console.log("Aborted")
        return
      }
    } finally {
      rl.close()
    }
  }

  // Remove the directory
  rmSync(pkgDir, { recursive: true })
  console.log(`Deleted ${entry?.local_path ?? opts.package}`)

  // Clean up state if still tracked
  if (entry) {
    // Unintegrate from build system
    if (entry.type === "npm") await unintegrateNpm(root)
    else if (entry.type === "java") unintegrateJava(root, opts.package)

    // Remove .gitignore entry
    removeGitignoreEntry(root, entry.local_path + "/")

    pm.remove(opts.package)
  }

  console.log(`Package '${opts.package}' has been removed`)
}
