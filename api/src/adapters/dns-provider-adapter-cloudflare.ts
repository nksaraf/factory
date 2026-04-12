import type {
  CreateDnsRecordInput,
  DnsProviderAdapter,
  DnsProviderAdapterConfig,
  DnsRecordEntry,
  DnsZone,
  UpdateDnsRecordInput,
} from "./dns-provider-adapter"

const CF_API = "https://api.cloudflare.com/client/v4"

interface CfApiResponse<T> {
  success: boolean
  result: T
  errors?: Array<{ message: string }>
}

export class CloudflareDnsProviderAdapter implements DnsProviderAdapter {
  readonly type = "cloudflare" as const
  private readonly token: string

  constructor(config: DnsProviderAdapterConfig) {
    this.token = config.apiToken
  }

  private async cfFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${CF_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new Error(
        `Cloudflare API ${init?.method ?? "GET"} ${path}: ${res.status} ${res.statusText} ${body}`
      )
    }
    const json = (await res.json()) as CfApiResponse<T>
    if (!json.success) {
      const msgs = json.errors?.map((e) => e.message).join("; ") ?? "unknown"
      throw new Error(`Cloudflare API error: ${msgs}`)
    }
    return json.result
  }

  // ── Read ───────────────────────────────────────────────────

  async listZones(): Promise<DnsZone[]> {
    const zones = await this.cfFetch<
      Array<{ id: string; name: string; status: string }>
    >("/zones?per_page=100")

    return zones.map((z) => ({
      externalId: z.id,
      name: z.name,
      status: z.status,
    }))
  }

  async listRecords(zoneId: string): Promise<DnsRecordEntry[]> {
    const records = await this.cfFetch<
      Array<{
        id: string
        type: string
        name: string
        content: string
        ttl: number
        priority?: number
        proxied?: boolean
      }>
    >(`/zones/${zoneId}/dns_records?per_page=5000`)

    return records.map((r) => ({
      externalId: r.id,
      type: r.type,
      name: r.name,
      content: r.content,
      ttl: r.ttl,
      priority: r.priority,
      proxied: r.proxied,
    }))
  }

  // ── Write ──────────────────────────────────────────────────

  async createRecord(
    zoneId: string,
    record: CreateDnsRecordInput
  ): Promise<DnsRecordEntry> {
    const result = await this.cfFetch<{
      id: string
      type: string
      name: string
      content: string
      ttl: number
      priority?: number
      proxied?: boolean
    }>(`/zones/${zoneId}/dns_records`, {
      method: "POST",
      body: JSON.stringify({
        type: record.type,
        name: record.name,
        content: record.content,
        ttl: record.ttl ?? 1, // 1 = auto in Cloudflare
        priority: record.priority,
        proxied: record.proxied ?? false,
      }),
    })

    return {
      externalId: result.id,
      type: result.type,
      name: result.name,
      content: result.content,
      ttl: result.ttl,
      priority: result.priority,
      proxied: result.proxied,
    }
  }

  async updateRecord(
    zoneId: string,
    recordId: string,
    record: UpdateDnsRecordInput
  ): Promise<DnsRecordEntry> {
    const result = await this.cfFetch<{
      id: string
      type: string
      name: string
      content: string
      ttl: number
      priority?: number
      proxied?: boolean
    }>(`/zones/${zoneId}/dns_records/${recordId}`, {
      method: "PATCH",
      body: JSON.stringify(record),
    })

    return {
      externalId: result.id,
      type: result.type,
      name: result.name,
      content: result.content,
      ttl: result.ttl,
      priority: result.priority,
      proxied: result.proxied,
    }
  }

  async deleteRecord(zoneId: string, recordId: string): Promise<void> {
    await this.cfFetch(`/zones/${zoneId}/dns_records/${recordId}`, {
      method: "DELETE",
    })
  }
}
