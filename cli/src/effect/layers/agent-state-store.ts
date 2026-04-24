import { Effect, Layer } from "effect"
import {
  readAgentState,
  writeAgentState,
  clearAgentState,
} from "../../site/agent-lifecycle.js"
import {
  AgentStateStore,
  type IAgentStateStore,
} from "../services/agent-state-store.js"
import { SiteConfig } from "../services/site-config.js"

export const AgentStateStoreLive = Layer.effect(
  AgentStateStore,
  Effect.gen(function* () {
    const config = yield* SiteConfig

    return AgentStateStore.of({
      read: Effect.sync(() => readAgentState(config.workingDir)),

      write: (state) =>
        Effect.sync(() => writeAgentState(config.workingDir, state)).pipe(
          Effect.catchAllDefect(() => Effect.void),
          Effect.withSpan("AgentStateStore.write")
        ),

      clear: Effect.sync(() => clearAgentState(config.workingDir)).pipe(
        Effect.catchAllDefect(() => Effect.void)
      ),
    }) satisfies IAgentStateStore
  })
)
