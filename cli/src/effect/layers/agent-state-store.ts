import { Effect, Layer } from "effect"
import {
  readAgentState,
  writeAgentState,
  clearAgentState,
} from "../../site/agent-lifecycle.js"
import {
  AgentStateStoreTag,
  type AgentStateStoreService,
} from "../services/agent-state-store.js"
import { SiteConfigTag } from "../services/site-config.js"

export const AgentStateStoreLive = Layer.effect(
  AgentStateStoreTag,
  Effect.gen(function* () {
    const config = yield* SiteConfigTag

    return AgentStateStoreTag.of({
      read: Effect.sync(() => readAgentState(config.workingDir)),

      write: (state) =>
        Effect.sync(() => writeAgentState(config.workingDir, state)).pipe(
          Effect.catchAllDefect(() => Effect.void),
          Effect.withSpan("AgentStateStore.write")
        ),

      clear: Effect.sync(() => clearAgentState(config.workingDir)).pipe(
        Effect.catchAllDefect(() => Effect.void)
      ),
    }) satisfies AgentStateStoreService
  })
)
