import { spawnSync } from "node:child_process"
import { basename } from "node:path"

import {
  styleBold,
  styleError,
  styleInfo,
  styleMuted,
  styleServiceStatus,
  styleSuccess,
  styleWarn,
} from "../cli-style.js"
import { Compose } from "../lib/docker.js"
import { resolveDxContext } from "../lib/dx-context.js"
import { SiteManager } from "../lib/site-manager.js"
import { isProcessRunning } from "../site/execution/native.js"
import { getAheadBehind, getCurrentBranch } from "../lib/git.js"
import type { DxFlags } from "../stub.js"

interface GitStatus {
  branch: string
  modified: number
  untracked: number
  ahead: number
  behind: number
}

interface ProjectInfo {
  name: string
  root: string
  components: string[]
  resources: string[]
}

export interface UnifiedServiceStatus {
  name: string
  runtime: "docker" | "dev"
  status: string
  ports: string
  pid?: number
}

function getGitFileStats(cwd: string): { modified: number; untracked: number } {
  const proc = spawnSync("git", ["status", "--porcelain"], {
    cwd,
    encoding: "utf8",
  })
  if (proc.status !== 0) return { modified: 0, untracked: 0 }

  const lines = (proc.stdout || "").trim().split("\n").filter(Boolean)
  let modified = 0
  let untracked = 0
  for (const line of lines) {
    if (line.startsWith("??")) {
      untracked++
    } else {
      modified++
    }
  }
  return { modified, untracked }
}

function formatChanges(modified: number, untracked: number): string {
  const parts: string[] = []
  if (modified > 0) parts.push(`${modified} files modified`)
  if (untracked > 0) parts.push(`${untracked} untracked`)
  if (parts.length === 0) return "clean"
  return parts.join(", ")
}

interface ResolvedProject extends ProjectInfo {
  composeFiles: string[]
}

async function tryLoadProject(
  cwd: string
): Promise<ResolvedProject | undefined> {
  try {
    const ctx = await resolveDxContext({ need: "project", cwd })
    const project = ctx.project
    return {
      name: project.name,
      root: project.rootDir,
      components: Object.keys(project.catalog.components),
      resources: Object.keys(project.catalog.resources),
      composeFiles: project.composeFiles,
    }
  } catch {
    // No compose files found — not a dx project
    return undefined
  }
}

/**
 * Get unified service statuses from both Docker Compose and native dev servers.
 * Dev servers take priority (they replace docker containers).
 */
export function getUnifiedServices(
  rootDir: string,
  composeFiles: string[]
): UnifiedServiceStatus[] {
  // Docker compose services (ps is read-only — only needs project name)
  const compose = new Compose([], basename(rootDir))
  const dockerServices = compose.ps({ all: true })

  // Native dev servers from site.json (with liveness verification)
  let devServers: {
    name: string
    port: number | null
    pid: number | null
    running: boolean
  }[] = []
  const site = SiteManager.load(rootDir)
  if (site) {
    const state = site.getState()
    for (const sd of state.spec.systemDeployments) {
      for (const cd of sd.componentDeployments) {
        if (cd.mode !== "native") continue
        const pid = cd.status.pid ?? null
        const running = pid !== null && isProcessRunning(pid)
        devServers.push({
          name: cd.componentSlug,
          port: cd.status.port ?? null,
          pid,
          running,
        })
      }
    }
  }

  const devNames = new Set(
    devServers.filter((s) => s.running).map((s) => s.name)
  )

  const result: UnifiedServiceStatus[] = []

  // Add dev servers first
  for (const s of devServers) {
    if (!s.running) continue
    result.push({
      name: s.name,
      runtime: "dev",
      status: "running",
      ports: s.port ? `:${s.port}` : "",
      pid: s.pid ?? undefined,
    })
  }

  // Add docker services (skip those replaced by dev servers)
  for (const s of dockerServices) {
    if (devNames.has(s.name)) continue
    result.push({
      name: s.name,
      runtime: "docker",
      status: s.status,
      ports: s.ports,
    })
  }

  return result
}

