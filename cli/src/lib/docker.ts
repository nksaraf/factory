import { spawnSync } from "node:child_process"

export function isDockerRunning(): boolean {
  const proc = spawnSync("docker", ["info"], {
    encoding: "utf8",
  })
  return proc.status === 0
}

// ---------------------------------------------------------------------------
// Compose service status (returned by ps)
// ---------------------------------------------------------------------------

export interface ComposeServiceStatus {
  name: string
  /** Container lifecycle state: "running", "exited", "created", "restarting", "paused", "dead", "removing". */
  status: string
  /** Healthcheck result: "healthy", "unhealthy", "starting", or "" when no healthcheck is configured. */
  health: string
  /** Formatted "PublishedPort→TargetPort, ..." */
  ports: string
}

// ---------------------------------------------------------------------------
// Compose class — single source of truth for docker-compose interactions
// ---------------------------------------------------------------------------

export class Compose {
  constructor(
    private readonly composeFiles: string[],
    private readonly projectName: string,
    private readonly envFile?: string,
    private readonly dockerHost?: string
  ) {}

  /** Common prefix: compose -p name -f file1 -f file2 --env-file ... */
  private baseArgs(opts?: { profiles?: string[] }): string[] {
    const args = ["compose"]
    if (this.projectName) {
      args.push("-p", this.projectName)
    }
    for (const f of this.composeFiles) {
      args.push("-f", f)
    }
    if (this.envFile) {
      args.push("--env-file", this.envFile)
    }
    if (opts?.profiles) {
      for (const p of opts.profiles) {
        args.push("--profile", p)
      }
    }
    return args
  }

  /** Spawn options with optional DOCKER_HOST */
  private spawnOpts(stdio: "inherit"): {
    stdio: "inherit"
    env?: NodeJS.ProcessEnv
  }
  private spawnOpts(stdio: "pipe"): {
    encoding: "utf-8"
    stdio: ["ignore", "pipe", "pipe"]
    env?: NodeJS.ProcessEnv
  }
  private spawnOpts(stdio: "inherit" | "pipe"): object {
    const env = this.dockerHost
      ? { ...process.env, DOCKER_HOST: this.dockerHost }
      : undefined
    if (stdio === "pipe") {
      return {
        encoding: "utf-8" as const,
        stdio: ["ignore", "pipe", "pipe"] as const,
        ...(env && { env }),
      }
    }
    return { stdio: "inherit" as const, ...(env && { env }) }
  }

  up(opts?: {
    detach?: boolean // defaults to true
    build?: boolean // defaults to true
    noBuild?: boolean
    noDeps?: boolean // pass --no-deps (don't start linked services)
    services?: string[]
    profiles?: string[]
  }): void {
    const args = this.baseArgs({ profiles: opts?.profiles })
    args.push("up")
    if (opts?.detach !== false) args.push("-d") // default: detach
    if (opts?.noDeps) args.push("--no-deps")
    if (opts?.noBuild) {
      args.push("--no-build")
    } else if (opts?.build !== false) {
      // default: build
      args.push("--build")
    }
    if (opts?.services?.length) {
      args.push(...opts.services)
    }
    const proc = spawnSync("docker", args, this.spawnOpts("inherit"))
    if (proc.status !== 0) {
      throw new Error("docker compose up failed")
    }
  }

  down(opts?: { volumes?: boolean; profiles?: string[] }): void {
    const args = this.baseArgs({ profiles: opts?.profiles })
    args.push("down")
    if (opts?.volumes) args.push("--volumes")
    const proc = spawnSync("docker", args, this.spawnOpts("inherit"))
    if (proc.status !== 0) {
      throw new Error("docker compose down failed")
    }
  }

  stop(services: string[]): void {
    const args = this.baseArgs()
    args.push("stop", ...services)
    spawnSync("docker", args, this.spawnOpts("inherit"))
  }

