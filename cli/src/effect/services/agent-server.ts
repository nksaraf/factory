import { Context, Effect, Scope } from "effect"

export interface IAgentServer {
  readonly start: Effect.Effect<
    { port: number; stop: Effect.Effect<void> },
    never,
    Scope.Scope
  >
}

export class AgentServer extends Context.Tag("AgentServer")<
  AgentServer,
  IAgentServer
>() {}
