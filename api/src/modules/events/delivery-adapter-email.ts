import { logger } from "../../logger"
import type { DeliveryAdapter, DeliveryContext } from "./delivery-adapter"

const log = logger.child({ module: "delivery-email" })

export class EmailDeliveryAdapter implements DeliveryAdapter {
  readonly provider = "email"

  async deliver(
    target: string,
    rendered: unknown,
    ctx: DeliveryContext
  ): Promise<{ ok: boolean; error?: string }> {
    const output = rendered as { subject?: string; html?: string }

    log.info(
      {
        to: target,
        subject: output.subject ?? `[${ctx.severity}] ${ctx.topic}`,
        topic: ctx.topic,
        eventId: ctx.eventId,
      },
      "email delivery (stub): would send email"
    )

    return { ok: true }
  }
}
