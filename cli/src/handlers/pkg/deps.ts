/**
 * dx pkg deps — dependency graph visualization.
 *
 * Default: ASCII tree of workspace inter-dependencies.
 * --why <pkg>: reverse dependency lookup (who depends on X).
 * --external: list all non-workspace deps per package.
 * --json: machine-readable adjacency list.
 */
import { existsSync } from "node:fs"
import { join } from "node:path"

import { styleBold, styleInfo, styleMuted } from "../../cli-style.js"
import {
  type MavenManifest,
  type MonorepoPackage,
  type MonorepoTopology,
  type NpmManifest,
  type PythonManifest,
  fromCwd,
} from "../../lib/monorepo-topology.js"
import { capture } from "../../lib/subprocess.js"
import { printTable } from "../../output.js"

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface DepsOptions {
  why?: string
  external?: boolean
  json?: boolean
  verbose?: boolean
}

// ---------------------------------------------------------------------------
// Graph building
// ---------------------------------------------------------------------------

interface DepEdge {
  from: string
  to: string
  version: string
}

function buildWorkspaceGraph(ws: MonorepoTopology): {
  adjacency: Map<string, string[]>
  edges: DepEdge[]
} {
  const pkgNames = new Set(ws.packages.map((p) => p.name))
  const adjacency = new Map<string, string[]>()
  const edges: DepEdge[] = []

  for (const pkg of ws.packages) {
    const deps: string[] = []

    if (pkg.type === "npm") {
      const manifest = pkg.manifest as NpmManifest
      for (const [dep, ver] of Object.entries({
        ...manifest.dependencies,
        ...manifest.devDependencies,
      })) {
        if (pkgNames.has(dep)) {
          deps.push(dep)
          edges.push({ from: pkg.name, to: dep, version: ver })
        }
      }
    } else if (pkg.type === "python") {
      const manifest = pkg.manifest as PythonManifest
      for (const depStr of manifest.dependencies) {
        // Python deps are like "package-name>=1.0"
        const depName = depStr.split(/[><=!~\s]/)[0].trim()
        if (pkgNames.has(depName)) {
          deps.push(depName)
          edges.push({ from: pkg.name, to: depName, version: depStr })
        }
      }
    } else if (pkg.type === "java") {
      const manifest = pkg.manifest as MavenManifest
      for (const dep of manifest.dependencies) {
        const depName = dep.artifactId
        if (pkgNames.has(depName)) {
          deps.push(depName)
          edges.push({
            from: pkg.name,
            to: depName,
            version: dep.version,
          })
        }
      }
    }

    adjacency.set(pkg.name, deps)
  }

  return { adjacency, edges }
}

// ---------------------------------------------------------------------------
// ASCII tree rendering
// ---------------------------------------------------------------------------

