/**
 * Message Intermediate Representation — typed content blocks for all AI coding agents.
 *
 * The Anthropic Messages API format is the base. Extensions cover Codex (command
 * execution, file changes) and Vercel AI SDK (reasoning, source references).
 *
 * These types give shape to the `content: jsonb` column on org.message.
 * The DB stores Record<string, unknown>[]; these types are the read/write lens.
 */
import { z } from "zod"

// ── Content Blocks ──────────────────────────────────────────

export const TextBlockSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
})
export type TextBlock = z.infer<typeof TextBlockSchema>

export const ThinkingBlockSchema = z.object({
  type: z.literal("thinking"),
  thinking: z.string(),
  signature: z.string().optional(),
})
export type ThinkingBlock = z.infer<typeof ThinkingBlockSchema>

export const RedactedThinkingBlockSchema = z.object({
  type: z.literal("redacted_thinking"),
  data: z.string(),
})
export type RedactedThinkingBlock = z.infer<typeof RedactedThinkingBlockSchema>

export const ToolUseBlockSchema = z.object({
  type: z.literal("tool_use"),
  id: z.string(),
  name: z.string(),
  input: z.record(z.unknown()),
})
export type ToolUseBlock = z.infer<typeof ToolUseBlockSchema>

export const ToolResultBlockSchema = z.object({
  type: z.literal("tool_result"),
  tool_use_id: z.string(),
  content: z.union([z.string(), z.array(z.record(z.unknown()))]),
  is_error: z.boolean().optional(),
})
export type ToolResultBlock = z.infer<typeof ToolResultBlockSchema>

export const ImageBlockSchema = z.object({
  type: z.literal("image"),
  source: z.object({
    type: z.enum(["base64", "url"]),
    media_type: z.string(),
    data: z.string(),
  }),
})
export type ImageBlock = z.infer<typeof ImageBlockSchema>

export const DocumentBlockSchema = z.object({
  type: z.literal("document"),
  source: z.object({
    type: z.enum(["base64", "url", "text"]),
    media_type: z.string(),
    data: z.string(),
  }),
  title: z.string().optional(),
})
export type DocumentBlock = z.infer<typeof DocumentBlockSchema>

export const ServerToolUseBlockSchema = z.object({
  type: z.literal("server_tool_use"),
  id: z.string(),
  name: z.string(),
  input: z.record(z.unknown()),
})
export type ServerToolUseBlock = z.infer<typeof ServerToolUseBlockSchema>

export const ServerToolResultBlockSchema = z.object({
  type: z.literal("server_tool_result"),
  tool_use_id: z.string(),
  content: z.union([z.string(), z.array(z.record(z.unknown()))]),
})
export type ServerToolResultBlock = z.infer<typeof ServerToolResultBlockSchema>

export const WebSearchToolUseBlockSchema = z.object({
  type: z.literal("web_search_tool_use"),
  id: z.string(),
  name: z.string().optional(),
  input: z.record(z.unknown()).optional(),
})
export type WebSearchToolUseBlock = z.infer<typeof WebSearchToolUseBlockSchema>

export const WebSearchToolResultBlockSchema = z.object({
  type: z.literal("web_search_tool_result"),
  tool_use_id: z.string().optional(),
  content: z.unknown(),
})
export type WebSearchToolResultBlock = z.infer<
  typeof WebSearchToolResultBlockSchema
>

