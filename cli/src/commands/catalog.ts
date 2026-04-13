import type {
  CatalogComponent,
  CatalogResource,
  CatalogSystem,
} from "@smp/factory-shared/catalog"
import { isDevComponent } from "@smp/factory-shared/catalog"
import { DependencyGraph } from "@smp/factory-shared/dependency-graph"
import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import {
  styleBold,
  styleInfo,
  styleMuted,
  styleSuccess,
  styleWarn,
} from "../cli-style.js"
import type { DxBase } from "../dx-root.js"
import {
  type FileDrift,
  GENERATED_DIR,
  detectFormats,
  loadCatalog,
} from "../lib/catalog.js"
import { getWorktreeInfo } from "../lib/worktree-detect.js"
import { printTable } from "../output.js"
import { setExamples } from "../plugins/examples-plugin.js"
import { runCatalogDoctor } from "./catalog-doctor.js"
import { toDxFlags } from "./dx-flags.js"

setExamples("catalog", [
  "$ dx catalog                              List all catalog entries",
  "$ dx catalog tree                          Dependency tree (deduplicated)",
  "$ dx catalog tree --reverse infra-postgres What breaks if postgres goes down?",
  "$ dx catalog tree --layers                 Startup parallelism layers",
  "$ dx catalog tree --focus infra-factory    Show service + its dependency chain",
  "$ dx catalog tree --startup-order          Flat list in startup order",
  "$ dx catalog tree --mermaid                Output mermaid graph syntax",
  "$ dx catalog info api                      Show details for a component or resource",
  "$ dx catalog status                        Show catalog source and detected formats",
  "$ dx catalog sync                          Push local catalog to the factory",
  "$ dx catalog sync -d                       Preview what would be synced (dry run)",
  "$ dx catalog doctor                        Diagnose missing catalog labels in docker-compose",
  "$ dx catalog doctor --fix                  Interactively add missing labels",
])

function renderDriftWarnings(drifts: FileDrift[], quiet: boolean): void {
  if (drifts.length === 0 || quiet) return

  console.error("")
  console.error(
    styleWarn(
      `Drift detected in ${drifts.length} file${drifts.length > 1 ? "s" : ""}:`
    )
  )
  for (const d of drifts) {
    console.error(
      `  ${styleWarn("⚠")} ${styleBold(d.file)} differs from ${d.format} generation`
    )
  }
  console.error(
    styleMuted(
      `  Run 'diff ${GENERATED_DIR}/<file> <file>' to inspect changes.`
    )
  )
}

// ── Display helpers ──────────────────────────────────────────

function lifecycleColor(lc: string | undefined): string {
  if (!lc) return styleMuted("–")
  switch (lc) {
    case "production":
      return styleSuccess(lc)
    case "deprecated":
      return styleWarn(lc)
    default:
      return lc
  }
}

function portsStr(
  ports: { port: number; containerPort?: number; protocol: string }[]
): string {
  if (ports.length === 0) return styleMuted("–")
  return ports
    .map((p) => {
      const cp =
        p.containerPort && p.containerPort !== p.port
          ? `→${p.containerPort}`
          : ""
      return `${p.port}${cp}/${p.protocol}`
    })
    .join(", ")
}

function renderFields(fields: [string, string][]): void {
  const maxLabel = Math.max(...fields.map(([l]) => l.length))
  for (const [label, value] of fields) {
    console.log(`${styleMuted(label.padEnd(maxLabel))}  ${value}`)
  }
}

