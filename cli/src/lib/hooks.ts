import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

// ─── Hook Definitions ───────────────────────────────────────

const HOOKS = {
  "commit-msg": `#!/bin/sh
# dx git-hook: validate commit message conventions
command -v dx >/dev/null 2>&1 || { echo "dx not found. Install: curl -fsSL https://factory.lepton.software/api/v1/factory/install | sh"; exit 1; }
exec dx git-hook commit-msg "$1"
`,
  "pre-commit": `#!/bin/sh
# dx git-hook: lint staged files
command -v dx >/dev/null 2>&1 || { echo "dx not found. Install: curl -fsSL https://factory.lepton.software/api/v1/factory/install | sh"; exit 1; }
exec dx git-hook pre-commit
`,
  "pre-push": `#!/bin/sh
# dx git-hook: run quality checks before push
command -v dx >/dev/null 2>&1 || { echo "dx not found. Install: curl -fsSL https://factory.lepton.software/api/v1/factory/install | sh"; exit 1; }
exec dx git-hook pre-push
`,
  "post-merge": `#!/bin/sh
# dx git-hook: sync local state after merge
command -v dx >/dev/null 2>&1 || exit 0
exec dx sync --quiet
`,
  "post-checkout": `#!/bin/sh
# dx git-hook: sync local state after checkout
# Only run on branch checkout (flag $3 == 1), not file checkout
[ "$3" = "1" ] || exit 0
command -v dx >/dev/null 2>&1 || exit 0
exec dx sync --quiet
`,
} as const

export type HookName = keyof typeof HOOKS
export const HOOK_NAMES = Object.keys(HOOKS) as HookName[]

// ─── Generate ───────────────────────────────────────────────

/** Get the content for a specific hook script. */
export function generateHookScript(hookName: HookName): string {
  return HOOKS[hookName]
}

// ─── Install ────────────────────────────────────────────────

export interface InstallHooksResult {
  installed: HookName[]
  updated: HookName[]
  unchanged: HookName[]
  hooksDir: string
}

/**
 * Install git hooks into `.dx/hooks/` and set `core.hooksPath`.
 * Safe to call repeatedly — only writes files that are missing or outdated.
 */
export function installHooks(projectDir: string): InstallHooksResult {
  const hooksDir = join(projectDir, ".dx", "hooks")
  mkdirSync(hooksDir, { recursive: true })

  const result: InstallHooksResult = {
    installed: [],
    updated: [],
    unchanged: [],
    hooksDir,
  }

  for (const hookName of HOOK_NAMES) {
    const hookPath = join(hooksDir, hookName)
    const content = generateHookScript(hookName)

    if (!existsSync(hookPath)) {
      writeFileSync(hookPath, content, "utf-8")
      chmodSync(hookPath, 0o755)
      result.installed.push(hookName)
    } else {
      const existing = readFileSync(hookPath, "utf-8")
      if (hashContent(existing) !== hashContent(content)) {
        writeFileSync(hookPath, content, "utf-8")
        chmodSync(hookPath, 0o755)
        result.updated.push(hookName)
      } else {
        result.unchanged.push(hookName)
      }
    }
  }

  // Set core.hooksPath
  setHooksPath(projectDir, ".dx/hooks")

  return result
}

// ─── Verify ─────────────────────────────────────────────────

export interface HookVerification {
  hooksPathSet: boolean
  hooksPathValue: string | null
  hooks: Record<HookName, "ok" | "missing" | "outdated">
}

/**
 * Check that hooks are installed and up to date without modifying anything.
 */
export function verifyHooks(projectDir: string): HookVerification {
  const hooksDir = join(projectDir, ".dx", "hooks")
  const hooksPathValue = getHooksPath(projectDir)
  const hooksPathSet = hooksPathValue === ".dx/hooks"

  const hooks: Record<string, "ok" | "missing" | "outdated"> = {}

  for (const hookName of HOOK_NAMES) {
    const hookPath = join(hooksDir, hookName)
    if (!existsSync(hookPath)) {
      hooks[hookName] = "missing"
    } else {
      const existing = readFileSync(hookPath, "utf-8")
      const expected = generateHookScript(hookName)
      hooks[hookName] =
        hashContent(existing) === hashContent(expected) ? "ok" : "outdated"
    }
  }

  return {
    hooksPathSet,
    hooksPathValue,
    hooks: hooks as Record<HookName, "ok" | "missing" | "outdated">,
  }
}

/** Returns true if all hooks are installed and up to date. */
export function hooksHealthy(projectDir: string): boolean {
  const v = verifyHooks(projectDir)
  if (!v.hooksPathSet) return false
  return Object.values(v.hooks).every((s) => s === "ok")
}

// ─── Git Config Helpers ─────────────────────────────────────

function setHooksPath(projectDir: string, path: string): void {
  spawnSync("git", ["config", "core.hooksPath", path], {
    cwd: projectDir,
    stdio: "ignore",
  })
}

function getHooksPath(projectDir: string): string | null {
  const result = spawnSync("git", ["config", "--get", "core.hooksPath"], {
    cwd: projectDir,
    encoding: "utf-8",
  })
  return result.status === 0 ? result.stdout.trim() : null
}

function hashContent(content: string): string {
  return createHash("sha256").update(content.trim()).digest("hex")
}
