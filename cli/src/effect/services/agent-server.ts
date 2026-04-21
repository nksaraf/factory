import { Context, Effect, Scope } from "effect"

export interface AgentServerService {
  readonly start: Effect.Effect<
    { port: number; stop: Effect.Effect<void> },
    never,
    Scope.Scope
  >
}

export class AgentServerTag extends Context.Tag("AgentServer")<
  AgentServerTag,
  AgentServerService
>() {}
