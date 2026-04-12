import { logger } from "../../logger"
import type { DeliveryAdapter, DeliveryContext } from "./delivery-adapter"

const log = logger.child({ module: "delivery-web" })

export class WebDeliveryAdapter implements DeliveryAdapter {
  readonly provider = "web"

  async deliver(
    target: string,
    rendered: unknown,
    ctx: DeliveryContext
  ): Promise<{ ok: boolean; error?: string }> {
    log.info(
      {
        principalId: target,
        topic: ctx.topic,
        eventId: ctx.eventId,
      },
      "web delivery: notification stored for client polling"
    )

    return { ok: true }
  }
}
