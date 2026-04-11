import { spawnSync } from "node:child_process"

// ─── Types ──────────────────────────────────────────────────

export interface ImageMetadata {
  image: string
  exposedPorts: number[]
  volumes: string[]
  env: Record<string, string>
  healthcheck?: {
    test: string[]
    interval?: string
    timeout?: string
    retries?: number
  }
  labels: Record<string, string>
}

// Env vars that every base image sets — not useful for compose templates
const IGNORED_ENV_PREFIXES = [
  "PATH=",
  "HOME=",
  "GOPATH=",
  "JAVA_HOME=",
  "LANG=",
  "LC_",
  "HOSTNAME=",
  "TERM=",
  "SHLVL=",
  "GPG_KEY=",
  "PYTHON_",
  "PIPX_",
  "PIP_",
  "NODE_VERSION=",
  "YARN_VERSION=",
  "NPM_CONFIG_",
]

// ─── Helpers ────────────────────────────────────────────────

function nanosToComposeInterval(nanos: number): string {
  const seconds = Math.round(nanos / 1_000_000_000)
  return `${seconds}s`
}

/**
 * Derive a short service name from a Docker image reference.
 * Examples: "redis:7-alpine" → "redis", "apache/kafka:3.9" → "kafka",
 *           "ghcr.io/org/my-svc:latest" → "my-svc"
 */
export function imageToName(image: string): string {
  // Strip tag/digest
  const withoutTag = image.split(":")[0]!
  // Take the last path segment
  const segments = withoutTag.split("/")
  return segments[segments.length - 1]!
}

// ─── Main ───────────────────────────────────────────────────

/**
 * Inspect a Docker image and return structured metadata.
 * Pulls the image if it's not available locally.
 */
export function inspectImage(image: string): ImageMetadata {
  // Try local inspect first
  let result = spawnSync(
    "docker",
    ["image", "inspect", "--format", "json", image],
    {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  )

  // If image not found locally, pull it
  if (result.status !== 0) {
    const pull = spawnSync("docker", ["pull", image], {
      encoding: "utf-8",
      stdio: "inherit",
    })
    if (pull.status !== 0) {
      throw new Error(`Failed to pull image "${image}". Is Docker running?`)
    }

    result = spawnSync(
      "docker",
      ["image", "inspect", "--format", "json", image],
      {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      }
    )
    if (result.status !== 0) {
      throw new Error(`Failed to inspect image "${image}" after pull.`)
    }
  }

  const data = JSON.parse(result.stdout)
  // docker inspect --format json returns an array
  const info = Array.isArray(data) ? data[0] : data
  const config = info.Config ?? {}

  // ── Exposed ports ─────────────────────────────────────────
  const exposedPorts: number[] = []
  if (config.ExposedPorts) {
    for (const key of Object.keys(config.ExposedPorts)) {
      const port = parseInt(key.split("/")[0]!, 10)
      if (!isNaN(port)) exposedPorts.push(port)
    }
  }
  exposedPorts.sort((a, b) => a - b)

  // ── Volumes ───────────────────────────────────────────────
  const volumes: string[] = config.Volumes ? Object.keys(config.Volumes) : []

  // ── Environment variables (filtered) ──────────────────────
  const env: Record<string, string> = {}
  if (config.Env) {
    for (const entry of config.Env as string[]) {
      if (IGNORED_ENV_PREFIXES.some((p) => entry.startsWith(p))) continue
      const eqIdx = entry.indexOf("=")
      if (eqIdx > 0) {
        env[entry.slice(0, eqIdx)] = entry.slice(eqIdx + 1)
      }
    }
  }

  // ── Healthcheck ───────────────────────────────────────────
  let healthcheck: ImageMetadata["healthcheck"]
  const hc = config.Healthcheck ?? info.ContainerConfig?.Healthcheck
  if (hc?.Test) {
    healthcheck = {
      test: hc.Test,
      ...(hc.Interval ? { interval: nanosToComposeInterval(hc.Interval) } : {}),
      ...(hc.Timeout ? { timeout: nanosToComposeInterval(hc.Timeout) } : {}),
      ...(hc.Retries ? { retries: hc.Retries } : {}),
    }
  }

  // ── Labels ────────────────────────────────────────────────
  const labels: Record<string, string> = config.Labels ?? {}

  return { image, exposedPorts, volumes, env, healthcheck, labels }
}
