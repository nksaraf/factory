export interface DeliveryContext {
  eventId: string
  topic: string
  severity: string
  source: string
  occurredAt: string
}

export interface DeliveryAdapter {
  readonly provider: string

  deliver(
    target: string,
    rendered: unknown,
    ctx: DeliveryContext
  ): Promise<{ ok: boolean; error?: string }>
}

const adapters = new Map<string, DeliveryAdapter>()

export function registerDeliveryAdapter(adapter: DeliveryAdapter): void {
  adapters.set(adapter.provider, adapter)
}

export function getDeliveryAdapter(provider: string): DeliveryAdapter | null {
  return adapters.get(provider) ?? null
}

export function listDeliveryAdapters(): string[] {
  return Array.from(adapters.keys())
}

export function providerToRenderFormat(
  provider: string
): "cli" | "web" | "slack" | "email" {
  switch (provider) {
    case "slack":
    case "teams":
    case "google-chat":
      return "slack"
    case "email":
      return "email"
    case "web":
      return "web"
    default:
      return "web"
  }
}