  restart(services: string[]): void {
    const args = this.baseArgs()
    args.push("restart", ...services)
    const proc = spawnSync("docker", args, this.spawnOpts("inherit"))
    if (proc.status !== 0) {
      throw new Error("docker compose restart failed")
    }
  }

  build(services: string[]): void {
    const args = this.baseArgs()
    args.push("build", ...services)
    const proc = spawnSync("docker", args, this.spawnOpts("inherit"))
    if (proc.status !== 0) {
      throw new Error("docker compose build failed")
    }
  }

  /** Build args for `docker compose logs` (used by streamDockerLogs). */
  logsArgs(opts?: {
    follow?: boolean
    since?: string
    tail?: number
    services?: string[]
  }): string[] {
    // Like ps/isRunning, use project-name-only for read-only operations.
    if (!this.projectName)
      throw new Error("Compose: projectName is required for logsArgs()")
    const args = ["compose", "-p", this.projectName, "logs"]
    if (opts?.follow) args.push("--follow")
    if (opts?.since) args.push("--since", opts.since)
    if (opts?.tail !== undefined) args.push("--tail", String(opts.tail))
    args.push("--no-log-prefix")
    if (opts?.services?.length) args.push(...opts.services)
    return args
  }

  isRunning(service: string): boolean {
    // Like ps(), use project-name-only to avoid env interpolation errors.
    if (!this.projectName) return false
    const args = ["compose", "-p", this.projectName, "ps", "-q", service]
    const env = this.dockerHost
      ? { ...process.env, DOCKER_HOST: this.dockerHost }
      : undefined
    const result = spawnSync("docker", args, {
      encoding: "utf8" as const,
      ...(env && { env }),
    })
    return result.status === 0 && result.stdout.trim().length > 0
  }

  ps(opts?: { all?: boolean }): ComposeServiceStatus[] {
    // No isDockerRunning() guard — docker compose ps already returns non-zero
    // if Docker isn't running, and the guard costs ~600ms (docker info).

    // ps only needs the project name — Docker queries running containers by
    // their compose project label. Skipping -f/--env-file avoids interpolation
    // errors that are irrelevant for a read-only status check.
    if (!this.projectName) return []
    const args = ["compose", "-p", this.projectName, "ps", "--format", "json"]
    if (opts?.all) args.push("-a")

    const env = this.dockerHost
      ? { ...process.env, DOCKER_HOST: this.dockerHost }
      : undefined
    const proc = spawnSync("docker", args, {
      encoding: "utf-8" as const,
      stdio: ["ignore", "pipe", "pipe"] as const,
      ...(env && { env }),
    })
    if (proc.status !== 0) return []

    const stdout = ((proc.stdout as string) || "").trim()
    if (!stdout) return []

    const services: ComposeServiceStatus[] = []
    for (const line of stdout.split("\n")) {
      if (!line.trim()) continue
      try {
        const obj = JSON.parse(line)
        services.push({
          name: obj.Service || obj.Name || "unknown",
          status: obj.State || obj.Status || "unknown",
          health: typeof obj.Health === "string" ? obj.Health : "",
          ports: obj.Publishers
            ? [
                ...new Set(
                  (
                    obj.Publishers as Array<{
                      PublishedPort: number
                      TargetPort: number
                    }>
                  )
                    .filter((p) => p.PublishedPort > 0)
                    .map((p) => `${p.PublishedPort}→${p.TargetPort}`)
                ),
              ].join(", ")
            : "",
        })
      } catch {
        // skip malformed lines
      }
    }
    return services
  }
}

// ---------------------------------------------------------------------------
// Plain docker (not compose)
// ---------------------------------------------------------------------------

export function dockerBuild(
  context: string,
  dockerfile: string,
  tag: string
): void {
  const proc = spawnSync(
    "docker",
    ["build", "-f", dockerfile, "-t", tag, context],
    {
      stdio: "inherit",
    }
  )
  if (proc.status !== 0) {
    throw new Error(`docker build failed for tag ${tag}`)
  }
}
