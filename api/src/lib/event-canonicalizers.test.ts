import { describe, expect, it } from "bun:test"

import { canonicalize } from "./event-canonicalizers"

describe("canonicalize", () => {
  it("canonicalizes GitHub push events to build.push.received", () => {
    const result = canonicalize({
      source: "github",
      eventType: "push",
      payload: { ref: "refs/heads/main", commits: [{ id: "abc" }] },
    })
    expect(result.topic).toBe("build.push.received")
    expect(result.entityKind).toBe("repository")
    expect(result.severity).toBe("info")
  })

  it("canonicalizes GitHub pull_request.opened to build.pr.opened", () => {
    const result = canonicalize({
      source: "github",
      eventType: "pull_request.opened",
      payload: { number: 42, title: "My PR" },
    })
    expect(result.topic).toBe("build.pr.opened")
    expect(result.entityKind).toBe("pull_request")
    expect(result.severity).toBe("info")
  })

  it("canonicalizes GitHub issue_comment.created to build.pr.commented", () => {
    const result = canonicalize({
      source: "github",
      eventType: "issue_comment.created",
      payload: { comment: { body: "LGTM" } },
    })
    expect(result.topic).toBe("build.pr.commented")
    expect(result.entityKind).toBe("pull_request")
    expect(result.severity).toBe("info")
  })

  it("falls back to ext.github.* for unknown GitHub events", () => {
    const result = canonicalize({
      source: "github",
      eventType: "star.created",
      payload: { starred_at: "2026-01-01" },
    })
    expect(result.topic).toBe("ext.github.star.created")
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

  it("canonicalizes Slack message to org.thread.turn_added", () => {
    const result = canonicalize({
      source: "slack",
      eventType: "message",
      payload: { text: "hello" },
    })
    expect(result.topic).toBe("org.thread.turn_added")
    expect(result.entityKind).toBe("channel")
    expect(result.data).toMatchObject({ source: "slack", text: "hello" })
  })

  it("canonicalizes Jira issue_updated to ops.work_item.updated", () => {
    const result = canonicalize({
      source: "jira",
      eventType: "issue_updated",
      payload: { issueKey: "PROJ-123" },
    })
    expect(result.topic).toBe("ops.work_item.updated")
    expect(result.entityKind).toBe("work_item")
  })
})