function renderTree(
  adjacency: Map<string, string[]>,
  ws: MonorepoTopology
): string {
  const lines: string[] = []
  const roots = [...adjacency.keys()].filter((name) => {
    // Roots are packages that no other package depends on
    for (const deps of adjacency.values()) {
      if (deps.includes(name)) return false
    }
    return true
  })

  // If no roots found (all circular), just list everything
  const startNodes = roots.length > 0 ? roots : [...adjacency.keys()]

  const visited = new Set<string>()

  function printNode(name: string, prefix: string, isLast: boolean): void {
    const connector = isLast ? "└── " : "├── "
    const pkg = ws.packages.find((p) => p.name === name)
    const typeTag = pkg ? styleMuted(` [${pkg.type}]`) : ""
    lines.push(`${prefix}${connector}${styleBold(name)}${typeTag}`)

    if (visited.has(name)) {
      const childPrefix = prefix + (isLast ? "    " : "│   ")
      lines.push(`${childPrefix}${styleMuted("(circular)")}`)
      return
    }
    visited.add(name)

    const deps = adjacency.get(name) ?? []
    const childPrefix = prefix + (isLast ? "    " : "│   ")
    for (let i = 0; i < deps.length; i++) {
      printNode(deps[i], childPrefix, i === deps.length - 1)
    }
  }

  lines.push(styleBold("Workspace dependency tree:"))
  for (let i = 0; i < startNodes.length; i++) {
    visited.clear()
    printNode(startNodes[i], "", i === startNodes.length - 1)
  }

  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// --why reverse lookup
// ---------------------------------------------------------------------------

async function whyPackage(
  ws: MonorepoTopology,
  target: string,
  opts: DepsOptions
): Promise<void> {
  // For npm, try pnpm why first
  if (existsSync(join(ws.root, "pnpm-workspace.yaml"))) {
    const result = await capture(["pnpm", "why", target, "-r"], {
      cwd: ws.root,
    })
    if (result.exitCode === 0 && result.stdout.trim()) {
      console.log(result.stdout)
      return
    }
  }

  // Fallback: manual reverse lookup
  const { adjacency } = buildWorkspaceGraph(ws)
  const dependents: string[] = []

  for (const [name, deps] of adjacency) {
    if (deps.includes(target)) dependents.push(name)
  }

  if (dependents.length === 0) {
    console.log(`No workspace packages depend on ${target}`)
  } else {
    console.log(
      `${styleInfo(target)} is depended on by:\n${dependents.map((d) => `  ${d}`).join("\n")}`
    )
  }
}

// ---------------------------------------------------------------------------
// --external
// ---------------------------------------------------------------------------

function showExternalDeps(ws: MonorepoTopology, opts: DepsOptions): void {
  const pkgNames = new Set(ws.packages.map((p) => p.name))
  const rows: string[][] = []

  for (const pkg of ws.packages) {
    const externalDeps: string[] = []

    if (pkg.type === "npm") {
      const manifest = pkg.manifest as NpmManifest
      for (const dep of Object.keys(manifest.dependencies)) {
        if (!dep.startsWith("workspace:") && !pkgNames.has(dep)) {
          externalDeps.push(dep)
        }
      }
    } else if (pkg.type === "python") {
      const manifest = pkg.manifest as PythonManifest
      for (const depStr of manifest.dependencies) {
        const depName = depStr.split(/[><=!~\s]/)[0].trim()
        if (!pkgNames.has(depName)) externalDeps.push(depName)
      }
    } else if (pkg.type === "java") {
      const manifest = pkg.manifest as MavenManifest
      for (const dep of manifest.dependencies) {
        if (!pkgNames.has(dep.artifactId)) {
          externalDeps.push(`${dep.groupId}:${dep.artifactId}`)
        }
      }
    }

    if (externalDeps.length > 0) {
      rows.push([pkg.name, pkg.type, externalDeps.join(", ")])
    }
  }

  if (opts.json) {
    const data: Record<string, string[]> = {}
    for (const [name, , deps] of rows) {
      data[name] = deps.split(", ")
    }
    console.log(JSON.stringify({ success: true, data }, null, 2))
  } else if (rows.length > 0) {
    console.log(printTable(["Package", "Type", "External Dependencies"], rows))
  } else {
    console.log("No external dependencies found.")
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function pkgDeps(root: string, opts: DepsOptions): Promise<void> {
  const ws = fromCwd(root)

  if (ws.packages.length === 0) {
    console.log("No workspace packages found.")
    return
  }

  if (opts.why) {
    await whyPackage(ws, opts.why, opts)
    return
  }

  if (opts.external) {
    showExternalDeps(ws, opts)
    return
  }

  const { adjacency } = buildWorkspaceGraph(ws)

  if (opts.json) {
    const data: Record<string, string[]> = {}
    for (const [name, deps] of adjacency) {
      data[name] = deps
    }
    console.log(JSON.stringify({ success: true, data }, null, 2))
  } else {
    console.log(renderTree(adjacency, ws))
  }
}
