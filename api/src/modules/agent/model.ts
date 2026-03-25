import { t, type UnwrapSchema } from "elysia"

export const AgentModel = {
  registerAgentBody: t.Object({
    name: t.String(),
    agentType: t.String(),
  }),
  agentIdParams: t.Object({ id: t.String() }),
  executeTaskBody: t.Object({ task: t.String() }),
} as const

export type AgentModels = {
  [K in keyof typeof AgentModel]: UnwrapSchema<(typeof AgentModel)[K]>
}