// Extensions for Codex app-server items
export const CommandBlockSchema = z.object({
  type: z.literal("command"),
  command: z.string(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  exit_code: z.number().optional(),
})
export type CommandBlock = z.infer<typeof CommandBlockSchema>

export const FileChangeBlockSchema = z.object({
  type: z.literal("file_change"),
  path: z.string(),
  diff: z.string().optional(),
  status: z.string().optional(),
})
export type FileChangeBlock = z.infer<typeof FileChangeBlockSchema>

// Extensions for Vercel AI SDK
export const ReasoningBlockSchema = z.object({
  type: z.literal("reasoning"),
  text: z.string(),
})
export type ReasoningBlock = z.infer<typeof ReasoningBlockSchema>

export const SourceRefBlockSchema = z.object({
  type: z.literal("source_ref"),
  url: z.string().optional(),
  title: z.string().optional(),
})
export type SourceRefBlock = z.infer<typeof SourceRefBlockSchema>

export const ContentBlockSchema = z.discriminatedUnion("type", [
  TextBlockSchema,
  ThinkingBlockSchema,
  RedactedThinkingBlockSchema,
  ToolUseBlockSchema,
  ToolResultBlockSchema,
  ImageBlockSchema,
  DocumentBlockSchema,
  ServerToolUseBlockSchema,
  ServerToolResultBlockSchema,
  WebSearchToolUseBlockSchema,
  WebSearchToolResultBlockSchema,
  CommandBlockSchema,
  FileChangeBlockSchema,
  ReasoningBlockSchema,
  SourceRefBlockSchema,
])
export type ContentBlock = z.infer<typeof ContentBlockSchema>

// ── IR Message ──────────────────────────────────────────────

export const IRMessageMetaSchema = z.object({
  permissionMode: z.string().optional(),
  userType: z.string().optional(),
  entrypoint: z.string().optional(),
  slug: z.string().optional(),
  version: z.string().optional(),
  requestId: z.string().optional(),
  promptId: z.string().optional(),
  isSidechain: z.boolean().optional(),
  isMeta: z.boolean().optional(),
  isApiErrorMessage: z.boolean().optional(),
  isCompactSummary: z.boolean().optional(),
  subtype: z.string().optional(),
  level: z.string().optional(),
  hookCount: z.number().optional(),
  sourceToolAssistantUUID: z.string().optional(),
  logicalParentUuid: z.string().optional(),
})
export type IRMessageMeta = z.infer<typeof IRMessageMetaSchema>

export const IRMessageSchema = z.object({
  id: z.string(),
  sequence: z.number().int(),
  threadId: z.string(),
  parentId: z.string().nullable(),
  role: z.enum(["user", "assistant", "system"]),
  source: z.string(),
  content: z.array(z.record(z.unknown())),
  startedAt: z.coerce.date(),
  completedAt: z.coerce.date().nullable().optional(),
  model: z.string().optional(),
  stopReason: z.string().optional(),
  usage: z
    .object({
      inputTokens: z.number().default(0),
      outputTokens: z.number().default(0),
      cacheReadTokens: z.number().default(0),
      cacheWriteTokens: z.number().default(0),
    })
    .optional(),
  meta: IRMessageMetaSchema.optional(),
  sourceEntryIds: z.array(z.string()),
})
export type IRMessage = z.infer<typeof IRMessageSchema>

// ── IR Thread (recursive) ───────────────────────────────────

// Recursive Zod schemas don't typecheck cleanly with tsgo; the IRThread type
// is the source of truth. Validate at ingest boundaries with manual checks.
export const IRThreadSchema = z.object({
  id: z.string(),
  parentThreadId: z.string().nullable(),
  parentToolUseId: z.string().nullable(),
  sessionId: z.string(),
  agentType: z.string().optional(),
  description: z.string().optional(),
  cwd: z.string().optional(),
  gitBranch: z.string().optional(),
  model: z.string().optional(),
  messages: z.array(IRMessageSchema),
  childThreads: z.array(z.any()),
})
export type IRThread = {
  id: string
  parentThreadId: string | null
  parentToolUseId: string | null
  sessionId: string
  agentType?: string
  description?: string
  cwd?: string
  gitBranch?: string
  model?: string
  messages: IRMessage[]
  childThreads: IRThread[]
}

// ── Hook Events (derived projection) ────────────────────────

export const HookEventTypeSchema = z.enum([
  "session.start",
  "session.end",
  "prompt.submit",
  "tool.pre",
  "tool.post",
  "tool.post_failure",
  "agent.stop",
  "subagent.start",
  "subagent.stop",
  "context.pre_compact",
  "context.post_compact",
  "agent.response",
  "agent.thought",
])
export type HookEventType = z.infer<typeof HookEventTypeSchema>

export const DerivedHookEventSchema = z.object({
  type: HookEventTypeSchema,
  threadId: z.string(),
  messageSequence: z.number().int(),
  toolName: z.string().optional(),
  toolUseId: z.string().optional(),
  isError: z.boolean().optional(),
  childThreadId: z.string().optional(),
})
export type DerivedHookEvent = z.infer<typeof DerivedHookEventSchema>
