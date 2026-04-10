/**
 * dx doctor — workbench health checks.
 *
 * Categories:
 *   toolchain  — required dev tools (node, java, python, docker, etc.)
 *   defaults   — machine-level configs (git, npm, ssh, etc.)
 *   auth       — factory auth + registry credentials
 *   workbench  — identity, registration status
 *   workspace  — delegates to dx pkg doctor if inside a workspace
 */
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import ora from "ora"

import {
  styleBold,
  styleError,
  styleInfo,
  styleMuted,
  styleSuccess,
  styleWarn,
} from "../cli-style.js"
import { readConfig, resolveFactoryMode } from "../config.js"
import { printToolchainResults } from "../lib/cli-ui.js"
import {
  getAuthServiceToken,
  getAuthServiceTokenForProfile,
  resolveActiveProfile,
} from "../session-token.js"
import { runToolchainChecks } from "./install/toolchain.js"
import { readWorkbenchConfig } from "./install/workbench-identity.js"
import { registryAuthStore } from "./pkg/registry-auth-store.js"

export interface DoctorOptions {
  category?: string
  json?: boolean
  verbose?: boolean
}

interface DoctorResult {
  category: string
  passed: boolean
  details: Record<string, unknown>
}

async function checkToolchain(verbose?: boolean): Promise<DoctorResult> {
  const spinner = ora({
    text: "Checking toolchain...",
    prefixText: " ",
  }).start()
  const result = await runToolchainChecks()
  spinner.stop()
  printToolchainResults(result.checks)

  return {
    category: "toolchain",
    passed: result.passed,
    details: {
      checks: result.checks.map((c) => ({
        name: c.name,
        passed: c.passed,
        version: c.version,
        required: c.required,
      })),
    },
  }
}

async function checkAuth(): Promise<DoctorResult> {
  console.log("\n  Auth")

  // Factory auth
  const profile = resolveActiveProfile()
  const token =
    profile === "default"
      ? await getAuthServiceToken()
      : await getAuthServiceTokenForProfile(profile)

  if (token) {
    console.log(
      `  ${styleSuccess("✔")} Factory auth${profile !== "default" ? ` (profile: ${profile})` : ""}`
    )
  } else {
    console.log(
      `  ${styleWarn("⚠")} Factory auth — not authenticated (run dx factory login)`
    )
  }

  // Registry auth
  let registryConfigured = false
  try {
    const stored = await registryAuthStore.read()
    registryConfigured =
      stored.GOOGLE_APPLICATION_CREDENTIALS_BASE64.length > 0 ||
      stored.GCP_NPM_SA_JSON_BASE64.length > 0
  } catch {
    // store unavailable
  }

  if (registryConfigured) {
    console.log(`  ${styleSuccess("✔")} Registry credentials`)
  } else {
    console.log(
      `  ${styleWarn("⚠")} Registry credentials — not configured (run dx pkg auth)`
    )
  }

  return {
    category: "auth",
    passed: !!token && registryConfigured,
    details: {
      factoryAuth: !!token,
      authProfile: profile,
      registryAuth: registryConfigured,
    },
  }
}

