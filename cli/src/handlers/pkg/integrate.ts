/**
 * Build system integration — pnpm/npm and Maven (pom.xml) integration.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { exec } from "../../lib/subprocess.js"
import { addPnpmOverride, removePnpmOverride } from "./pnpm-overrides.js"

export interface NpmIntegration {
  /** Linked source's npm name (from its package.json#name). */
  npmName?: string
  /** Path of the linked source relative to the workspace root. */
  localPath: string
}

/**
 * Wire a linked source into the workspace via pnpm.overrides at the root,
 * then run `pnpm install`. Skips override + install when there's no
 * package.json at the root.
 */
export async function integrateNpm(
  root: string,
  npm?: NpmIntegration
): Promise<void> {
  if (!existsSync(join(root, "package.json"))) return

  if (npm?.npmName) {
    addPnpmOverride(root, npm.npmName, npm.localPath)
  }
  await exec(["pnpm", "install"], { cwd: root })
}

/**
 * Remove a linked source's pnpm.overrides entry (if recorded) and run
 * `pnpm install` so workspaces re-resolve.
 */
export async function unintegrateNpm(
  root: string,
  npmName?: string
): Promise<void> {
  if (!existsSync(join(root, "package.json"))) return

  if (npmName) {
    removePnpmOverride(root, npmName)
  }
  await exec(["pnpm", "install"], { cwd: root })
}

/** Add module to packages/java/pom.xml and run mvn install. */
export async function integrateJava(
  root: string,
  pkgName: string
): Promise<void> {
  const pomPath = join(root, "packages", "java", "pom.xml")
  if (!existsSync(pomPath)) {
    console.warn("packages/java/pom.xml not found, skipping Maven integration")
    return
  }

  let content = readFileSync(pomPath, "utf8")
  const moduleEntry = `        <module>${pkgName}</module>`

  if (content.includes(moduleEntry)) {
    console.log(`Module ${pkgName} already in pom.xml`)
  } else {
    content = content.replace(
      "    </modules>",
      `${moduleEntry}\n    </modules>`
    )
    writeFileSync(pomPath, content)
    console.log(`Added module ${pkgName} to packages/java/pom.xml`)
  }

  await exec(["mvn", "install", "-pl", pkgName, "-DskipTests"], {
    cwd: join(root, "packages", "java"),
  })
}

/** Remove module from packages/java/pom.xml. */
export function unintegrateJava(root: string, pkgName: string): void {
  const pomPath = join(root, "packages", "java", "pom.xml")
  if (!existsSync(pomPath)) return

  let content = readFileSync(pomPath, "utf8")
  const pattern = new RegExp(
    `\\n?\\s*<module>${pkgName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</module>`
  )
  const newContent = content.replace(pattern, "")
  if (newContent !== content) {
    writeFileSync(pomPath, newContent)
    console.log(`Removed module ${pkgName} from packages/java/pom.xml`)
  }
}
