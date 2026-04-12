import { logger } from "../../logger"
import type { DeliveryAdapter, DeliveryContext } from "./delivery-adapter"

const log = logger.child({ module: "delivery-chat" })

export class ChatDeliveryAdapter implements DeliveryAdapter {
  readonly provider: string

  constructor(provider: string) {
    this.provider = provider
  }

  async deliver(
    target: string,
    rendered: unknown,
    ctx: DeliveryContext
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const { bot, adapters } = await import("../../modules/chat/bot")

      if (!adapters[this.provider]) {
        return {
          ok: false,
          error: `Chat SDK adapter not configured for ${this.provider}`,
        }
      }

      await bot.initialize()

      const dmThread = await bot.openDM(target)

      let text: string
      let blocks: unknown[] | undefined

      if (Array.isArray(rendered)) {
        blocks = rendered
        const firstBlock = rendered[0] as { text?: { text?: string } }
        text = firstBlock?.text?.text ?? `[${ctx.severity}] ${ctx.topic}`
      } else if (typeof rendered === "string") {
        text = rendered
      } else {
        const output = rendered as { title?: string; body?: string }
        text = output.title
          ? `*${output.title}*\n${output.body ?? ""}`
          : `[${ctx.severity}] ${ctx.topic}`
      }

      await dmThread.post(text, blocks ? { blocks } : undefined)

      log.info(
        { provider: this.provider, target, topic: ctx.topic },
        "delivered notification via Chat SDK"
      )

      return { ok: true }
    } catch (err) {
      const error =
        err instanceof Error ? err.message : "unknown delivery error"
      log.error(
        { provider: this.provider, target, topic: ctx.topic, err },
        "failed to deliver notification via Chat SDK"
      )
      return { ok: false, error }
    }
  }
}
