/**
 * dx pkg list — show linked and contributed packages.
 */

import { existsSync } from "node:fs"
import { join } from "node:path"
import { capture } from "../../lib/subprocess.js"
import { printTable } from "../../output.js"
import { PackageState } from "./state.js"
import { gitRepoDir, gitStatusSummary, shortSource } from "./detect.js"

export async function pkgList(root: string, json?: boolean): Promise<void> {
  const pm = new PackageState(root)
  const packages = pm.all()
  const names = Object.keys(packages).sort()

  if (names.length === 0) {
    console.log("No packages currently linked or contributed.")
    console.log(
      "Use 'dx pkg link <source>' or 'dx pkg contribute <pkg>' to get started."
    )
    return
  }

  if (json) {
    console.log(JSON.stringify({ success: true, data: packages }, null, 2))
    return
  }

  const rows: string[][] = []
  for (const name of names) {
    const entry = packages[name]
    const pkgDir = join(root, entry.local_path)
    let statusStr: string
    let changes: string

    if (!existsSync(pkgDir)) {
      statusStr = "missing"
      changes = "-"
    } else if (entry.mode === "contribute") {
      const repoDir = entry.repo_path ? join(root, entry.repo_path) : undefined
      if (repoDir && existsSync(repoDir)) {
        const { status, count } = await gitStatusSummary(entry, root)
        if (status === "modified") {
          statusStr = "local ahead"
          changes = `${count} file${count !== 1 ? "s" : ""}`
        } else {
          statusStr = "synced"
          changes = "-"
        }
      } else {
        statusStr = "no staging clone"
        changes = "-"
      }
    } else {
      const { status, count } = await gitStatusSummary(entry, root)
      if (status === "modified") {
        statusStr = "modified"
        changes = `${count} file${count !== 1 ? "s" : ""}`
      } else {
        statusStr = status
        changes = "-"
      }
    }

    // Branch info
    const checkoutBranch = entry.checkout_branch ?? "-"
    const baseBranch = entry.branch ?? "main"
    let branchDisplay = checkoutBranch

    const repoDir = gitRepoDir(entry, root)
    if (existsSync(repoDir)) {
      const result = await capture(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"],
        { cwd: repoDir }
      )
      if (result.exitCode === 0) {
        const actual = result.stdout.trim()
        if (actual !== checkoutBranch) {
          branchDisplay = `${actual} (!)`
        }
      }
    }

    rows.push([
      name,
      entry.mode ?? "link",
      entry.type ?? "?",
      `${branchDisplay} (${baseBranch})`,
      shortSource(entry.source),
      statusStr,
      changes,
    ])
  }

  console.log(
    printTable(
      [
        "Package",
        "Mode",
        "Type",
        "Branch (base)",
        "Source",
        "Status",
        "Changes",
      ],
      rows
    )
  )
}
