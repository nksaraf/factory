import { describe, expect, test } from "bun:test"
import {
  MessageSpecSchema,
  MessageRoleSchema,
  ExchangeStatusSchema,
  ExchangeSpecSchema,
  ToolCallStatusSchema,
  ToolCallSpecSchema,
} from "../schemas/org"

describe("Message schema", () => {
  test("MessageRoleSchema accepts valid roles", () => {
    expect(MessageRoleSchema.parse("user")).toBe("user")
    expect(MessageRoleSchema.parse("assistant")).toBe("assistant")
    expect(MessageRoleSchema.parse("system")).toBe("system")
    expect(MessageRoleSchema.parse("tool")).toBe("tool")
  })

  test("MessageRoleSchema rejects invalid role", () => {
    expect(() => MessageRoleSchema.parse("invalid")).toThrow()
  })

  test("MessageSpecSchema parses with usage", () => {
    const spec = MessageSpecSchema.parse({
      sourceMessageId: "msg_123",
      model: "claude-opus-4-6",
      usage: { inputTokens: 100, outputTokens: 200 },
    })
    expect(spec.model).toBe("claude-opus-4-6")
    expect(spec.usage?.inputTokens).toBe(100)
  })

  test("MessageSpecSchema defaults empty", () => {
    const spec = MessageSpecSchema.parse({})
    expect(spec.sourceMessageId).toBeUndefined()
    expect(spec.usage).toBeUndefined()
  })
})

describe("Exchange schema", () => {
  test("ExchangeStatusSchema accepts valid statuses", () => {
    expect(ExchangeStatusSchema.parse("running")).toBe("running")
    expect(ExchangeStatusSchema.parse("completed")).toBe("completed")
    expect(ExchangeStatusSchema.parse("interrupted")).toBe("interrupted")
    expect(ExchangeStatusSchema.parse("errored")).toBe("errored")
  })

  test("ExchangeSpecSchema parses stats", () => {
    const spec = ExchangeSpecSchema.parse({
      summary: "Fixed the bug",
      stats: { toolCallCount: 5, filesWritten: 2 },
      artifacts: [{ type: "plan", slug: "my-plan", version: 3 }],
    })
    expect(spec.summary).toBe("Fixed the bug")
    expect(spec.stats?.toolCallCount).toBe(5)
    expect(spec.artifacts?.[0]?.slug).toBe("my-plan")
  })
})

describe("ToolCall schema", () => {
  test("ToolCallStatusSchema accepts valid statuses", () => {
    expect(ToolCallStatusSchema.parse("pending")).toBe("pending")
    expect(ToolCallStatusSchema.parse("running")).toBe("running")
    expect(ToolCallStatusSchema.parse("completed")).toBe("completed")
    expect(ToolCallStatusSchema.parse("errored")).toBe("errored")
  })

  test("ToolCallSpecSchema parses file path", () => {
    const spec = ToolCallSpecSchema.parse({
      filePath: "/src/index.ts",
      duration: 150,
    })
    expect(spec.filePath).toBe("/src/index.ts")
    expect(spec.duration).toBe(150)
  })
})
