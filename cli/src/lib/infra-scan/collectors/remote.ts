/**
 * Remote collector — runs a collector script on a remote host via SSH.
 * Uses EntityFinder's ResolvedEntity for transport details.
 */
import type { ResolvedEntity } from "../../entity-finder.js"
import { type SshOptions, buildSshArgs } from "../../ssh-utils.js"
import type { ScanResult } from "../types.js"
import { LINUX_COLLECTOR_SCRIPT } from "./linux.js"
import {
  collectContainerIpMap,
  collectTraefikRoutes,
  detectTraefikApiUrl,
} from "./traefik.js"
import { WINDOWS_COLLECTOR_SCRIPT } from "./windows.js"

/**
 * Run a scan on a remote host via SSH.
 * Selects the Linux or Windows collector based on the host's OS.
 */
export async function collectRemote(
  entity: ResolvedEntity,
  os: "linux" | "windows" | "macos" = "linux"
): Promise<ScanResult> {
  if (entity.transport !== "ssh" || !entity.sshHost) {
    throw new Error(
      `Cannot scan host "${entity.slug}" — no SSH transport available (transport: ${entity.transport})`
    )
  }

  const start = Date.now()

  const sshOpts: SshOptions = {
    host: entity.sshHost,
    port: entity.sshPort ?? 22,
    user: entity.sshUser ?? "root",
    tty: "none",
    hostKeyCheck: "accept-new",
    jumpHost: entity.jumpHost,
    jumpUser: entity.jumpUser,
    jumpPort: entity.jumpPort,
    identity: entity.identityFile,
  }

  const sshBaseArgs = buildSshArgs(sshOpts)

  // Select the right collector script based on OS
  let script: string
  let remoteCmd: string

  if (os === "windows") {
    script = WINDOWS_COLLECTOR_SCRIPT
    remoteCmd = "powershell -NoProfile -NonInteractive -Command -"
  } else if (os === "macos") {
    const { MACOS_COLLECTOR_SCRIPT } = await import("./macos.js")
    script = MACOS_COLLECTOR_SCRIPT
    remoteCmd = "bash -s"
  } else {
    script = LINUX_COLLECTOR_SCRIPT
    remoteCmd = "bash -s"
  }

  const args = [...sshBaseArgs, remoteCmd]

  const proc = Bun.spawn(["ssh", ...args], {
    stdin: new Blob([script]),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120_000,
  })

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])

  const exitCode = await proc.exited

  if (exitCode !== 0) {
    const errMsg = stderr.trim() || `SSH exited with code ${exitCode}`
    throw new Error(`Failed to scan host "${entity.slug}": ${errMsg}`)
  }

  // Find the JSON in stdout (skip any SSH banner/warnings before it)
  const jsonStart = stdout.indexOf("{")
  if (jsonStart === -1) {
    throw new Error(
      `No JSON output from host "${entity.slug}". Raw output: ${stdout.slice(0, 200)}`
    )
  }

  const result = JSON.parse(stdout.slice(jsonStart)) as ScanResult
  result.scanDurationMs = Date.now() - start

  // Detect reverse proxies and collect routes
  const hostAddress = entity.sshHost
  const hasProxy = result.services.some(
    (svc) => detectTraefikApiUrl(svc, hostAddress) !== null
  )

  if (hasProxy) {
    // Collect container IP map via SSH for backend resolution
    let containerIpMap = undefined
    try {
      containerIpMap = await collectContainerIpMap(sshBaseArgs)
      if (containerIpMap.length > 0) {
        result.containerIpMap = containerIpMap
      }
    } catch {
      // Container IP map collection failed — proceed without
    }

    for (const svc of result.services) {
      const apiUrl = detectTraefikApiUrl(svc, hostAddress)
      if (!apiUrl) continue

      try {
        const proxy = await collectTraefikRoutes(apiUrl, containerIpMap)
        proxy.containerName = svc.name
        result.reverseProxies = result.reverseProxies ?? []
        result.reverseProxies.push(proxy)
      } catch {
        // Traefik API not reachable from scanner — skip
      }
    }
  }

  return result
}
