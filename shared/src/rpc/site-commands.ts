/**
 * Site Command Protocol — typed JSON-RPC contract between Factory API and
 * Site Agent (dx dev). Uses Effect Schema for compile-time + runtime validation.
 *
 * The API is the RPC client. dx dev is the RPC server.
 * Transport: JSON-RPC 2.0 over the existing tunnel WebSocket.
 */
import { Schema } from "effect"

// ── Agent lifecycle ─────────────────────────────────────────

export const AgentSpawnParams = Schema.Struct({
  sessionId: Schema.String,
  agentType: Schema.String,
  cwd: Schema.String,
  model: Schema.optionalWith(Schema.String, { as: "Option" }),
  env: Schema.optionalWith(
    Schema.Record({ key: Schema.String, value: Schema.String }),
    { as: "Option" }
  ),
})

export const AgentSpawnResult = Schema.Struct({
  pid: Schema.Number,
  ready: Schema.Boolean,
})

export const AgentInputParams = Schema.Struct({
  sessionId: Schema.String,
  text: Schema.String,
})

export const AgentInputResult = Schema.Struct({
  accepted: Schema.Boolean,
  queuePosition: Schema.optionalWith(Schema.Number, { as: "Option" }),
})

export const AgentStopParams = Schema.Struct({
  sessionId: Schema.String,
  signal: Schema.optionalWith(Schema.Literal("SIGINT", "SIGTERM"), {
    as: "Option",
  }),
})

export const AgentStopResult = Schema.Struct({
  stopped: Schema.Boolean,
})

export const AgentStatusParams = Schema.Struct({
  sessionId: Schema.String,
})

export const AgentStatusResult = Schema.Struct({
  status: Schema.String,
  pid: Schema.optionalWith(Schema.Number, { as: "Option" }),
  lastHeartbeat: Schema.optionalWith(Schema.String, { as: "Option" }),
})

// ── Tool execution (proxied to site workbench) ──────────────

export const ToolExecuteParams = Schema.Struct({
  callId: Schema.String,
  name: Schema.String,
  input: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
})

export const ToolExecuteResult = Schema.Struct({
  output: Schema.Unknown,
  isError: Schema.Boolean,
})

export const ToolApproveParams = Schema.Struct({
  callId: Schema.String,
  decision: Schema.Literal("approve", "reject"),
  modifiedInput: Schema.optionalWith(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
    { as: "Option" }
  ),
})

export const ToolApproveResult = Schema.Struct({
  forwarded: Schema.Boolean,
})

// ── Site status ─────────────────────────────────────────────

export const SiteStatusParams = Schema.Struct({})

export const SiteStatusResult = Schema.Struct({
  site: Schema.optionalWith(Schema.String, { as: "Option" }),
  workbench: Schema.String,
  sessions: Schema.Array(Schema.String),
  cwd: Schema.String,
})

// ── Notifications (site agent → API, no response) ───────────

export const AgentMessageNotification = Schema.Struct({
  sessionId: Schema.String,
  message: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
})

export const AgentHeartbeatNotification = Schema.Struct({
  sessionId: Schema.String,
  status: Schema.String,
})

export const ApprovalRequestNotification = Schema.Struct({
  sessionId: Schema.String,
  callId: Schema.String,
  toolName: Schema.String,
  input: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
})

// ── Command registry ────────────────────────────────────────

export const SiteCommands = {
  "agent.spawn": { params: AgentSpawnParams, result: AgentSpawnResult },
  "agent.input": { params: AgentInputParams, result: AgentInputResult },
  "agent.stop": { params: AgentStopParams, result: AgentStopResult },
  "agent.status": { params: AgentStatusParams, result: AgentStatusResult },
  "tool.execute": { params: ToolExecuteParams, result: ToolExecuteResult },
  "tool.approve": { params: ToolApproveParams, result: ToolApproveResult },
  "site.status": { params: SiteStatusParams, result: SiteStatusResult },
} as const

export type SiteCommandName = keyof typeof SiteCommands

export const SiteNotifications = {
  "agent.message": AgentMessageNotification,
  "agent.heartbeat": AgentHeartbeatNotification,
  "approval.request": ApprovalRequestNotification,
} as const

export type SiteNotificationName = keyof typeof SiteNotifications

// ── JSON-RPC envelope types ─────────────────────────────────

export const JsonRpcRequest = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.Union(Schema.String, Schema.Number),
  method: Schema.String,
  params: Schema.Unknown,
})

export const JsonRpcResponse = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.Union(Schema.String, Schema.Number),
  result: Schema.optionalWith(Schema.Unknown, { as: "Option" }),
  error: Schema.optionalWith(
    Schema.Struct({
      code: Schema.Number,
      message: Schema.String,
      data: Schema.optionalWith(Schema.Unknown, { as: "Option" }),
    }),
    { as: "Option" }
  ),
})

export const JsonRpcNotification = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  method: Schema.String,
  params: Schema.Unknown,
})
