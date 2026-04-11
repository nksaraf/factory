import { existsSync, statfsSync } from "node:fs"
import { platform, arch } from "node:os"
import { run, runInherit } from "../../lib/subprocess.js"
import type { InstallRole } from "@smp/factory-shared/install-types"
import type {
  PreflightCheck,
  PreflightResult,
} from "@smp/factory-shared/install-types"

const REQUIRED_PORTS = [6443, 443, 80, 10250]
const MIN_DISK_GB: Record<InstallRole, number> = {
  workbench: 2,
  site: 20,
  factory: 50,
}

function check(
  name: string,
  passed: boolean,
  message: string,
  required = true
): PreflightCheck {
  return { name, passed, message, required }
}

function checkRoot(): PreflightCheck {
  const isRoot = process.getuid?.() === 0
  return check("root", isRoot, isRoot ? "root" : "not root (use sudo)")
}

function checkOs(role: InstallRole): PreflightCheck {
  const os = platform()
  if (role === "workbench") {
    return check("os", true, `${os}/${arch()}`, false)
  }
  const ok = os === "linux"
  return check("os", ok, ok ? `linux/${arch()}` : `${os} (linux required)`)
}

function checkArch(): PreflightCheck {
  const a = arch()
  const ok = a === "x64" || a === "arm64"
  return check("arch", ok, ok ? a : `${a} (x64/arm64 required)`)
}

function checkDisk(role: InstallRole): PreflightCheck {
  const minGb = MIN_DISK_GB[role]
  try {
    const stats = statfsSync("/")
    const freeGb = Math.floor(
      (stats.bfree * stats.bsize) / (1024 * 1024 * 1024)
    )
    const ok = freeGb >= minGb
    return check(
      "disk",
      ok,
      ok ? `disk ${freeGb}GB` : `disk ${freeGb}GB (need ${minGb}GB)`
    )
  } catch {
    return check("disk", false, "disk check failed")
  }
}

function checkPort(port: number): PreflightCheck {
  const result = run("ss", ["-tlnp", `sport = :${port}`])
  const inUse = result.status === 0 && result.stdout.includes(`:${port}`)
  return check(
    `port-${port}`,
    !inUse,
    inUse ? `port ${port} in use` : `port ${port}`
  )
}

function checkNoExistingK3s(
  force: boolean,
  resumeClusterInstall?: boolean
): PreflightCheck {
  const exists =
    existsSync("/usr/local/bin/k3s") || existsSync("/etc/rancher/k3s")
  if (force && exists) return check("k3s", true, "k3s found (--force)", false)
  if (resumeClusterInstall && exists) {
    return check("k3s", true, "k3s present (resuming after phase 2)", false)
  }
  return check(
    "k3s",
    !exists,
    exists
      ? "k3s exists (use --force, or dx setup reset-progress if reinstalling)"
      : "no k3s"
  )
}

function checkDns(domain: string): PreflightCheck {
  const result = run("getent", ["hosts", domain])
  const ok = result.status === 0
  return check("dns", ok, ok ? `dns ${domain}` : `dns fail ${domain}`, false)
}

// --- Auto-install helpers ---

function hasBrew(): boolean {
  return run("brew", ["--version"]).status === 0
}

function hasApt(): boolean {
  return run("apt-get", ["--version"]).status === 0
}

function hasYum(): boolean {
  return run("yum", ["--version"]).status === 0
}

function installViaBrew(pkg: string, verbose?: boolean): boolean {
  console.log(`  Installing ${pkg} via Homebrew...`)
  return runInherit("brew", ["install", pkg], { verbose }) === 0
}

function installViaApt(pkg: string, verbose?: boolean): boolean {
  console.log(`  Installing ${pkg} via apt...`)
  return runInherit("apt-get", ["install", "-y", pkg], { verbose }) === 0
}

function installViaYum(pkg: string, verbose?: boolean): boolean {
  console.log(`  Installing ${pkg} via yum...`)
  return runInherit("yum", ["install", "-y", pkg], { verbose }) === 0
}

function installViaCurl(
  name: string,
  script: string,
  verbose?: boolean
): boolean {
  console.log(`  Installing ${name} via install script...`)
  const curl = run("curl", ["-fsSL", script])
  if (curl.status !== 0) return false
  return runInherit("sh", ["-c", curl.stdout], { verbose }) === 0
}

