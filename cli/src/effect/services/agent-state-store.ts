import { Context, Effect } from "effect"
import type { AgentState } from "../../site/agent-lifecycle.js"

export type { AgentState }

export interface AgentStateStoreService {
  readonly read: Effect.Effect<AgentState | null>
  readonly write: (state: AgentState) => Effect.Effect<void>
  readonly clear: Effect.Effect<void>
}

export class AgentStateStoreTag extends Context.Tag("AgentStateStore")<
  AgentStateStoreTag,
  AgentStateStoreService
>() {}
