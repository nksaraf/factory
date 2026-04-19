import type { LogEntry } from "@smp/factory-shared/observability-types"
import { spawn } from "node:child_process"
import { createInterface } from "node:readline"

import type { ResolvedEntity } from "./entity-finder.js"
import type { LogSource, LogStreamOptions } from "./log-source.js"
import { buildSshArgs } from "./ssh-utils.js"
import { parseDockerLogLine } from "./docker-logs.js"

export class SshLogSource implements LogSource {
  constructor(
    private entity: ResolvedEntity & { sshHost: string },
    private composeProject: string | undefined,
    private serviceName: string
  ) {}

  get label(): string {
    return `${this.serviceName} on ${this.entity.slug} via SSH`
  }

  async stream(
    opts: LogStreamOptions,
    onEntry: (entry: LogEntry) => void
  ): Promise<void> {
    let remoteCmd: string
    if (this.composeProject) {
      const dockerArgs = ["compose", "-p", this.composeProject, "logs"]
      if (opts.follow) dockerArgs.push("--follow")
      if (opts.tail !== undefined) dockerArgs.push("--tail", String(opts.tail))
      if (opts.since) dockerArgs.push("--since", opts.since)
      dockerArgs.push("--no-log-prefix")
      dockerArgs.push(this.serviceName)
      remoteCmd = `docker ${dockerArgs.join(" ")}`
    } else {
      // No compose project — find container by name grep and use docker logs.
      // Traefik service names often differ from compose service names (e.g.
      // "airflow-service" vs "airflow-webserver"), so we strip common suffixes
      // and search broadly.
      const tail = opts.tail !== undefined ? `--tail ${opts.tail}` : ""
      const follow = opts.follow ? "--follow" : ""
      const since = opts.since ? `--since ${opts.since}` : ""
      const searchTerm = this.serviceName
        .replace(/-service$/, "")
        .replace(/['"]/g, "")
      remoteCmd = `CID=$(docker ps -q --filter name=${searchTerm} | head -1) && [ -n "$CID" ] && docker logs ${follow} ${tail} ${since} $CID 2>&1 || echo "No container matching ${searchTerm} found"`
    }

    const sshArgs = buildSshArgs({
      host: this.entity.sshHost,
      port: this.entity.sshPort,
      user: this.entity.sshUser,
      identity: this.entity.identityFile,
      jumpHost: this.entity.jumpHost,
      jumpUser: this.entity.jumpUser,
      jumpPort: this.entity.jumpPort,
      tty: "none",
      hostKeyCheck: "accept-new",
      extraArgs: ["-o", "BatchMode=yes"],
    })
    sshArgs.push(remoteCmd)

    return new Promise<void>((resolve, reject) => {
      const proc = spawn("ssh", sshArgs, {
        stdio: ["ignore", "pipe", "pipe"],
      })

      const rl = createInterface({ input: proc.stdout! })
      rl.on("line", (line) => {
        if (!line.trim()) return
        const entry = parseDockerLogLine(line)
        entry.source = entry.source || this.serviceName
        if (opts.level && entry.level !== opts.level) return
        if (opts.grep && !entry.message.includes(opts.grep)) return
        onEntry(entry)
      })

      const rlErr = createInterface({ input: proc.stderr! })
      rlErr.on("line", (line) => {
        const trimmed = line.trim()
        if (!trimmed) return
        if (
          trimmed.startsWith("Warning:") ||
          trimmed.startsWith("Pseudo-terminal")
        )
          return
        onEntry({
          timestamp: new Date().toISOString(),
          level: "error",
          message: trimmed,
          source: "ssh",
          attributes: {},
        })
      })

      proc.on("close", () => {
        rl.close()
        rlErr.close()
        resolve()
      })
      proc.on("error", (err) => {
        rl.close()
        rlErr.close()
        reject(err)
      })

      if (opts.signal) {
        opts.signal.addEventListener("abort", () => proc.kill("SIGTERM"))
      }
    })
  }
}
