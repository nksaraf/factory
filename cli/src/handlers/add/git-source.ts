import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs"
import { join, basename } from "node:path"
import os from "node:os"
import type { GeneratedFile } from "../../templates/types.js"

// ─── Types ──────────────────────────────────────────────────

export interface GitSourceResult {
  files: GeneratedFile[]
  composeFiles: string[]
}

// ─── Compose file discovery ─────────────────────────────────

const ROOT_COMPOSE_NAMES = [
  "compose.yml",
  "compose.yaml",
  "docker-compose.yml",
  "docker-compose.yaml",
]

// ─── Bind-mount extraction ──────────────────────────────────

/**
 * Extract local bind-mount paths from compose file content.
 * Matches patterns like `./config/foo.yaml:/etc/foo.yaml:ro`
 */
function extractBindMounts(content: string): string[] {
  const mounts: string[] = []
  const volumeLineRe = /^\s*-\s*(\.\/.+?):/gm
  let match: RegExpExecArray | null
  while ((match = volumeLineRe.exec(content)) !== null) {
    mounts.push(match[1]!)
  }
  return mounts
}

// ─── Main ───────────────────────────────────────────────────

/**
 * Clone a git repo and extract compose files + referenced configs.
 * Uses spawnSync with explicit argument arrays (no shell interpolation).
 */
export function cloneAndExtract(url: string, name?: string): GitSourceResult {
  const tmpDir = mkdtempSync(join(os.tmpdir(), "dx-git-source-"))

  try {
    // Clone — arguments are passed as an array, safe from injection
    const clone = spawnSync("git", ["clone", "--depth", "1", url, tmpDir], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    })
    if (clone.status !== 0) {
      throw new Error(`Failed to clone ${url}: ${clone.stderr}`)
    }

    const files: GeneratedFile[] = []
    const composeFiles: string[] = []

    // Derive name from repo URL if not provided
    const repoName = name || basename(url).replace(/\.git$/, "")

    // ── Check for compose/ directory ────────────────────────
    const composeDir = join(tmpDir, "compose")
    if (existsSync(composeDir)) {
      const ymlFiles = readdirSync(composeDir).filter(
        (f) => f.endsWith(".yml") || f.endsWith(".yaml")
      )
      for (const ymlFile of ymlFiles) {
        const content = readFileSync(join(composeDir, ymlFile), "utf8")
        const destPath = `compose/${ymlFile}`
        files.push({ path: destPath, content })
        composeFiles.push(destPath)

        // Extract bind-mount configs
        for (const mount of extractBindMounts(content)) {
          const mountPath = join(tmpDir, "compose", mount)
          if (existsSync(mountPath)) {
            const destConfigPath = `compose/${mount}`
            files.push({
              path: destConfigPath,
              content: readFileSync(mountPath, "utf8"),
            })
          }
        }
      }
      return { files, composeFiles }
    }

    // ── Check for root-level compose file ───────────────────
    for (const composeName of ROOT_COMPOSE_NAMES) {
      const composePath = join(tmpDir, composeName)
      if (existsSync(composePath)) {
        const content = readFileSync(composePath, "utf8")
        const destPath = `compose/${repoName}.yml`
        files.push({ path: destPath, content })
        composeFiles.push(destPath)

        // Extract bind-mount configs referenced from root
        for (const mount of extractBindMounts(content)) {
          const mountPath = join(tmpDir, mount)
          if (existsSync(mountPath)) {
            files.push({
              path: mount.startsWith("./") ? mount.slice(2) : mount,
              content: readFileSync(mountPath, "utf8"),
            })
          }
        }

        break // Use the first match
      }
    }

    return { files, composeFiles }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}
