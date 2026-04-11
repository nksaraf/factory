/**
 * dx pkg push — commit, push, and create PR for package changes.
 */

import { existsSync } from "node:fs"
import { exec, capture } from "../../lib/subprocess.js"
import { PackageState } from "./state.js"
import { gitRepoDir, gitStatusSummary, shortSource } from "./detect.js"

export interface PushOptions {
  package: string
  branch?: string
  message?: string
  verbose?: boolean
}

export async function pkgPush(root: string, opts: PushOptions): Promise<void> {
  const pm = new PackageState(root)
  let entry = pm.get(opts.package)
  if (!entry) {
    throw new Error(
      `Package '${opts.package}' is not tracked (checked out or contributed)`
    )
  }

  // Switch branch if override provided
  if (opts.branch) {
    const repoDir = gitRepoDir(entry, root)
    await exec(["git", "checkout", opts.branch], { cwd: repoDir })
    entry.checkout_branch = opts.branch
    pm.add(opts.package, entry)
    entry = pm.get(opts.package)!
  }

  const pkgDir = root + "/" + entry.local_path
  if (!existsSync(pkgDir)) {
    throw new Error(`Package directory missing: ${entry.local_path}`)
  }

  const repoDir = gitRepoDir(entry, root)

  // For contributed packages, sync local files to staging clone first
  if (entry.mode === "contribute") {
    const { syncToStaging } = await import("./contribute.js")
    if (!(await syncToStaging(root, entry))) {
      throw new Error("Sync to staging failed. Run 'dx pkg pull' to reconcile.")
    }
  }

  // Check for changes
  const { status, count } = await gitStatusSummary(entry, root)
  if (status === "clean") {
    // Check for committed but unpushed changes
    const compareBranch = entry.checkout_branch ?? entry.branch
    const unpushedResult = await capture(
      ["git", "log", "--oneline", `origin/${compareBranch}..HEAD`],
      { cwd: repoDir }
    )
    if (unpushedResult.exitCode === 0 && !unpushedResult.stdout.trim()) {
      console.log(`No changes to push for ${opts.package}`)
      return
    }
  }

  const message = opts.message ?? `dx: update ${opts.package}`

  // Stage and commit (only if there are unstaged changes)
  if (status !== "clean") {
    console.log("Staging and committing changes...")
    if (entry.source_path) {
      await exec(["git", "add", entry.source_path], { cwd: repoDir })
    } else {
      await exec(["git", "add", "-A"], { cwd: repoDir })
    }
    await exec(["git", "commit", "-m", message], { cwd: repoDir })
    console.log("Changes committed")
  }

  // Push
  const branch = entry.checkout_branch ?? `dx/${opts.package}-dev`
  console.log(`Pushing branch ${branch}...`)
  await exec(["git", "push", "-u", "origin", branch], { cwd: repoDir })
  console.log("Pushed to remote")

  // Create PR via gh CLI
  const ghCheck = await capture(["which", "gh"])
  if (ghCheck.exitCode === 0) {
    console.log("Creating pull request...")
    const targetBranch = entry.branch ?? "main"
    const prResult = await capture(
      [
        "gh",
        "pr",
        "create",
        "--title",
        `Update ${opts.package}`,
        "--body",
        `Changes to \`${opts.package}\` made via \`dx pkg\` from the project workspace.`,
        "--base",
        targetBranch,
        "--head",
        branch,
      ],
      { cwd: repoDir }
    )
    if (prResult.exitCode === 0) {
      console.log(`Pull request created: ${prResult.stdout.trim()}`)
    } else if (
      prResult.stdout.toLowerCase().includes("already exists") ||
      prResult.stderr.toLowerCase().includes("already exists")
    ) {
      console.log("A pull request already exists for this branch")
      const urlResult = await capture(
        ["gh", "pr", "view", "--json", "url", "-q", ".url"],
        { cwd: repoDir }
      )
      if (urlResult.exitCode === 0 && urlResult.stdout.trim()) {
        console.log(`  ${urlResult.stdout.trim()}`)
      }
    } else {
      console.warn(`Could not create PR: ${prResult.stderr || prResult.stdout}`)
      console.log(`Create one manually for branch '${branch}'`)
    }
  } else {
    console.log("gh CLI not found — create a PR manually:")
    console.log(`  Branch: ${branch}`)
    console.log(`  Repo:   ${shortSource(entry.source)}`)
  }
}
