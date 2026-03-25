import type { AgentModels } from "./model"

export abstract class AgentService {
  static listAgents() {
    return { data: [], total: 0 }
  }

  static registerAgent(body: AgentModels["registerAgentBody"]) {
    return { data: { agentId: null, ...body } }
  }

  static getAgent(id: string) {
    return { data: null, id }
  }

  static executeTask(
    id: string,
    body: AgentModels["executeTaskBody"]
  ) {
    return { data: { agentId: id, executionId: null, ...body } }
  }

  static listExecutions(agentId: string) {
    return { data: [], agentId }
  }
}