function renderComponentInfo(name: string, c: CatalogComponent): void {
  const fields: [string, string][] = [
    ["Name", styleInfo(name)],
    ["Kind", c.kind],
    ["Type", c.spec.type],
    ["Lifecycle", lifecycleColor(c.spec.lifecycle)],
    ["Owner", c.spec.owner || styleMuted("–")],
    ["System", c.spec.system ?? styleMuted("–")],
  ]

  if (c.metadata.description) {
    fields.push(["Description", c.metadata.description])
  }
  if (c.spec.image) {
    fields.push(["Image", c.spec.image])
  }
  if (c.spec.ports.length > 0) {
    fields.push(["Ports", portsStr(c.spec.ports)])
  }
  if (isDevComponent(c)) {
    fields.push(["Dev command", c.spec.dev.command])
  }
  if (c.spec.test) {
    fields.push(["Test", c.spec.test])
  }
  if (c.spec.lint) {
    fields.push(["Lint", c.spec.lint])
  }
  if (c.spec.healthchecks) {
    const hc = c.spec.healthchecks
    const checks: string[] = []
    if (hc.live) checks.push("live")
    if (hc.ready) checks.push("ready")
    if (hc.start) checks.push("start")
    if (checks.length > 0) fields.push(["Healthchecks", checks.join(", ")])
  }
  if (c.spec.providesApis?.length) {
    fields.push(["Provides APIs", c.spec.providesApis.join(", ")])
  }
  if (c.spec.consumesApis?.length) {
    fields.push(["Consumes APIs", c.spec.consumesApis.join(", ")])
  }
  if (c.spec.dependsOn?.length) {
    fields.push(["Depends on", c.spec.dependsOn.join(", ")])
  }
  if (c.metadata.tags?.length) {
    fields.push(["Tags", c.metadata.tags.join(", ")])
  }
  renderFields(fields)
}

function renderResourceInfo(name: string, r: CatalogResource): void {
  const fields: [string, string][] = [
    ["Name", styleInfo(name)],
    ["Kind", r.kind],
    ["Type", r.spec.type],
    ["Lifecycle", lifecycleColor(r.spec.lifecycle)],
    ["Image", r.spec.image],
  ]

  if (r.spec.ports.length > 0) {
    fields.push(["Ports", portsStr(r.spec.ports)])
  }
  if (r.spec.healthcheck) {
    fields.push(["Healthcheck", r.spec.healthcheck])
  }
  if (r.spec.dependencyOf?.length) {
    fields.push(["Dependency of", r.spec.dependencyOf.join(", ")])
  }
  if (r.metadata.tags?.length) {
    fields.push(["Tags", r.metadata.tags.join(", ")])
  }
  renderFields(fields)
}

// ── Tree helpers ─────────────────────────────────────────────

type EntityInfo = Map<string, { kind: string; type: string }>

const TYPE_ICONS: Record<string, string> = {
  database: "⛁",
  cache: "◆",
  queue: "↔",
  storage: "▤",
  search: "⊕",
  gateway: "⇌",
  service: "●",
  init: "▷",
  other: "○",
}

function iconFor(kind: string, type: string): string {
  if (kind === "Resource") return TYPE_ICONS[type] ?? TYPE_ICONS.other!
  if (kind === "API") return "◇"
  if (type === "init") return TYPE_ICONS.init!
  return TYPE_ICONS.service!
}

/**
 * Per-service runtime connections derived from env vars that reference other service hostnames.
 * This is different from dependsOn (startup ordering) — connections show "talks to at runtime."
 */
type ServiceConnections = Map<string, string[]>

function buildServiceConnections(catalog: CatalogSystem): ServiceConnections {
  const allNames = new Set([
    ...Object.keys(catalog.components),
    ...Object.keys(catalog.resources),
  ])

  const connections: ServiceConnections = new Map()

  for (const [name, entry] of [
    ...Object.entries(catalog.components),
    ...Object.entries(catalog.resources),
  ]) {
    const env = entry.spec.environment ?? {}
    const targets = new Set<string>()
    for (const v of Object.values(env)) {
      if (typeof v !== "string") continue
      for (const svc of allNames) {
        if (svc !== name && v.includes(svc)) {
          targets.add(svc)
        }
      }
    }
    // Gateway routing targets (parsed from mounted config files)
    if ("gatewayTargets" in entry.spec && entry.spec.gatewayTargets) {
      for (const gt of entry.spec.gatewayTargets) {
        if (allNames.has(gt.service)) {
          targets.add(gt.service)
        }
      }
    }

    if (targets.size > 0) {
      connections.set(name, [...targets].sort())
    }
  }

  return connections
}

/**
 * Build a map of init container names → their parent service names.
 * Used by graph collapsing to remove init nodes and rewire edges.
 */
function buildInitMap(catalog: CatalogSystem): Map<string, string> {
  const initMap = new Map<string, string>()
  for (const [name, comp] of Object.entries(catalog.components)) {
    if (comp.spec.type === "init" && comp.spec.initFor) {
      initMap.set(name, comp.spec.initFor)
    }
  }
  return initMap
}

