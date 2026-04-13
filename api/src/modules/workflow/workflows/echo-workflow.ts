/**
 * Echo Workflow — minimal smoke test for the workflow engine.
 *
 * Echoes the input message back. Optionally waits for an event before completing.
 * Use this to verify workflow init, event matching, and the full CLI/REST pipeline
 * without needing real adapters.
 *
 * Usage:
 *   dx workflow start echo-workflow --input '{"message":"hello"}'
 *   dx workflow start echo-workflow --input '{"message":"waiting","waitForEvent":"test.ping","waitMatch":{"id":"abc"}}'
 *   dx workflow emit test.ping --data '{"id":"abc","payload":"pong"}'
 */

import { z } from "zod"

import { registerWorkflow } from "../../../lib/workflow-engine"
import { waitForEvent } from "../../../lib/workflow-events"
import { getWorkflowDb, updateRun } from "../../../lib/workflow-helpers"

const echoWorkflowInputSchema = z.object({
  /** Message to echo back */
  message: z.string(),

  /** If set, workflow waits for this event name before completing */
  waitForEvent: z.string().optional(),

  /** JSONB fields to match when waiting for event */
  waitMatch: z.record(z.string()).optional(),

  /** Timeout in seconds for event wait (default 300 = 5 min) */
  waitTimeout: z.number().default(300),
})

export type EchoWorkflowInput = z.infer<typeof echoWorkflowInputSchema>

async function echoWorkflowFn(input: EchoWorkflowInput) {
  "use workflow"
  const db = getWorkflowDb()
  // Workflow run ID comes from the REST trigger that created the workflow_run row
  // and passed it as part of the start() call. For business state tracking we
  // use the run ID that was pre-allocated by the trigger.
  const wfId = (input as unknown as { _workflowRunId?: string })._workflowRunId

  if (wfId) {
    await updateRun(db, wfId, {
      phase: "running",
      state: { message: input.message },
    })
  }

  let receivedEvent: unknown = null

  if (input.waitForEvent) {
    if (wfId) {
      await updateRun(db, wfId, {
        phase: "waiting",
        state: {
          waitingFor: input.waitForEvent,
          waitMatch: input.waitMatch ?? {},
        },
      })
    }

    receivedEvent = await waitForEvent(
      input.waitForEvent,
      input.waitMatch ?? {},
      input.waitTimeout
    )

    if (wfId) {
      if (receivedEvent) {
        await updateRun(db, wfId, { state: { receivedEvent } })
      } else {
        await updateRun(db, wfId, {
          state: { receivedEvent: null, timedOut: true },
        })
      }
    }
  }

  const output = {
    echo: input.message,
    receivedEvent,
    timestamp: new Date().toISOString(),
  }

  if (wfId) {
    await updateRun(db, wfId, {
      phase: "completed",
      status: "succeeded",
      output,
      completedAt: new Date(),
    })
  }

  return output
}

export const echoWorkflow = registerWorkflow({
  name: "echo-workflow",
  description: "Smoke test: echoes input back, optionally waits for an event",
  triggerTypes: ["cli", "manual"],
  inputSchema: echoWorkflowInputSchema as z.ZodType<EchoWorkflowInput>,
  fn: echoWorkflowFn,
})