/** Context-local status: git + project info, no factory API required. */
export async function runContextStatus(flags: DxFlags): Promise<void> {
  const cwd = process.cwd()

  // --- Git context ---
  let gitStatus: GitStatus | undefined
  try {
    const branch = getCurrentBranch(cwd)
    const { modified, untracked } = getGitFileStats(cwd)

    let ahead = 0
    let behind = 0
    try {
      const ab = getAheadBehind(cwd)
      ahead = ab.ahead
      behind = ab.behind
    } catch {
      // no upstream tracking branch
    }

    gitStatus = { branch, modified, untracked, ahead, behind }
  } catch {
    // not in a git repo
  }

  // --- Project context (docker-compose) ---
  const project = await tryLoadProject(cwd)

  // --- Unified service statuses ---
  let services: UnifiedServiceStatus[] = []
  if (project) {
    services = getUnifiedServices(project.root, project.composeFiles)
  }

  // --- Output ---
  if (flags.json) {
    const result: Record<string, unknown> = { success: true }
    if (project) {
      result.project = {
        name: project.name,
        root: project.root,
        components: project.components,
        resources: project.resources,
      }
    }
    if (gitStatus) {
      result.git = {
        branch: gitStatus.branch,
        modified: gitStatus.modified,
        untracked: gitStatus.untracked,
        ahead: gitStatus.ahead,
        behind: gitStatus.behind,
      }
    }
    if (services.length > 0) {
      result.services = services
    }
    if (project) {
      const siteManager = SiteManager.load(project.root)
      if (siteManager) {
        result.site = siteManager.getState()
      }
    }
    result.cwd = cwd
    console.log(JSON.stringify(result, null, 2))
    return
  }

  // Human-readable output
  if (project) {
    console.log(`${styleBold("Project:")}    ${styleInfo(project.name)}`)
    if (project.components.length > 0) {
      console.log(
        `${styleBold("Components:")} ${project.components.join(", ")}`
      )
    }
    if (project.resources.length > 0) {
      console.log(`${styleBold("Resources:")}  ${project.resources.join(", ")}`)
    }
    console.log(`${styleBold("Root:")}       ${styleMuted(project.root)}`)
  } else {
    console.log(styleMuted(`Directory: ${cwd}`))
  }

  if (gitStatus) {
    console.log("")
    console.log(`${styleBold("Branch:")}     ${styleInfo(gitStatus.branch)}`)
    console.log(
      `${styleBold("Changes:")}    ${gitStatus.modified === 0 && gitStatus.untracked === 0 ? styleSuccess("clean") : styleWarn(formatChanges(gitStatus.modified, gitStatus.untracked))}`
    )
    console.log(
      `${styleBold("Remote:")}     ${gitStatus.ahead} ahead, ${gitStatus.behind} behind`
    )
  }

  // --- Services ---
  if (services.length > 0) {
    console.log("")
    console.log(styleBold("Services:"))
    for (const svc of services) {
      const runtimeTag =
        svc.runtime === "dev" ? styleMuted("[dev]") : styleMuted("[docker]")
      const ports = svc.ports ? styleMuted(` (${svc.ports})`) : ""
      const pid = svc.pid ? styleMuted(` PID ${svc.pid}`) : ""
      console.log(
        `  ${svc.name.padEnd(24)} ${styleServiceStatus(svc.status)} ${runtimeTag}${ports}${pid}`
      )
    }
  } else if (project) {
    console.log("")
    console.log(styleMuted("Services:    not running (use dx dev or dx up)"))
  }

  if (project) {
    const siteManager = SiteManager.load(project.root)
    if (siteManager) {
      const spec = siteManager.getSpec()
      const status = siteManager.getStatus()

      console.log("")
      console.log(styleBold("Site:"))
      console.log(`  ${"Mode:".padEnd(14)}${styleInfo(spec.mode)}`)
      console.log(`  ${"Phase:".padEnd(14)}${styleServiceStatus(status.phase)}`)
      console.log(`  ${"Updated:".padEnd(14)}${styleMuted(status.updatedAt)}`)

      for (const sd of spec.systemDeployments) {
        if (sd.linkedRef) {
          console.log(
            `  ${sd.slug.padEnd(14)}${styleMuted(`→ linked (${sd.linkedRef.site})`)}`
          )
          continue
        }

        for (const cd of sd.componentDeployments) {
          const specMode = cd.mode
          const pid = cd.status.pid
          const phase = cd.status.phase ?? "unknown"

          let actual: string
          if (specMode === "native") {
            const alive = pid != null && isProcessRunning(pid)
            actual = alive
              ? "running"
              : phase === "running"
                ? styleError("dead (stale PID)")
                : phase
          } else if (specMode === "container") {
            actual = phase
          } else {
            actual = specMode
          }

          const delta =
            (specMode === "native" && phase !== "running") ||
            (specMode === "container" && phase === "stopped")
              ? styleWarn(" ≠")
              : ""

          const portStr = cd.status.port ? styleMuted(`:${cd.status.port}`) : ""
          console.log(
            `  ${cd.componentSlug.padEnd(14)}${specMode.padEnd(12)}${styleServiceStatus(actual)}${portStr}${delta}`
          )
        }
      }
    }
  }
}
