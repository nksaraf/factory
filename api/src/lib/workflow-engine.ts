/**
 * Workflow Engine Foundation
 *
 * This is the ONLY file that imports DBOS. All workflow code goes through
 * the functions exported here: createStep, createWorkflow, getWorkflowId, sleep.
 *
 * Swapping DBOS for Restate/Inngest means changing this one file.
 */

import { DBOS } from "@dbos-inc/dbos-sdk";
import type { z } from "zod";

// ── Types ─────────────────────────────────────────────────

export type TriggerType =
  | "jira_webhook"
  | "github_webhook"
  | "cli"
  | "manual"
  | "schedule"
  | "workflow";

export interface WorkflowDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodSchema<TInput>;
  triggerTypes: TriggerType[];
  fn: (input: TInput) => Promise<TOutput>;
}

export interface StepOptions {
  name: string;
  retries?: {
    maxAttempts?: number;
    intervalSeconds?: number;
    backoffRate?: number;
  };
}

// ── Registry ──────────────────────────────────────────────

const registry = new Map<string, WorkflowDefinition>();

/** List all registered workflow definitions. */
export function listWorkflowDefinitions(): WorkflowDefinition[] {
  return Array.from(registry.values());
}

/** Get a workflow definition by name. */
export function getWorkflowDefinition(
  name: string,
): WorkflowDefinition | undefined {
  return registry.get(name);
}

// ── createStep ────────────────────────────────────────────

/**
 * Define a checkpointed step. DBOS records the return value so that on
 * replay (crash recovery) the step body is skipped.
 */
export function createStep<TInput, TOutput>(opts: {
  name: string;
  fn: (input: TInput) => Promise<TOutput>;
  retries?: StepOptions["retries"];
}) {
  return DBOS.registerStep(async (input: TInput) => opts.fn(input), {
    name: opts.name,
    ...opts.retries,
  });
}

// ── createWorkflow ────────────────────────────────────────

/**
 * Define a durable workflow. The function is registered with DBOS for
 * checkpoint-based replay and added to the global registry for API discovery.
 */
export function createWorkflow<TInput, TOutput>(opts: {
  name: string;
  description: string;
  inputSchema: z.ZodSchema<TInput>;
  triggerTypes: TriggerType[];
  fn: (input: TInput) => Promise<TOutput>;
}) {
  const fn = DBOS.registerWorkflow(opts.fn, { name: opts.name });
  const def: WorkflowDefinition<TInput, TOutput> = { ...opts, fn };
  registry.set(opts.name, def as WorkflowDefinition);
  return fn;
}

// ── Context helpers ───────────────────────────────────────

/** Get the current workflow run ID (only valid inside a workflow). */
export function getWorkflowId(): string {
  const id = DBOS.workflowID;
  if (!id) throw new Error("getWorkflowId() called outside a workflow context");
  return id;
}

/** Durable sleep — survives process restarts. */
export function sleep(ms: number) {
  return DBOS.sleep(ms);
}

/** Durable receive — suspends until a message arrives on the given topic. */
export function recv<T>(topic: string, timeoutSec: number): Promise<T | null> {
  return DBOS.recv<T>(topic, timeoutSec);
}

/** Send a message to a workflow by ID on a given topic. */
export function send(workflowId: string, data: unknown, topic: string) {
  return DBOS.send(workflowId, data, topic);
}

// ── Start / query workflows ───────────────────────────────

/** Start a workflow. Returns a handle to check status / get result. */
export function startWorkflow<TInput, TOutput>(
  workflowFn: (input: TInput) => Promise<TOutput>,
  input: TInput,
  workflowId?: string,
) {
  return DBOS.startWorkflow(workflowFn, { workflowID: workflowId })(input);
}

/** Get the status of a workflow by ID. */
export function getWorkflowStatus(workflowId: string) {
  return DBOS.getWorkflowStatus(workflowId);
}

// ── Engine lifecycle ──────────────────────────────────────

/** Initialize the workflow engine. Call once at server boot. */
export async function initWorkflowEngine(databaseUrl: string) {
  DBOS.setConfig({
    name: "factory",
    systemDatabaseUrl: databaseUrl,
  });
  await DBOS.launch();
}

/** Shut down the workflow engine. Call on server exit. */
export async function shutdownWorkflowEngine() {
  await DBOS.shutdown();
}