async function checkWorkbench(): Promise<DoctorResult> {
  console.log("\n  Workbench")

  // Walk up from cwd to find workbench root
  const path = await import("node:path")
  const { existsSync } = await import("node:fs")
  let dir = process.cwd()
  const root = path.parse(dir).root
  let workbenchRoot: string | undefined
  while (dir !== root) {
    if (existsSync(path.join(dir, ".dx", "workbench.json"))) {
      workbenchRoot = dir
      break
    }
    dir = path.dirname(dir)
  }

  if (!workbenchRoot) {
    console.log(`  ${styleWarn("⚠")} No workbench found — run dx setup`)
    return { category: "workbench", passed: false, details: {} }
  }

  const config = readWorkbenchConfig(workbenchRoot)
  if (!config) {
    console.log(
      `  ${styleError("✖")} workbench.json corrupted at ${workbenchRoot}`
    )
    return { category: "workbench", passed: false, details: {} }
  }

  console.log(`  ${styleSuccess("✔")} ${config.workbenchId} (${config.type})`)
  console.log(`    ${styleMuted(`hostname: ${config.hostname}`)}`)
  console.log(`    ${styleMuted(`os: ${config.os}/${config.arch}`)}`)
  console.log(`    ${styleMuted(`root: ${workbenchRoot}`)}`)
  console.log(`    ${styleMuted(`installed: ${config.lastInstallAt}`)}`)

  if (config.factoryRegistered) {
    console.log(`  ${styleSuccess("✔")} Registered with factory`)
  } else {
    console.log(`  ${styleMuted("  Not registered with factory")}`)
  }

  return {
    category: "workbench",
    passed: true,
    details: {
      workbenchId: config.workbenchId,
      type: config.type,
      hostname: config.hostname,
      factoryRegistered: config.factoryRegistered,
    },
  }
}

async function checkWorkspace(): Promise<DoctorResult> {
  const { existsSync } = await import("node:fs")
  const { join } = await import("node:path")
  const cwd = process.cwd()

  if (
    !existsSync(join(cwd, "pnpm-workspace.yaml")) &&
    !existsSync(join(cwd, "package.json"))
  ) {
    return { category: "workspace", passed: true, details: { found: false } }
  }

  console.log("\n  Workspace")

  try {
    const { pkgDoctor } = await import("./pkg/doctor.js")
    await pkgDoctor(cwd, { verbose: false })
  } catch (err) {
    console.log(
      `  ${styleWarn("⚠")} Workspace check failed: ${err instanceof Error ? err.message : String(err)}`
    )
    return { category: "workspace", passed: false, details: {} }
  }

  return { category: "workspace", passed: true, details: { found: true } }
}

