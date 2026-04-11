import { and, eq, lt, or } from "drizzle-orm"

import type { Database } from "../../db/connection"
import { eventAlert } from "../../db/schema/org"
import { logger } from "../../logger"

export function startEscalationWorker(
  db: Database,
  intervalMs = 60_000
): { stop: () => void } {
  const timer = setInterval(() => processEscalations(db), intervalMs)
  logger.info("escalation-worker: started")
  return {
    stop: () => {
      clearInterval(timer)
      logger.info("escalation-worker: stopped")
    },
  }
}

async function processEscalations(db: Database): Promise<void> {
  try {
    const alerts = await db
      .select()
      .from(eventAlert)
      .where(
        and(
          or(
            eq(eventAlert.status, "firing"),
            eq(eventAlert.status, "escalated")
          ),
          lt(eventAlert.nextEscalation, new Date())
        )
      )

    for (const alert of alerts) {
      const spec = (alert.spec ?? {}) as {
        escalationPolicy?: {
          steps: Array<{
            delayMinutes: number
            targetPrincipalId: string
          }>
        }
        notificationHistory?: Array<{ channel: string; deliveredAt: string }>
      }

      const policy = spec.escalationPolicy
      if (!policy?.steps?.length) {
        // No escalation policy — mark as escalated (terminal)
        await db
          .update(eventAlert)
          .set({ status: "escalated", nextEscalation: null })
          .where(eq(eventAlert.id, alert.id))
        continue
      }

      const currentStep = alert.escalationStep
      const nextStep = currentStep + 1

      if (nextStep >= policy.steps.length) {
        // All steps exhausted — mark as escalated (terminal)
        await db
          .update(eventAlert)
          .set({
            status: "escalated",
            escalationStep: nextStep,
            nextEscalation: null,
          })
          .where(eq(eventAlert.id, alert.id))
        logger.warn(
          { alertId: alert.id, steps: policy.steps.length },
          "escalation-worker: all escalation steps exhausted"
        )
        continue
      }

      const step = policy.steps[nextStep]
      const nextDelay = step.delayMinutes * 60_000
      const history = spec.notificationHistory ?? []
      history.push({
        channel: `escalation:${step.targetPrincipalId}`,
        deliveredAt: new Date().toISOString(),
      })

      await db
        .update(eventAlert)
        .set({
          status: "escalated",
          escalationStep: nextStep,
          nextEscalation: new Date(Date.now() + nextDelay),
          spec: { ...spec, notificationHistory: history },
        })
        .where(eq(eventAlert.id, alert.id))

      logger.info(
        {
          alertId: alert.id,
          step: nextStep,
          target: step.targetPrincipalId,
        },
        "escalation-worker: escalated alert"
      )
    }

    if (alerts.length > 0) {
      logger.info(
        { count: alerts.length },
        "escalation-worker: processed escalations"
      )
    }
  } catch (err) {
    logger.error({ err }, "escalation-worker: error processing escalations")
  }
}
