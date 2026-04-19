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

  // Detect reverse proxies and collect routes.
  // Use "localhost" for API URL detection since we query via SSH curl
  // (the Traefik API may only bind to localhost on the remote host).
  const hasProxy = result.services.some(
    (svc) => detectTraefikApiUrl(svc, "localhost") !== null
  )

  if (hasProxy) {
    let containerIpMap = undefined
    try {
      containerIpMap = await collectContainerIpMap(sshBaseArgs)
      if (containerIpMap.length > 0) {
        result.containerIpMap = containerIpMap
      }
    } catch {
      // Container IP map collection failed — proceed without
    }

    const sshCurlJson = async <T>(apiUrl: string, path: string): Promise<T> => {
      const url = `${apiUrl.replace(/\/$/, "")}${path}`
      const proc = Bun.spawn(
        ["ssh", ...sshBaseArgs, `curl -sf --max-time 10 '${url}'`],
        { stdout: "pipe", stderr: "pipe", timeout: 15_000 }
      )
      const [out, exit] = await Promise.all([
        new Response(proc.stdout).text(),
        proc.exited,
      ])
      if (exit !== 0 || !out.trim()) {
        throw new Error(`curl ${url} failed (exit ${exit})`)
      }
      return JSON.parse(out) as T
    }

    for (const svc of result.services) {
      const candidateUrl = detectTraefikApiUrl(svc, "localhost")
      if (!candidateUrl) continue

      // Probe candidate ports to find one with the full API.
      // Port 8080 often has only the dashboard, not /api/http/routers.
      const entrypointPorts = new Set([80, 443, 389, 636, 5432, 6432, 8443])
      const candidatePorts = svc.ports.filter(
        (p) => p > 8000 && p < 10000 && !entrypointPorts.has(p)
      )
      let apiUrl: string | null = null
      for (const port of candidatePorts) {
        try {
          await sshCurlJson(`http://localhost:${port}`, "/api/http/routers")
          apiUrl = `http://localhost:${port}`
          break
        } catch {
          // this port doesn't serve the full API
        }
      }
      if (!apiUrl) continue

      try {
        const proxy = await collectTraefikRoutes(
          apiUrl,
          containerIpMap,
          sshCurlJson
        )
        proxy.containerName = svc.name
        result.reverseProxies = result.reverseProxies ?? []
        result.reverseProxies.push(proxy)
      } catch (err) {
        console.error(
          `    Traefik API error (${apiUrl}): ${err instanceof Error ? err.message : err}`
        )
      }
    }
  }

  return result
}