function buildEntityInfo(catalog: CatalogSystem): EntityInfo {
  const info: EntityInfo = new Map()
  for (const [name, c] of Object.entries(catalog.components)) {
    info.set(name, { kind: c.kind, type: c.spec.type })
  }
  for (const [name, r] of Object.entries(catalog.resources)) {
    info.set(name, { kind: r.kind, type: r.spec.type })
  }
  if (catalog.apis) {
    for (const [name, a] of Object.entries(catalog.apis)) {
      info.set(name, { kind: a.kind, type: a.spec.type })
    }
  }
  return info
}

function nodeLabel(name: string, entityInfo: EntityInfo): string {
  const info = entityInfo.get(name)
  const icon = info ? iconFor(info.kind, info.type) : "?"
  const kindTag = info
    ? styleMuted(` ${info.kind.toLowerCase()}:${info.type}`)
    : ""
  return `${icon} ${styleBold(name)}${kindTag}`
}

/** Default: deduplicated tree from roots down. Shared deps show "(see above)" on repeat. */
function renderTree(
  graph: DependencyGraph,
  entityInfo: EntityInfo,
  startNodes: string[],
  getChildren: (name: string) => string[]
): string {
  const lines: string[] = []
  const visited = new Set<string>()
  const ancestors = new Set<string>()

  function printNode(name: string, prefix: string, isLast: boolean): void {
    const connector = isLast ? "└── " : "├── "
    const childPrefix = prefix + (isLast ? "    " : "│   ")

    if (ancestors.has(name)) {
      lines.push(
        `${prefix}${connector}${nodeLabel(name, entityInfo)} ${styleMuted("(circular)")}`
      )
      return
    }

    if (visited.has(name)) {
      lines.push(
        `${prefix}${connector}${nodeLabel(name, entityInfo)} ${styleMuted("↑")}`
      )
      return
    }

    lines.push(`${prefix}${connector}${nodeLabel(name, entityInfo)}`)
    visited.add(name)
    ancestors.add(name)

    const children = getChildren(name)
    for (let i = 0; i < children.length; i++) {
      printNode(children[i], childPrefix, i === children.length - 1)
    }

    ancestors.delete(name)
  }

  for (let i = 0; i < startNodes.length; i++) {
    printNode(startNodes[i], "", i === startNodes.length - 1)
  }

  return lines.join("\n")
}

/** Reverse/impact tree: what depends on a given service? */
function renderReverseTree(
  graph: DependencyGraph,
  entityInfo: EntityInfo,
  service: string
): string {
  const affected = graph.transitiveDependents(service)
  const lines: string[] = []
  lines.push(
    styleBold(`Impact of ${service}`) +
      styleMuted(
        ` (${affected.length} service${affected.length !== 1 ? "s" : ""} affected)`
      )
  )
  lines.push("")
  lines.push(
    renderTree(graph, entityInfo, [service], (n) =>
      graph.directDependents(n).sort()
    )
  )
  return lines.join("\n")
}

/** Layers view: group by topological level for startup parallelism. */
function renderLayers(graph: DependencyGraph, entityInfo: EntityInfo): string {
  const levels = graph.topologicalLevels()
  const lines: string[] = []

  for (let i = 0; i < levels.length; i++) {
    const prefix = i === 0 ? "" : "→ "
    const label = styleMuted(`Layer ${i}`)
    const services = levels[i]
      .map((name) => nodeLabel(name, entityInfo))
      .join(styleMuted(", "))
    lines.push(`${label}  ${prefix}${services}`)
  }

  return lines.join("\n")
}

/** Flat numbered list in dependency-first startup order. */
function renderStartupOrder(
  graph: DependencyGraph,
  entityInfo: EntityInfo,
  focusTargets?: string[]
): string {
  const order = focusTargets
    ? graph.startupOrder(focusTargets)
    : graph.topologicalSort()

  const lines: string[] = []
  const pad = String(order.length).length
  for (let i = 0; i < order.length; i++) {
    const num = styleMuted(String(i + 1).padStart(pad) + ".")
    lines.push(`${num} ${nodeLabel(order[i], entityInfo)}`)
  }
  return lines.join("\n")
}

