import type {
  CreateDnsRecordInput,
  DnsProviderAdapter,
  DnsProviderAdapterConfig,
  DnsRecordEntry,
  DnsZone,
  UpdateDnsRecordInput,
} from "./dns-provider-adapter"

const GD_API = "https://api.godaddy.com"

interface GdDomain {
  domain: string
  domainId: number
  status: string
}

interface GdRecord {
  type: string
  name: string
  data: string
  ttl: number
  priority?: number
}

export class GoDaddyDnsProviderAdapter implements DnsProviderAdapter {
  readonly type = "godaddy" as const
  private readonly authHeader: string

  constructor(config: DnsProviderAdapterConfig) {
    const key = config.apiKey ?? config.apiToken
    const secret = config.apiSecret ?? ""
    this.authHeader = `sso-key ${key}:${secret}`
  }

  private async gdFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${GD_API}${path}`, {
      ...init,
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new Error(
        `GoDaddy API ${init?.method ?? "GET"} ${path}: ${res.status} ${res.statusText} ${body}`
      )
    }
    if (res.status === 204) return undefined as T
    return res.json() as Promise<T>
  }

  // GoDaddy has no record IDs — we synthesize one from type+name+data
  private syntheticId(rec: GdRecord): string {
    return `${rec.type}:${rec.name}:${rec.data}`
  }

  // Convert GoDaddy's relative name (@, www) to FQDN given the domain
  private toFqdn(name: string, domain: string): string {
    if (name === "@") return domain
    return `${name}.${domain}`
  }

  // ── Read ───────────────────────────────────────────────────

  async listZones(): Promise<DnsZone[]> {
    const domains = await this.gdFetch<GdDomain[]>(
      "/v1/domains?statuses=ACTIVE&limit=999"
    )

    return domains.map((d) => ({
      externalId: d.domain, // GoDaddy uses domain name as the zone identifier
      name: d.domain,
      status: d.status.toLowerCase(),
    }))
  }

  async listRecords(zoneId: string): Promise<DnsRecordEntry[]> {
    // zoneId is the domain name for GoDaddy
    const records = await this.gdFetch<GdRecord[]>(
      `/v1/domains/${zoneId}/records`
    )

    return records.map((r) => ({
      externalId: this.syntheticId(r),
      type: r.type,
      name: this.toFqdn(r.name, zoneId),
      content: r.data,
      ttl: r.ttl,
      priority: r.priority,
    }))
  }

  // ── Write ──────────────────────────────────────────────────

  async createRecord(
    zoneId: string,
    record: CreateDnsRecordInput
  ): Promise<DnsRecordEntry> {
    // PATCH adds records
    const gdRecord: GdRecord = {
      type: record.type,
      name: this.toRelativeName(record.name, zoneId),
      data: record.content,
      ttl: record.ttl ?? 3600,
      priority: record.priority,
    }

    await this.gdFetch(`/v1/domains/${zoneId}/records`, {
      method: "PATCH",
      body: JSON.stringify([gdRecord]),
    })

    return {
      externalId: this.syntheticId(gdRecord),
      type: gdRecord.type,
      name: this.toFqdn(gdRecord.name, zoneId),
      content: gdRecord.data,
      ttl: gdRecord.ttl,
      priority: gdRecord.priority,
    }
  }

  async updateRecord(
    zoneId: string,
    recordId: string,
    record: UpdateDnsRecordInput
  ): Promise<DnsRecordEntry> {
    // recordId is "TYPE:NAME:DATA" — parse to find existing record
    const [origType, origName] = recordId.split(":")

    // Read all records of that type+name, update the matching one, PUT back
    const existing = await this.gdFetch<GdRecord[]>(
      `/v1/domains/${zoneId}/records/${origType}/${origName}`
    )

    const updated = existing.map((r) => {
      if (this.syntheticId(r) === recordId) {
        return {
          ...r,
          data: record.content ?? r.data,
          ttl: record.ttl ?? r.ttl,
          priority: record.priority ?? r.priority,
        }
      }
      return r
    })

    await this.gdFetch(
      `/v1/domains/${zoneId}/records/${origType}/${origName}`,
      { method: "PUT", body: JSON.stringify(updated) }
    )

    const result =
      updated.find(
        (r) =>
          r.data === (record.content ?? recordId.split(":").slice(2).join(":"))
      ) ?? updated[0]

    return {
      externalId: this.syntheticId(result),
      type: result.type,
      name: this.toFqdn(result.name, zoneId),
      content: result.data,
      ttl: result.ttl,
      priority: result.priority,
    }
  }

  async deleteRecord(zoneId: string, recordId: string): Promise<void> {
    const [type, name, ...dataParts] = recordId.split(":")
    const data = dataParts.join(":")

    // Read existing records for this type+name
    const existing = await this.gdFetch<GdRecord[]>(
      `/v1/domains/${zoneId}/records/${type}/${name}`
    )

    const remaining = existing.filter((r) => r.data !== data)

    if (remaining.length === 0) {
      // Delete all records of this type+name
      await this.gdFetch(`/v1/domains/${zoneId}/records/${type}/${name}`, {
        method: "DELETE",
      })
    } else {
      // PUT back only the remaining records
      await this.gdFetch(`/v1/domains/${zoneId}/records/${type}/${name}`, {
        method: "PUT",
        body: JSON.stringify(remaining),
      })
    }
  }

  // ── Helpers ────────────────────────────────────────────────

  private toRelativeName(fqdn: string, domain: string): string {
    if (fqdn === domain) return "@"
    if (fqdn.endsWith(`.${domain}`)) {
      return fqdn.slice(0, -(domain.length + 1))
    }
    return fqdn
  }
}
