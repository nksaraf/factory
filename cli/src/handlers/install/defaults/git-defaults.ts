import { DX_CONFIG_DIR } from "../../../lib/host-dirs.js"
import { join } from "node:path"
import { capture } from "../../../lib/subprocess.js"
import { ensureFileExists } from "./file-utils.js"
import type { ConfigProvider, ConfigChange } from "./types.js"

const GIT_DEFAULTS: Record<string, string> = {
  "init.defaultBranch": "main",
  "pull.rebase": "true",
  "push.autoSetupRemote": "true",
  "fetch.prune": "true",
  "rerere.enabled": "true",
  "commit.verbose": "true",
  "diff.algorithm": "histogram",
  "merge.conflictstyle": "zdiff3",
}

const COMMIT_TEMPLATE_PATH = join(DX_CONFIG_DIR, "commit-template.txt")

const COMMIT_TEMPLATE = `
# <type>(<scope>): <subject>
#
# Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore
# Scope: optional, the module or area affected
# Subject: imperative mood, no period at end
#
# Body: explain what and why, not how (wrap at 72 chars)
#
# Footer: Breaking changes, issue references
`.trimStart()

async function getGitConfig(key: string): Promise<string | null> {
  const result = await capture(["git", "config", "--global", "--get", key])
  if (result.exitCode !== 0) return null
  return result.stdout.trim()
}

async function setGitConfig(key: string, value: string): Promise<boolean> {
  const result = await capture(["git", "config", "--global", key, value])
  return result.exitCode === 0
}

export const gitDefaultsProvider: ConfigProvider = {
  name: "Git global config",
  category: "git",
  roles: ["workbench", "site", "factory"],

  async detect(): Promise<ConfigChange[]> {
    const changes: ConfigChange[] = []

    for (const [key, value] of Object.entries(GIT_DEFAULTS)) {
      const current = await getGitConfig(key)
      changes.push({
        id: `git:${key}`,
        category: "git",
        description: `${key} = ${value}`,
        target: "~/.gitconfig",
        currentValue: current,
        proposedValue: value,
        alreadyApplied: current === value,
        requiresSudo: false,
        platform: null,
        apply: () => setGitConfig(key, value),
      })
    }

    // Commit template
    const currentTemplate = await getGitConfig("commit.template")
    const templateApplied = currentTemplate === COMMIT_TEMPLATE_PATH
    changes.push({
      id: "git:commit.template",
      category: "git",
      description: `commit.template = ~/.dx/commit-template.txt`,
      target: COMMIT_TEMPLATE_PATH,
      currentValue: currentTemplate,
      proposedValue: COMMIT_TEMPLATE_PATH,
      alreadyApplied: templateApplied,
      requiresSudo: false,
      platform: null,
      apply: async () => {
        ensureFileExists(COMMIT_TEMPLATE_PATH, COMMIT_TEMPLATE)
        return setGitConfig("commit.template", COMMIT_TEMPLATE_PATH)
      },
    })

    // Windows: credential helper
    if (process.platform === "win32") {
      const current = await getGitConfig("credential.helper")
      changes.push({
        id: "git:credential.helper",
        category: "git",
        description: "credential.helper = manager",
        target: "~/.gitconfig",
        currentValue: current,
        proposedValue: "manager",
        alreadyApplied: current === "manager",
        requiresSudo: false,
        platform: "win32",
        apply: () => setGitConfig("credential.helper", "manager"),
      })
    }

    return changes
  },
}