/** Render mermaid source as an HTML page and open in the default browser. */
function openMermaidInBrowser(source: string, title: string): void {
  const escHtml = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
  const escaped = escHtml(source)
  const safeTitle = escHtml(title)
  const html = [
    "<!DOCTYPE html>",
    `<html><head><meta charset="utf-8"><title>${safeTitle} — dependency graph</title>`,
    "<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#1e1e2e;overflow:auto}",
    ".mermaid{display:flex;justify-content:center;padding:1rem}",
    ".mermaid svg{width:100vw;height:auto;min-height:100vh}</style>",
    '<script type="module">',
    "import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';",
    "mermaid.initialize({startOnLoad:true,theme:'dark',themeVariables:{primaryColor:'#89b4fa',primaryTextColor:'#cdd6f4',lineColor:'#a6adc8',secondaryColor:'#313244'}});",
    "</script></head><body>",
    `<pre class="mermaid">${escaped}</pre>`,
    "</body></html>",
  ].join("\n")

  const safe = title.replace(/[^a-z0-9-]/gi, "-")
  const filePath = resolve(tmpdir(), `dx-catalog-${safe}.html`)
  writeFileSync(filePath, html)
  try {
    const openCmd = process.platform === "darwin" ? "open" : "xdg-open"
    execFileSync(openCmd, [filePath], { stdio: "ignore" })
    console.log(styleMuted(`Opened ${filePath}`))
  } catch {
    console.log(styleMuted(`Written to ${filePath} — open manually if needed`))
  }
}

/** Mermaid graph syntax for docs/sharing. */
function renderMermaid(
  graph: DependencyGraph,
  entityInfo: EntityInfo,
  connections: ServiceConnections,
  opts?: { reverse?: string; focus?: string }
): string {
  let services: string[]
  if (opts?.focus) {
    services = graph.subgraphFor([opts.focus]).allServices()
  } else if (opts?.reverse) {
    services = [opts.reverse, ...graph.transitiveDependents(opts.reverse)]
  } else {
    services = graph.allServices()
  }

  const serviceSet = new Set(services)
  const lines: string[] = ["graph TD"]

  // Node definitions
  for (const name of services) {
    const info = entityInfo.get(name)
    const icon = info ? iconFor(info.kind, info.type) : "?"
    const tag = info ? `${info.kind.toLowerCase()}:${info.type}` : ""
    const id = name.replace(/-/g, "_")
    lines.push(`  ${id}["${icon} ${name}<br/>${tag}"]`)
  }

  lines.push("")

  // Dependency edges (solid) — "depends on" / startup ordering
  const depEdges = new Set<string>()
  for (const name of services) {
    const id = name.replace(/-/g, "_")
    if (opts?.reverse) {
      for (const dep of graph.directDependents(name)) {
        if (serviceSet.has(dep)) {
          const edge = `${id}-->${dep.replace(/-/g, "_")}`
          depEdges.add(edge)
          lines.push(`  ${id} ==>|depends on| ${dep.replace(/-/g, "_")}`)
        }
      }
    } else {
      for (const dep of graph.directDeps(name)) {
        if (serviceSet.has(dep)) {
          const edge = `${id}-->${dep.replace(/-/g, "_")}`
          depEdges.add(edge)
          lines.push(`  ${id} ==>|depends on| ${dep.replace(/-/g, "_")}`)
        }
      }
    }
  }

  // Connection edges (dashed) — "connects to" / runtime, skip if already a dep edge
  for (const name of services) {
    const targets = connections.get(name) ?? []
    const id = name.replace(/-/g, "_")
    for (const target of targets) {
      if (!serviceSet.has(target)) continue
      const edge = `${id}-->${target.replace(/-/g, "_")}`
      if (depEdges.has(edge)) continue // already shown as dep
      lines.push(`  ${id} -.->|connects to| ${target.replace(/-/g, "_")}`)
    }
  }

  return lines.join("\n")
}

// ── Command ──────────────────────────────────────────────────

