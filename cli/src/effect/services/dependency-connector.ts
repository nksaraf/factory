import { Context, Effect } from "effect"
import type { ConnectionError } from "../errors/site.js"
import type { ConnectionFlags } from "./site-config.js"

export interface ConnectionResult {
  readonly env: Record<string, string>
  readonly profileName: string
  readonly remoteDeps: string[]
}

export interface IDependencyConnector {
  readonly resolve: (
    flags: ConnectionFlags
  ) => Effect.Effect<ConnectionResult | null, ConnectionError>
  readonly apply: (
    conn: ConnectionResult,
    envPath: string,
    dryRun: boolean
  ) => Effect.Effect<string[], ConnectionError>
  readonly restoreLocal: (envPath: string) => Effect.Effect<void>
}

export class DependencyConnector extends Context.Tag("DependencyConnector")<
  DependencyConnector,
  IDependencyConnector
>() {}
