type ChannelType = "cli" | "web" | "slack" | "email"

interface EventLike {
  id: string
  topic: string
  source: string
  severity: string
  scopeKind: string
  scopeId: string
  spec: { data?: Record<string, unknown>; rawPayload?: unknown }
  schemaVersion: number
  occurredAt: string
  createdAt: string
}

interface WebOutput {
  title: string
  body: string
  severity: string
  topic: string
  timestamp: string
  data: Record<string, unknown>
}

interface AggregateLike {
  topicPrefix: string
  eventCount: number
  maxSeverity: string
  windowStart: string
  windowEnd: string
}

// Severity → ANSI color codes for CLI
const SEVERITY_COLORS: Record<string, string> = {
  debug: "\x1b[90m",
  info: "\x1b[36m",
  warning: "\x1b[33m",
  critical: "\x1b[31m",
}
const RESET = "\x1b[0m"

// Severity → emoji for Slack
const SEVERITY_EMOJI: Record<string, string> = {
  debug: "🔍",
  info: "ℹ️",
  warning: "⚠️",
  critical: "🚨",
}

// ── Topic-specific renderers ──────────────────────────────────
// Register custom renderers per topic for richer output.

type TopicRenderer = {
  cli: (event: EventLike) => string
  web: (event: EventLike) => WebOutput
  slack: (event: EventLike) => unknown[]
  email: (event: EventLike) => { subject: string; html: string }
}

const topicRenderers = new Map<string, Partial<TopicRenderer>>()

// Example: drift detection gets custom rendering
topicRenderers.set("ops.component_deployment.drifted", {
  cli: (e) => {
    const d = (e.spec.data ?? {}) as Record<string, unknown>
    const color = SEVERITY_COLORS[e.severity] ?? ""
    return `${color}[${e.severity.toUpperCase()}]${RESET} Drift detected on ${d.componentDeploymentSlug ?? "unknown"}: expected ${d.desiredImage ?? "?"} but found ${d.actualImage ?? "?"} (site: ${d.siteSlug ?? "?"})`
  },
  slack: (e) => {
    const d = (e.spec.data ?? {}) as Record<string, unknown>
    return [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${SEVERITY_EMOJI[e.severity] ?? ""} *Drift detected* on \`${d.componentDeploymentSlug ?? "unknown"}\`\nExpected: \`${d.desiredImage ?? "?"}\`\nActual: \`${d.actualImage ?? "?"}\`\nSite: \`${d.siteSlug ?? "?"}\``,
        },
      },
    ]
  },
})

// ── Generic renderers ─────────────────────────────────────────

function genericCli(event: EventLike): string {
  const color = SEVERITY_COLORS[event.severity] ?? ""
  const data = event.spec.data ?? {}
  const summary = Object.entries(data)
    .slice(0, 3)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ")
  return `${color}[${event.severity.toUpperCase()}]${RESET} ${event.topic} ${summary ? `(${summary})` : ""}`
}

function genericWeb(event: EventLike): WebOutput {
  const parts = event.topic.split(".")
  const entity = parts.slice(0, -1).join(".")
  const verb = parts[parts.length - 1]
  return {
    title: `${entity} ${verb}`,
    body: JSON.stringify(event.spec.data ?? {}, null, 2),
    severity: event.severity,
    topic: event.topic,
    timestamp: event.occurredAt,
    data: (event.spec.data ?? {}) as Record<string, unknown>,
  }
}

function genericSlack(event: EventLike): unknown[] {
  const emoji = SEVERITY_EMOJI[event.severity] ?? ""
  const data = event.spec.data ?? {}
  const fields = Object.entries(data)
    .slice(0, 5)
    .map(([k, v]) => `*${k}:* ${v}`)
    .join("\n")
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${emoji} *${event.topic}*\n${fields}`,
      },
    },
  ]
}

function genericEmail(event: EventLike): { subject: string; html: string } {
  const data = event.spec.data ?? {}
  const rows = Object.entries(data)
    .map(([k, v]) => `<tr><td><strong>${k}</strong></td><td>${v}</td></tr>`)
    .join("")
  return {
    subject: `[${event.severity.toUpperCase()}] ${event.topic}`,
    html: `<h2>${event.topic}</h2><table>${rows}</table><p>Source: ${event.source} | ${event.occurredAt}</p>`,
  }
}

// ── Public API ────────────────────────────────────────────────

export function renderEvent(event: EventLike, channel: ChannelType): unknown {
  // Try exact topic match
  const topicRenderer = topicRenderers.get(event.topic)
  if (topicRenderer?.[channel]) {
    return topicRenderer[channel]!(event)
  }

  // Try prefix match (e.g., "ops.component_deployment" for "ops.component_deployment.drifted")
  const prefix = event.topic.split(".").slice(0, -1).join(".")
  const prefixRenderer = topicRenderers.get(prefix)
  if (prefixRenderer?.[channel]) {
    return prefixRenderer[channel]!(event)
  }

  // Generic fallback
  switch (channel) {
    case "cli":
      return genericCli(event)
    case "web":
      return genericWeb(event)
    case "slack":
      return genericSlack(event)
    case "email":
      return genericEmail(event)
  }
}

export function renderAggregate(
  aggregate: AggregateLike,
  channel: ChannelType
): unknown {
  switch (channel) {
    case "cli":
      return `\x1b[33m[STORM]\x1b[0m ${aggregate.topicPrefix}: ${aggregate.eventCount} events (${aggregate.maxSeverity}) from ${aggregate.windowStart} to ${aggregate.windowEnd}`
    case "web":
      return {
        title: `Storm: ${aggregate.topicPrefix}`,
        body: `${aggregate.eventCount} events aggregated`,
        severity: aggregate.maxSeverity,
        topic: aggregate.topicPrefix,
        timestamp: aggregate.windowEnd,
        data: {
          eventCount: aggregate.eventCount,
          windowStart: aggregate.windowStart,
          windowEnd: aggregate.windowEnd,
        },
      }
    case "slack":
      return [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `⚡ *Storm detected:* \`${aggregate.topicPrefix}\`\n${aggregate.eventCount} events (max severity: ${aggregate.maxSeverity})\nWindow: ${aggregate.windowStart} → ${aggregate.windowEnd}`,
          },
        },
      ]
    case "email":
      return {
        subject: `[STORM] ${aggregate.topicPrefix}: ${aggregate.eventCount} events`,
        html: `<h2>Storm: ${aggregate.topicPrefix}</h2><p>${aggregate.eventCount} events (max: ${aggregate.maxSeverity})</p>`,
      }
  }
}
