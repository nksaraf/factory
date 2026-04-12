/**
 * Per-source event canonicalizers.
 *
 * Each source (GitHub, Slack, Jira, Claude Code, Cursor, etc.) has its own
 * mapping from raw event types to canonical Factory topics + payloads.
 */
import type { EventSeverity } from "@smp/factory-shared/schemas/events"

export interface CanonicalFields {
  topic: string
  entityKind?: string
  entityId?: string
  severity: EventSeverity
  data: Record<string, unknown>
}

interface RawIngest {
  source: string
  eventType: string
  payload: Record<string, unknown>
}

type Canonicalizer = (raw: RawIngest) => CanonicalFields

const github: Canonicalizer = (raw) => {
  switch (raw.eventType) {
    case "push":
      return {
        topic: "build.push.received",
        entityKind: "repository",
        severity: "info",
        data: raw.payload,
      }
    case "pull_request.opened":
      return {
        topic: "build.pr.opened",
        entityKind: "pull_request",
        severity: "info",
        data: raw.payload,
      }
    case "pull_request.closed":
      return {
        topic: (raw.payload as any).merged
          ? "build.pr.merged"
          : "build.pr.closed",
        entityKind: "pull_request",
        severity: "info",
        data: raw.payload,
      }
    case "pull_request_review_comment.created":
    case "issue_comment.created":
      return {
        topic: "build.pr.commented",
        entityKind: "pull_request",
        severity: "info",
        data: raw.payload,
      }
    case "check_run.completed":
      return {
        topic:
          (raw.payload as any).conclusion === "success"
            ? "build.pipeline.completed"
            : "build.pipeline.failed",
        entityKind: "pipeline",
        severity:
          (raw.payload as any).conclusion === "success" ? "info" : "warning",
        data: raw.payload,
      }
    default:
      return {
        topic: `ext.github.${raw.eventType}`,
        entityKind: "repository",
        severity: "info",
        data: raw.payload,
      }
  }
}

const slack: Canonicalizer = (raw) => {
  switch (raw.eventType) {
    case "message":
      return {
        topic: "org.thread.turn_added",
        entityKind: "channel",
        severity: "info",
        data: { source: "slack", ...raw.payload },
      }
    default:
      return {
        topic: `ext.slack.${raw.eventType}`,
        entityKind: "channel",
        severity: "info",
        data: raw.payload,
      }
  }
}

const jira: Canonicalizer = (raw) => {
  const eventType = raw.eventType.replace(/^jira:/, "")
  switch (eventType) {
    case "issue_updated":
      return {
        topic: "ops.work_item.updated",
        entityKind: "work_item",
        severity: "info",
        data: raw.payload,
      }
    case "issue_created":
      return {
        topic: "ops.work_item.created",
        entityKind: "work_item",
        severity: "info",
        data: raw.payload,
      }
    default:
      return {
        topic: `ext.jira.${eventType}`,
        entityKind: "issue",
        severity: "info",
        data: raw.payload,
      }
  }
}

const claudeCode: Canonicalizer = (raw) => {
  switch (raw.eventType) {
    case "session.start":
      return {
        topic: "org.agent.session_started",
        entityKind: "thread",
        severity: "info",
        data: { source: "claude-code", ...raw.payload },
      }
    case "session.end":
      return {
        topic: "org.agent.session_completed",
        entityKind: "thread",
        severity: "info",
        data: { source: "claude-code", ...raw.payload },
      }
    case "tool.call":
      return {
        topic: "org.agent.tool_called",
        entityKind: "thread",
        severity: "debug",
        data: { source: "claude-code", ...raw.payload },
      }
    default:
      return {
        topic: `org.agent.${raw.eventType}`,
        entityKind: "thread",
        severity: "info",
        data: { source: "claude-code", ...raw.payload },
      }
  }
}

const cursor: Canonicalizer = (raw) => {
  switch (raw.eventType) {
    case "session.begin":
      return {
        topic: "org.agent.session_started",
        entityKind: "thread",
        severity: "info",
        data: { source: "cursor", ...raw.payload },
      }
    case "session.end":
      return {
        topic: "org.agent.session_completed",
        entityKind: "thread",
        severity: "info",
        data: { source: "cursor", ...raw.payload },
      }
    default:
      return {
        topic: `org.agent.${raw.eventType}`,
        entityKind: "thread",
        severity: "info",
        data: { source: "cursor", ...raw.payload },
      }
  }
}

const fallback: Canonicalizer = (raw) => ({
  topic: `ext.${raw.source}.${raw.eventType}`,
  severity: "debug",
  data: raw.payload,
})

const canonicalizers: Record<string, Canonicalizer> = {
  github,
  slack,
  jira,
  "claude-code": claudeCode,
  cursor,
}

/**
 * Canonicalize a raw external event into Factory's topic/data vocabulary.
 * Falls back to ext.{source}.{eventType} for unknown sources.
 */
export function canonicalize(raw: RawIngest): CanonicalFields {
  const fn = canonicalizers[raw.source] ?? fallback
  return fn(raw)
}
