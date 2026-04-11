import {
  existsSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  statSync,
} from "node:fs"
import { join, dirname, basename } from "node:path"
import { homedir } from "node:os"

import { runSkillsInteractive } from "./run-skills-cli.js"

const GLOBAL_SKILLS_DIR = join(homedir(), ".agents", "skills")

/** Walk up from `start` looking for a directory that contains `pnpm-workspace.yaml` or `.git`. */
function findMonorepoRoot(start: string): string | null {
  let dir = start
  while (true) {
    if (
      existsSync(join(dir, "pnpm-workspace.yaml")) ||
      existsSync(join(dir, ".git"))
    ) {
      return dir
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export async function agentSkillSync(opts: {
  agent?: string
  json?: boolean
  verbose?: boolean
}): Promise<void> {
  const root = findMonorepoRoot(process.cwd())
  if (!root) {
    throw new Error(
      "Could not find monorepo root (no pnpm-workspace.yaml or .git found)."
    )
  }

  const skillsDir = join(root, "skills")
  if (!existsSync(skillsDir)) {
    throw new Error(
      `No skills/ directory found at ${skillsDir}. Create it and add SKILL.md files.`
    )
  }

  const entries = readdirSync(skillsDir).filter((name) => {
    const full = join(skillsDir, name)
    return statSync(full).isDirectory() && existsSync(join(full, "SKILL.md"))
  })

  if (entries.length === 0) {
    if (opts.json) {
      console.log(JSON.stringify({ success: true, synced: 0, skills: [] }))
    } else {
      console.log("No skills found in skills/ directory.")
    }
    return
  }

  const synced: string[] = []

  for (const name of entries) {
    const src = join(skillsDir, name, "SKILL.md")
    const dest = join(GLOBAL_SKILLS_DIR, name, "SKILL.md")

    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(src, dest)
    synced.push(name)

    if (opts.verbose) {
      console.log(`  Copied ${name}/SKILL.md → ${dest}`)
    }
  }

  // Use `skills experimental_sync` to push to agent directories
  const syncArgs = ["experimental_sync", "--yes"]
  if (opts.agent) syncArgs.push("--agent", opts.agent)
  await runSkillsInteractive(syncArgs)

  if (opts.json) {
    console.log(
      JSON.stringify({ success: true, synced: synced.length, skills: synced })
    )
  } else {
    console.log(
      `\nSynced ${synced.length} internal skill(s): ${synced.join(", ")}`
    )
  }
}
