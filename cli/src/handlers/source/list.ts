/**
 * dx source list — show source-linked packages with required/optional status.
 */

import { existsSync } from "node:fs"
import { join } from "node:path"
import { capture } from "../../lib/subprocess.js"
import { printTable } from "../../output.js"
import { PackageState } from "../pkg/state.js"
import { gitRepoDir, gitStatusSummary, shortSource } from "../pkg/detect.js"
import { readSources } from "./sources-config.js"

export async function sourceList(root: string, json?: boolean): Promise<void> {
  const pm = new PackageState(root)
  const packages = pm.all()
  const sources = readSources(root)

  // Merge: show both active links and declared-but-not-linked sources
  const allNames = new Set([...Object.keys(packages), ...Object.keys(sources)])
  const names = [...allNames].sort()

  if (names.length === 0) {
    console.log("No sources currently linked.")
    console.log("Use 'dx source link <source> --target <dir>' to get started.")
    return
  }

  if (json) {
    const data: Record<string, any> = {}
    for (const name of names) {
      data[name] = {
        ...packages[name],
        required: name in sources,
        config: sources[name],
      }
    }
    console.log(JSON.stringify({ success: true, data }, null, 2))
    return
  }

  const rows: string[][] = []
  for (const name of names) {
    const entry = packages[name]
    const sourceConfig = sources[name]
    const isRequired = name in sources

    if (!entry) {
      // Declared in config but not linked locally
      rows.push([
        name,
        "required",
        "-",
        sourceConfig?.ref ?? "main",
        shortSource(sourceConfig?.source ?? "?"),
        sourceConfig?.target ?? "?",
        "not linked",
        "-",
      ])
      continue
    }

    const pkgDir = join(root, entry.local_path)
    let statusStr: string
    let changes: string

    if (!existsSync(pkgDir)) {
      statusStr = "missing"
      changes = "-"
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
      isRequired ? "required" : "optional",
      entry.type ?? "?",
      `${branchDisplay} (${entry.branch ?? "main"})`,
      shortSource(entry.source),
      entry.local_path,
      statusStr,
      changes,
    ])
  }

  console.log(
    printTable(
      [
        "Source",
        "Mode",
        "Type",
        "Branch (base)",
        "Repo",
        "Target",
        "Status",
        "Changes",
      ],
      rows
    )
  )
}
