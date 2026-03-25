import { Elysia } from "elysia"

import { AgentModel } from "./model"
import { AgentService } from "./service"

export const agentController = new Elysia({ prefix: "/api/v1/agent" })
  .get("/agents", () => AgentService.listAgents(), {
    detail: { tags: ["Agent"], summary: "List agents" },
  })
  .post(
    "/agents",
    ({ body }) => AgentService.registerAgent(body),
    {
      body: AgentModel.registerAgentBody,
      detail: { tags: ["Agent"], summary: "Register agent" },
    }
  )
  .get(
    "/agents/:id",
    ({ params }) => AgentService.getAgent(params.id),
    {
      params: AgentModel.agentIdParams,
      detail: { tags: ["Agent"], summary: "Get agent" },
    }
  )
  .post(
    "/agents/:id/execute",
    ({ params, body }) => AgentService.executeTask(params.id, body),
    {
      params: AgentModel.agentIdParams,
      body: AgentModel.executeTaskBody,
      detail: { tags: ["Agent"], summary: "Execute agent task" },
    }
  )
  .get(
    "/agents/:id/executions",
    ({ params }) => AgentService.listExecutions(params.id),
    {
      params: AgentModel.agentIdParams,
      detail: { tags: ["Agent"], summary: "List agent executions" },
    }
  )
