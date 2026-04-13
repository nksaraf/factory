/**
 * Workflow Engine Foundation
 *
 * This is the abstraction layer for the Vercel Workflow SDK.
 * All workflow code goes through the functions exported here.
 *
 * The Workflow SDK handles durability via "use workflow" / "use step" directives.
 * This file provides a registry for API discovery and lazy re-exports of SDK primitives.
 *
 * SDK imports are lazy because the workflow package has transitive dependencies
 * that fail to load in test environments. The actual SDK functions only work
 * within a workflow context anyway.
 */

import type { z } from "zod"

// ── Lazy SDK re-exports ──────────────────────────────────
// These are only callable within a running workflow context.

export async function sleep(duration: string) {
  const { sleep: sdkSleep } = await import("workflow")
  return sdkSleep(duration)
}

export async function createWebhook() {
  const { createWebhook: sdkCreateWebhook } = await import("workflow")
  return sdkCreateWebhook()
}

export async function getStepMetadata() {
  const { getStepMetadata: sdkGetStepMetadata } = await import("workflow")
  return sdkGetStepMetadata()
}

export async function start<TInput>(
  fn: (input: TInput) => Promise<unknown>,
  args: [TInput]
) {
  const { start: sdkStart } = await import("workflow/api")
  return sdkStart(fn, args)
}

export async function getRun(runId: string) {
  const { getRun: sdkGetRun } = await import("workflow/api")
  return sdkGetRun(runId)
}

// ── Types ─────────────────────────────────────────────────

export type TriggerType =
  | "jira_webhook"
  | "github_webhook"
  | "cli"
  | "manual"
  | "schedule"
  | "workflow"

export interface WorkflowDefinition<TInput = unknown, TOutput = unknown> {
  name: string
  description: string
  inputSchema: z.ZodSchema<TInput>
  triggerTypes: TriggerType[]
  fn: (input: TInput) => Promise<TOutput>
}

// ── Registry ──────────────────────────────────────────────

const registry = new Map<string, WorkflowDefinition>()

/** List all registered workflow definitions. */
export function listWorkflowDefinitions(): WorkflowDefinition[] {
  return Array.from(registry.values())
}

/** Get a workflow definition by name. */
export function getWorkflowDefinition(
  name: string
): WorkflowDefinition | undefined {
  return registry.get(name)
}

// ── registerWorkflow ─────────────────────────────────────

/**
 * Register a workflow for API discovery. The workflow function itself
 * uses the "use workflow" directive for durability — this just adds
 * it to the registry so REST/CLI can find and start it.
 *
 * Returns the workflow function for convenience.
 */
export function registerWorkflow<TInput, TOutput>(opts: {
  name: string
  description: string
  inputSchema: z.ZodSchema<TInput>
  triggerTypes: TriggerType[]
  fn: (input: TInput) => Promise<TOutput>
}): (input: TInput) => Promise<TOutput> {
  const def: WorkflowDefinition<TInput, TOutput> = { ...opts }
  registry.set(opts.name, def as WorkflowDefinition)
  return opts.fn
}
