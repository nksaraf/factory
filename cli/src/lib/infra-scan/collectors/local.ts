/**
 * Local collector — runs the appropriate platform-specific collector
 * directly on the current machine via Bun.spawn.
 */
import type { ScanResult } from "../types.js"
import { LINUX_COLLECTOR_SCRIPT } from "./linux.js"
import {
  collectContainerIpMap,
  collectTraefikRoutes,
  detectTraefikApiUrl,
} from "./traefik.js"
import { WINDOWS_COLLECTOR_SCRIPT } from "./windows.js"

export async function collectLocal(): Promise<ScanResult> {
  const start = Date.now()
  const platform = process.platform

  let raw: string

  if (platform === "win32") {
    const proc = Bun.spawn(
      ["powershell", "-NoProfile", "-NonInteractive", "-Command", "-"],
      {
        stdin: new Blob([WINDOWS_COLLECTOR_SCRIPT]),
        stdout: "pipe",
        stderr: "pipe",
        timeout: 60_000,
      }
    )
    raw = await new Response(proc.stdout).text()
    await proc.exited
  } else if (platform === "darwin") {
    const { MACOS_COLLECTOR_SCRIPT } = await import("./macos.js")
    const proc = Bun.spawn(["bash", "-s"], {
      stdin: new Blob([MACOS_COLLECTOR_SCRIPT]),
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60_000,
    })
    raw = await new Response(proc.stdout).text()
    await proc.exited
  } else {
    // Linux
    const proc = Bun.spawn(["bash", "-s"], {
      stdin: new Blob([LINUX_COLLECTOR_SCRIPT]),
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60_000,
    })
    raw = await new Response(proc.stdout).text()
    await proc.exited
  }

  // Find JSON object in output (skip any warnings/banners before it)
  const trimmed = raw.trim()
  const jsonStart = trimmed.indexOf("{")
  if (jsonStart === -1) {
    throw new Error(
      `Local scan produced no JSON output. Raw output: ${trimmed.slice(0, 200)}`
    )
  }

  let result: ScanResult
  try {
    result = JSON.parse(trimmed.slice(jsonStart)) as ScanResult
  } catch {
    throw new Error(
      `Local scan produced invalid JSON. Raw output: ${trimmed.slice(0, 200)}`
    )
  }

  result.scanDurationMs = Date.now() - start

  // Detect reverse proxies in discovered services and collect routes
  await detectAndCollectProxies(result, "localhost")

  return result
}

/**
 * Detect reverse proxy services in scan results and collect their routes.
 * Also collects container IP mapping to resolve backends to containers.
 * Mutates result.reverseProxies and result.containerIpMap in place.
 */
async function detectAndCollectProxies(
  result: ScanResult,
  hostAddress: string
): Promise<void> {
  // Check if any service looks like a reverse proxy
  const hasProxy = result.services.some(
    (svc) => detectTraefikApiUrl(svc, hostAddress) !== null
  )
  if (!hasProxy) return

  // Collect container IP map for backend resolution (only if Docker is available)
  let containerIpMap = undefined
  try {
    containerIpMap = await collectContainerIpMap()
    if (containerIpMap.length > 0) {
      result.containerIpMap = containerIpMap
    }
  } catch {
    // Docker not available or no containers — proceed without IP map
  }

  const proxies: ScanResult["reverseProxies"] = []
  for (const svc of result.services) {
    const apiUrl = detectTraefikApiUrl(svc, hostAddress)
    if (!apiUrl) continue

    try {
      const proxy = await collectTraefikRoutes(apiUrl, containerIpMap)
      proxy.containerName = svc.name
      proxies.push(proxy)
    } catch {
      // Traefik API not reachable — skip silently
    }
  }

  if (proxies.length > 0) {
    result.reverseProxies = proxies
  }
}
