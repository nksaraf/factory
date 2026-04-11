/**
 * Per-topic Zod schema registry for event payload validation.
 *
 * Each (topic, schemaVersion) pair has a registered Zod schema.
 * Validation happens at ingestion time in emitEvent().
 * Unknown topics are allowed (logged as warnings).
 * All schemas use .passthrough() to tolerate unknown fields.
 */
import { z } from "zod"

import { logger } from "../logger"

type SchemaRegistry = Record<string, Record<number, z.ZodType>>

const registry: SchemaRegistry = {
  "ops.component_deployment.drifted": {
    1: z
      .object({
        componentDeploymentSlug: z.string(),
        desiredImage: z.string().optional(),
        actualImage: z.string().optional(),
        siteSlug: z.string().optional(),
      })
      .passthrough(),
  },
  "ops.component_deployment.reconciled": {
    1: z
      .object({
        componentDeploymentSlug: z.string(),
        image: z.string().optional(),
      })
      .passthrough(),
  },
  "ops.workspace.created": {
    1: z
      .object({
        workspaceId: z.string(),
        name: z.string().optional(),
      })
      .passthrough(),
  },
  "ops.workspace.health_changed": {
    1: z
      .object({
        workspaceId: z.string(),
        previousHealth: z.string().optional(),
        newHealth: z.string(),
      })
      .passthrough(),
  },
  "ops.workspace.ready": {
    1: z
      .object({
        workspaceId: z.string(),
        status: z.string(),
      })
      .passthrough(),
  },
  "org.agent.session_started": {
    1: z
      .object({
        source: z.string().optional(),
        threadId: z.string().optional(),
        agentSlug: z.string().optional(),
        channelId: z.string().optional(),
      })
      .passthrough(),
  },
  "org.agent.session_completed": {
    1: z
      .object({
        source: z.string().optional(),
        threadId: z.string().optional(),
      })
      .passthrough(),
  },
  "org.thread.created": {
    1: z
      .object({
        threadId: z.string(),
        channelId: z.string().optional(),
        source: z.string().optional(),
      })
      .passthrough(),
  },
  "infra.host.discovered": {
    1: z
      .object({
        hostSlug: z.string(),
        hostname: z.string().optional(),
        ipAddress: z.string().optional(),
      })
      .passthrough(),
  },
  "infra.host.status_changed": {
    1: z
      .object({
        hostSlug: z.string(),
        previousStatus: z.string().optional(),
        newStatus: z.string(),
      })
      .passthrough(),
  },
}

/**
 * Validate event data against the registered schema for the given topic and version.
 * Returns { valid: true, data } on success or unknown topic.
 * Returns { valid: false, errors } on validation failure.
 */
export function validateEventData(
  topic: string,
  data: Record<string, unknown>,
  schemaVersion: number = 1
):
  | { valid: true; data: Record<string, unknown> }
  | { valid: false; errors: string[] } {
  const topicSchemas = registry[topic]
  if (!topicSchemas) {
    logger.debug({ topic }, "event-schemas: no schema registered for topic")
    return { valid: true, data }
  }

  const schema =
    topicSchemas[schemaVersion] ??
    topicSchemas[Math.max(...Object.keys(topicSchemas).map(Number))]
  if (!schema) {
    return { valid: true, data }
  }

  const result = schema.safeParse(data)
  if (result.success) {
    return { valid: true, data: result.data as Record<string, unknown> }
  }

  return {
    valid: false,
    errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  }
}
