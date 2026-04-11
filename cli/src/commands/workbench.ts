import { execFileSync } from "node:child_process"
import { userInfo } from "node:os"
import ora from "ora"

import { getFactoryClient, getFactoryRestClient } from "../client.js"
import type { FactoryEdenClient } from "../client.js"
import { readConfig, resolveFactoryUrl } from "../config.js"
import type { DxBase } from "../dx-root.js"
import {
  createLocalWorkbench,
  deleteLocalWorkbench,
  listLocalWorkbenches,
  showLocalWorkbench,
} from "../handlers/workbench/local-workbench.js"
import type { FactoryClient } from "../lib/api-client.js"
import { exitWithError } from "../lib/cli-exit.js"
import { addHostEntry, removeHostEntry } from "../lib/hosts-manager.js"
import { getRepoDisplayName } from "../lib/repo-picker.js"
import type { LocalWorkbenchInfo } from "../lib/worktree-detect.js"
import { printTable } from "../output.js"
import { setExamples } from "../plugins/examples-plugin.js"
import { toDxFlags } from "./dx-flags.js"
import {
  type ColumnOpt,
  actionResult,
  apiCall,
  colorStatus,
  detailView,
  styleBold,
  styleMuted,
  styleSuccess,
  tableOrJson,
  timeAgo,
} from "./list-helpers.js"

setExamples("workbench", [
  "$ dx workbench list                           List all workbenches (local + remote)",
  "$ dx workbench list --tier worktree           List local worktree workbenches",
  "$ dx workbench create my-ws --tier worktree   Create a worktree workbench",
  "$ dx workbench create my-ws                   Create a remote workbench",
  "$ dx workbench show my-ws                     Show workbench details",
  "$ dx workbench delete my-ws                   Delete a workbench",
])

const WS_BASE = "/api/v1/factory/ops/workbenches"
function wsPath(id?: string, action?: string): string {
  let p = WS_BASE
  if (id) p += `/${id}`
  if (action) p += `/${action}`
  return p
}

const SNAP_BASE = "/api/v1/factory/ops/workbench-snapshots"
function snapPath(id?: string, action?: string): string {
  let p = SNAP_BASE
  if (id) p += `/${id}`
  if (action) p += `/${action}`
  return p
}

// Returns the full factory client. Callers access Eden paths inline via S().
// NOTE: Do NOT pre-resolve Eden proxy paths and return/await them —
// Eden proxies are thenables, so `await` triggers an HTTP call.
async function getApi() {
  return getFactoryClient()
}
// Shorthand to reach the workbenches sub-path on the Eden proxy.
const S = (api: FactoryEdenClient) => api.api.v1.factory.ops.workbenches

async function waitForStatus(
  rest: FactoryClient,
  sandboxId: string,
  target: string,
  maxWaitMs: number
): Promise<boolean> {
  const spinner = ora({
    text: `Waiting for workbench to be ${target}...`,
    spinner: "dots",
  }).start()
  const interval = 2_000
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, interval))
    try {
      const poll = await rest.request<{ data?: Record<string, unknown> }>(
        "GET",
        wsPath(sandboxId)
      )
      const d = poll?.data
      const spec = (
        d?.spec && typeof d.spec === "object" ? d.spec : {}
      ) as Record<string, unknown>
      const status = (spec.lifecycle ?? d?.status ?? "") as string
      spinner.text = `Workbench status: ${status}...`
      if (status === target) {
        spinner.succeed(`Workbench is ${target}.`)
        return true
      }
    } catch {
      // ignore transient errors
    }
  }
  spinner.warn(`Timed out waiting for workbench to be ${target}.`)
  return false
}

async function waitForSnapshotStatus(
  rest: FactoryClient,
  snapshotId: string,
  terminal: string[],
  maxWaitMs: number = 120_000
): Promise<string> {
  const spinner = ora({
    text: `Waiting for snapshot...`,
    spinner: "dots",
  }).start()
  const interval = 3_000
  const start = Date.now()
  let status = "creating"
  while (Date.now() - start < maxWaitMs && !terminal.includes(status)) {
    await new Promise((r) => setTimeout(r, interval))
    try {
      const poll = await rest.request<{ data?: Record<string, unknown> }>(
        "GET",
        snapPath(snapshotId)
      )
      const d = poll?.data
      const spec = (
        d?.spec && typeof d.spec === "object" ? d.spec : {}
      ) as Record<string, unknown>
      status = (spec.lifecycle ?? d?.status ?? status) as string
      spinner.text = `Snapshot status: ${status}...`
    } catch {
      // ignore transient errors
    }
  }
  if (terminal.includes(status)) {
    spinner.succeed(`Snapshot is ${status}.`)
  } else {
    spinner.warn(`Timed out waiting for snapshot (status: ${status}).`)
  }
  return status
}

