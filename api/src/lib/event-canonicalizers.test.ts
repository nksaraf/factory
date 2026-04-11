import { describe, expect, it } from "vitest"

import { canonicalize } from "./event-canonicalizers"

describe("canonicalize", () => {
  it("canonicalizes GitHub push events", () => {
    const result = canonicalize({
      source: "github",
      eventType: "push",
      payload: { ref: "refs/heads/main", commits: [{ id: "abc" }] },
    })
    expect(result.topic).toBe("ext.github.push")
    expect(result.entityKind).toBe("repository")
    expect(result.severity).toBe("info")
  })

  it("canonicalizes Claude Code session.start to org.agent.session_started", () => {
    const result = canonicalize({
      source: "claude-code",
      eventType: "session.start",
      payload: { threadId: "thrd_123" },
    })
    expect(result.topic).toBe("org.agent.session_started")
    expect(result.entityKind).toBe("thread")
    expect(result.data).toEqual({ source: "claude-code", threadId: "thrd_123" })
  })

  it("canonicalizes Cursor session.begin to org.agent.session_started", () => {
    const result = canonicalize({
      source: "cursor",
      eventType: "session.begin",
      payload: { workbenchId: "wb-1" },
    })
    expect(result.topic).toBe("org.agent.session_started")
    expect(result.data.source).toBe("cursor")
  })

  it("falls back to ext.{source}.{eventType} for unknown sources", () => {
    const result = canonicalize({
      source: "unknown-tool",
      eventType: "something.happened",
      payload: { key: "value" },
    })
    expect(result.topic).toBe("ext.unknown-tool.something.happened")
    expect(result.severity).toBe("debug")
  })

  it("canonicalizes Slack events", () => {
    const result = canonicalize({
      source: "slack",
      eventType: "message",
      payload: { text: "hello" },
    })
    expect(result.topic).toBe("ext.slack.message")
    expect(result.entityKind).toBe("channel")
  })

  it("canonicalizes Jira events", () => {
    const result = canonicalize({
      source: "jira",
      eventType: "issue_updated",
      payload: { issueKey: "PROJ-123" },
    })
    expect(result.topic).toBe("ext.jira.issue_updated")
    expect(result.entityKind).toBe("issue")
  })
})
