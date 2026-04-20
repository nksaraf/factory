import type { LogEntry } from "@smp/factory-shared/observability-types"

export interface LogStreamOptions {
  follow: boolean
  since?: string
  tail?: number
  grep?: string
  level?: string
  signal?: AbortSignal
}

export interface LogSource {
  label: string
  stream(
    opts: LogStreamOptions,
    onEntry: (entry: LogEntry) => void
  ): Promise<void>
}
