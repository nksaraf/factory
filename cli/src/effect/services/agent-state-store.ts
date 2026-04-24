import { Context, Effect } from "effect"
import type { AgentState } from "../../site/agent-lifecycle.js"

export type { AgentState }

export interface IAgentStateStore {
  readonly read: Effect.Effect<AgentState | null>
  readonly write: (state: AgentState) => Effect.Effect<void>
  readonly clear: Effect.Effect<void>
}

export class AgentStateStore extends Context.Tag("AgentStateStore")<
  AgentStateStore,
  IAgentStateStore
>() {}