/** Run a command inside the workbench container via kubectl exec */
function kubectlExecInSandbox(
  podName: string,
  ns: string,
  cmd: string[],
  kubeContext?: string
): string {
  const args = [
    "exec",
    podName,
    "-n",
    ns,
    "-c",
    "workbench",
    ...(kubeContext ? ["--context", kubeContext] : []),
    "--",
    ...cmd,
  ]
  try {
    return execFileSync("kubectl", args, {
      encoding: "utf-8",
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim()
  } catch {
    return ""
  }
}

interface LogSource {
  name: string
  type: "container" | "docker" | "process" | "system"
  description: string
}

/** Discover all available log sources in a workbench */
function discoverLogSources(
  podName: string,
  ns: string,
  kubeContext?: string
): LogSource[] {
  const sources: LogSource[] = [
    {
      name: "workbench",
      type: "container",
      description: "Workbench container (k8s)",
    },
    {
      name: "dind",
      type: "container",
      description: "Docker-in-Docker sidecar (k8s)",
    },
    {
      name: "clone-repos",
      type: "container",
      description: "Repo clone init container (k8s)",
    },
    {
      name: "build",
      type: "container",
      description: "Envbuilder build phase only",
    },
  ]

  // Discover Docker containers inside DinD
  const dockerPs = kubectlExecInSandbox(
    podName,
    ns,
    ["docker", "ps", "--format", "{{.Names}}\t{{.Status}}\t{{.Ports}}"],
    kubeContext
  )
  if (dockerPs) {
    for (const line of dockerPs.split("\n").filter(Boolean)) {
      const [name, status, ports] = line.split("\t")
      sources.push({
        name,
        type: "docker",
        description: `Docker: ${status}${ports ? ` (${ports})` : ""}`,
      })
    }
  }

  // Discover running processes
  const psOutput = kubectlExecInSandbox(
    podName,
    ns,
    ["ps", "axo", "pid,comm,args", "--no-headers"],
    kubeContext
  )
  if (psOutput) {
    const seen = new Set<string>()
    for (const line of psOutput.split("\n").filter(Boolean)) {
      const parts = line.trim().split(/\s+/)
      const pid = parts[0]
      const comm = parts[1]
      const cmdline = parts.slice(2).join(" ")
      if (
        !comm ||
        ["sleep", "sh", "bash", "ps", "tee", "cat", "grep", "tail"].includes(
          comm
        )
      )
        continue
      if (seen.has(comm)) continue
      seen.add(comm)
      sources.push({
        name: comm,
        type: "process",
        description: `PID ${pid}: ${cmdline.slice(0, 60)}`,
      })
    }
  }

  // Discover system log files
  const logFiles = kubectlExecInSandbox(
    podName,
    ns,
    [
      "sh",
      "-c",
      "ls /var/log/syslog /var/log/messages /var/log/auth.log 2>/dev/null || true",
    ],
    kubeContext
  )
  if (logFiles) {
    for (const f of logFiles.split("\n").filter(Boolean)) {
      const basename = f.split("/").pop()!
      sources.push({
        name: basename,
        type: "system",
        description: `System log: ${f}`,
      })
    }
  }

  // Check for journald
  const hasJournald = kubectlExecInSandbox(
    podName,
    ns,
    [
      "sh",
      "-c",
      "command -v journalctl >/dev/null 2>&1 && echo yes || echo no",
    ],
    kubeContext
  )
  if (hasJournald === "yes") {
    sources.push({
      name: "journal",
      type: "system",
      description: "System journal (journalctl)",
    })
  }

  return sources
}

export function workbenchCommand(app: DxBase) {
  return (
    app
      .sub("workbench")
      .meta({ description: "Manage workbenches" })

      // --- create ---
      .command("create", (c) =>
        c
          .meta({ description: "Create a workbench" })
          .args([
            {
              name: "name",
              type: "string",
              description: "Workbench name (interactive if omitted)",
            },
          ])
          .flags({
            tier: {
              type: "string",
              description: "Isolation tier (worktree|container|vm)",
            },
            type: {
              type: "string",
              description: "Runtime type (container|vm)",
            },
            template: {
              type: "string",
              description: "Workbench template slug",
            },
            size: {
              type: "string",
              description: "Size preset: small, medium, large, xlarge",
            },
            ttl: {
              type: "number",
              description: "TTL in minutes (default from template)",
            },
            cpu: {
              type: "string",
              description: 'CPU spec (e.g. "2")',
            },
            memory: {
              type: "string",
              description: 'Memory spec (e.g. "4Gi")',
            },
            storage: {
              type: "number",
              description: "PVC size in GB",
            },
            repo: {
              type: "string",
              description: "Repo URL to clone",
            },
            branch: {
              type: "string",
              description:
                "Branch name (worktree tier) or branch for repo (remote tier)",
            },
            path: {
              type: "string",
              description: "Directory path override (worktree tier)",
            },
            "skip-install": {
              type: "boolean",
              description: "Skip dependency install (worktree tier)",
            },
            force: {
              type: "boolean",
              description:
                "Skip branch validation (worktree tier) or force deletion",
            },
            "owner-id": {
              type: "string",
              description: "Owner ID",
            },
            "owner-type": {
              type: "string",
              description: "Owner type (user|agent)",
            },
            cluster: {
              type: "string",
              description: "Cluster ID to deploy to (auto-selects if omitted)",
            },
            wait: {
              type: "boolean",
              alias: "w",
              description:
                "Wait for workbench to become active (default: true)",
            },
          })
          .run(async ({ args, flags }) => {
            let name = args.name as string | undefined

            // Mutable overrides — flags object is readonly, so collect mutations here
            const overrides: {
              cpu?: string
              memory?: string
              storage?: number
              repo?: string
              branch?: string
            } = {}

            // ── Interactive mode (no name provided) ──
            if (!name) {
              if (!process.stdout.isTTY) {
                console.error(
                  "Workbench name is required in non-interactive mode."
                )
                console.log(
                  styleMuted(
                    "Usage: dx workbench create <name> [--size medium] [--repo <url>]"
                  )
                )
                process.exit(1)
              }

              const { input, select, filter } = await import("@crustjs/prompts")
              const { WORKBENCH_PRESETS } =
                await import("../lib/workbench-presets.js")

              // 1. Name
              name = await input({
                message: "Workbench name",
                validate: (v) => v.trim().length > 0 || "Name is required",
              })

              // 2. Size
              const sizeChoices = [
                ...Object.entries(WORKBENCH_PRESETS).map(([key, p]) => ({
                  label: `${p.label.padEnd(8)} ${styleMuted(p.description)}`,
                  value: key,
                })),
                { label: "Custom", value: "custom" },
              ]
              const sizeChoice = await select({
                message: "Workbench size",
                choices: sizeChoices,
                default: "medium",
              })

              if (sizeChoice === "custom") {
                overrides.cpu = await input({
                  message: "CPU cores",
                  default: "2",
                })
                overrides.memory = await input({
                  message: "Memory",
                  default: "4Gi",
                })
                const storageStr = await input({
                  message: "Storage (GB)",
                  default: "20",
                })
                overrides.storage = parseInt(storageStr, 10)
              } else {
                const preset = WORKBENCH_PRESETS[sizeChoice]!
                overrides.cpu = preset.cpu
                overrides.memory = preset.memory
                overrides.storage = preset.storageGb
              }

              // 3. Repo selection
              try {
                const api = await getFactoryClient()
                const listRes = await api.api.v1.factory.build.repos.get()
                const repos = (listRes?.data?.data ?? []) as Array<{
                  name: string
                  kind?: string
                  gitUrl?: string
                  defaultBranch?: string
                }>

                if (repos.length > 0) {
                  const repoChoices = [
                    ...repos.map((r) => ({
                      label: `${getRepoDisplayName(r)} ${styleMuted(`(${r.kind ?? "repo"})`)}`,
                      value: r,
                      hint: r.gitUrl,
                    })),
                    {
                      label: styleMuted("None — empty workbench"),
                      value: null as (typeof repos)[0] | null,
                    },
                  ]
                  const chosen = await filter({
                    message: "Select a repo to clone",
                    choices: repoChoices,
                  })
                  if (chosen) {
                    overrides.repo = chosen.gitUrl
                    overrides.branch = await input({
                      message: `Branch for ${getRepoDisplayName(chosen)}`,
                      default: chosen.defaultBranch ?? "main",
                    })
                  }
                }
              } catch {
                // Repo listing failed — continue without repo
              }
            }

            // ── Size preset (non-interactive shorthand) ──
            if (flags.size && !flags.cpu && !flags.memory) {
              const { WORKBENCH_PRESETS } =
                await import("../lib/workbench-presets.js")
              const preset = WORKBENCH_PRESETS[flags.size as string]
              if (preset) {
                overrides.cpu = preset.cpu
                overrides.memory = preset.memory
                if (!flags.storage) overrides.storage = preset.storageGb
              }
            }

            // ── Worktree tier ──
            if (flags.tier === "worktree") {
              const f = toDxFlags(flags)
              try {
                const branch =
                  overrides.branch ?? (flags.branch as string) ?? name
                const result = await createLocalWorkbench({
                  name: name!,
                  branch,
                  path: flags.path as string | undefined,
                  skipInstall: flags["skip-install"] as boolean,
                  force: flags.force as boolean,
                })
                if (f.json) {
                  console.log(
                    JSON.stringify({ success: true, data: result }, null, 2)
                  )
                } else {
                  console.log(
                    styleSuccess(`Worktree workbench "${result.name}" created.`)
                  )
                  console.log(styleMuted(`  Path:     ${result.path}`))
                  console.log(styleMuted(`  Branch:   ${result.branch}`))
                  console.log(
                    styleMuted(`  Compose:  ${result.composeProject}`)
                  )
                  if (Object.keys(result.ports).length > 0) {
                    console.log(
                      styleMuted(
                        `  Ports:    ${Object.keys(result.ports).length} allocated`
                      )
                    )
                  }
                  console.log()
                  console.log(`  cd ${result.path}`)
                }
              } catch (err) {
                exitWithError(
                  f,
                  err instanceof Error ? err.message : String(err)
                )
              }
              return
            }

            // ── Remote tier (container/vm) ──
            const rest = await getFactoryRestClient()
            const spec: Record<string, unknown> = {}
            const effectiveCpu = overrides.cpu ?? flags.cpu
            const effectiveMemory = overrides.memory ?? flags.memory
            const effectiveStorage = overrides.storage ?? flags.storage
            const effectiveRepo = overrides.repo ?? flags.repo
            const effectiveBranch = overrides.branch ?? flags.branch
            if (flags.type) spec.realmType = flags.type
            if (flags.template) spec.templateSlug = flags.template
            if (flags.ttl) spec.ttlMinutes = flags.ttl
            if (effectiveCpu) spec.cpu = effectiveCpu
            if (effectiveMemory) spec.memory = effectiveMemory
            if (effectiveStorage) spec.storageGb = effectiveStorage
            if (effectiveRepo) {
              const repoUrl = effectiveRepo as string
              spec.repos = [
                {
                  url: repoUrl,
                  branch: effectiveBranch as string | undefined,
                },
              ]
            }
            if (flags.cluster) spec.clusterId = flags.cluster
            spec.ownerType = (flags["owner-type"] as string) || "user"
            const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, "-")
            const ownerId =
              (flags["owner-id"] as string) || `local:${userInfo().username}`
            const type = (flags.type as string) || "developer"
            const body: Record<string, unknown> = {
              name,
              slug,
              type,
              ownerId,
              spec,
            }
            const result = await rest.request<{ data?: { id?: string } }>(
              "POST",
              WS_BASE,
              body
            )
            const resultData = result?.data
            if (!resultData?.id) {
              actionResult(
                flags,
                result,
                styleSuccess(`Workbench "${name}" created.`)
              )
              return
            }

            const sandboxId = resultData.id
            const shouldWait = flags.wait !== false

            if (shouldWait) {
              const spinner = ora({
                text: "Provisioning workbench...",
                spinner: "dots",
              }).start()
              const maxWait = 60_000
              const interval = 2_000
              const startMs = Date.now()
              let status = "provisioning"

              while (
                Date.now() - startMs < maxWait &&
                status === "provisioning"
              ) {
                await new Promise((r) => setTimeout(r, interval))
                try {
                  const poll = await rest.request<{
                    data?: Record<string, unknown>
                  }>("GET", wsPath(sandboxId))
                  const d = poll?.data
                  const spc = (
                    d?.spec && typeof d.spec === "object" ? d.spec : {}
                  ) as Record<string, unknown>
                  status = (spc.lifecycle ?? d?.status ?? status) as string
                  spinner.text = `Workbench status: ${status}...`
                } catch {
                  // ignore transient errors
                }
              }

              if (status === "active") {
                spinner.succeed(`Workbench "${name}" is active.`)
                const poll = await rest.request<{
                  data?: Record<string, unknown>
                }>("GET", wsPath(sandboxId))
                const sbxData = poll?.data
                const spc = (
                  sbxData?.spec && typeof sbxData.spec === "object"
                    ? sbxData.spec
                    : {}
                ) as Record<string, unknown>
                const webTerminalUrl =
                  spc.webTerminalUrl ?? sbxData?.webTerminalUrl
                const webIdeUrl = spc.webIdeUrl ?? sbxData?.webIdeUrl
                const sshHost = spc.sshHost ?? sbxData?.sshHost
                const sshPort = spc.sshPort ?? sbxData?.sshPort
                if (webTerminalUrl) {
                  console.log(styleMuted(`  Terminal: ${webTerminalUrl}`))
                }
                if (webIdeUrl) {
                  console.log(styleMuted(`  IDE:      ${webIdeUrl}`))
                }
                if (sshHost && sshPort) {
                  console.log(
                    styleMuted(`  SSH:      ssh -p ${sshPort} ${sshHost}`)
                  )
                }
                // Add /etc/hosts entry for local gateway routing
                const cfg = await readConfig()
                const factoryUrl = resolveFactoryUrl(cfg)
                if (
                  factoryUrl.includes("localhost") ||
                  factoryUrl.includes("127.0.0.1")
                ) {
                  const wksSlug = (sbxData?.slug as string) ?? name
                  await addHostEntry(wksSlug, "workbench")
                }
              } else {
                spinner.warn(
                  `Workbench status: ${status} (may still be provisioning)`
                )
              }
            } else {
              actionResult(
                flags,
                result,
                styleSuccess(
                  `Workbench "${name}" created (provisioning in background).`
                )
              )
            }
          })
      )

      // --- list ---
      .command("list", (c) =>
        c
          .meta({ description: "List workbenches" })
          .flags({
            tier: {
              type: "string",
              description: "Filter by tier (worktree|container|vm)",
            },
            all: {
              type: "boolean",
              alias: "a",
              description: "Include stopped/destroyed workbenches",
            },
            status: {
              type: "string",
              alias: "s",
              description: "Filter by status",
            },
            "owner-id": {
              type: "string",
              description: "Filter by owner ID",
            },
            runtime: {
              type: "string",
              description: "Filter by runtime (container|vm)",
            },
            sort: {
              type: "string",
              description: "Sort by: name, status, created (default: name)",
            },
            limit: {
              type: "number",
              alias: "n",
              description: "Limit results (default: 50)",
            },
            project: {
              type: "string",
              alias: "p",
              description:
                "Filter worktrees to a specific project (e.g., factory)",
            },
          })
          .run(async ({ flags }) => {
            const f = toDxFlags(flags)
            const tier = flags.tier as string | undefined
            const project = flags.project as string | undefined

            if (tier && !["worktree", "container", "vm"].includes(tier)) {
              exitWithError(
                f,
                `Invalid tier "${tier}". Must be one of: worktree, container, vm`
              )
              return
            }

            // Collect data from both local and remote sources
            const localWorkbenches: Awaited<
              ReturnType<typeof listLocalWorkbenches>
            > = []
            const remoteItems: Record<string, unknown>[] = []

            // Local worktrees
            if (!tier || tier === "worktree") {
              try {
                localWorkbenches.push(
                  ...(await listLocalWorkbenches({ project }))
                )
              } catch {
                // No git repo or detection failed — skip local
              }
            }

            // Remote workbenches
            if (!tier || tier !== "worktree") {
              try {
                const api = await getApi()
                const status = flags.all
                  ? undefined
                  : (flags.status as string | undefined)
                const result = await apiCall(flags, () =>
                  S(api).get({
                    query: {
                      status,
                      ownerId: flags["owner-id"] as string | undefined,
                      realmType: flags.runtime as string | undefined,
                    },
                  })
                )
                const items = Array.isArray(result?.data) ? result.data : []
                remoteItems.push(...items)
              } catch {
                // Factory API unavailable — skip remote
                if (tier && tier !== "worktree") {
                  console.error(
                    "Failed to connect to Factory API for remote workbenches."
                  )
                  process.exit(1)
                }
              }
            }

            if (f.json) {
              const data = [
                ...localWorkbenches,
                ...remoteItems.map((r: Record<string, unknown>) => {
                  const spec = (
                    r.spec && typeof r.spec === "object" ? r.spec : {}
                  ) as Record<string, unknown>
                  return {
                    name: String(r.name ?? ""),
                    tier: String(spec.realmType ?? "container"),
                    status: String(spec.lifecycle ?? ""),
                    owner: String(r.ownerId ?? ""),
                    id: String(r.id ?? ""),
                    createdAt: String(r.createdAt ?? ""),
                  }
                }),
              ]
              console.log(JSON.stringify({ success: true, data }, null, 2))
              return
            }

            // Build table rows
            const rows: string[][] = []
            for (const w of localWorkbenches) {
              rows.push([
                styleBold(w.name),
                "worktree",
                w.branch,
                w.path,
                w.commit,
                timeAgo(w.createdAt ?? ""),
              ])
            }
            for (const r of remoteItems) {
              const spec = (
                r.spec && typeof r.spec === "object" ? r.spec : {}
              ) as Record<string, unknown>
              rows.push([
                styleBold(String(r.name ?? "")),
                String(spec.realmType ?? "container"),
                colorStatus(String(spec.lifecycle ?? "")),
                String(r.ownerId ?? ""),
                styleMuted(String(r.id ?? "").slice(0, 8)),
                timeAgo(String(r.createdAt)),
              ])
            }

            if (rows.length === 0) {
              console.log("No workbenches found.")
              return
            }

            const headers =
              tier === "worktree"
                ? ["Name", "Tier", "Branch", "Path", "Commit", "Created"]
                : [
                    "Name",
                    "Tier",
                    "Status/Branch",
                    "Path/Owner",
                    "ID/Commit",
                    "Created",
                  ]
            console.log(printTable(headers, rows))
          })
      )

      // --- show ---
      .command("show", (c) =>
        c
          .meta({ description: "Show workbench details" })
          .args([
            {
              name: "id",
              type: "string",
              required: true,
              description: "Workbench name, ID, or slug",
            },
          ])
          .run(async ({ args, flags }) => {
            const f = toDxFlags(flags)

            // Try local worktree first
            try {
              const local = await showLocalWorkbench(args.id)
              if (local) {
                if (f.json) {
                  console.log(
                    JSON.stringify({ success: true, data: local }, null, 2)
                  )
                  return
                }
                const portCount = Object.keys(local.ports).length
                const fields: [string, string][] = [
                  ["Name", styleBold(local.name)],
                  ["Tier", "worktree"],
                  ["Path", local.path],
                  ["Branch", local.branch],
                  ["Commit", local.commit],
                  ["Compose", local.composeProject],
                  ["Ports", portCount > 0 ? `${portCount} allocated` : "none"],
                  ["Created", local.createdAt ? timeAgo(local.createdAt) : "-"],
                ]
                if (portCount > 0) {
                  for (const [key, port] of Object.entries(local.ports)) {
                    fields.push([`  ${key}`, String(port)])
                  }
                }
                const maxLabel = Math.max(...fields.map(([l]) => l.length))
                for (const [label, value] of fields) {
                  console.log(`${styleMuted(label.padEnd(maxLabel))}  ${value}`)
                }
                return
              }
            } catch {
              // Local detection failed — fall through to remote
            }

            // Fall through to remote API
            const rest = await getFactoryRestClient()
            const result = await rest.request<{
              data?: Record<string, unknown>
            }>("GET", wsPath(args.id))
            const d = result?.data
            const spc = (
              d?.spec && typeof d.spec === "object" ? d.spec : {}
            ) as Record<string, unknown>
            if (f.json) {
              console.log(JSON.stringify({ success: true, data: d }, null, 2))
              return
            }
            if (!d) {
              console.log("Not found.")
              return
            }
            const fields: [string, string][] = [
              ["ID", styleMuted(String(d.id ?? ""))],
              ["Name", styleBold(String(d.name ?? ""))],
              ["Tier", String(spc.realmType ?? "container")],
              ["Status", colorStatus(String(spc.lifecycle ?? ""))],
              ["Health", colorStatus(String(spc.healthStatus ?? "unknown"))],
              ["CPU", String(spc.cpu ?? "")],
              ["Memory", String(spc.memory ?? "")],
              ["Storage", spc.storageGb ? `${spc.storageGb}GB` : ""],
              ["Template", String(d.templateId ?? "")],
              ["Owner", String(d.ownerId ?? "")],
              ["Owner Type", String(spc.ownerType ?? "")],
              ["Terminal", String(spc.webTerminalUrl ?? "")],
              ["IDE", String(spc.webIdeUrl ?? "")],
              ["Created", timeAgo(String(d.createdAt))],
            ]
            const maxLabel = Math.max(...fields.map(([l]) => l.length))
            for (const [label, value] of fields) {
              console.log(`${styleMuted(label.padEnd(maxLabel))}  ${value}`)
            }
          })
      )

      // --- start ---
      .command("start", (c) =>
        c
          .meta({ description: "Start a workbench" })
          .args([
            {
              name: "id",
              type: "string",
              required: true,
              description: "Workbench ID or slug",
            },
          ])
          .run(async ({ args, flags }) => {
            const rest = await getFactoryRestClient()
            await rest.request("POST", wsPath(args.id, "start"), {})
            process.stdout.write(styleMuted("Starting workbench..."))
            const ok = await waitForStatus(rest, args.id, "active", 60_000)
            console.log()
            if (ok) {
              console.log(styleSuccess(`Workbench ${args.id} started.`))
            } else {
              console.log(
                styleMuted(
                  `Workbench ${args.id} start initiated (may still be starting).`
                )
              )
            }
          })
      )

      // --- stop ---
      .command("stop", (c) =>
        c
          .meta({ description: "Stop a workbench" })
          .args([
            {
              name: "id",
              type: "string",
              required: true,
              description: "Workbench ID or slug",
            },
          ])
          .run(async ({ args, flags }) => {
            const rest = await getFactoryRestClient()
            await rest.request("POST", wsPath(args.id, "stop"), {})
            process.stdout.write(styleMuted("Stopping workbench..."))
            const ok = await waitForStatus(rest, args.id, "suspended", 30_000)
            console.log()
            if (ok) {
              console.log(styleSuccess(`Workbench ${args.id} stopped.`))
            } else {
              console.log(
                styleMuted(
                  `Workbench ${args.id} stop initiated (may still be in progress).`
                )
              )
            }
          })
      )

      // --- delete ---
      .command("delete", (c) =>
        c
          .meta({ description: "Delete a workbench" })
          .args([
            {
              name: "id",
              type: "string",
              required: true,
              description: "Workbench name, ID, or slug",
            },
          ])
          .flags({
            force: {
              type: "boolean",
              description:
                "Force deletion even with uncommitted changes (worktree tier)",
            },
          })
          .run(async ({ args, flags }) => {
            const f = toDxFlags(flags)

            // Try local worktree first
            try {
              const local = await showLocalWorkbench(args.id)
              if (local) {
                try {
                  await deleteLocalWorkbench(args.id, {
                    force: flags.force as boolean,
                    resolved: local,
                  })
                  if (f.json) {
                    console.log(
                      JSON.stringify({ success: true, name: local.name })
                    )
                  } else {
                    console.log(
                      styleSuccess(
                        `Worktree workbench "${local.name}" deleted.`
                      )
                    )
                  }
                } catch (err) {
                  exitWithError(
                    f,
                    err instanceof Error ? err.message : String(err)
                  )
                }
                return
              }
            } catch {
              // Local detection failed — fall through to remote
            }

            // Remote delete:
            // 1. Set lifecycle → "destroying" via action (preserves full spec)
            // 2. Reconciler cleans up k8s, sets lifecycle → "destroyed"
            // 3. Bitemporal-delete the DB record
            const rest = await getFactoryRestClient()
            await rest.request("POST", wsPath(args.id, "destroy"), {})
            process.stdout.write(styleMuted("Destroying workbench..."))
            const ok = await waitForStatus(rest, args.id, "destroyed", 60_000)
            console.log()
            try {
              await rest.request("POST", wsPath(args.id, "delete"), {})
            } catch {
              // Record may already be gone
            }
            if (ok) {
              console.log(styleSuccess(`Workbench ${args.id} destroyed.`))
              const cfg = await readConfig()
              const factoryUrl = resolveFactoryUrl(cfg)
              if (
                factoryUrl.includes("localhost") ||
                factoryUrl.includes("127.0.0.1")
              ) {
                await removeHostEntry(args.id, "workbench")
              }
            } else {
              console.log(
                styleMuted(
                  `Workbench ${args.id} delete initiated (may still be destroying).`
                )
              )
            }
          })
      )

      // --- resize ---
      .command("resize", (c) =>
        c
          .meta({ description: "Resize a workbench" })
          .args([
            {
              name: "id",
              type: "string",
              required: true,
              description: "Workbench ID or slug",
            },
          ])
          .flags({
            cpu: {
              type: "string",
              description: 'CPU spec (e.g. "2000m")',
            },
            memory: {
              type: "string",
              description: 'Memory spec (e.g. "4Gi")',
            },
            storage: {
              type: "number",
              description: "PVC size in GB",
            },
          })
          .run(async ({ args, flags }) => {
            const rest = await getFactoryRestClient()
            const body: Record<string, unknown> = {}
            if (flags.cpu) body.cpu = flags.cpu
            if (flags.memory) body.memory = flags.memory
            if (flags.storage) body.storageGb = flags.storage
            const result = await rest.request(
              "POST",
              wsPath(args.id, "resize"),
              body
            )
            actionResult(
              flags,
              result,
              styleSuccess(`Workbench ${args.id} resized.`)
            )
          })
      )

      // --- extend ---
      .command("extend", (c) =>
        c
          .meta({ description: "Extend workbench TTL" })
          .args([
            {
              name: "id",
              type: "string",
              required: true,
              description: "Workbench ID or slug",
            },
          ])
          .flags({
            minutes: {
              type: "number",
              required: true,
              description: "Minutes to extend by",
            },
          })
          .run(async ({ args, flags }) => {
            const rest = await getFactoryRestClient()
            const result = await rest.request(
              "POST",
              wsPath(args.id, "extend"),
              { additionalMinutes: flags.minutes as number }
            )
            actionResult(
              flags,
              result,
              styleSuccess(
                `Workbench ${args.id} TTL extended by ${flags.minutes} minutes.`
              )
            )
          })
      )

      // --- snapshot ---
      .command("snapshot", (c) =>
        c
          .meta({ description: "Manage workbench snapshots" })
          .command("create", (sc) =>
            sc
              .meta({ description: "Create a snapshot of a workbench" })
              .args([
                {
                  name: "id",
                  type: "string",
                  required: true,
                  description: "Workbench ID or slug",
                },
              ])
              .flags({
                name: {
                  type: "string",
                  required: true,
                  description: "Snapshot name",
                },
                description: {
                  type: "string",
                  description: "Snapshot description",
                },
                wait: {
                  type: "boolean",
                  alias: "w",
                  description: "Wait for snapshot to be ready (default: true)",
                },
              })
              .run(async ({ args, flags }) => {
                const rest = await getFactoryRestClient()
                const body: Record<string, unknown> = {
                  name: flags.name as string,
                }
                if (flags.description) body.description = flags.description
                const result = await rest.request<{ data?: { id?: string } }>(
                  "POST",
                  `${wsPath(args.id)}/workbench-snapshots`,
                  body
                )
                const snapshotId = result?.data?.id
                if (!snapshotId || flags.wait === false) {
                  actionResult(
                    flags,
                    result,
                    styleSuccess(
                      `Snapshot "${flags.name}" created for workbench ${args.id}.`
                    )
                  )
                  return
                }
                process.stdout.write(styleMuted("Creating snapshot..."))
                const finalStatus = await waitForSnapshotStatus(
                  rest,
                  snapshotId,
                  ["ready", "failed"]
                )
                console.log()
                if (finalStatus === "ready") {
                  console.log(
                    styleSuccess(
                      `Snapshot "${flags.name}" is ready (${snapshotId}).`
                    )
                  )
                } else {
                  console.log(
                    `Snapshot "${flags.name}" ${finalStatus} (${snapshotId}).`
                  )
                }
              })
          )
          .command("list", (sc) =>
            sc
              .meta({ description: "List snapshots for a workbench" })
              .args([
                {
                  name: "id",
                  type: "string",
                  required: true,
                  description: "Workbench ID or slug",
                },
              ])
              .run(async ({ args, flags }) => {
                const rest = await getFactoryRestClient()
                const result = await rest.request<{
                  data?: Record<string, unknown>[]
                }>("GET", `${wsPath(args.id)}/workbench-snapshots`)
                const f = toDxFlags(flags)
                if (f.json) {
                  console.log(
                    JSON.stringify({ success: true, data: result }, null, 2)
                  )
                  return
                }
                const items = Array.isArray(result?.data) ? result.data : []
                if (items.length === 0) {
                  console.log("No snapshots found.")
                  return
                }
                const { printTable } = await import("../output.js")
                const rows = items.map((r) => {
                  const spec = (
                    r.spec && typeof r.spec === "object" ? r.spec : {}
                  ) as Record<string, unknown>
                  return [
                    styleMuted(String(r.id ?? "")),
                    colorStatus(String(spec.status ?? "")),
                    spec.sizeBytes
                      ? `${Math.round(Number(spec.sizeBytes) / 1024 / 1024)}MB`
                      : "-",
                    timeAgo(String(r.createdAt)),
                  ]
                })
                console.log(
                  printTable(["ID", "Status", "Size", "Created"], rows)
                )
              })
          )
      )

      // --- restore ---
      .command("restore", (c) =>
        c
          .meta({ description: "Restore a workbench from a snapshot" })
          .args([
            {
              name: "id",
              type: "string",
              required: true,
              description: "Workbench ID or slug",
            },
          ])
          .flags({
            snapshot: {
              type: "string",
              required: true,
              description: "Snapshot ID to restore from",
            },
            wait: {
              type: "boolean",
              alias: "w",
              description:
                "Wait for workbench to become active after restore (default: true)",
            },
          })
          .run(async ({ args, flags }) => {
            const rest = await getFactoryRestClient()
            const result = await rest.request(
              "POST",
              snapPath(flags.snapshot as string, "restore"),
              {}
            )
            // args.id is the workbench, but the restore endpoint is on the snapshot
            if (flags.wait !== false) {
              process.stdout.write(styleMuted("Restoring workbench..."))
              const ready = await waitForStatus(
                rest,
                args.id,
                "active",
                120_000
              )
              console.log()
              if (ready) {
                console.log(
                  styleSuccess(
                    `Workbench ${args.id} restored from snapshot ${flags.snapshot}.`
                  )
                )
              } else {
                console.log(
                  `Workbench ${args.id} restore may still be in progress. Check with: dx workbench show ${args.id}`
                )
              }
            } else {
              actionResult(
                flags,
                result,
                styleSuccess(
                  `Workbench restore triggered from snapshot ${flags.snapshot}.`
                )
              )
            }
          })
      )

      // --- clone ---
      .command("clone", (c) =>
        c
          .meta({ description: "Clone a workbench from a snapshot" })
          .flags({
            snapshot: {
              type: "string",
              required: true,
              description: "Snapshot ID to clone from",
            },
            name: {
              type: "string",
              required: true,
              description: "Name for the new workbench",
            },
          })
          .run(async ({ flags }) => {
            const rest = await getFactoryRestClient()
            const result = await rest.request(
              "POST",
              snapPath(flags.snapshot as string, "clone"),
              { name: flags.name as string }
            )
            actionResult(
              flags,
              result,
              styleSuccess(
                `Workbench "${flags.name}" cloned from snapshot ${flags.snapshot}.`
              )
            )
          })
      )

      // --- share ---
      .command("share", (c) =>
        c
          .meta({ description: "Share a workbench with a user" })
          .args([
            {
              name: "id",
              type: "string",
              required: true,
              description: "Workbench ID or slug",
            },
          ])
          .flags({
            user: {
              type: "string",
              required: true,
              description: "Principal ID to share with",
            },
            role: {
              type: "string",
              description: "Role (editor|viewer, default: viewer)",
            },
          })
          .run(async ({ args, flags }) => {
            const rest = await getFactoryRestClient()
            const result = await rest.request(
              "POST",
              wsPath(args.id, "access"),
              {
                principalId: flags.user as string,
                role: (flags.role as string) ?? "viewer",
              }
            )
            actionResult(
              flags,
              result,
              styleSuccess(`Workbench ${args.id} shared with ${flags.user}.`)
            )
          })
      )

      // --- unshare ---
      .command("unshare", (c) =>
        c
          .meta({ description: "Revoke workbench access for a user" })
          .args([
            {
              name: "id",
              type: "string",
              required: true,
              description: "Workbench ID or slug",
            },
          ])
          .flags({
            user: {
              type: "string",
              required: true,
              description: "Principal ID to revoke",
            },
          })
          .run(async ({ args, flags }) => {
            const rest = await getFactoryRestClient()
            const result = await rest.request(
              "POST",
              `${wsPath(args.id)}/access/${flags.user as string}/delete`,
              {}
            )
            actionResult(
              flags,
              result,
              styleSuccess(
                `Access revoked for ${flags.user} on workbench ${args.id}.`
              )
            )
          })
      )

      // --- access ---
      .command("access", (c) =>
        c
          .meta({ description: "List who has access to a workbench" })
          .args([
            {
              name: "id",
              type: "string",
              required: true,
              description: "Workbench ID or slug",
            },
          ])
          .run(async ({ args, flags }) => {
            const rest = await getFactoryRestClient()
            const result = await rest.request<{
              data?: Record<string, unknown>[]
            }>("GET", wsPath(args.id, "access"))
            const f = toDxFlags(flags)
            if (f.json) {
              console.log(
                JSON.stringify({ success: true, data: result }, null, 2)
              )
              return
            }
            const items = Array.isArray(result?.data) ? result.data : []
            if (items.length === 0) {
              console.log("No access entries.")
              return
            }
            const { printTable } = await import("../output.js")
            const rows = items.map((r) => [
              styleBold(String(r.principalId ?? "")),
              String(r.role ?? ""),
              timeAgo(r.createdAt as string),
            ])
            console.log(printTable(["Principal", "Role", "Granted"], rows))
          })
      )

      // --- exec ---
      .command("exec", (c) =>
        c
          .meta({ description: "Execute a command in a workbench" })
          .args([
            {
              name: "id",
              type: "string",
              required: true,
              description: "Workbench ID or slug",
            },
            {
              name: "command",
              type: "string",
              description: "Command to execute",
            },
          ])
          .flags({
            container: {
              type: "string",
              description: "Container name (default: workbench)",
            },
          })
          .run(async ({ args, flags }) => {
            const slugOrId = args.id
            const cmd = args.command ?? "bash"

            // Resolve workbench to get pod info
            const api = await getApi()
            const result = await apiCall(flags, () =>
              S(api)({ slugOrId }).get()
            )
            const wksData = result?.data ?? result
            const wks = (
              wksData && typeof wksData === "object" ? wksData : {}
            ) as Record<string, unknown>
            const wksSlug = (wks.slug ?? slugOrId) as string
            const podName = `workbench-${wksSlug}`
            const ns = `workbench-${wksSlug}`
            const container = (flags.container as string) ?? "workbench"

            const { spawnSync } = await import("node:child_process")
            try {
              const result = spawnSync(
                "kubectl",
                [
                  "exec",
                  "-it",
                  podName,
                  "-n",
                  ns,
                  "-c",
                  container,
                  "--",
                  ...cmd.split(" "),
                ],
                { stdio: "inherit" }
              )
              process.exitCode = result.status ?? 1
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              console.error(`exec failed: ${msg}`)
              process.exitCode = 1
            }
          })
      )

      // --- logs ---
      .command("logs", (c) =>
        c
          .meta({ description: "Stream workbench logs" })
          .args([
            {
              name: "id",
              type: "string",
              required: true,
              description: "Workbench ID or slug",
            },
          ])
          .flags({
            follow: {
              type: "boolean",
              alias: "f",
              description: "Follow log output (default: true)",
            },
            tail: {
              type: "number",
              description: "Lines to show (default: 100)",
            },
            container: {
              type: "string",
              alias: "c",
              description:
                "Container (workbench, dind, clone-repos, build) or Docker container name",
            },
            source: {
              type: "string",
              alias: "s",
              description: "Log source: k8s, docker, process, journal, system",
            },
            discover: {
              type: "boolean",
              description: "List all available log sources in the workbench",
            },
          })
          .run(async ({ args, flags }) => {
            const slugOrId = args.id
            const api = await getApi()
            const result = await apiCall(flags, () =>
              S(api)({ slugOrId }).get()
            )
            const wksData = result?.data ?? result
            const wks = (
              wksData && typeof wksData === "object" ? wksData : {}
            ) as Record<string, unknown>
            const wksSlug = (wks.slug ?? slugOrId) as string
            const podName = `workbench-${wksSlug}`
            const ns = `workbench-${wksSlug}`

            // Discover mode
            if (flags.discover) {
              const sources = discoverLogSources(podName, ns)
              if (toDxFlags(flags).json) {
                console.log(JSON.stringify(sources, null, 2))
              } else {
                console.log(styleBold("Available log sources:"))
                for (const s of sources) {
                  console.log(
                    `  ${styleBold(s.name)} (${s.type}) — ${s.description}`
                  )
                }
              }
              return
            }

            const tail = (flags.tail as number) ?? 100
            const follow = flags.follow !== false
            const container = (flags.container as string) ?? "workbench"
            const source = flags.source as string | undefined

            const { spawn } = await import("node:child_process")

            // Docker container logs (run inside workbench via kubectl exec)
            if (
              source === "docker" ||
              (container &&
                !["workbench", "dind", "clone-repos", "build"].includes(
                  container
                ))
            ) {
              const dockerCmd = follow
                ? `docker logs -f --tail ${tail} ${container}`
                : `docker logs --tail ${tail} ${container}`
              const child = spawn(
                "kubectl",
                [
                  "exec",
                  podName,
                  "-n",
                  ns,
                  "-c",
                  "workbench",
                  "--",
                  "sh",
                  "-c",
                  dockerCmd,
                ],
                { stdio: "inherit" }
              )
              child.on("exit", (code) => {
                process.exitCode = code ?? 0
              })
              return
            }

            // Process logs (via journal or /proc)
            if (source === "process") {
              const processName = container
              const journalCmd = `journalctl -u ${processName} -n ${tail} ${follow ? "-f" : ""} --no-pager 2>/dev/null || tail ${follow ? "-f" : ""} -n ${tail} /var/log/${processName}.log 2>/dev/null || echo "No logs found for process ${processName}"`
              const child = spawn(
                "kubectl",
                [
                  "exec",
                  podName,
                  "-n",
                  ns,
                  "-c",
                  "workbench",
                  "--",
                  "sh",
                  "-c",
                  journalCmd,
                ],
                { stdio: "inherit" }
              )
              child.on("exit", (code) => {
                process.exitCode = code ?? 0
              })
              return
            }

            // System journal
            if (source === "journal") {
              const journalCmd = `journalctl -n ${tail} ${follow ? "-f" : ""} --no-pager`
              const child = spawn(
                "kubectl",
                [
                  "exec",
                  podName,
                  "-n",
                  ns,
                  "-c",
                  "workbench",
                  "--",
                  "sh",
                  "-c",
                  journalCmd,
                ],
                { stdio: "inherit" }
              )
              child.on("exit", (code) => {
                process.exitCode = code ?? 0
              })
              return
            }

            // System log files
            if (source === "system") {
              const logFile = `/var/log/${container}`
              const tailCmd = `tail ${follow ? "-f" : ""} -n ${tail} ${logFile}`
              const child = spawn(
                "kubectl",
                [
                  "exec",
                  podName,
                  "-n",
                  ns,
                  "-c",
                  "workbench",
                  "--",
                  "sh",
                  "-c",
                  tailCmd,
                ],
                { stdio: "inherit" }
              )
              child.on("exit", (code) => {
                process.exitCode = code ?? 0
              })
              return
            }

            // Default: k8s container logs
            const kubectlArgs = [
              "logs",
              podName,
              "-n",
              ns,
              "-c",
              container,
              `--tail=${tail}`,
            ]
            if (follow) kubectlArgs.push("-f")

            const child = spawn("kubectl", kubectlArgs, { stdio: "inherit" })
            child.on("exit", (code) => {
              process.exitCode = code ?? 0
            })
          })
      )

      // --- open ---
      .command("open", (c) =>
        c
          .meta({ description: "Open workbench in browser" })
          .args([
            {
              name: "id",
              type: "string",
              required: true,
              description: "Workbench ID or slug",
            },
          ])
          .flags({
            ide: {
              type: "boolean",
              description: "Open web IDE instead of terminal",
            },
          })
          .run(async ({ args, flags }) => {
            const rest = await getFactoryRestClient()
            const result = await rest.request<{
              data?: Record<string, unknown>
            }>("GET", wsPath(args.id))
            const d = result?.data
            const spc = (
              d?.spec && typeof d.spec === "object" ? d.spec : {}
            ) as Record<string, unknown>
            const url = flags.ide
              ? (spc.webIdeUrl ?? d?.webIdeUrl)
              : (spc.webTerminalUrl ?? d?.webTerminalUrl)
            if (!url) {
              console.error(
                `No ${flags.ide ? "IDE" : "terminal"} URL available for workbench ${args.id}.`
              )
              process.exitCode = 1
              return
            }
            const openCmd = process.platform === "darwin" ? "open" : "xdg-open"
            const { exec: execCmd } = await import("../lib/subprocess.js")
            try {
              await execCmd([openCmd, String(url)])
            } catch {
              console.log(`Open in browser: ${url}`)
            }
          })
      )
  )
}