export function catalogCommand(app: DxBase) {
  return app
    .sub("catalog")
    .meta({ description: "Software catalog" })
    .run(({ flags }) => {
      const f = toDxFlags(flags)
      const result = loadCatalog(process.cwd())

      if (!result) {
        console.error(
          "No catalog source found. Searched for: docker-compose.yaml, catalog-info.yaml, Chart.yaml"
        )
        process.exit(1)
      }

      const cat = result.catalog

      if (f.json) {
        console.log(
          JSON.stringify(
            {
              success: true,
              format: result.format,
              data: cat,
              drifts: result.drifts,
            },
            null,
            2
          )
        )
        return
      }

      const rows: string[][] = []
      for (const [name, c] of Object.entries(cat.components)) {
        rows.push([name, c.kind, c.spec.type, c.spec.lifecycle ?? "–"])
      }
      for (const [name, r] of Object.entries(cat.resources)) {
        rows.push([name, r.kind, r.spec.type, r.spec.lifecycle ?? "–"])
      }
      if (cat.apis) {
        for (const [name, a] of Object.entries(cat.apis)) {
          rows.push([name, a.kind, a.spec.type, a.spec.lifecycle])
        }
      }

      if (rows.length === 0) {
        console.log("No catalog entries found.")
        return
      }

      // Show system name from x-dx.name, with worktree context if applicable
      const worktree = getWorktreeInfo(process.cwd())
      let headerName = cat.metadata.name
      if (worktree) {
        headerName += ` ${styleMuted(`(worktree: ${worktree.worktreeName})`)}`
      }
      console.log(styleBold(headerName) + styleMuted(` (${result.owner})`))
      console.log("")
      console.log(printTable(["NAME", "KIND", "TYPE", "LIFECYCLE"], rows))

      renderDriftWarnings(result.drifts, !!f.quiet)
    })
    .command("info", (c) =>
      c
        .meta({ description: "Show details for a catalog entry" })
        .args([
          {
            name: "name",
            type: "string" as const,
            required: true,
            description: "Component or resource name",
          },
        ])
        .run(({ args, flags }) => {
          const f = toDxFlags(flags)
          const result = loadCatalog(process.cwd())

          if (!result) {
            console.error("No catalog source found.")
            process.exit(1)
          }

          const cat = result.catalog
          const name = args.name

          const component = cat.components[name]
          const resource = cat.resources[name]
          const api = cat.apis?.[name]
          const entry = component ?? resource ?? api

          if (!entry) {
            const available = [
              ...Object.keys(cat.components),
              ...Object.keys(cat.resources),
              ...Object.keys(cat.apis ?? {}),
            ]
            console.error(
              `Entry "${name}" not found. Available: ${available.join(", ")}`
            )
            process.exit(1)
          }

          if (f.json) {
            console.log(
              JSON.stringify(
                { success: true, format: result.format, data: entry },
                null,
                2
              )
            )
            return
          }

          if (component) {
            renderComponentInfo(name, component)
          } else if (resource) {
            renderResourceInfo(name, resource)
          } else if (api) {
            renderFields([
              ["Name", styleInfo(name)],
              ["Kind", api.kind],
              ["Type", api.spec.type],
              ["Lifecycle", lifecycleColor(api.spec.lifecycle)],
              ["Definition", api.spec.definition],
            ])
          }

          renderDriftWarnings(result.drifts, !!f.quiet)
        })
    )
    .command("tree", (c) =>
      c
        .meta({ description: "Show dependency tree of catalog entries" })
        .flags({
          reverse: {
            type: "string",
            description: "Show what depends on a service (blast radius)",
          },
          layers: {
            type: "boolean",
            description: "Group by topological level (startup parallelism)",
          },
          focus: {
            type: "string",
            description: "Show only a service and its dependency chain",
          },
          mermaid: {
            type: "boolean",
            description: "Output mermaid graph syntax for docs/sharing",
          },
          "startup-order": {
            type: "boolean",
            description: "Flat numbered list in dependency-first startup order",
          },
          "show-init": {
            type: "boolean",
            description:
              "Show init/migration containers (collapsed by default)",
          },
          open: {
            type: "boolean",
            description:
              "Render mermaid diagram and open in browser (use with --mermaid)",
          },
        })
        .run(({ flags }) => {
          const f = toDxFlags(flags)
          const result = loadCatalog(process.cwd())

          if (!result) {
            console.error("No catalog source found.")
            process.exit(1)
          }

          const cat = result.catalog
          const initMap = buildInitMap(cat)
          const showInit = !!flags["show-init"]

          // Collapse init containers unless --show-init
          const fullGraph = DependencyGraph.fromCatalog(cat)
          const graph =
            showInit || initMap.size === 0
              ? fullGraph
              : fullGraph.collapse(new Set(initMap.keys()))

          // Filter init nodes from entityInfo when collapsed
          const entityInfo = buildEntityInfo(cat)
          if (!showInit && initMap.size > 0) {
            for (const initName of initMap.keys()) {
              entityInfo.delete(initName)
            }
          }

          const allConnections = buildServiceConnections(cat)
          // Filter init nodes from connections when collapsed
          let connections: ServiceConnections = allConnections
          if (!showInit && initMap.size > 0) {
            connections = new Map<string, string[]>()
            for (const [name, targets] of allConnections) {
              if (initMap.has(name)) continue
              const filtered = targets.filter((t) => !initMap.has(t))
              if (filtered.length > 0) connections.set(name, filtered)
            }
          }

          // Validate service references
          const reverse = flags.reverse as string | undefined
          const focus = flags.focus as string | undefined
          if (reverse && !graph.has(reverse)) {
            console.error(
              `Service "${reverse}" not found. Available: ${graph.allServices().join(", ")}`
            )
            process.exit(1)
          }
          if (focus && !graph.has(focus)) {
            console.error(
              `Service "${focus}" not found. Available: ${graph.allServices().join(", ")}`
            )
            process.exit(1)
          }

          // JSON output
          if (f.json) {
            if (reverse) {
              const affected = graph.transitiveDependents(reverse)
              console.log(
                JSON.stringify(
                  {
                    success: true,
                    mode: "reverse",
                    service: reverse,
                    affected,
                  },
                  null,
                  2
                )
              )
            } else if (flags.layers) {
              const levels = graph.topologicalLevels()
              console.log(
                JSON.stringify(
                  { success: true, mode: "layers", data: levels },
                  null,
                  2
                )
              )
            } else if (flags["startup-order"]) {
              const order = focus
                ? graph.startupOrder([focus])
                : graph.topologicalSort()
              console.log(
                JSON.stringify(
                  { success: true, mode: "startup-order", data: order },
                  null,
                  2
                )
              )
            } else {
              const g = focus ? graph.subgraphFor([focus]) : graph
              const data: Record<string, string[]> = {}
              for (const name of g.allServices()) {
                data[name] = g.directDeps(name)
              }
              console.log(JSON.stringify({ success: true, data }, null, 2))
            }
            return
          }

          // Mermaid output (no header/legend)
          if (flags.mermaid) {
            const mermaidSource = renderMermaid(
              graph,
              entityInfo,
              connections,
              { reverse, focus }
            )
            if (flags.open) {
              openMermaidInBrowser(mermaidSource, cat.metadata.name)
            } else {
              console.log(mermaidSource)
            }
            return
          }

          // Print header
          const worktree = getWorktreeInfo(process.cwd())
          let headerName = cat.metadata.name
          if (worktree) {
            headerName += ` ${styleMuted(`(worktree: ${worktree.worktreeName})`)}`
          }
          console.log(styleBold(headerName) + styleMuted(` (${result.owner})`))
          console.log("")

          // Print legend (except for layers/startup-order which are compact)
          if (!flags.layers && !flags["startup-order"]) {
            const legend = Object.entries(TYPE_ICONS)
              .map(([type, icon]) => `${icon} ${type}`)
              .join(styleMuted("  "))
            console.log(styleMuted(legend))
            console.log("")
          }

          // Dispatch to mode
          if (reverse) {
            console.log(renderReverseTree(graph, entityInfo, reverse))
          } else if (flags.layers) {
            console.log(renderLayers(graph, entityInfo))
          } else if (flags["startup-order"]) {
            console.log(
              renderStartupOrder(graph, entityInfo, focus ? [focus] : undefined)
            )
          } else {
            // Default or --focus: deduplicated tree
            const g = focus ? graph.subgraphFor([focus]) : graph
            const roots = g.roots()
            const startNodes = roots.length > 0 ? roots : g.allServices()
            console.log(
              renderTree(g, entityInfo, startNodes, (n) => g.directDeps(n))
            )
          }
        })
    )
    .command("status", (c) =>
      c
        .meta({ description: "Show catalog source and detected formats" })
        .run(({ flags }) => {
          const f = toDxFlags(flags)
          const cwd = process.cwd()
          const result = loadCatalog(cwd)
          const rootDir = result?.rootDir ?? cwd
          const detected = detectFormats(rootDir)

          if (f.json) {
            console.log(
              JSON.stringify(
                {
                  success: true,
                  data: {
                    active: result
                      ? { format: result.format, file: result.file }
                      : null,
                    detected: detected.map((d) => ({
                      format: d.format,
                      file: join(rootDir, d.file),
                    })),
                    rootDir,
                    generatedDir: join(rootDir, GENERATED_DIR),
                    components: result
                      ? Object.keys(result.catalog.components).length
                      : 0,
                    resources: result
                      ? Object.keys(result.catalog.resources).length
                      : 0,
                    drifts: result?.drifts ?? [],
                  },
                },
                null,
                2
              )
            )
            return
          }

          console.log(styleBold("Catalog Status"))
          console.log("")

          if (result) {
            console.log(
              `${styleMuted("Source:")}      ${styleSuccess(result.format)} ${styleMuted("(active)")}`
            )
            console.log(`${styleMuted("File:")}        ${result.file}`)
          } else {
            console.log(
              `${styleMuted("Source:")}      ${styleWarn("none")} — no catalog source found`
            )
          }

          console.log(`${styleMuted("Root:")}        ${rootDir}`)
          console.log(
            `${styleMuted("Generated:")}   ${join(rootDir, GENERATED_DIR)}`
          )

          if (result) {
            const nComp = Object.keys(result.catalog.components).length
            const nRes = Object.keys(result.catalog.resources).length
            const nApi = Object.keys(result.catalog.apis ?? {}).length
            console.log(
              `${styleMuted("Entries:")}     ${nComp} components, ${nRes} resources, ${nApi} APIs`
            )
          }

          console.log("")
          console.log(styleBold("Detected Formats:"))

          if (detected.length === 0) {
            console.log(styleMuted("  No catalog files found."))
          } else {
            for (const d of detected) {
              const isActive = d.format === result?.format
              const tag = isActive ? styleSuccess(" ← active") : ""
              console.log(
                `  ${styleInfo(d.format.padEnd(16))} ${styleMuted(d.file)}${tag}`
              )
            }
          }

          console.log("")
          console.log(styleMuted("Priority: docker-compose > backstage > helm"))

          // Drift section
          if (result && result.drifts.length > 0) {
            console.log("")
            console.log(styleBold(styleWarn("Drift:")))
            for (const d of result.drifts) {
              console.log(
                `  ${styleWarn("⚠")} ${styleBold(d.file)} differs from ${d.format} generation`
              )
              console.log(
                styleMuted(`    diff ${GENERATED_DIR}/${d.file} ${d.file}`)
              )
            }
          } else if (result) {
            console.log("")
            console.log(
              `${styleBold("Drift:")}       ${styleSuccess("none")} — all formats in sync`
            )
          }
        })
    )
    .command("doctor", (c) =>
      c
        .meta({
          description: "Diagnose and fix catalog labels in docker-compose",
        })
        .flags({
          fix: {
            type: "boolean",
            description: "Interactively add missing labels",
          },
          yes: {
            type: "boolean",
            short: "y",
            description: "Accept all defaults without prompting",
          },
          file: {
            type: "string",
            short: "f",
            description:
              "Path to docker-compose file (auto-detected if omitted)",
          },
          service: {
            type: "string",
            short: "s",
            description: "Only diagnose/fix a specific service",
          },
        })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags)
          await runCatalogDoctor(flags, f)
        })
    )
    .command("sync", (c) =>
      c
        .meta({ description: "Sync local catalog to the factory" })
        .flags({
          "dry-run": {
            type: "boolean",
            short: "d",
            description: "Preview what would be synced without making changes",
          },
        })
        .run(async ({ flags }) => {
          const { runCatalogSync } = await import("../handlers/catalog-sync.js")
          await runCatalogSync(toDxFlags(flags), {
            dryRun: Boolean(flags["dry-run"]),
          })
        })
    )
}