function autoInstall(
  pkg: string,
  opts?: {
    brewPkg?: string
    aptPkg?: string
    curlScript?: string
    verbose?: boolean
  }
): boolean {
  const brewPkg = opts?.brewPkg ?? pkg
  const aptPkg = opts?.aptPkg ?? pkg

  if (platform() === "darwin") {
    if (hasBrew()) return installViaBrew(brewPkg, opts?.verbose)
  } else {
    if (hasApt()) return installViaApt(aptPkg, opts?.verbose)
    if (hasYum()) return installViaYum(aptPkg, opts?.verbose)
  }

  if (opts?.curlScript) {
    return installViaCurl(pkg, opts.curlScript, opts?.verbose)
  }

  return false
}

/** Check for kubectl, auto-install if missing. */
function ensureKubectl(verbose?: boolean): PreflightCheck {
  if (run("kubectl", ["version", "--client"]).status === 0) {
    return check("kubectl", true, "kubectl available")
  }

  console.log("  kubectl not found, installing...")
  const installed = autoInstall("kubectl", {
    brewPkg: "kubernetes-cli",
    aptPkg: "kubectl",
    curlScript:
      "https://raw.githubusercontent.com/kubernetes/kubectl/master/scripts/install.sh",
    verbose,
  })

  if (installed && run("kubectl", ["version", "--client"]).status === 0) {
    return check("kubectl", true, "kubectl installed")
  }

  return check("kubectl", false, "kubectl install failed")
}

/** Check for psql, auto-install if missing. */
function ensurePsql(verbose?: boolean): PreflightCheck {
  if (run("psql", ["--version"]).status === 0) {
    return check("psql", true, "psql available")
  }

  console.log("  psql not found, installing...")
  const installed = autoInstall("psql", {
    brewPkg: "libpq",
    aptPkg: "postgresql-client",
    verbose,
  })

  if (installed && run("psql", ["--version"]).status === 0) {
    return check("psql", true, "psql installed")
  }

  return check("psql", false, "psql install failed")
}

/** Check for helm, auto-install if missing. */
function ensureHelm(verbose?: boolean): PreflightCheck {
  if (run("helm", ["version", "--short"]).status === 0) {
    return check("helm", true, "helm available")
  }

  console.log("  helm not found, installing...")
  const installed = autoInstall("helm", {
    curlScript:
      "https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3",
    verbose,
  })

  if (installed && run("helm", ["version", "--short"]).status === 0) {
    return check("helm", true, "helm installed")
  }

  return check("helm", false, "helm install failed")
}

export function runPreflight(opts: {
  role: InstallRole
  domain?: string
  installMode?: string
  force?: boolean
  /** k3s may already be running (recorded progress past phase 2); allow in-use API ports and existing k3s. */
  resumeClusterInstall?: boolean
  /** Targeting a remote cluster via --kubeconfig; skip root, OS, port, and k3s checks. */
  remoteCluster?: boolean
  verbose?: boolean
}): PreflightResult {
  const checks: PreflightCheck[] = []

  // Workbench: light checks only
  if (opts.role === "workbench") {
    checks.push(
      checkOs(opts.role),
      checkArch(),
      checkDisk(opts.role),
      ensurePsql(opts.verbose)
    )
    const passed = checks.filter((c) => c.required).every((c) => c.passed)
    return { passed, checks, role: opts.role }
  }

  const resume = opts.resumeClusterInstall ?? false

  if (opts.remoteCluster) {
    // Remote cluster: check arch, disk, and ensure kubectl + helm + psql are available (auto-install if needed)
    checks.push(
      checkArch(),
      checkDisk("workbench"),
      ensureKubectl(opts.verbose),
      ensureHelm(opts.verbose),
      ensurePsql(opts.verbose)
    )
  } else {
    // Local install: full checks (omit port checks on resume — k3s already bound 6443 / 10250 etc.)
    checks.push(
      checkRoot(),
      checkOs(opts.role),
      checkArch(),
      checkDisk(opts.role),
      ...(resume ? [] : REQUIRED_PORTS.map(checkPort)),
      checkNoExistingK3s(opts.force ?? false, resume)
    )
  }

  if (opts.installMode !== "offline" && opts.domain) {
    checks.push(checkDns(opts.domain))
  }

  const passed = checks.filter((c) => c.required).every((c) => c.passed)
  return { passed, checks, role: opts.role }
}