async function checkProject(): Promise<DoctorResult> {
  console.log("\n  Project")

  // Find compose root by walking up
  let dir = process.cwd()
  const root = (await import("node:path")).parse(dir).root
  let composeRoot: string | undefined
  while (dir !== root) {
    const composePath = join(dir, "docker-compose.yaml")
    if (existsSync(composePath)) {
      const content = readFileSync(composePath, "utf8")
      if (content.includes("include:")) {
        composeRoot = dir
        break
      }
    }
    dir = dirname(dir)
  }

  if (!composeRoot) {
    console.log(`  ${styleMuted("Not inside a dx project — skipping")}`)
    return { category: "project", passed: true, details: { found: false } }
  }

  const issues: string[] = []
  const composePath = join(composeRoot, "docker-compose.yaml")
  const content = readFileSync(composePath, "utf8")

  // Parse include paths
  const includePaths: string[] = []
  for (const line of content.split("\n")) {
    const match = line.match(/^\s*-\s*path:\s*(.+)$/)
    if (match) includePaths.push(match[1]!.trim())
  }

  // Check 1: All referenced compose files exist
  const missingFiles: string[] = []
  for (const inc of includePaths) {
    if (!existsSync(join(composeRoot, inc))) {
      missingFiles.push(inc)
    }
  }
  if (missingFiles.length > 0) {
    issues.push(`Missing compose files: ${missingFiles.join(", ")}`)
    console.log(
      `  ${styleError("✖")} ${missingFiles.length} compose file(s) missing from docker-compose.yaml`
    )
    for (const f of missingFiles) {
      console.log(`    ${styleMuted(f)}`)
    }
  } else {
    console.log(
      `  ${styleSuccess("✔")} All ${includePaths.length} compose files exist`
    )
  }

  // Check 2: Dockerfiles exist for services with build context
  const missingDockerfiles: string[] = []
  for (const inc of includePaths) {
    const filePath = join(composeRoot, inc)
    if (!existsSync(filePath)) continue
    const ymlContent = readFileSync(filePath, "utf8")

    // Simple regex to find build.context and build.dockerfile
    const contextMatch = ymlContent.match(/context:\s*(.+)/)
    const dockerfileMatch = ymlContent.match(/dockerfile:\s*(.+)/)
    if (contextMatch) {
      const ctx = contextMatch[1]!.trim()
      const dockerfile = dockerfileMatch
        ? dockerfileMatch[1]!.trim()
        : "Dockerfile"
      // Resolve relative to the compose file's directory
      const composeDir = dirname(filePath)
      const fullDockerfile = join(composeDir, ctx, dockerfile)
      if (!existsSync(fullDockerfile)) {
        const relPath = `${dirname(inc)}/${ctx}/${dockerfile}`
        missingDockerfiles.push(relPath)
      }
    }
  }
  if (missingDockerfiles.length > 0) {
    issues.push(`Missing Dockerfiles: ${missingDockerfiles.join(", ")}`)
    console.log(
      `  ${styleWarn("⚠")} ${missingDockerfiles.length} Dockerfile(s) missing`
    )
    for (const f of missingDockerfiles) {
      console.log(`    ${styleMuted(f)}`)
    }
  } else {
    const buildCount = includePaths.filter((inc) => {
      const fp = join(composeRoot, inc)
      if (!existsSync(fp)) return false
      return readFileSync(fp, "utf8").includes("context:")
    }).length
    if (buildCount > 0) {
      console.log(
        `  ${styleSuccess("✔")} All ${buildCount} Dockerfile(s) present`
      )
    }
  }

  // Check 3: Port conflicts across compose files
  const portMap = new Map<number, string[]>() // hostPort → [service names]
  for (const inc of includePaths) {
    const filePath = join(composeRoot, inc)
    if (!existsSync(filePath)) continue
    const ymlContent = readFileSync(filePath, "utf8")

    // Extract default host ports: "${VAR:-HOST}:CONTAINER" or "HOST:CONTAINER"
    const portRe = /["']?\$\{[^}]*:-(\d+)\}:(\d+)["']?|["']?(\d+):(\d+)["']?/g
    let portMatch: RegExpExecArray | null
    while ((portMatch = portRe.exec(ymlContent)) !== null) {
      const hostPort = parseInt(portMatch[1] || portMatch[3]!, 10)
      const serviceName = inc.replace("compose/", "").replace(".yml", "")
      if (!portMap.has(hostPort)) portMap.set(hostPort, [])
      portMap.get(hostPort)!.push(serviceName)
    }
  }

  const conflicts: string[] = []
  for (const [port, services] of portMap) {
    if (services.length > 1) {
      conflicts.push(`Port ${port} used by: ${services.join(", ")}`)
    }
  }
  if (conflicts.length > 0) {
    issues.push(...conflicts)
    console.log(`  ${styleWarn("⚠")} ${conflicts.length} port conflict(s)`)
    for (const c of conflicts) {
      console.log(`    ${styleMuted(c)}`)
    }
  } else {
    console.log(
      `  ${styleSuccess("✔")} No port conflicts (${portMap.size} ports configured)`
    )
  }

  return {
    category: "project",
    passed: issues.length === 0,
    details: {
      found: true,
      root: composeRoot,
      includeCount: includePaths.length,
      missingFiles,
      missingDockerfiles,
      portConflicts: conflicts,
    },
  }
}

async function checkDefaults(): Promise<DoctorResult> {
  console.log("\n  Defaults")

  const { collectDefaults } = await import("./install/defaults/index.js")
  const { displayCheckSummary } = await import("./install/defaults/display.js")
  // Read saved role from workbench config; fall back to "workbench"
  const config = await readConfig()
  const role = config.role
  const scan = await collectDefaults(
    (role as "workbench" | "site" | "factory") || "workbench"
  )
  displayCheckSummary(scan)

  const passed = scan.pending.length === 0
  return {
    category: "defaults",
    passed,
    details: {
      total: scan.all.length,
      applied: scan.applied.length,
      pending: scan.pending.length,
    },
  }
}

async function checkLocal(): Promise<DoctorResult> {
  console.log("\n  Local (k3d + daemon)")

  const { capture } = await import("../lib/subprocess.js")
  const { isLocalDaemonRunning } = await import("../local-daemon/lifecycle.js")

  const checks: Array<{
    name: string
    passed: boolean
    detail?: string
    fix?: string
  }> = []

  // 1. k3d installed
  const k3dVersion = await capture(["k3d", "version"])
  if (k3dVersion.exitCode === 0) {
    const ver = k3dVersion.stdout.split("\n")[0]?.trim() ?? "unknown"
    checks.push({ name: "k3d installed", passed: true, detail: ver })
  } else {
    checks.push({
      name: "k3d installed",
      passed: false,
      fix: "brew install k3d",
    })
  }

  // 2. Docker running
  const dockerInfo = await capture([
    "docker",
    "info",
    "--format",
    "{{.ServerVersion}}",
  ])
  if (dockerInfo.exitCode === 0) {
    checks.push({
      name: "Docker running",
      passed: true,
      detail: dockerInfo.stdout.trim(),
    })
  } else {
    checks.push({
      name: "Docker running",
      passed: false,
      fix: "Start Docker Desktop or the Docker daemon",
    })
  }

  // 3. dx-local cluster exists
  let clusterExists = false
  let clusterJson: any[] = []
  if (k3dVersion.exitCode === 0) {
    const clusters = await capture([
      "k3d",
      "cluster",
      "list",
      "--output",
      "json",
    ])
    if (clusters.exitCode === 0) {
      try {
        clusterJson = JSON.parse(clusters.stdout)
      } catch {}
      clusterExists = clusterJson.some((c: any) => c.name === "dx-local")
    }
  }
  if (clusterExists) {
    checks.push({ name: "dx-local cluster exists", passed: true })
  } else {
    checks.push({
      name: "dx-local cluster exists",
      passed: false,
      fix: "dx cluster create --local",
    })
  }

  // 4. k3d API reachable
  let apiReachable = false
  if (clusterExists) {
    const path = await import("node:path")
    const os = await import("node:os")
    const kubeconfigPath = path.join(
      os.homedir(),
      ".config",
      "dx",
      "kubeconfig-dx-local.yaml"
    )
    const clusterInfo = await capture([
      "kubectl",
      "--kubeconfig",
      kubeconfigPath,
      "cluster-info",
      "--request-timeout=5s",
    ])
    apiReachable = clusterInfo.exitCode === 0
    if (apiReachable) {
      checks.push({ name: "k3d API reachable", passed: true })
    } else {
      checks.push({
        name: "k3d API reachable",
        passed: false,
        fix: "k3d cluster start dx-local",
      })
    }

    // 5. Storage class available
    if (apiReachable) {
      const sc = await capture([
        "kubectl",
        "--kubeconfig",
        kubeconfigPath,
        "get",
        "sc",
        "local-path",
        "--no-headers",
      ])
      if (sc.exitCode === 0) {
        checks.push({ name: "local-path storage class", passed: true })
      } else {
        checks.push({
          name: "local-path storage class",
          passed: false,
          fix: "Recreate k3d cluster (ships with local-path by default)",
        })
      }
    }

    // 6. NodePort range mapped
    const hasPortRange = clusterJson.some((c: any) => {
      if (c.name !== "dx-local") return false
      const nodes = c.nodes ?? []
      for (const node of nodes) {
        const portMappings = node.portMappings ?? {}
        for (const key of Object.keys(portMappings)) {
          const port = parseInt(key, 10)
          if (port >= 30000 && port <= 30200) return true
        }
      }
      return false
    })
    if (hasPortRange) {
      checks.push({ name: "NodePort range 30000-30200 mapped", passed: true })
    } else {
      checks.push({
        name: "NodePort range 30000-30200 mapped",
        passed: false,
        fix: "Recreate cluster with: k3d cluster delete dx-local && dx cluster create --local",
      })
    }
  }

  // 7. Local daemon running
  const daemonRunning = await isLocalDaemonRunning()
  if (daemonRunning) {
    checks.push({ name: "Local daemon running", passed: true })
  } else {
    checks.push({
      name: "Local daemon running",
      passed: false,
      fix: "Daemon starts automatically on first API call",
    })
  }

  // 8. Daemon health endpoint
  if (daemonRunning) {
    try {
      const res = await fetch("http://localhost:4100/health", {
        signal: AbortSignal.timeout(3000),
      })
      if (res.ok) {
        checks.push({ name: "Daemon health endpoint", passed: true })
      } else {
        checks.push({
          name: "Daemon health endpoint",
          passed: false,
          detail: `HTTP ${res.status}`,
          fix: "Check ~/.config/dx/daemon.log",
        })
      }
    } catch {
      checks.push({
        name: "Daemon health endpoint",
        passed: false,
        fix: "Check ~/.config/dx/daemon.log",
      })
    }
  }

  // 9. PGlite data directory
  const fs = await import("node:fs")
  const path = await import("node:path")
  const os = await import("node:os")
  const pgliteDir = path.join(os.homedir(), ".config", "dx", "data", "pglite")
  if (fs.existsSync(pgliteDir)) {
    checks.push({ name: "PGlite data exists", passed: true, detail: pgliteDir })
  } else {
    checks.push({
      name: "PGlite data exists",
      passed: false,
      detail: "Will be created on daemon start",
    })
  }

  // Print results
  for (const c of checks) {
    if (c.passed) {
      console.log(
        `  ${styleSuccess("✔")} ${c.name}${c.detail ? ` (${c.detail})` : ""}`
      )
    } else {
      console.log(
        `  ${styleError("✖")} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`
      )
      if (c.fix) {
        console.log(`    ${styleMuted(`fix: ${c.fix}`)}`)
      }
    }
  }

  const allPassed = checks.every((c) => c.passed)
  return {
    category: "local",
    passed: allPassed,
    details: {
      checks: checks.map((c) => ({
        name: c.name,
        passed: c.passed,
        detail: c.detail,
        fix: c.fix,
      })),
    },
  }
}

const CATEGORIES: Record<string, () => Promise<DoctorResult>> = {
  toolchain: checkToolchain,
  defaults: checkDefaults,
  auth: checkAuth,
  workbench: checkWorkbench,
  workspace: checkWorkspace,
  project: checkProject,
  local: checkLocal,
}

export async function runDoctor(opts: DoctorOptions): Promise<void> {
  console.log("\n  dx doctor\n")

  const config = await readConfig()
  const modeInfo = resolveFactoryMode(config)
  console.log(
    `  ${styleBold("Factory:")}  ${modeInfo.mode === "local" ? styleSuccess(modeInfo.label) : styleInfo(modeInfo.label)}`
  )
  console.log()

  const categoriesToRun = opts.category
    ? [opts.category]
    : Object.keys(CATEGORIES)

  if (opts.category && !CATEGORIES[opts.category]) {
    throw new Error(
      `Unknown category: ${opts.category}\nAvailable: ${Object.keys(CATEGORIES).join(", ")}`
    )
  }

  const results: DoctorResult[] = []
  for (const cat of categoriesToRun) {
    const result = await CATEGORIES[cat]()
    results.push(result)
  }

  const allPassed = results.every((r) => r.passed)
  console.log()
  if (allPassed) {
    console.log(`  ${styleSuccess("✔")} All checks passed`)
  } else {
    console.log(`  ${styleWarn("⚠")} Some checks need attention`)
  }
  console.log()

  if (opts.json) {
    console.log(JSON.stringify({ success: allPassed, results }, null, 2))
  }
}
