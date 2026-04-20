import type { LogEntry } from "@smp/factory-shared/observability-types"

import type { Compose } from "./docker.js"
import { streamDockerLogs } from "./docker-logs.js"
import type { LogSource, LogStreamOptions } from "./log-source.js"

export class LocalLogSource implements LogSource {
  constructor(
    private compose: Compose,
    private services: string[]
  ) {}

  get label(): string {
    return `${this.services.join(", ")} (local docker)`
  }

  async stream(
    opts: LogStreamOptions,
    onEntry: (entry: LogEntry) => void
  ): Promise<void> {
    const filterEntry = (entry: LogEntry) => {
      if (opts.level && entry.level !== opts.level) return
      if (opts.grep && !entry.message.includes(opts.grep)) return
      onEntry(entry)
    }

    await streamDockerLogs(
      {
        compose: this.compose,
        services: this.services,
        follow: opts.follow,
        since: opts.since,
        tail: opts.tail,
        signal: opts.signal,
      },
      filterEntry
    )
  }
}
